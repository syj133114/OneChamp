import type { OneChampPolicy, Specialist, SpecialistRepository } from '../models';
export const plannedPolicy: OneChampPolicy = { version: 'draft-1', queueId: 420, targetGames: 50, minimumPickRate: .7 };
// Entirely fictional fixtures: never represent actual Riot accounts or rankings.
const fixtures: Specialist[] = ['Yasuo', 'Ahri', 'Zed', 'LeeSin', 'Yone', 'Riven'].flatMap(championId => [
  { name: '데모 바람의 길', tier: 'CHALLENGER', lp: 1032, points: 3824500, total: 50, games: 46, wins: 29 },
  { name: '데모 하나의 정체성', tier: 'GRANDMASTER', lp: 742, points: 2146800, total: 50, games: 42, wins: 25 },
  { name: '데모 묵묵한 수련', tier: 'MASTER', lp: 386, points: 1672300, total: 50, games: 38, wins: 21 },
  { name: '데모 새로운 시작', tier: 'DIAMOND', lp: 64, points: 425000, total: 18, games: 15, wins: 9 },
].map((f, i) => ({ puuid: `demo-${championId}-${i}`, riotId: { gameName: f.name, tagLine: 'DEMO' }, championId, region: 'KR' as const, rank: { tier: f.tier, leaguePoints: f.lp }, mastery: { points: f.points, level: 50 - i * 8 }, analysis: { queueId: 420 as const, totalGames: f.total, championGames: f.games, championWins: f.wins, updatedAt: '2026-10-26T00:00:00Z' }, source: 'demo' as const, recognition: { status: 'not-evaluated' as const, policyVersion: plannedPolicy.version } })));
export const demoRepository: SpecialistRepository = { async list(championId, region) { return fixtures.filter(p => p.championId === championId && p.region === region); } };
// Future adapter calls only a server endpoint; Riot credentials never enter browser code.
export const apiRepository: SpecialistRepository = { async list(championId, region) {
  const response = await fetch(`/api/champions/${encodeURIComponent(championId)}/specialists?region=${region}`);
  if (!response.ok) throw new Error('장인 데이터를 불러오지 못했습니다.');
  return response.json();
} };
