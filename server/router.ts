import catalogue from '../src/data/champions.json';
import { AppError, database } from './errors';
import { advanceJob, collectCandidates, createJob, getJob, listSpecialists, publicJob } from './jobs';
import type { Env } from './types';
import type { SpecialistSort } from '../src/models';
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });
function localDevelopment(request: Request, env: Env) {
  return env.APP_ENV === 'development' && ['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname);
}
async function authorized(request: Request, env: Env) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) throw new AppError('ORIGIN_REJECTED', '같은 사이트에서 요청하세요.', 403);
  if (localDevelopment(request, env) && !env.ADMIN_TOKEN) return;
  if (!localDevelopment(request, env) && env.RIOT_KEY_MODE !== 'production') throw new AppError('PRODUCTION_KEY_REQUIRED', '공개 서비스의 수집에는 승인된 프로덕션 키가 필요합니다. 개발 키는 로컬에서만 사용하세요.', 503);
  if (!env.ADMIN_TOKEN) throw new AppError('ADMIN_NOT_CONFIGURED', '서버에 수집용 운영자 인증이 설정되지 않았습니다.', 503);
  const supplied = request.headers.get('X-OneChamp-Token') ?? '';
  // Hash to equal lengths before comparison. No credentials are persisted in client storage.
  const [a, b] = await Promise.all([supplied, env.ADMIN_TOKEN].map(v => crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))));
  const left = new Uint8Array(a), right = new Uint8Array(b); let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  if (diff) throw new AppError('UNAUTHORIZED', '수집하려면 올바른 운영자 토큰을 입력하세요.', 401);
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('Content-Length')) > 2048) throw new AppError('BODY_TOO_LARGE', '입력값이 너무 깁니다.', 413);
  const text = await request.text();
  if (text.length > 2048) throw new AppError('BODY_TOO_LARGE', '입력값이 너무 깁니다.', 413);
  try { const data = JSON.parse(text); if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error(); return data; }
  catch { throw new AppError('INVALID_JSON', '올바른 JSON 입력이 필요합니다.', 400); }
}
export async function route(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url), path = url.pathname;
    if (request.method === 'GET' && path === '/api/health') {
      let ready = false;
      if (env.DB) { try { await env.DB.prepare('SELECT id FROM riot_gate WHERE id=1').first(); ready = true; } catch { /* migration not applied */ } }
      return json({ storageReady: ready, collectionReady: ready && !!env.RIOT_API_KEY && (localDevelopment(request, env) || (env.RIOT_KEY_MODE === 'production' && !!env.ADMIN_TOKEN)), localDevelopment: localDevelopment(request, env), requiresAdminToken: !localDevelopment(request, env) || !!env.ADMIN_TOKEN, region: 'KR' });
    }
    const list = path.match(/^\/api\/champions\/([A-Za-z0-9]+)\/specialists$/);
    if (request.method === 'GET' && list) {
      if ((url.searchParams.get('region') ?? 'KR') !== 'KR') throw new AppError('REGION_UNSUPPORTED', '현재 실제 분석은 KR 서버만 지원합니다.', 400);
      if (!catalogue.champions.some(c => c.id === list[1])) throw new AppError('CHAMPION_NOT_FOUND', '챔피언을 찾을 수 없습니다.', 404);
      const sort = url.searchParams.get('sort') ?? 'pickrate';
      if (!['pickrate','mastery','winrate','rank'].includes(sort)) throw new AppError('INVALID_SORT', '지원하지 않는 정렬입니다.', 400);
      return json(await listSpecialists(env, list[1], sort as SpecialistSort));
    }
    if (path === '/api/analyses' && request.method === 'POST') {
      await authorized(request, env);
      const data = await body(request);
      if (typeof data.riotId !== 'string') throw new AppError('INVALID_RIOT_ID', 'Riot ID를 입력하세요.', 400);
      return json(await createJob(env, { riotId: data.riotId }), 202);
    }
    const job = path.match(/^\/api\/jobs\/([a-f0-9-]{36})(\/advance)?$/);
    if (job && ((request.method === 'GET' && !job[2]) || (request.method === 'POST' && job[2]))) {
      await authorized(request, env);
      return json(job[2] ? await advanceJob(env, job[1]) : publicJob(await getJob(database(env), job[1])));
    }
    if (path === '/api/admin/candidates' && request.method === 'POST') {
      await authorized(request, env);
      const data = await body(request), tier = data.tier;
      if (!['challenger','grandmaster','master'].includes(tier as string)) throw new AppError('INVALID_TIER', '수집 대상 티어를 선택하세요.', 400);
      const limit = data.limit ?? 1;
      if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 3) throw new AppError('INVALID_LIMIT', '한 번에 1~3명만 수집할 수 있습니다.', 400);
      return json(await collectCandidates(env, tier as 'challenger' | 'grandmaster' | 'master', limit), 202);
    }
    return json({ error: { code: 'NOT_FOUND', message: '지원하지 않는 API 경로 또는 메서드입니다.' } }, 404);
  } catch (error) {
    const e = error instanceof AppError ? error : new AppError('SERVER_ERROR', '서버 저장소 또는 설정을 확인하세요. 임의 데이터를 반환하지 않았습니다.', 500);
    return json({ error: { code: e.code, message: e.message }, retryAfterMs: e.retryAfter }, e.status, e.retryAfter ? { 'Retry-After': String(Math.ceil(e.retryAfter / 1000)) } : {});
  }
}
