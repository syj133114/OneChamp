export type Region = 'KR' | 'NA' | 'EUW' | 'JP';
export type SpecialistSort = 'pickrate' | 'mastery' | 'winrate' | 'rank';
export interface Champion { id: string; key: string; name: string; englishName: string; title: string; tags: string[] }
export interface OneChampPolicy { version: string; queueId: 420; targetGames: number; minimumGames: number; minimumPickRate: number; minimumWinRateGames: number }
export interface Specialist {
  puuid: string; riotId: { gameName: string; tagLine: string }; championId: string; region: 'KR';
  rank: { tier: string; division?: string; leaguePoints: number } | null;
  mastery: { points: number; level: number } | null;
  analysis: { queueId: 420; totalGames: number; requestedGames: number; championGames: number; championWins: number; excludedGames: number; unavailableGames: number; complete: boolean; updatedAt: string };
  source: 'riot'; recognition: { status: 'candidate' | 'insufficient' | 'not-qualified' | 'incomplete'; policyVersion: string };
}
export interface SpecialistList {
  players: Specialist[]; analyzedUsers: number; matchingUsers: number; updatedAt: string | null;
  scope: string; minimumWinRateGames: number;
}
export interface AnalysisJob {
  id: string; status: 'running' | 'completed' | 'failed'; phase: string;
  processedGames: number; requestedGames: number | null; retryAfterMs: number;
  error: { code: string; message: string } | null;
  result?: { riotId: { gameName: string; tagLine: string }; validGames: number; requestedGames: number; excludedGames: number; unavailableGames: number; complete: boolean; specialists: Specialist[]; updatedAt: string };
}
