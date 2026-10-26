import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Info, RefreshCw } from 'lucide-react';
import { api, ApiError, apiRepository } from '../services/specialists';
import type { AnalysisJob } from '../models';
const phases: Record<string, string> = { account: 'Riot ID 확인', rank: '공식 솔로랭크 확인', mastery: '챔피언 숙련도 확인', ids: '최근 솔로랭크 경기 조회', matches: '경기 참가자·승패 분석', done: '분석 완료' };
function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
export default function AnalysisPanel({ onComplete }: { onComplete: () => void }) {
  const [riotId, setRiotId] = useState(''); const [token, setToken] = useState('');
  const [job, setJob] = useState<AnalysisJob>(); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [tier, setTier] = useState('all'); const [batch, setBatch] = useState('');
  const [health, setHealth] = useState<{ storageReady: boolean; collectionReady: boolean; localDevelopment: boolean; requiresAdminToken: boolean }>();
  const [resumeId, setResumeId] = useState(() => sessionStorage.getItem('onechamp-job') ?? '');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { const c = new AbortController(); api<typeof health>('/api/health', { signal: c.signal }).then(setHealth).catch(() => {}); return () => { c.abort(); controller.current?.abort(); }; }, []);
  async function run(initial: AnalysisJob, signal: AbortSignal) {
    let current = initial;
    sessionStorage.setItem('onechamp-job', current.id); setResumeId(current.id);
    while (current.status === 'running') {
      setJob(current);
      await pause(Math.max(1450, current.retryAfterMs), signal);
      current = await apiRepository.advance(current.id, token, signal);
    }
    setJob(current);
    if (current.status === 'failed') throw new Error(current.error?.message ?? '분석에 실패했습니다.');
    sessionStorage.removeItem('onechamp-job'); setResumeId(''); onComplete();
  }
  async function action(kind: 'analyze' | 'resume' | 'collect') {
    controller.current?.abort(); const c = new AbortController(); controller.current = c;
    setBusy(true); setError(''); setBatch(''); setJob(undefined);
    try {
      if (kind === 'analyze') await run(await apiRepository.create(riotId, token, c.signal), c.signal);
      else if (kind === 'resume') await run(await apiRepository.job(resumeId, token, c.signal), c.signal);
      else {
        const tiers = tier === 'all' ? ['challenger', 'grandmaster', 'master'] : [tier];
        let completed = 0;
        for (const t of tiers) {
          let collected: { selected: number; missingIdentifiers: number; jobs: AnalysisJob[] };
          for (;;) {
            try { collected = await api('/api/admin/candidates', { method: 'POST', data: { tier: t, limit: 1 }, token, signal: c.signal }); break; }
            catch (e) { if (e instanceof ApiError && e.retryAfterMs) { setBatch(`API 제한 대기 · ${Math.ceil(e.retryAfterMs / 1000)}초`); await pause(e.retryAfterMs, c.signal); } else throw e; }
          }
          setBatch(`${t.toUpperCase()} · 실제 식별자 후보 ${collected.selected}명 선택${collected.missingIdentifiers ? ` · 식별자 없는 ${collected.missingIdentifiers}명 제외` : ''}`);
          for (const next of collected.jobs) { await run(next, c.signal); completed++; }
        }
        setBatch(`소규모 수집 완료 · ${completed}명 분석. 이미 저장된 후보는 중복 수집하지 않습니다.`);
      }
    } catch (e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : '분석 요청에 실패했습니다.'); }
    finally { if (!c.signal.aborted) setBusy(false); }
  }
  const result = job?.result;
  return <section className="analysis-panel"><div className="analysis-heading"><div><span className="section-kicker">VERIFIED BY RIOT API</span><h2>실제 Riot ID 분석</h2><p>KR 계정의 최근 솔로랭크 최대 50경기를 분석합니다. 수집에는 몇 분이 걸릴 수 있습니다.</p></div><Info size={19}/></div>
    {health && !health.storageReady && <p className="inline-warning">서버 D1 데이터베이스 연결 또는 마이그레이션이 필요합니다.</p>}
    {health?.storageReady && !health.collectionReady && <p className="inline-warning">수집용 서버 키·운영자 설정을 확인하세요. 저장된 장인 목록은 계속 조회할 수 있습니다.</p>}
    <form onSubmit={e => { e.preventDefault(); void action('analyze'); }}><div className="analysis-inputs"><label>Riot ID<input value={riotId} onChange={e => setRiotId(e.target.value)} placeholder="닉네임#태그" required maxLength={100} disabled={busy}/></label>{health?.requiresAdminToken !== false && <label>운영자 토큰<input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder="수집 권한 확인용" disabled={busy}/></label>}<button type="submit" className="primary" disabled={busy || !riotId.trim()}>{busy ? <RefreshCw className="collecting" size={15}/> : <ArrowRight size={15}/>} 실제 전적 분석</button></div></form>
    <details className="collector"><summary>소규모 장인 후보 수집 · 운영자 테스트</summary><p>공식 상위 솔로랭크 목록에 PUUID가 있는 유저만 선택합니다. 티어별 1명, 전체 선택 시 최대 3명을 순서대로 분석합니다.</p><div><select aria-label="후보 수집 티어" value={tier} onChange={e => setTier(e.target.value)} disabled={busy}><option value="all">챌린저 · 그랜드마스터 · 마스터</option><option value="challenger">챌린저</option><option value="grandmaster">그랜드마스터</option><option value="master">마스터</option></select><button className="secondary" onClick={() => void action('collect')} disabled={busy}>실제 후보 수집</button></div></details>
    {resumeId && !busy && <button className="resume-button" onClick={() => void action('resume')}>저장된 분석 작업 이어가기 <RefreshCw size={13}/></button>}
    {busy && <p className="collection-note">이 화면에서 진행 중입니다. 화면을 닫으면 수집이 멈추며, 재방문 시 저장된 작업을 이어갈 수 있습니다.</p>}
    {batch && <p className="collection-note" role="status">{batch}</p>}
    {job && <div className="job-status" role="status"><strong>{phases[job.phase] ?? job.phase}</strong><span>{job.requestedGames === null ? '실제 계정 확인 중' : `경기 처리 ${job.processedGames} / 요청 ${job.requestedGames}경기`}</span>{job.status === 'running' && job.error && <p>{job.error.message} {job.retryAfterMs > 0 && `${Math.ceil(job.retryAfterMs / 1000)}초 후 재시도`}</p>}{result && <><p><b>{result.riotId.gameName}#{result.riotId.tagLine}</b> · 유효 {result.validGames}경기 / 요청 {result.requestedGames}경기 · 제외 {result.excludedGames}경기 · 미수집 {result.unavailableGames}경기</p>{!result.complete && <p className="inline-warning">일부 경기 확인에 실패했습니다. 이 결과는 장인 목록에 반영하지 않았습니다.</p>}{result.validGames < 20 && <p>표본 부족: 유효 분석이 20경기 미만이므로 확정 후보로 분류하지 않습니다.</p>}<div className="analysis-champions">{result.specialists.filter(s => s.analysis.championGames / s.analysis.totalGames >= .7).map(s => <span key={s.championId}>{s.championId} · {s.analysis.championGames}/{s.analysis.totalGames}경기 · {s.recognition.status === 'candidate' ? '원챔 후보' : s.recognition.status === 'incomplete' ? '수집 미완료' : '표본 부족'}</span>)}</div>{result.complete && !result.specialists.some(s => s.recognition.status === 'candidate') && <p>현재 분석에서 원챔 후보 기준을 충족한 챔피언이 없습니다.</p>}</>}</div>}
    {error && <p className="api-error" role="alert">{error}</p>}
  </section>;
}
