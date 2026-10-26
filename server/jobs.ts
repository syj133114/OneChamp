import { AppError, database } from './errors';
import { aggregate, rankOrder } from './analysis';
import { assertKey, parseRiotId, RiotClient } from './riot';
import { oneChampPolicy } from '../src/policy';
import type { AnalysisJob, Specialist, SpecialistList, SpecialistSort } from '../src/models';
import type { AnalysisSnapshot, Env, JobPayload, JobRow, MatchSummary } from './types';
const CACHE_MS = 60 * 60 * 1000;
const stamp = () => new Date().toISOString();
export function publicJob(job: JobRow): AnalysisJob {
  const data: JobPayload = JSON.parse(job.payload);
  return { id: job.id, status: job.status, phase: job.phase, processedGames: data.cursor, requestedGames: data.matchIds?.length ?? null, retryAfterMs: Math.max(0, job.retry_at - Date.now()), error: job.error_code ? { code: job.error_code, message: job.error_message! } : null, ...(data.snapshot ? { result: data.snapshot } : {}) };
}
export async function getJob(db: D1Database, id: string): Promise<JobRow> {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').bind(id).first<JobRow>();
  if (!job) throw new AppError('JOB_NOT_FOUND', '분석 작업을 찾을 수 없습니다.', 404);
  return job;
}
export async function createJob(env: Env, input: { riotId?: string; puuid?: string }): Promise<AnalysisJob> {
  assertKey(env);
  const db = database(env);
  let subject: string, snapshot: AnalysisSnapshot | undefined;
  if (input.riotId) {
    const id = parseRiotId(input.riotId);
    subject = `riot:${id.gameName.toLowerCase()}#${id.tagLine.toLowerCase()}`;
    const row = await db.prepare('SELECT payload FROM snapshots WHERE riot_name=? COLLATE NOCASE AND riot_tag=? COLLATE NOCASE').bind(id.gameName, id.tagLine).first<{ payload: string }>();
    if (row) snapshot = JSON.parse(row.payload);
  } else if (input.puuid) {
    subject = `puuid:${input.puuid}`;
    const row = await db.prepare('SELECT payload FROM snapshots WHERE puuid=?').bind(input.puuid).first<{ payload: string }>();
    if (row) snapshot = JSON.parse(row.payload);
  } else throw new AppError('INVALID_RIOT_ID', 'Riot ID를 입력하세요.', 400);
  const active = await db.prepare("SELECT * FROM jobs WHERE subject=? AND status='running'").bind(subject).first<JobRow>();
  if (active) return publicJob(active);
  const fresh = snapshot?.complete && Date.now() - Date.parse(snapshot.updatedAt) < CACHE_MS;
  const payload: JobPayload = { ...input, cursor: 0, matches: [], unavailableGames: 0, ...(fresh ? { snapshot } : {}) };
  const id = crypto.randomUUID(), now = stamp();
  const phase = fresh ? 'done' : 'account';
  // Race-safe deduplication via the partial unique index.
  await db.prepare('INSERT OR IGNORE INTO jobs(id,subject,status,phase,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(id, subject, fresh ? 'completed' : 'running', phase, JSON.stringify(payload), now, now).run();
  const job = await db.prepare("SELECT * FROM jobs WHERE id=? OR (subject=? AND status='running') ORDER BY created_at DESC LIMIT 1").bind(id, subject).first<JobRow>();
  if (!job) throw new AppError('JOB_CREATE_FAILED', '분석 작업을 생성하지 못했습니다.', 500);
  return publicJob(job);
}
async function persistSnapshot(db: D1Database, snapshot: AnalysisSnapshot) {
  if (!snapshot.complete) return; // Partial collection cannot replace a verified complete snapshot.
  const statements = [
    db.prepare('INSERT INTO snapshots(puuid,riot_name,riot_tag,updated_at,payload) VALUES(?,?,?,?,?) ON CONFLICT(puuid) DO UPDATE SET riot_name=excluded.riot_name,riot_tag=excluded.riot_tag,updated_at=excluded.updated_at,payload=excluded.payload').bind(snapshot.puuid, snapshot.riotId.gameName, snapshot.riotId.tagLine, snapshot.updatedAt, JSON.stringify(snapshot)),
    db.prepare('DELETE FROM champion_stats WHERE puuid=?').bind(snapshot.puuid),
  ];
  for (const p of snapshot.specialists) {
    const a = p.analysis;
    const pickRate = a.championGames / a.totalGames;
    if (pickRate < oneChampPolicy.minimumPickRate || !['candidate', 'insufficient'].includes(p.recognition.status)) continue;
    statements.push(db.prepare('INSERT INTO champion_stats(puuid,champion_id,pick_rate,champion_games,win_rate,mastery_points,rank_order,recognition,payload) VALUES(?,?,?,?,?,?,?,?,?)').bind(p.puuid, p.championId, pickRate, a.championGames, a.championWins / a.championGames, p.mastery?.points ?? null, rankOrder(p.rank), p.recognition.status, JSON.stringify(p)));
  }
  await db.batch(statements);
}
export async function advanceJob(env: Env, id: string, fetcher: typeof fetch = fetch): Promise<AnalysisJob> {
  assertKey(env); const db = database(env);
  let job = await getJob(db, id);
  if (job.status !== 'running' || job.retry_at > Date.now()) return publicJob(job);
  const leaseToken = crypto.randomUUID();
  const lease = await db.prepare("UPDATE jobs SET lease_token=?,lease_until=? WHERE id=? AND status='running' AND lease_until<=?").bind(leaseToken, Date.now() + 60_000, id, Date.now()).run();
  if (!lease.meta.changes) return { ...publicJob(job), retryAfterMs: 1500 };
  job = await getJob(db, id);
  const payload: JobPayload = JSON.parse(job.payload);
  const client = new RiotClient(env, db, fetcher);
  let phase = job.phase, status = job.status;
  try {
    if (phase === 'account') {
      payload.account = payload.puuid ? await client.accountByPuuid(payload.puuid) : await client.accountById(payload.riotId!);
      payload.puuid = payload.account.puuid;
      await db.prepare('INSERT OR IGNORE INTO candidates(puuid,source,discovered_at) VALUES(?,?,?)').bind(payload.puuid, payload.riotId ? 'riot-id' : 'ladder', stamp()).run();
      const cached = await db.prepare('SELECT payload FROM snapshots WHERE puuid=?').bind(payload.puuid).first<{ payload: string }>();
      const snapshot: AnalysisSnapshot | undefined = cached ? JSON.parse(cached.payload) : undefined;
      if (snapshot?.complete && Date.now() - Date.parse(snapshot.updatedAt) < CACHE_MS && snapshot.riotId.gameName === payload.account.gameName && snapshot.riotId.tagLine === payload.account.tagLine) { payload.snapshot = snapshot; phase = 'done'; status = 'completed'; }
      else phase = 'rank';
    } else if (phase === 'rank') { payload.rank = await client.rank(payload.puuid!); phase = 'mastery'; }
    else if (phase === 'mastery') { payload.masteries = await client.mastery(payload.puuid!); phase = 'ids'; }
    else if (phase === 'ids') { payload.matchIds = await client.matchIds(payload.puuid!); phase = 'matches'; }
    else if (phase === 'matches') {
      // One upstream request per advance; cached matches are reused without a Riot call.
      for (let reused = 0; reused < 10 && payload.cursor < payload.matchIds!.length; reused++) {
        const matchId = payload.matchIds![payload.cursor];
        const cached = await db.prepare('SELECT payload FROM matches WHERE match_id=?').bind(matchId).first<{ payload: string }>();
        let match: MatchSummary | undefined;
        if (cached) match = JSON.parse(cached.payload);
        else {
          try { match = await client.match(matchId); }
          catch (error) { if (error instanceof AppError && error.code === 'RIOT_NOT_FOUND') payload.unavailableGames++; else throw error; }
          if (match) await db.prepare('INSERT OR IGNORE INTO matches(match_id,payload,fetched_at) VALUES(?,?,?)').bind(matchId, JSON.stringify(match), stamp()).run();
        }
        if (match) payload.matches.push(match);
        payload.cursor++;
        if (!cached) break; // At most one upstream request; reuse up to ten stored matches.
      }
      if (payload.cursor === payload.matchIds!.length) {
        payload.snapshot = aggregate(payload, stamp());
        await persistSnapshot(db, payload.snapshot);
        phase = 'done'; status = 'completed';
      }
    } else throw new AppError('INVALID_JOB_PHASE', '알 수 없는 분석 단계입니다.', 500);
    await db.prepare('UPDATE jobs SET status=?,phase=?,payload=?,retry_at=0,attempts=0,error_code=NULL,error_message=NULL,updated_at=? WHERE id=? AND lease_token=?').bind(status, phase, JSON.stringify(payload), stamp(), id, leaseToken).run();
  } catch (error) {
    const e = error instanceof AppError ? error : new AppError('COLLECTION_FAILED', '분석 저장 중 오류가 발생했습니다. 결과를 추정하지 않았습니다.', 500);
    const waiting = ['RATE_WAIT', 'RIOT_RATE_LIMIT'].includes(e.code);
    const transient = ['RIOT_NETWORK', 'RIOT_UNAVAILABLE'].includes(e.code);
    const attempts = waiting ? job.attempts : job.attempts + 1;
    const retry = waiting || (transient && attempts <= 3);
    await db.prepare('UPDATE jobs SET status=?,error_code=?,error_message=?,retry_at=?,attempts=?,updated_at=? WHERE id=? AND lease_token=?').bind(retry ? 'running' : 'failed', e.code, e.message, retry ? Date.now() + Math.max(1350, e.retryAfter) : 0, attempts, stamp(), id, leaseToken).run();
  } finally {
    await db.prepare('UPDATE jobs SET lease_until=0,lease_token=NULL WHERE id=? AND lease_token=?').bind(id, leaseToken).run();
  }
  return publicJob(await getJob(db, id));
}
export async function listSpecialists(env: Env, championId: string, sort: SpecialistSort): Promise<SpecialistList> {
  const db = database(env);
  const order = { pickrate: 'pick_rate DESC,champion_games DESC,puuid', mastery: 'mastery_points DESC,pick_rate DESC,puuid', winrate: 'win_rate DESC,champion_games DESC,puuid', rank: 'rank_order DESC,pick_rate DESC,puuid' }[sort];
  const rows = await db.prepare(`SELECT payload FROM champion_stats WHERE champion_id=? ${sort === 'winrate' ? 'AND champion_games>=?' : ''} ORDER BY ${order} LIMIT 100`).bind(...(sort === 'winrate' ? [championId, oneChampPolicy.minimumWinRateGames] : [championId])).all<{ payload: string }>();
  const info = await db.prepare('SELECT COUNT(*) AS count,MAX(updated_at) AS updated_at FROM snapshots').first<{ count: number; updated_at: string | null }>();
  const count = await db.prepare('SELECT COUNT(*) AS count FROM champion_stats WHERE champion_id=?').bind(championId).first<{ count: number }>();
  return { players: rows.results.map(r => JSON.parse(r.payload) as Specialist), analyzedUsers: info?.count ?? 0, matchingUsers: count?.count ?? 0, updatedAt: info?.updated_at ?? null, scope: 'OneChamp가 분석한 유저 중', minimumWinRateGames: oneChampPolicy.minimumWinRateGames };
}
export async function collectCandidates(env: Env, tier: 'challenger' | 'grandmaster' | 'master', limit: number) {
  assertKey(env); const db = database(env);
  const ladder = await new RiotClient(env, db).ladder(tier);
  const picked: string[] = [];
  // Store only real identifiers returned by League-V4. Limit analysis to 1–3 users per request.
  for (const puuid of ladder.puuids) {
    const existing = await db.prepare('SELECT puuid FROM candidates WHERE puuid=?').bind(puuid).first();
    if (!existing) picked.push(puuid);
    if (picked.length >= limit) break;
  }
  if (picked.length) await db.batch(picked.map(puuid => db.prepare('INSERT OR IGNORE INTO candidates(puuid,source,discovered_at) VALUES(?,?,?)').bind(puuid, tier, stamp())));
  const jobs: AnalysisJob[] = [];
  for (const puuid of picked) jobs.push(await createJob(env, { puuid }));
  const result = { tier, availableIdentifiers: ladder.puuids.length, missingIdentifiers: ladder.missingIdentifiers, selected: picked.length, jobs };
  await db.prepare('INSERT INTO collection_runs(id,tier,payload,created_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(), tier, JSON.stringify({ ...result, jobs: jobs.map(j => j.id) }), stamp()).run();
  return result;
}
