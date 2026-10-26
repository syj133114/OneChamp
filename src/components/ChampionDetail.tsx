import { useEffect, useState } from 'react';
import { ArrowLeft, Crosshair, Flame, Info, RefreshCw, Sword, Trophy } from 'lucide-react';
import type { Champion, Region, SpecialistList, SpecialistSort } from '../models';
import { apiRepository } from '../services/specialists';
import { oneChampPolicy } from '../policy';
import dataset from '../data/champions.json';
import AnalysisPanel from './AnalysisPanel';
export default function ChampionDetail({ champion, region, onBack, onPolicy }: { champion: Champion; region: Region; onBack: () => void; onPolicy: () => void }) {
  const [sort, setSort] = useState<SpecialistSort>('pickrate'); const [data, setData] = useState<SpecialistList>();
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [revision, setRevision] = useState(0);
  useEffect(() => {
    const c = new AbortController(); setData(undefined); setError('');
    if (region !== 'KR') { setLoading(false); return; }
    setLoading(true);
    apiRepository.list(champion.id, region, sort, c.signal).then(setData).catch(e => { if (!c.signal.aborted) setError(e.message); }).finally(() => { if (!c.signal.aborted) setLoading(false); });
    return () => c.abort();
  }, [champion.id, region, sort, revision]);
  const image = `https://ddragon.leagueoflegends.com/cdn/${dataset.version}/img/champion/${champion.id}.png`;
  return <div className="content detail"><button className="back" onClick={onBack}><ArrowLeft size={16}/> 전체 챔피언</button><section className="detail-hero" style={{ backgroundImage: `linear-gradient(90deg, #171721 12%, #171721bb 52%, #17172122), url(https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${champion.id}_0.jpg)` }}><img className="detail-portrait" src={image} alt={champion.name}/><div><div className="section-kicker">{champion.englishName.toUpperCase()} · {region}</div><h1>{champion.name} 장인</h1><p>이 챔피언을 가장 깊이 파고든 플레이어들</p></div><span className="demo-badge"><span/> RIOT API</span></section>
  <div className="demo-notice"><Info size={18}/><p><strong>OneChamp가 분석한 유저 중</strong> 실제 Riot API로 확인된 기록만 표시합니다. KR 전체 유저 순위나 Riot 공식 원챔 인증이 아닙니다.</p></div>
  <div className="metrics-intro"><div><Flame size={19}/><h2>하나의 챔피언, 깊이 있는 플레이</h2></div><button onClick={onPolicy}>분석 기준 <Info size={14}/></button></div>
  <div className="detail-toolbar"><span>솔로랭크 · 최근 최대 50경기 <strong>{data ? `분석된 유저 ${data.analyzedUsers}명 · 표시 ${data.players.length}명` : '실제 분석 데이터'}{data && data.matchingUsers > 100 && ' · 최대 100명 표시'}</strong></span><label>정렬 <select aria-label="장인 정렬" value={sort} onChange={e => setSort(e.target.value as SpecialistSort)}><option value="pickrate">원챔 집중도 높은 순</option><option value="mastery">챔피언 숙련도 높은 순</option><option value="winrate">챔피언 승률 높은 순</option><option value="rank">공식 솔로랭크 티어 / LP 순</option></select></label></div>
  {sort === 'winrate' && <p className="collection-note">소표본 왜곡을 줄이기 위해 해당 챔피언을 {oneChampPolicy.minimumWinRateGames}경기 이상 플레이한 유저만 표시합니다.</p>}
  {region !== 'KR' ? <div className="empty"><Crosshair size={32}/><h3>현재 실제 분석은 KR 서버만 지원합니다</h3><p>상단 서버 선택을 KR로 변경해 주세요.</p></div> : loading ? <div className="empty" role="status"><RefreshCw size={27}/>저장된 분석 결과를 불러오고 있습니다…</div> : error ? <div className="empty"><Info size={30}/><h3>장인 목록을 불러오지 못했습니다</h3><p role="alert">{error}</p><button className="primary" onClick={() => setRevision(r => r + 1)}>다시 시도</button></div> : data?.players.length ? <div className="players">{data.players.map(p => {
    const a = p.analysis, pickRate = a.championGames / a.totalGames * 100, winRate = a.championWins / a.championGames * 100;
    return <article className="player" key={p.puuid}><div className="player-identity"><div className="player-avatar"><img src={image} alt=""/><span><Sword size={12}/></span></div><div><span className="fixture-label">{p.recognition.status === 'candidate' ? '원챔 후보 · 자체 기준' : '표본 부족 · 미확정'}</span><h3>{p.riotId.gameName}<span>#{p.riotId.tagLine}</span></h3>{p.rank ? <span className={`tier tier-${p.rank.tier.toLowerCase()}`}><Trophy size={12}/>{p.rank.tier} {['MASTER','GRANDMASTER','CHALLENGER'].includes(p.rank.tier) ? '' : p.rank.division}<span>{p.rank.leaguePoints} LP</span></span> : <span className="tier">현재 솔로랭크 배치 정보 없음</span>}</div></div>
    <div className="stat"><span>얼마나 오래 · 숙련도</span><strong>{p.mastery ? p.mastery.points.toLocaleString('ko-KR') : '—'}<small>점</small></strong><span>{p.mastery ? `숙련도 레벨 ${p.mastery.level}` : '숙련도 데이터 없음'}</span></div>
    <div className="stat"><span>얼마나 자주 · 선택 비율</span><strong className="violet">{pickRate.toFixed(1)}<small>%</small></strong><div className="progress"><i style={{ width: `${pickRate}%` }}/></div><span>유효 {a.totalGames}경기 중 {a.championGames}경기</span></div>
    <div className="stat"><span>얼마나 잘 · 챔피언 승률</span><strong className="mint">{winRate.toFixed(1)}<small>%</small></strong><span>{a.championWins}승 {a.championGames - a.championWins}패 · 솔로랭크</span></div>
    <div className="player-meta"><span>실제 분석 {a.totalGames}경기 / 조회 {a.requestedGames}경기 (최대 50) · 제외 {a.excludedGames}경기 {a.totalGames < 20 && <b>표본 부족</b>}</span><time dateTime={a.updatedAt}>갱신 · {new Date(a.updatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST</time></div></article>;
  })}</div> : <div className="empty"><Crosshair size={36}/><h3>{sort === 'winrate' && data?.matchingUsers ? '최소 경기 수 조건을 충족한 장인이 없습니다' : '아직 분석된 장인이 없습니다'}</h3><p>{champion.name}의 실제 분석 데이터가 충분하지 않습니다.<br/>아래에서 실제 Riot ID를 분석하거나 소규모 후보 수집을 시작할 수 있습니다.</p></div>}
  <div className="detail-footnote"><Info size={16}/><p>선택 비율 70% 이상 · 유효 분석 20경기 이상이면 원챔 후보입니다. 20경기 미만은 표본 부족으로 표시합니다. 다시하기·비솔로랭크 경기는 제외하며, 일부 경기를 확인하지 못한 결과는 목록에 반영하지 않습니다. 수치는 표시된 갱신 시각 기준입니다.</p></div>
  {region === 'KR' && <AnalysisPanel onComplete={() => setRevision(r => r + 1)}/>}
  </div>;
}
