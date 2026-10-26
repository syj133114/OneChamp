# OneChamp · 원챔

**One Champion. One Identity.** 챔피언 중심의 실제 원챔 장인 발견 서비스.

기존 React + TypeScript + Vite + Tailwind UI와 나피리 메인 이미지, 전체 챔피언 한글·영문 검색을 유지합니다. 장인 목록은 서버가 Riot API로 검증하고 D1에 저장한 결과만 제공합니다. 런타임 가상 플레이어 데이터는 제거했습니다.

## 로컬 실행 (Codespaces 포함)

Node.js 24 권장. 최초 설치:

```bash
npm ci
npm run build
npm run db:migrate:local
```

Riot 개발 키는 Codespaces Secret 또는 셸의 `RIOT_API_KEY` 환경변수로 설정합니다. 값을 명령줄 인수로 전달하지 마세요. 로컬 대안으로 `.dev.vars.example`을 `.dev.vars`에 복사한 뒤 `RIOT_API_KEY`를 입력할 수 있습니다. `.dev.vars`, `.env*`, `.wrangler/`는 Git에서 제외됩니다. `.dev.vars`가 있으면 Wrangler는 해당 파일을 우선 사용하므로 Codespaces 환경변수를 사용하려면 해당 파일을 사용하지 마세요. 키 변경 후 API 서버를 재시작하세요.

터미널 1:

```bash
npm run dev:api
```

터미널 2:

```bash
npm run dev
```

- 프론트엔드: http://localhost:5173 (Codespaces에서는 포트 5173의 전달 주소 사용)
- API: http://127.0.0.1:8788
- Vite가 `/api`를 Pages Functions로 프록시합니다. 로컬 D1을 사용하며 재시작 후에도 데이터가 남습니다.
- 챔피언 카드 → 실제 Riot ID 분석 → `닉네임#태그` 입력 → 분석 진행 → 조건에 맞는 장인 목록 갱신.
- 순수 로컬 요청은 운영자 토큰 없이 테스트할 수 있습니다. 로컬에서도 `ADMIN_TOKEN`을 설정하면 토큰이 필요합니다. 원격 전달 주소로 직접 Pages API에 접근하는 경우 운영자 인증이 필요하므로 Vite 포트 5173을 사용하세요.
- 일반 사용자는 키나 운영자 토큰 없이 저장된 목록을 조회할 수 있습니다.
- `npm run preview`는 정적 UI만 제공합니다. 실제 API 테스트에는 위 두 서버 또는 빌드 후 `npm run dev:api`가 필요합니다.

## 분석 기준과 정직한 데이터 표시

- KR 서버의 최근 솔로랭크(`queue=420`) 최대 50개 경기 ID를 조회합니다.
- 각 경기 `info.participants`에서 **정확히 같은 PUUID** 1명의 챔피언·승패만 사용합니다.
- 비솔로랭크, 180초 미만 경기, 해당 참가자의 `gameEndedInEarlySurrender=true` 경기는 제외합니다. 유효 경기 수를 분모로 사용합니다.
- **선택 비율 = 챔피언 경기 수 / 유효 분석 경기 수**.
- **승률 = 해당 챔피언 승리 수 / 해당 챔피언 경기 수**.
- 유효 분석 20경기 이상·선택 비율 70% 이상이면 **원챔 후보**. 20경기 미만·선택 비율 70% 이상은 목록에 **표본 부족 · 미확정**으로 별도 표시합니다.
- 승률 정렬은 **해당 챔피언 20경기 이상**만 포함합니다.
- 404 경기 또는 PUUID 불일치 등 미확인 경기가 있으면 부분 결과로 표시하고 장인 목록에는 게시하지 않습니다. 기존 완전한 스냅샷도 덮어쓰지 않습니다.
- 조회가 정상 종료되어 50경기 미만이 반환된 경우 실제 반환 경기만 분석합니다. `유효 / 조회 / 최대 50`, 제외·미수집 경기 수를 구분합니다.
- 현재 Riot ID는 Account-V1, 공식 솔로랭크 티어·단계·LP는 League-V4, 숙련도는 Champion-Mastery-V4 응답만 사용합니다. 응답에 없는 숙련도는 `정보 없음`, 랭크 엔트리가 없으면 `현재 솔로랭크 배치 정보 없음`으로 표시합니다.
- 목록 범위는 **OneChamp가 분석한 유저 중**, 최대 100명입니다. KR 전체 유저의 공식 순위가 아닙니다.
- 기본 정렬은 집중도이며 숙련도·승률·공식 티어/단계/LP 정렬을 제공합니다. MMR·ELO·독자 실력 점수는 만들지 않습니다. DB의 `rank_order`는 공식 티어/단계/LP를 정렬하기 위한 내부 키일 뿐, UI나 API에 별도 점수로 제공하지 않습니다.
- 자체 정책은 `src/policy.ts`에서 버전 관리합니다. 숙련도는 플레이한 기간과 동일하지 않으므로 기간으로 변환하지 않습니다.

## API 구조

| 경로 | 기능 | 권한 |
| --- | --- | --- |
| `GET /api/health` | DB 마이그레이션·수집 설정 준비 상태 | 공개 |
| `GET /api/champions/Yasuo/specialists?region=KR&sort=pickrate` | 저장된 검증 장인 목록 | 공개 |
| `POST /api/analyses` `{ "riotId": "실제닉네임#태그" }` | 단일 유저 분석 생성/캐시 재사용 | 운영자 |
| `GET /api/jobs/:id` | 작업 진행 상태·결과 | 운영자 |
| `POST /api/jobs/:id/advance` | 한 단계 수집·재개 | 운영자 |
| `POST /api/admin/candidates` `{ "tier": "challenger", "limit": 1 }` | 공식 래더 후보 수집 및 분석 작업 생성 | 운영자 |

정렬: `pickrate`, `mastery`, `winrate`, `rank`. 현재 실제 분석은 KR만 지원하며 다른 서버를 선택하면 지원 범위를 안내합니다.

호스팅 환경에서 수집 요청은 `X-OneChamp-Token: <ADMIN_TOKEN>` 헤더가 필요합니다. UI에서 입력한 운영자 토큰은 메모리에만 두고 브라우저 저장소에 기록하지 않습니다. Riot API 키를 입력하는 브라우저 필드는 없습니다. 세션 저장소에는 작업 UUID만 저장하며 재방문 시 토큰을 다시 입력해 작업을 이어갈 수 있습니다.

### 수집과 캐시

- 후보 수집은 챌린저·그랜드마스터·마스터 공식 솔로랭크 목록을 사용합니다. UI의 전체 선택은 각 티어에서 1명씩 최대 3명만 순서대로 분석합니다. API는 요청당 1~3명으로 제한됩니다.
- API 응답의 실제 PUUID만 저장합니다. 식별자가 없는 엔트리는 제외하고 제외 수를 반환합니다. summoner ID에서 임의 PUUID를 만들지 않습니다.
- 한 번 저장된 후보는 PUUID 기본 키로 중복 제거합니다. 실패한 분석은 단일 Riot ID로 재요청할 수 있고, 진행 중 작업은 UUID로 재개합니다. 추후 다른 티어/등록 방식은 `candidates.source`와 동일한 분석 파이프라인으로 확장할 수 있습니다.
- 작업은 D1에 단계별로 저장됩니다. `advance` 1회당 Riot 호출은 최대 1개입니다. UI가 진행 요청을 보내는 동안 수집하며, 페이지를 닫으면 멈춥니다. 예약 수집·상시 크롤러는 포함하지 않습니다.
- D1 전역 lease로 앱 내 Riot 호출 동시성을 **1**로 제한하고 호출 간 최소 **1.35초**를 둡니다. Riot의 app/method rate limit 헤더도 반영합니다. 다른 프로그램에서 같은 키를 사용하는 경우 해당 프로그램의 호출량은 사전에 알 수 없으며 Riot 429에 따라 조정됩니다.
- 429는 `Retry-After`(초/HTTP 날짜) 이상 대기 후 재개합니다. 네트워크·5xx는 단계별 최대 3회 재시도 후 실패로 종료합니다. 401/403은 키 만료/권한 문제, 404는 데이터 없음으로 구분합니다. 오류 본문과 로그에 키를 출력하지 않습니다.
- 경기 캐시는 경기 ID별로 영속 저장합니다. 전체 원본 대신 참가자 PUUID·챔피언·승패와 검증에 필요한 필드만 저장합니다.
- 완전한 유저 분석은 **1시간 캐시**합니다. 갱신은 재분석 요청 시 수행되며 자동 갱신되지 않습니다. 화면에는 실제 수집 완료 시각을 표시합니다.
- 미완료 결과는 작업에만 보관하며 랭킹용 테이블에는 넣지 않습니다. 목록 조회는 Riot API를 호출하지 않습니다.

## Cloudflare Pages 실제 배포 설정

빌드 명령 `npm run build`, 출력 디렉터리 `dist`, 기본 브랜치 `main`, Node 24. Pages가 저장소 루트 `functions/`를 백엔드로 배포합니다. `_routes.json`은 `/api/*`만 Functions로 처리합니다. GitHub push가 배포를 트리거하지만 **DB 생성·Secret 등록·마이그레이션을 대신하지 않습니다.**

원격 리소스 설정에는 해당 Cloudflare 계정 인증이 필요합니다. 실제 Database ID를 모르는 상태에서 가짜 UUID를 프로덕션 설정에 넣지 않습니다.

### 1. 실제 D1 생성·연결

```bash
npx wrangler login
npx wrangler d1 create onechamp
npm run db:configure -- <생성된-실제-database-UUID>
npx wrangler d1 migrations apply onechamp --remote
```

`db:configure`가 `wrangler.jsonc`에 실제 `DB` 바인딩과 `migrations_dir`를 추가합니다. 변경된 설정을 커밋·push하세요. CLI 로그인이 어려우면 Cloudflare 대시보드의 D1에서 `onechamp`를 생성하고 Database ID를 위 명령에 전달하세요. 마이그레이션은 CLI로 적용하거나 D1 Console에서 `migrations/0001_initial.sql`의 SQL을 실행할 수 있습니다. 대시보드 바인딩만 사용하려면 Pages → Settings → Bindings → D1 → 변수명 `DB`로 연결하되, Wrangler 설정이 바인딩을 관리하는 경우 실제 UUID도 파일에 반영하세요.

로컬 전용 `wrangler.local.jsonc`의 UUID는 로컬 SQLite 네임스페이스이며 실제 Cloudflare 리소스를 가리키지 않습니다. 프로덕션에 사용하지 마세요.

### 2. 서버 측 Secret

Pages `onechamp` → Settings → Variables and Secrets에서 **Secret**으로 설정:

| 이름 | 값 |
| --- | --- |
| `RIOT_API_KEY` | 공개 서비스용으로 승인된 Riot **프로덕션** API 키 |
| `ADMIN_TOKEN` | 운영자만 아는 충분히 긴 무작위 토큰 |

일반 변수 `APP_ENV=production`, `RIOT_KEY_MODE=production`은 `wrangler.jsonc`에 있습니다. 프로덕션 키 설정이라는 운영자 선언이며 Riot 키 종류를 문자열로 자동 감별하는 기능은 아닙니다. 전달된 개발 키는 로컬 검증에만 사용하고 공개 사이트에는 등록하지 않습니다. 승인 키가 없으면 공개 수집은 아직 준비되지 않은 상태이며 로컬 개발 검증만 가능합니다.

이후 재배포하고 `/api/health`의 `storageReady`, `collectionReady`를 확인하세요. DB만 연결되어 있으면 키 없이도 기존 저장 목록은 읽을 수 있습니다. 환경별 preview Secret/DB는 별도로 분리하여 설정하세요. 키·토큰은 채팅이나 GitHub 파일에 넣지 마세요.

## 검증

```bash
npm test
npm run build
npm run test:live -- '실제닉네임#태그'
```

`test:live`는 API 서버가 실행 중이어야 하며, Riot ID 인수 없이 실행하면 공식 챌린저 목록에서 실제 후보 1명만 선택합니다. 완료 후 실제 경기 수, 조건 충족 여부, 저장 목록 반영 및 Riot-ID 캐시 재사용을 확인합니다. 기준 미달이면 유저를 장인 목록에 강제로 추가하지 않습니다. 원격에서 실행할 때는 `ONECHAMP_API_URL`, `ONECHAMP_ADMIN_TOKEN` 환경변수를 사용하세요. 운영자 토큰은 출력하지 않습니다.

- `tests/core.test.mjs`: 공식 챔피언 식별, 한글·영문 검색, 검색 초기화/역할 필터.
- `tests/server.test.ts`: 테스트 전용 합성 프로토콜 응답으로 계산 경계값, 정확한 PUUID, 다시하기·누락 처리, 429/인증/서버 오류, 실제 SQLite SQL, 작업 재개, 캐시, 게시 제한, 인증·지역 검증. 테스트 응답은 애플리케이션에 번들되지 않습니다.
- 실제 Riot API 테스트 성공과 목 응답 테스트 성공을 구분해서 보고해야 합니다. 브라우저 자동 시각 검수는 별도입니다.

## 주요 파일

- `server/riot.ts`: 서버 전용 Riot API 어댑터·응답 검증·요청 제한
- `server/analysis.ts`: 실제 경기 집계·원챔 분류
- `server/jobs.ts`: D1 캐시·수집 작업·후보 수집·목록
- `server/router.ts`, `functions/api/[[path]].ts`: OneChamp 자체 API
- `migrations/0001_initial.sql`: D1 테이블·인덱스
- `src/components/ChampionDetail.tsx`, `AnalysisPanel.tsx`: 실제 장인 목록·분석 테스트 UI
- `src/services/specialists.ts`: 프론트엔드 전용 OneChamp API 클라이언트
- `src/data/champions.json`: 공식 챔피언 스냅샷. `npm run data:refresh`로 갱신

## 공식 명세·비제휴 고지

2026-10-26 Riot Developer Portal의 `/api-details/account-v1`, `league-v4`, `champion-mastery-v4`, `match-v5` 동적 문서를 확인했습니다. League-V4 상위 리그 엔트리는 `puuid`, 계정 응답은 `gameName/tagLine`이 없을 수 있어 없는 이름을 생성하지 않습니다.

- [Riot API 명세](https://developer.riotgames.com/apis)
- [Riot 요청 제한](https://developer.riotgames.com/docs/portal#web-apis_rate-limiting)
- [Cloudflare Pages D1 바인딩](https://developers.cloudflare.com/pages/functions/bindings/#d1-databases)
- [D1 마이그레이션 명령](https://developers.cloudflare.com/d1/wrangler-commands/#migrations-apply)

OneChamp는 Riot Games와 제휴하지 않은 독립 서비스입니다. 자체 원챔 후보 기준은 공식 인증이나 공식 실력 랭킹이 아닙니다. 푸터에 비제휴 고지를 유지합니다.

이번 구현에서는 개발 키로 실제 KR 유저 1명의 50경기를 수집했고 헤카림 41경기(선택 비율 82%)가 후보로 D1 목록에 반영되는 것을 확인했습니다. 실제 Riot ID 입력→Account-V1→랭크·숙련도→경기 분석 흐름과 재분석 시 경기 캐시 재사용도 통과했습니다. 로컬 검증 결과는 프로덕션 DB로 자동 복제하지 않습니다. 현재 원격 Cloudflare 계정 인증·실제 D1 바인딩·승인된 프로덕션 키 설정은 별도 완료가 필요합니다.
