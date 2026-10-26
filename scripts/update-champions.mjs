import { writeFile } from 'node:fs/promises';
const version = (await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json())[0];
const [ko, en] = await Promise.all(['ko_KR', 'en_US'].map(async locale => (await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/${locale}/champion.json`)).json()).data));
const champions = Object.values(ko).map(c => ({ id: c.id, key: c.key, name: c.name, englishName: en[c.id].name, title: c.title, tags: c.tags }));
await writeFile(new URL('../src/data/champions.json', import.meta.url), JSON.stringify({ version, champions }, null, 2) + '\n');
console.log(`Saved ${champions.length} champions (${version})`);
