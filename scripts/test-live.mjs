// Real API integration check. Uses backend endpoints only; never reads or prints the Riot key.
const base = process.env.ONECHAMP_API_URL ?? 'http://127.0.0.1:8788';
const token = process.env.ONECHAMP_ADMIN_TOKEN;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(path, data) {
  const response = await fetch(base + path, { method: data ? 'POST' : 'GET', headers: { ...(data ? { 'Content-Type':'application/json' } : {}), ...(token ? { 'X-OneChamp-Token':token } : {}) }, ...(data ? { body:JSON.stringify(data) } : {}), signal: AbortSignal.timeout(25_000) });
  const body = await response.json();
  if (!response.ok) { console.error(JSON.stringify({ status:response.status, error:body.error })); process.exit(1); }
  return body;
}
const health = await request('/api/health');
console.log('Storage ready:', health.storageReady, '| Collection ready:', health.collectionReady);
if (!health.collectionReady) { console.error('Backend configuration required.'); process.exit(1); }
const riotId = process.argv.slice(2).join(' ');
let jobs;
if (riotId) jobs = [await request('/api/analyses', { riotId })];
else {
  const collected = await request('/api/admin/candidates', { tier:'challenger',limit:1 });
  console.log('Real ladder identifiers:', collected.availableIdentifiers, '| Selected:', collected.selected, '| Missing identifiers skipped:', collected.missingIdentifiers);
  jobs = collected.jobs;
}
for (let job of jobs) {
  while (job.status === 'running') {
    await wait(Math.max(1500, job.retryAfterMs));
    job = await request(`/api/jobs/${job.id}/advance`, {});
    console.log(job.phase, job.processedGames, '/', job.requestedGames ?? '?', job.error?.code ?? '');
  }
  if (job.status !== 'completed') { console.error(job.error); process.exit(1); }
  const result = job.result;
  if (!result) { console.error('No verified result'); process.exit(1); }
  console.log(JSON.stringify({ riotId:result.riotId,validGames:result.validGames,requestedGames:result.requestedGames,excludedGames:result.excludedGames,unavailableGames:result.unavailableGames,complete:result.complete,champions:result.specialists.map(s=>({ championId:s.championId,games:s.analysis.championGames,status:s.recognition.status })) }, null, 2));
  if (!result.complete) process.exitCode=1;
  for (const specialist of result.specialists.filter(s => s.recognition.status === 'candidate')) {
    const list=await request(`/api/champions/${specialist.championId}/specialists?region=KR`);
    if (!list.players.some(p=>p.puuid===specialist.puuid)) throw Error('Verified candidate missing from persisted list');
    console.log('Persisted candidate verified:', specialist.championId);
  }
  // By-Riot-ID submission must reuse the verified snapshot within the one-hour TTL.
  const cached=await request('/api/analyses', { riotId:`${result.riotId.gameName}#${result.riotId.tagLine}` });
  if (cached.status !== 'completed') throw Error('Verified user cache not reused');
  console.log('Riot-ID cache reuse verified.');
}
