export class AppError extends Error {
  constructor(public code: string, message: string, public status = 500, public retryAfter = 0) { super(message); }
}
export function database(env: { DB?: D1Database }): D1Database {
  if (!env.DB) throw new AppError('DATABASE_NOT_CONFIGURED', '데이터베이스가 연결되지 않았습니다. 운영자가 D1 설정을 완료해야 합니다.', 503);
  return env.DB;
}
export function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('RIOT_INVALID_RESPONSE', 'Riot 응답 형식을 확인할 수 없습니다.', 502);
}
export function invalid(): never { throw new AppError('RIOT_INVALID_RESPONSE', 'Riot 응답 필수 정보가 누락되었습니다. 추정 데이터를 저장하지 않았습니다.', 502); }
