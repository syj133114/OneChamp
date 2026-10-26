import { AppError, assertRecord, invalid } from './errors';
import type { Env, MatchSummary, RiotAccount, RiotMastery, RiotRank } from './types';
export function parseRiotId(value: unknown): { gameName: string; tagLine: string } {
  if (typeof value !== 'string' || value.length > 100) throw new AppError('INVALID_RIOT_ID', 'Riot ID를 닉네임#태그 형식으로 입력하세요.', 400);
  const parts = value.trim().split('#');
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim() || /[\x00-\x1f/\\]/.test(value)) throw new AppError('INVALID_RIOT_ID', 'Riot ID를 닉네임#태그 형식으로 입력하세요.', 400);
  return { gameName: parts[0].trim(), tagLine: parts[1].trim() };
}
export function retryAfterMs(header: string | null, now = Date.now()): number {
  if (!header) return 60_000;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1000, Math.ceil(seconds * 1000));
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(1000, date - now) : 60_000;
}
export function assertKey(env: Env) {
  if (!env.RIOT_API_KEY) throw new AppError('RIOT_KEY_MISSING', '서버에 Riot API 키가 설정되지 않았습니다.', 503);
  if (env.APP_ENV !== 'development' && env.RIOT_KEY_MODE !== 'production') throw new AppError('PRODUCTION_KEY_REQUIRED', '공개 서비스의 수집에는 승인된 프로덕션 키 설정이 필요합니다. 개발 키는 로컬 테스트에서만 사용할 수 있습니다.', 503);
}
function responseCooldown(response: Response): number {
  let delay = 1350; // <= 89 calls / 120 sec, globally serialized by D1.
  for (const kind of ['App', 'Method']) {
    const limits = response.headers.get(`X-${kind}-Rate-Limit`);
    const counts = response.headers.get(`X-${kind}-Rate-Limit-Count`);
    if (!limits || !counts) continue;
    const used = new Map(counts.split(',').map(v => v.split(':').map(Number) as [number, number]).map(([count, window]) => [window, count]));
    for (const pair of limits.split(',')) {
      const [limit, window] = pair.split(':').map(Number);
      if (limit > 0 && window > 0) {
        delay = Math.max(delay, Math.ceil(window * 1000 / limit) + 20);
        if ((used.get(window) ?? 0) >= limit) delay = Math.max(delay, window * 1000 + 1000);
      }
    }
  }
  return delay;
}
export class RiotClient {
  constructor(private env: Env, private db: D1Database, private fetcher: typeof fetch = fetch, private now: () => number = Date.now) {}
  async get(host: 'kr' | 'asia', path: string): Promise<unknown> {
    assertKey(this.env);
    const now = this.now(), token = crypto.randomUUID();
    const claimed = await this.db.prepare('UPDATE riot_gate SET lease_token=?, lease_until=?, next_at=? WHERE id=1 AND lease_until<=? AND next_at<=?').bind(token, now + 30_000, now + 1350, now, now).run();
    if (!claimed.meta.changes) {
      const gate = await this.db.prepare('SELECT next_at, lease_until FROM riot_gate WHERE id=1').first<{ next_at: number; lease_until: number }>();
      throw new AppError('RATE_WAIT', 'Riot 요청 간격을 지키며 수집 중입니다.', 429, Math.max(1000, (gate?.next_at ?? now + 1350) - now, (gate?.lease_until ?? now) - now));
    }
    let delay = 1350;
    try {
      let response: Response;
      try { response = await this.fetcher.call(globalThis, `https://${host}.api.riotgames.com${path}`, { headers: { 'X-Riot-Token': this.env.RIOT_API_KEY!, Accept: 'application/json' }, signal: AbortSignal.timeout(12_000), redirect: 'manual' }); }
      catch (error) { if (this.env.APP_ENV === 'development') console.warn('Riot network diagnostic:', error instanceof Error ? error.message.replaceAll(this.env.RIOT_API_KEY!, '[redacted]').slice(0, 180) : 'unknown'); throw new AppError('RIOT_NETWORK', 'Riot 서버 연결이 지연되었습니다. 잠시 후 재시도합니다.', 502, 5000); }
      delay = responseCooldown(response);
      if (response.status === 429) { delay = Math.max(delay, retryAfterMs(response.headers.get('Retry-After'), this.now())); throw new AppError('RIOT_RATE_LIMIT', 'Riot API 요청 제한으로 대기 중입니다.', 429, delay); }
      if (response.status === 401 || response.status === 403) throw new AppError('RIOT_AUTH', 'Riot API 인증에 실패했습니다. 서버 키의 만료·권한을 확인하세요.', 503);
      if (response.status === 404) throw new AppError('RIOT_NOT_FOUND', 'Riot API에서 해당 데이터를 찾을 수 없습니다.', 404);
      if (response.status >= 500) throw new AppError('RIOT_UNAVAILABLE', 'Riot API에 일시적인 장애가 발생했습니다.', 502, 5000);
      if (!response.ok) throw new AppError('RIOT_REQUEST_FAILED', 'Riot API가 요청을 처리하지 못했습니다.', 502);
      try { return await response.json(); } catch { return invalid(); }
    } finally {
      await this.db.prepare('UPDATE riot_gate SET next_at=MAX(next_at,?), lease_until=0, lease_token=NULL WHERE id=1 AND lease_token=?').bind(this.now() + delay, token).run();
    }
  }
  async accountById(riotId: string) {
    const { gameName, tagLine } = parseRiotId(riotId);
    return account(await this.get('asia', `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`));
  }
  async accountByPuuid(puuid: string) {
    const result = account(await this.get('asia', `/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`));
    if (result.puuid !== puuid) return invalid();
    return result;
  }
  async rank(puuid: string): Promise<RiotRank | null> {
    const data = await this.get('kr', `/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`);
    if (!Array.isArray(data)) return invalid();
    for (const entry of data) {
      assertRecord(entry);
      if (entry.queueType !== 'RANKED_SOLO_5x5') continue;
      if (entry.puuid !== puuid || typeof entry.tier !== 'string' || !TIERS.includes(entry.tier) || typeof entry.rank !== 'string' || !['I','II','III','IV'].includes(entry.rank) || !nonnegative(entry.leaguePoints)) return invalid();
      return entry as unknown as RiotRank;
    }
    return null;
  }
  async mastery(puuid: string): Promise<RiotMastery[]> {
    const data = await this.get('kr', `/lol/champion-mastery/v4/champion-masteries/by-puuid/${encodeURIComponent(puuid)}`);
    if (!Array.isArray(data)) return invalid();
    return data.map(item => {
      assertRecord(item);
      if (item.puuid !== puuid || !nonnegative(item.championId) || !nonnegative(item.championLevel) || !nonnegative(item.championPoints)) return invalid();
      return { championId: item.championId, championLevel: item.championLevel, championPoints: item.championPoints } as RiotMastery;
    });
  }
  async matchIds(puuid: string): Promise<string[]> {
    const data = await this.get('asia', `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?queue=420&start=0&count=50`);
    if (!Array.isArray(data) || data.length > 50 || data.some(id => typeof id !== 'string' || !/^KR_\d+$/.test(id)) || new Set(data).size !== data.length) return invalid();
    return data;
  }
  async match(id: string): Promise<MatchSummary> {
    const data = await this.get('asia', `/lol/match/v5/matches/${encodeURIComponent(id)}`);
    assertRecord(data); assertRecord(data.metadata); assertRecord(data.info);
    if (data.metadata.matchId !== id || !Number.isInteger(data.info.queueId) || !nonnegative(data.info.gameDuration) || !Array.isArray(data.info.participants)) return invalid();
    const participants = data.info.participants.map(p => {
      assertRecord(p);
      if (typeof p.puuid !== 'string' || !nonnegative(p.championId) || typeof p.win !== 'boolean' || typeof p.gameEndedInEarlySurrender !== 'boolean') return invalid();
      return { puuid: p.puuid, championId: p.championId, win: p.win, gameEndedInEarlySurrender: p.gameEndedInEarlySurrender } as MatchSummary['participants'][number];
    });
    return { id, queueId: data.info.queueId as number, gameDuration: data.info.gameDuration, participants };
  }
  async ladder(tier: 'challenger' | 'grandmaster' | 'master'): Promise<{ puuids: string[]; missingIdentifiers: number }> {
    const data = await this.get('kr', `/lol/league/v4/${tier}leagues/by-queue/RANKED_SOLO_5x5`);
    assertRecord(data);
    if (data.queue !== 'RANKED_SOLO_5x5' || !Array.isArray(data.entries)) return invalid();
    let missingIdentifiers = 0;
    const entries = data.entries.filter(e => {
      if (!e || typeof e !== 'object' || typeof e.puuid !== 'string' || !e.puuid.trim()) { missingIdentifiers++; return false; }
      return true;
    });
    return { puuids: [...new Set(entries.map(e => e.puuid as string))], missingIdentifiers };
  }
}
export const TIERS = ['IRON','BRONZE','SILVER','GOLD','PLATINUM','EMERALD','DIAMOND','MASTER','GRANDMASTER','CHALLENGER'];
function nonnegative(n: unknown): n is number { return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0; }
function account(data: unknown): RiotAccount {
  assertRecord(data);
  if (typeof data.puuid !== 'string' || !data.puuid || typeof data.gameName !== 'string' || !data.gameName || typeof data.tagLine !== 'string' || !data.tagLine) return invalid();
  return { puuid: data.puuid, gameName: data.gameName, tagLine: data.tagLine };
}
