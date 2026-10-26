import type { Champion } from '../models';
export const normalize = (s: string) => s.toLowerCase().replace(/[\s.'’]/g, '');
export function filterChampions(champions: Champion[], query: string, role = 'all'): Champion[] {
  const term = normalize(query);
  return champions.filter(c => (normalize(c.name).includes(term) || normalize(c.englishName).includes(term)) && (role === 'all' || c.tags.includes(role)));
}
