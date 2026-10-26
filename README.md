# OneChamp · 원챔

**One Champion. One Identity.** 챔피언 중심의 원챔 장인 발견 서비스 프론트엔드 MVP.

## 실행

Node.js 22.12 이상(권장 24 LTS).

```bash
npm ci
npm run dev
```

개발 서버: http://localhost:5173

```bash
npm test
npm run build
npm run preview
```

## 구현

- React + TypeScript + Vite + Tailwind CSS 4, 반응형 다크 UI
- Riot Data Dragon 16.21.1 전체 173개 챔피언의 한글·영문 이름 및 공식 이미지
- 실시간 검색, 키보드 자동완성(위/아래/Enter/Escape), 검색 초기화, 역할 필터
- 카드 선택 시 해시 기반 상세 화면, 브라우저 뒤로 가기 및 상세 URL 공유
- 서버 선택(KR/NA/EUW/JP), 숙련도·선택 비율·승률 정렬
- KR의 야스오·아리·제드·리 신·요네·리븐에 가상 데모 기록 제공. 다른 챔피언/서버는 빈 상태
- 모든 유저는 가상이며 DEMO 명시. 원챔 인증·공식 순위·실시간 전적 기능 없음
- 분석 50경기 미만 표본 부족 표시. 승률은 챔피언 경기 수, 선택 비율은 분석 전체 경기 수 기준

## 파일 구조

- `src/App.tsx`: 메인·검색·상세·안내 UI
- `src/style.css`: 반응형 디자인, Tailwind 연결
- `src/models.ts`: 챔피언·Riot ID·숙련도·랭크·경기 분석·원챔 기준 모델
- `src/services/search.ts`: 검색 로직
- `src/services/specialists.ts`: 데모 저장소와 향후 서버 API 어댑터 (현재 연결 안 됨)
- `src/data/champions.json`: 공식 정적 데이터 스냅샷
- `scripts/update-champions.mjs`: 최신 Data Dragon 한글·영문 목록 갱신 (`npm run data:refresh`)
- `tests/core.test.mjs`: 검색·전체 목록 복원·지역별 데모 격리·통계 데이터 검증
- `public/_headers`, `public/_redirects`: Cloudflare Pages 정적 호스팅 설정

챔피언 이름은 번들에 포함되어 검색 시 API가 필요 없습니다. 이미지는 Riot CDN, 폰트는 Google Fonts에서 불러오므로 인터넷이 필요합니다. 외부 폰트 실패 시 시스템 폰트를 사용합니다. 데이터 갱신은 개발 시 수행하고 변경된 JSON을 커밋하세요.

## Cloudflare Pages 배포

GitHub에 이 저장소를 push한 뒤 Cloudflare 대시보드 → Workers & Pages → Create → Pages → Import an existing Git repository.

| 설정 | 값 |
| --- | --- |
| Framework preset | Vite |
| Production branch | main (저장소 기본 브랜치에 맞춤) |
| Root directory | / (저장소 루트) |
| Build command | npm run build |
| Build output directory | dist |
| Environment variable | NODE_VERSION = 24 |

API 키 및 런타임 환경변수 없이 배포 가능합니다. `package-lock.json`을 함께 커밋하세요. `wrangler.jsonc`에 Pages 프로젝트명과 출력 디렉터리를 선언했으며 `.node-version`으로 Node 24를 지정했습니다. 최초 배포 시 Cloudflare에서 GitHub 저장소 접근을 승인해야 합니다. 연결 후 기본 브랜치 push마다 자동 배포됩니다.

## 향후 Riot API 연동

현재 앱은 `demoRepository`만 사용합니다. `apiRepository`는 `/api/champions/:id/specialists?region=KR`에 요청하는 향후 어댑터이며, 서버 구현 전에는 전환하지 마세요. 실제 응답은 서버에서 검증하고 오류·로딩 상태를 확장해야 합니다.

장인 목록을 반환하는 단일 Riot API는 없습니다. 서버에서 후보 수집(동의한 계정·공식 래더 등), 작업 큐, 호출 제한/재시도, 캐싱, 갱신 주기 및 집계 저장소가 필요합니다.

1. Account-V1: Riot ID → PUUID (지역별 라우팅).
2. Champion-Mastery-V4: PUUID의 챔피언 숙련도.
3. League-V4: 현재 솔로랭크 티어·LP (플랫폼별 라우팅).
4. Match-V5: queue=420 최근 50경기 수집 후 해당 챔피언 경기 수·승리 수 집계.
5. 집계 결과에 분석 경기 수, 갱신 시각, 데이터 출처를 저장하여 서버 엔드포인트로 반환.

`plannedPolicy`는 최근 50경기·선택 비율 70%의 내부 기획 기준만 정의합니다. 판정은 구현하지 않았으며 모든 데모의 `recognition.status`는 `not-evaluated`입니다. 숙련도는 플레이 기간과 동일하지 않으므로 숙련도 점수만 표시합니다.

API 키는 Cloudflare Workers secrets (`RIOT_API_KEY`) 등 서버 측에만 보관하세요. `VITE_` 환경변수, 브라우저 번들, Git에 키를 넣지 마세요. 개발 키는 프론트엔드 MVP에 필요하지 않습니다.

공식 정적 데이터 및 API 안내: https://developer.riotgames.com/docs/lol#data-dragon

## 비제휴 고지

푸터에 Riot Games 비제휴 고지가 있습니다. OneChamp의 기획 기준은 Riot 공식 인증이나 공식 순위가 아닙니다.
