import type { Specialist } from '../src/models';
export interface Env {
  DB?: D1Database; RIOT_API_KEY?: string; RIOT_KEY_MODE?: string;
  APP_ENV?: string; ADMIN_TOKEN?: string;
}
export interface RiotAccount { puuid: string; gameName: string; tagLine: string }
export interface RiotRank { queueType: string; tier: string; rank: string; leaguePoints: number; puuid?: string }
export interface RiotMastery { championId: number; championLevel: number; championPoints: number }
export interface MatchSummary {
  id: string; queueId: number; gameDuration: number;
  participants: { puuid: string; championId: number; win: boolean; gameEndedInEarlySurrender: boolean }[];
}
export interface AnalysisSnapshot {
  puuid: string; riotId: { gameName: string; tagLine: string }; updatedAt: string;
  requestedGames: number; validGames: number; excludedGames: number; unavailableGames: number;
  complete: boolean; specialists: Specialist[];
}
export interface JobPayload {
  riotId?: string; puuid?: string; account?: RiotAccount; rank?: RiotRank | null;
  masteries?: RiotMastery[]; matchIds?: string[]; cursor: number;
  matches: MatchSummary[]; unavailableGames: number; snapshot?: AnalysisSnapshot;
}
export interface JobRow {
  id: string; subject: string; status: 'running' | 'completed' | 'failed'; phase: string;
  payload: string; error_code: string | null; error_message: string | null;
  retry_at: number; attempts: number; lease_token: string | null; lease_until: number;
  created_at: string; updated_at: string;
}
