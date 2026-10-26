import type { AnalysisJob, SpecialistList, SpecialistSort } from '../models';
export class ApiError extends Error {
  constructor(message: string, public code: string, public retryAfterMs = 0) { super(message); }
}
export async function api<T>(path: string, options: { method?: 'GET' | 'POST'; data?: unknown; token?: string; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(path, { method: options.method ?? 'GET', signal: options.signal, headers: { ...(options.data ? { 'Content-Type': 'application/json' } : {}), ...(options.token ? { 'X-OneChamp-Token': options.token } : {}) }, ...(options.data ? { body: JSON.stringify(options.data) } : {}) });
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new ApiError('분석 서버에 연결되지 않았습니다. 백엔드 실행·배포 설정을 확인하세요.', 'API_UNAVAILABLE');
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error?.message ?? '서버 요청에 실패했습니다.', data.error?.code ?? 'API_ERROR', data.retryAfterMs ?? 0);
  return data as T;
}
export const apiRepository = {
  list(championId: string, region: string, sort: SpecialistSort, signal?: AbortSignal) {
    return api<SpecialistList>(`/api/champions/${encodeURIComponent(championId)}/specialists?region=${region}&sort=${sort}`, { signal });
  },
  create(riotId: string, token: string, signal: AbortSignal) { return api<AnalysisJob>('/api/analyses', { method: 'POST', data: { riotId }, token, signal }); },
  job(id: string, token: string, signal: AbortSignal) { return api<AnalysisJob>(`/api/jobs/${id}`, { token, signal }); },
  advance(id: string, token: string, signal: AbortSignal) { return api<AnalysisJob>(`/api/jobs/${id}/advance`, { method: 'POST', token, signal }); },
};
