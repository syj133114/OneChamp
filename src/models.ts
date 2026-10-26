export type Region = 'KR' | 'NA' | 'EUW' | 'JP';
export interface Champion { id: string; key: string; name: string; englishName: string; title: string; tags: string[] }
export interface OneChampPolicy { version: string; queueId: 420; targetGames: number; minimumPickRate: number }
export interface Specialist {
  puuid: string; riotId: { gameName: string; tagLine: string }; championId: string; region: Region;
  rank: { tier: string; division?: string; leaguePoints: number };
  mastery: { points: number; level: number };
  analysis: { queueId: 420; totalGames: number; championGames: number; championWins: number; updatedAt: string };
  source: 'demo' | 'riot'; recognition: { status: 'not-evaluated'; policyVersion: string };
}
export interface SpecialistRepository { list(championId: string, region: Region): Promise<Specialist[]> }
