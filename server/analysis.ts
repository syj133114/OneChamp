import catalogue from '../src/data/champions.json';
import { oneChampPolicy as policy } from '../src/policy';
import type { Specialist } from '../src/models';
import type { AnalysisSnapshot, JobPayload } from './types';
import { AppError } from './errors';
export function aggregate(payload: JobPayload, updatedAt: string): AnalysisSnapshot {
  if (!payload.account || !payload.masteries || !payload.matchIds || payload.rank === undefined || payload.cursor !== payload.matchIds.length) throw new AppError('INCOMPLETE_JOB', '수집이 끝나지 않아 결과를 게시하지 않았습니다.', 409);
  const counts = new Map<number, { games: number; wins: number }>();
  let validGames = 0, excludedGames = 0, unavailableGames = payload.unavailableGames;
  for (const match of payload.matches) {
    const participants = match.participants.filter(p => p.puuid === payload.account!.puuid);
    if (participants.length !== 1) { unavailableGames++; continue; }
    const participant = participants[0];
    if (match.queueId !== 420 || match.gameDuration < 180 || participant.gameEndedInEarlySurrender) { excludedGames++; continue; }
    validGames++;
    const count = counts.get(participant.championId) ?? { games: 0, wins: 0 };
    count.games++; if (participant.win) count.wins++;
    counts.set(participant.championId, count);
  }
  const complete = unavailableGames === 0 && payload.matches.length + payload.unavailableGames === payload.matchIds.length;
  const { puuid, gameName, tagLine } = payload.account;
  const specialists: Specialist[] = [];
  for (const [championKey, count] of counts) {
    const champion = catalogue.champions.find(c => Number(c.key) === championKey);
    if (!champion) continue; // Unknown champion is never guessed or assigned another identity.
    const mastery = payload.masteries.find(m => m.championId === championKey);
    const concentrated = count.games / validGames >= policy.minimumPickRate;
    specialists.push({
      puuid, riotId: { gameName, tagLine }, championId: champion.id, region: 'KR', source: 'riot',
      rank: payload.rank ? { tier: payload.rank.tier, division: payload.rank.rank, leaguePoints: payload.rank.leaguePoints } : null,
      mastery: mastery ? { points: mastery.championPoints, level: mastery.championLevel } : null,
      analysis: { queueId: 420, totalGames: validGames, requestedGames: payload.matchIds.length, championGames: count.games, championWins: count.wins, excludedGames, unavailableGames, complete, updatedAt },
      recognition: { status: !complete ? 'incomplete' : validGames < policy.minimumGames ? 'insufficient' : concentrated ? 'candidate' : 'not-qualified', policyVersion: policy.version },
    });
  }
  return { puuid, riotId: { gameName, tagLine }, updatedAt, requestedGames: payload.matchIds.length, validGames, excludedGames, unavailableGames, complete, specialists };
}
export function rankOrder(rank: Specialist['rank']): number {
  if (!rank) return -1;
  const tiers = ['IRON','BRONZE','SILVER','GOLD','PLATINUM','EMERALD','DIAMOND','MASTER','GRANDMASTER','CHALLENGER'];
  // Sorting only by Riot's official tier/division/LP, never a skill score or estimated MMR.
  return tiers.indexOf(rank.tier) * 1_000_000 + Math.max(0, ['IV','III','II','I'].indexOf(rank.division ?? '')) * 100_000 + rank.leaguePoints;
}
