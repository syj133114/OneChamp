import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const load = async path => import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64'));
const { champions } = JSON.parse(await readFile(new URL('../src/data/champions.json', import.meta.url), 'utf8'));
const { filterChampions } = await load('../src/services/search.ts');
const { demoRepository, plannedPolicy } = await load('../src/services/specialists.ts');
test('official catalogue has complete bilingual identities and unique IDs', () => {
  assert.ok(champions.length >= 170);
  assert.equal(new Set(champions.map(c => c.id)).size, champions.length);
  assert.ok(champions.every(c => c.name && c.englishName && c.tags.length));
});
test('Korean, English, case, punctuation and whitespace search', () => {
  for (const q of ['야스오', 'YASUO', 'ya suo']) assert.equal(filterChampions(champions, q)[0].id, 'Yasuo');
  assert.equal(filterChampions(champions, '리 신')[0].id, 'LeeSin');
  assert.equal(filterChampions(champions, 'Kaisa')[0].id, 'Kaisa');
  assert.equal(filterChampions(champions, '없는챔피언').length, 0);
});
test('clearing search restores all champions; role filter composes with search', () => {
  assert.equal(filterChampions(champions, '').length, champions.length);
  assert.ok(filterChampions(champions, '', 'Mage').every(c => c.tags.includes('Mage')));
  assert.equal(filterChampions(champions, '야스오', 'Support').length, 0);
});
test('demo records stay region and champion scoped and have consistent denominators', async () => {
  const players = await demoRepository.list('Yasuo', 'KR');
  assert.equal(players.length, 4);
  assert.ok(players.some(p => p.analysis.totalGames < plannedPolicy.targetGames));
  for (const p of players) {
    assert.equal(p.source, 'demo'); assert.equal(p.riotId.tagLine, 'DEMO');
    assert.equal(p.recognition.status, 'not-evaluated');
    assert.ok(p.analysis.championWins <= p.analysis.championGames);
    assert.ok(p.analysis.championGames <= p.analysis.totalGames);
    assert.ok(p.analysis.totalGames <= 50);
  }
  assert.deepEqual(await demoRepository.list('Yasuo', 'NA'), []);
  assert.deepEqual(await demoRepository.list('Bard', 'KR'), []);
});
