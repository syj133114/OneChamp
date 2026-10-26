// Synthetic protocol fixtures exist only in tests; never imported by application/server runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { aggregate } from '../server/analysis';
import { AppError } from '../server/errors';
import { RiotClient, parseRiotId, retryAfterMs } from '../server/riot';
import { advanceJob, collectCandidates, createJob, listSpecialists } from '../server/jobs';
import { route } from '../server/router';
import type { Env, JobPayload, MatchSummary } from '../server/types';
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('migrations/0001_initial.sql', 'utf8'));
  const adapter = {
    prepare(sql: string) {
      let params: unknown[] = [];
      const result = {
        bind(...values: unknown[]) { params = values; return result; },
        async first() { return sqlite.prepare(sql).get(...params as any[]) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...params as any[]), success: true }; },
        async run() { const r = sqlite.prepare(sql).run(...params as any[]); return { success: true, meta: { changes: Number(r.changes) } }; },
      }; return result;
    },
    async batch(statements: { run(): Promise<unknown> }[]) { sqlite.exec('BEGIN'); try { const r = []; for (const s of statements) r.push(await s.run()); sqlite.exec('COMMIT'); return r; } catch(e) { sqlite.exec('ROLLBACK'); throw e; } },
  } as unknown as D1Database;
  return { db: adapter, sqlite, reset: () => sqlite.exec('UPDATE riot_gate SET next_at=0,lease_until=0') };
}
const account = { puuid: 'protocol-test-subject', gameName: 'test-only', tagLine: 'TEST' };
function payload(count: number, championGames: number): JobPayload {
  const ids = Array.from({ length: count }, (_, i) => `KR_${i + 1}`);
  return { puuid: account.puuid, account, rank: { puuid: account.puuid, queueType: 'RANKED_SOLO_5x5', tier: 'MASTER', rank: 'I', leaguePoints: 100 }, masteries: [{ championId: 157, championLevel: 10, championPoints: 2000 }], matchIds: ids, cursor: count, unavailableGames: 0, matches: ids.map((id, i) => ({ id, queueId: 420, gameDuration: 1500, participants: [{ puuid: 'other-test-subject', championId: 103, win: false, gameEndedInEarlySurrender: false }, { puuid: account.puuid, championId: i < championGames ? 157 : 103, win: i % 2 === 0, gameEndedInEarlySurrender: false }] })) };
}
const env = (db: D1Database): Env => ({ DB: db, RIOT_API_KEY: 'test-only-not-a-real-key', APP_ENV: 'development' });
const now = '2026-10-26T00:00:00Z';
test('70%/20-game boundaries and exact PUUID participant/win denominators', () => {
  const p = aggregate(payload(20, 14), now).specialists.find(p => p.championId === 'Yasuo')!;
  assert.equal(p.recognition.status, 'candidate'); assert.equal(p.analysis.championWins, 7);
  assert.equal(p.analysis.championGames, 14); assert.equal(p.analysis.totalGames, 20);
  assert.equal(aggregate(payload(19, 19), now).specialists[0].recognition.status, 'insufficient');
  assert.equal(aggregate(payload(50, 34), now).specialists.find(p => p.championId === 'Yasuo')!.recognition.status, 'not-qualified');
  assert.equal(aggregate(payload(50, 35), now).specialists.find(p => p.championId === 'Yasuo')!.recognition.status, 'candidate');
});
test('remakes excluded, no invalid participant substitution, incomplete collection never qualifies', () => {
  const p = payload(20, 20); p.matches[0].gameDuration = 100;
  let result = aggregate(p, now); assert.equal(result.validGames, 19); assert.equal(result.excludedGames, 1); assert.equal(result.complete, true);
  p.matches[1].participants = p.matches[1].participants.filter(x => x.puuid !== account.puuid);
  result = aggregate(p, now); assert.equal(result.unavailableGames, 1); assert.equal(result.complete, false); assert.equal(result.specialists[0].recognition.status, 'incomplete');
  const missing = payload(20, 20); missing.matches.pop(); missing.unavailableGames = 1;
  assert.equal(aggregate(missing, now).complete, false);
  const noMastery = payload(20, 20); noMastery.masteries = [];
  assert.equal(aggregate(noMastery, now).specialists[0].mastery, null);
});
test('retry-after parses seconds and HTTP-date without retrying early', () => {
  assert.equal(retryAfterMs('4'), 4000); assert.equal(retryAfterMs('Thu, 01 Jan 1970 00:00:10 GMT', 0), 10000);
  assert.equal(retryAfterMs(null), 60000);
});
test('Riot ID validation and escaped path, no key in URL', async () => {
  assert.throws(() => parseRiotId('test'), AppError); assert.throws(() => parseRiotId('x#y#z'), AppError);
  const { db } = database(); let called = '';
  const client = new RiotClient(env(db), db, async (url, options) => {
    called = String(url); assert.equal((options!.headers as Record<string,string>)['X-Riot-Token'], 'test-only-not-a-real-key'); return Response.json(account);
  });
  await client.accountById('가 나#KR1'); assert.ok(called.includes('%EA%B0%80%20%EB%82%98/KR1')); assert.ok(!called.includes('api_key'));
});
test('Riot 401/403, 404, 429, 5xx and malformed responses are distinct', async () => {
  for (const [status, code] of [[401,'RIOT_AUTH'],[403,'RIOT_AUTH'],[404,'RIOT_NOT_FOUND'],[429,'RIOT_RATE_LIMIT'],[503,'RIOT_UNAVAILABLE']] as const) {
    const { db, sqlite } = database();
    const client = new RiotClient(env(db), db, async () => new Response('{}', { status, headers: { 'Retry-After': '7' } }));
    await assert.rejects(client.get('kr', '/test'), (e: AppError) => e.code === code && (status !== 429 || e.retryAfter >= 7000));
    if (status === 429) assert.ok((sqlite.prepare('SELECT next_at FROM riot_gate').get() as any).next_at >= Date.now() + 6000);
  }
  const { db } = database();
  await assert.rejects(new RiotClient(env(db), db, async () => Response.json({ puuid: 'id-only' })).accountById('a#b'), (e: AppError) => e.code === 'RIOT_INVALID_RESPONSE');
});
test('shared D1 gate bounds concurrent upstream calls across clients', async () => {
  const { db } = database(); let calls = 0;
  const fetcher = async () => { calls++; return Response.json(account); };
  const results = await Promise.allSettled([new RiotClient(env(db), db, fetcher).accountById('a#b'), new RiotClient(env(db), db, fetcher).accountById('a#b')]);
  assert.equal(calls, 1); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});
function protocolFetch(p: JobPayload, call: (path: string) => void = () => {}): typeof fetch {
  return async url => {
    const path = String(url); call(path);
    if (path.includes('/accounts/')) return Response.json(account);
    if (path.includes('/entries/')) return Response.json([p.rank]);
    if (path.includes('/champion-masteries/')) return Response.json(p.masteries!.map(m => ({ ...m, puuid: account.puuid })));
    if (path.includes('/ids?')) return Response.json(p.matchIds);
    const id = path.split('/').pop(); const m = p.matches.find(m => m.id === id);
    if (!m) return new Response('{}', { status: 404 });
    return Response.json({ metadata: { matchId: m.id }, info: { queueId: m.queueId, gameDuration: m.gameDuration, participants: m.participants } });
  };
}
async function finish(db: D1Database, reset: () => void, id: string, fetcher: typeof fetch) {
  for (let i = 0; i < 65; i++) {
    reset(); const result = await advanceJob(env(db), id, fetcher);
    if (result.status !== 'running') return result;
  } throw new Error('Job did not finish');
}
test('persistent jobs publish only verified results, reuse match cache, cache player for 1h', async () => {
  const { db, sqlite, reset } = database(); const p = payload(50, 40);
  let matchCalls = 0;
  const fetcher = protocolFetch(p, path => { if (/\/matches\/KR_/.test(path)) matchCalls++; });
  const job = await createJob(env(db), { riotId: 'test-only#TEST' });
  assert.equal((await createJob(env(db), { riotId: 'test-only#TEST' })).id, job.id);
  const result = await finish(db, reset, job.id, fetcher);
  assert.equal(result.status, 'completed'); assert.equal(result.result!.validGames, 50); assert.equal(matchCalls, 50);
  const list = await listSpecialists(env(db), 'Yasuo', 'pickrate');
  assert.equal(list.analyzedUsers, 1); assert.equal(list.players.length, 1); assert.equal(list.players[0].source, 'riot'); assert.equal(list.players[0].analysis.championGames, 40);
  const cached = await createJob(env(db), { riotId: 'test-only#TEST' }); assert.equal(cached.status, 'completed');
  sqlite.prepare("UPDATE snapshots SET updated_at='2000-01-01',payload=json_set(payload,'$.updatedAt','2000-01-01')").run();
  const refreshed = await createJob(env(db), { riotId: 'test-only#TEST' });
  await finish(db, reset, refreshed.id, fetcher); assert.equal(matchCalls, 50);
});
test('missing matches and failed authentication do not publish partial or fake players', async () => {
  const { db, reset } = database(); const p = payload(20, 20); p.matches.pop();
  const job = await createJob(env(db), { riotId: 'test-only#TEST' }); const result = await finish(db, reset, job.id, protocolFetch(p));
  assert.equal(result.result!.complete, false); assert.equal(result.result!.unavailableGames, 1);
  assert.equal((await listSpecialists(env(db), 'Yasuo', 'pickrate')).players.length, 0);
  const bad = await createJob(env(db), { riotId: 'other#TEST' });
  reset(); const failed = await advanceJob(env(db), bad.id, async () => new Response('{}', { status: 403 }));
  assert.equal(failed.status, 'failed'); assert.equal(failed.error!.code, 'RIOT_AUTH');
});
test('winrate sort requires champion 20-game minimum; rank sort follows official tier/LP', async () => {
  const { db, reset } = database();
  const p = payload(20, 14); const job = await createJob(env(db), { riotId: 'test-only#TEST' });
  await finish(db, reset, job.id, protocolFetch(p));
  assert.equal((await listSpecialists(env(db), 'Yasuo', 'pickrate')).players.length, 1);
  assert.equal((await listSpecialists(env(db), 'Yasuo', 'winrate')).players.length, 0);
});
test('safe missing configuration, auth, unsupported region and unknown API errors', async () => {
  let r = await route(new Request('https://example.com/api/champions/Yasuo/specialists'), {}); assert.equal(r.status, 503);
  const { db } = database();
  r = await route(new Request('https://example.com/api/champions/Yasuo/specialists?region=NA'), { DB: db }); assert.equal(r.status, 400);
  r = await route(new Request('https://example.com/api/analyses', { method: 'POST', body: JSON.stringify({ riotId: 'a#b' }) }), { ...env(db), ADMIN_TOKEN: 'private-token' }); assert.equal(r.status, 503); // Dev key blocked on public host even if APP_ENV is development.
  const production = { ...env(db), APP_ENV: 'production', RIOT_KEY_MODE: 'production', ADMIN_TOKEN: 'private-token' };
  r = await route(new Request('https://example.com/api/analyses', { method: 'POST', body: '{}' }), production); assert.equal(r.status, 401);
  r = await route(new Request('https://example.com/api/analyses', { method: 'POST', headers: { 'X-OneChamp-Token': 'private-token', Origin: 'https://other.com' }, body: '{}' }), production); assert.equal(r.status, 403);
  r = await route(new Request('https://example.com/api/no-such-endpoint'), {}); assert.equal(r.status, 404); assert.ok((await r.text()).includes('NOT_FOUND'));
  r = await route(new Request('http://localhost:8788/api/analyses', { method: 'POST', body: JSON.stringify({ riotId: 'a#b' }) }), { DB: db, APP_ENV: 'development' }); assert.equal(r.status, 503); assert.ok((await r.text()).includes('RIOT_KEY_MISSING'));
});
test('ladder parsing never invents PUUIDs from summoner IDs', async () => {
  const { db } = database();
  const client = new RiotClient(env(db), db, async () => Response.json({ queue: 'RANKED_SOLO_5x5', entries: [{ puuid: 'real-protocol-test-id' }, { summonerId: 'must-not-convert' }, { puuid: 'real-protocol-test-id' }] }));
  const result = await client.ladder('challenger'); assert.deepEqual(result.puuids, ['real-protocol-test-id']); assert.equal(result.missingIdentifiers, 1);
});
test('429 pauses a persistent job and early resume does not make another upstream call', async () => {
  const { db, sqlite, reset } = database(); const j = await createJob(env(db), { riotId:'rate-test#TEST' });
  let calls = 0;
  const fetcher = async () => { calls++; return new Response('{}', { status:429, headers:{ 'Retry-After':'10' } }); };
  reset(); const waiting = await advanceJob(env(db), j.id, fetcher);
  assert.equal(waiting.status,'running'); assert.equal(waiting.phase,'account'); assert.ok(waiting.retryAfterMs >= 9000);
  await advanceJob(env(db), j.id, fetcher); assert.equal(calls,1);
  sqlite.prepare('UPDATE jobs SET retry_at=0 WHERE id=?').run(j.id); reset();
  const resumed = await advanceJob(env(db), j.id, protocolFetch(payload(20,20)));
  assert.equal(resumed.phase,'rank'); assert.equal(resumed.error,null);
});
test('SQL sorting respects official tiers, divisions, LP and minimum winrate sample', async () => {
  const { db } = database();
  const ranks = [
    { tier:'DIAMOND', division:'I', leaguePoints:99 },
    { tier:'MASTER', division:'I', leaguePoints:1 },
    { tier:'DIAMOND', division:'II', leaguePoints:99 },
    { tier:'DIAMOND', division:'I', leaguePoints:50 },
  ];
  const { rankOrder } = await import('../server/analysis');
  for (const [i, rank] of ranks.entries()) {
    const p = aggregate(payload(50,40),now).specialists.find(p=>p.championId==='Yasuo')!;
    p.puuid=`sql-test-${i}`; p.rank=rank;
    await db.prepare('INSERT INTO snapshots(puuid,riot_name,riot_tag,updated_at,payload) VALUES(?,?,?,?,?)').bind(p.puuid,'test-only','TEST',now,'{}').run();
    await db.prepare('INSERT INTO champion_stats(puuid,champion_id,pick_rate,champion_games,win_rate,mastery_points,rank_order,recognition,payload) VALUES(?,?,?,?,?,?,?,?,?)').bind(p.puuid,'Yasuo',.8,40,.5,2000,rankOrder(rank),'candidate',JSON.stringify(p)).run();
  }
  assert.deepEqual((await listSpecialists(env(db),'Yasuo','rank')).players.map(p=>p.puuid),['sql-test-1','sql-test-0','sql-test-3','sql-test-2']);
});
