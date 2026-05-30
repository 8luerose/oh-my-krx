# kr-stock-daily-brief (MVP)

**목표:** 한국 주식 시장을 날짜별로 요약 생성하고(MySQL에 저장), 초보자도 이해하기 쉬운 **오늘의 시장 브리프 + 종목 리서치 + 용어 학습 UI**에서 조회한다.

- 데이터 계산: `marketdata` 서비스(`/leaders`)가 “상승/하락/언급 TOP”을 산출
- 저장/제공: `backend`가 요약을 생성/저장하고 REST API로 제공
- 표시/학습: `frontend`에서 오늘의 시장 브리프, TOP3 종목 리서치 패널, 캔들차트, 월 달력, 초보자 용어 사전, 학습 도우미를 제공
- AI 확장점: `/api/learning/assistant`는 내부 용어 사전 기반 응답을 제공하고, `/api/ai/chat`은 검색/브리프/차트/이벤트/뉴스/용어 근거를 묶은 RAG 응답을 제공한다.
- AI 서비스: `ai-service`가 `/chat`, `/ollama/insights`를 제공하고 backend가 `/api/ai/chat`, `/api/ai/ollama/insights`로 프록시한다. OpenAI-compatible, Anthropic-compatible, Ollama 설정이 있으면 live LLM으로 응답하고, 설정이 없거나 실패하면 규칙형 근거 기반 fallback으로 응답한다.

> 추가 목표: Discord **웹훅(Webhook)**으로 지정 **스레드**에 자동 포스팅

---

## Stack

- Backend: Java 17, Spring Boot 3 (Gradle, Flyway, JPA)
- Frontend: React + JavaScript (Vite)
- Marketdata: FastAPI + pykrx + Naver(크롤링)
- AI service: FastAPI + RAG-ready response contract
- Vector store: Qdrant (RAG 확장용)
- DB: MySQL
- Orchestration: Docker Compose + Makefile wrappers

---

## 빠른 시작(로컬, Docker)

```bash
make up
make health
```

열기:
- UI: http://localhost:5173
- API(예시): http://localhost:8080/api/summaries?from=2026-02-01&to=2026-02-29

오늘 생성:
```bash
curl -X POST "http://localhost:8080/api/summaries/generate/today"
```

특정 날짜 생성:
```bash
curl -X POST "http://localhost:8080/api/summaries/2026-02-26/generate"
```

---

## 시스템 동작(핵심 플로우)

### 1) marketdata: 리더 계산 API
- 서비스: `marketdata-python` (port 8000)
- 핵심 엔드포인트: `GET /leaders?date=YYYY-MM-DD`
- 계산 규칙(현재 코드 기준)
  - **topGainer/topLoser**: pykrx 등락률(전영업일→해당일)에서 상위/하위
  - **mostMentioned**: 네이버 금융 종목토론방(board.naver) 게시물 수 top(거래대금 상위 유니버스에서 TOP3)

응답 예시(축약):
```json
{
  "date": "2026-02-26",
  "effectiveDate": "20260226",
  "topGainer": "젠큐릭스",
  "topLoser": "캐리",
  "mostMentioned": "한화비전",
  "topGainers": [{"code":"229000","name":"젠큐릭스","rate":68.91}],
  "topLosers": [{"code":"313760","name":"캐리","rate":-35.42}],
  "mostMentionedTop": [{"code":"489790","name":"한화비전","count":60}],
  "source": "pykrx(KRX historical change) + naver(item board)",
  "notes": "..."
}
```

### 2) backend: 요약 생성/저장/조회 API
- 서비스: Spring Boot (port 8080)
- 동작: `POST /api/summaries/{date}/generate` 호출 시
  1) marketdata에서 리더 데이터를 받아서
  2) 날짜 1건 요약을 생성하고
  3) MySQL에 저장한 후
  4) 저장된 결과를 JSON으로 반환

### 3) frontend: 브리프 + 학습 UI
- 서비스: Vite/React (port 5173)
- 첫 화면에서 오늘의 시장 브리프, 데이터 기준일, 주요 종목 흐름, AI 학습 도우미를 먼저 표시
- 상단 내비게이션은 `브리프`, `종목 리서치`, `학습`, `포트폴리오`, `운영`으로 분리
- 월 달력에서 날짜를 선택하면 backend API로 조회해서 표시
- 상승/하락/언급 TOP3 항목을 선택하면 종목 상세 리서치 패널로 연결
- 종목 상세에서 일봉/주봉/월봉 캔들차트, 20일 이동평균선, 거래량, 급등/급락/거래량 이벤트 마커를 확인
- 차트 옆에서 공격형/중립형/보수형 시나리오별 매수 검토, 매도 검토, 리스크 관리 조건을 교육용으로 확인
- 종목 선택 시 국내 뉴스 헤드라인 후보를 함께 불러와 Ollama 단기 감성 판단의 근거로 사용
- 포트폴리오 샌드박스에서 관심 종목과 가상 비중을 저장하고 집중도/변동성 리스크를 확인
- 브리프 옆에서 `등락률`, `거래량`, `PER`, `공시`, `종목토론방 언급량` 같은 핵심 용어를 바로 확인
- 학습 도우미에서 선택 날짜와 용어를 묶어 초보자용 설명/주의점/출처/한계를 확인
- 운영 버튼은 접힌 관리자/운영 패널에서 실행
  - 오늘 생성
  - 선택일 생성
  - 일괄 생성(backfill)
  - 보관(archive)

---

## API (Backend)

조회:
- `GET /api/summaries?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/summaries/{date}`
- `GET /api/summaries/latest`
- `GET /api/summaries/stats`
- `GET /api/summaries/insights?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/summaries/{date}/verification/krx`

생성/운영:
- `POST /api/summaries/{date}/generate`
- `POST /api/summaries/generate/today`
- `POST /api/summaries/backfill?from=YYYY-MM-DD&to=YYYY-MM-DD` (admin)
- `PUT /api/summaries/{date}/archive` (admin)

학습/AI 연결:
- `GET /api/learning/terms`
- `GET /api/learning/terms/{id}`
- `POST /api/learning/assistant`
- `POST /api/ai/chat`
- `POST /api/ai/ollama/insights`
- `GET /api/ai/chat/history?stockCode=005930`
- `GET /api/ai/status`

종목 리서치:
- `GET /api/stocks/{code}/chart?range=1M|3M|6M|1Y|3Y&interval=daily|weekly|monthly`
- `GET /api/stocks/{code}/events?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/stocks/{code}/news?limit=8`

정책:
- 날짜 포맷은 ISO `YYYY-MM-DD`
- 미래 날짜는 생성/백필/보관 모두 차단
- 이미 존재하는 날짜의 재생성은 admin만 허용(일반 요청은 409)
- 최신/기간 브리프 응답에는 `afterMarketAiReport`가 포함되어 장후 시장 분위기, 핵심 포인트, 다음 거래일 확인 항목을 바로 보여준다. Ollama 모델이 연결되면 `/api/ai/ollama/insights`가 같은 브리프 맥락을 로컬 LLM 코멘트로 보강한다.
- 학습 도우미는 투자 지시가 아니라 용어 설명/체크리스트/주의점 제공 목적이다.
- 종목 판단 패널은 교육용 분석 보조이며 “지금 사라/팔아라”가 아니라 조건, 리스크, 반대 신호를 제공한다.
- 기업 선택은 React 화면 상태만 바꾸며 DB에 저장하지 않는다. AI 답변은 생성 직후 `ai_chat_interactions`에 감사 로그로 저장되고, 포트폴리오 샌드박스 입력은 `portfolio_items`에 저장된다.

---

## Scheduler (Backend)

- 평일 1회 자동 생성 (기본: 15:40 Asia/Seoul)
- 구현: `SummaryScheduler`의 Spring `@Scheduled`

---

## Admin-only operations (ADMIN_KEY)

운영자가 데이터를 덮어쓰거나(재생성) 대량 작업(백필)을 실행할 때 보호 장치.

- Admin 인식 방법
  - HTTP header: `X-Admin-Key: <ADMIN_KEY>`
  - 또는 query param: `adminKey=<ADMIN_KEY>`
  - 또는 trusted CIDR에서의 요청(로컬/도커 내부)

Admin-only:
- 기존 날짜 재생성(=이미 존재하는 date에 대해 generate)
- backfill
- archive

---

## Discord 자동 포스팅 (계획)

**방식:** Discord Webhook URL로 POST 해서, 생성된 요약을 지정 스레드에 올린다.

- (제안) 환경변수
  - `DISCORD_WEBHOOK_URL`
  - `DISCORD_THREAD_ID` (있으면 `?thread_id=` 방식으로 스레드에 포스팅)

포스팅 예시(개념):
- 제목: `[2026-02-26] 한국 주식 일간 브리프`
- 본문: topGainer/topLoser/mostMentioned + TOP3 + 근거 링크

---

## Environment Variables

Copy `.env.example` to `.env` and adjust values for your environment.

| Variable | Required | Description |
|----------|----------|-------------|
| `DB_NAME` | Yes | Database name |
| `DB_USER` | Yes | Database user |
| `DB_PASSWORD` | Yes | Database password |
| `DB_ROOT_PASSWORD` | Yes | MySQL root password |
| `BACKEND_PORT` | Yes | Backend API port (default: 8080) |
| `FRONTEND_PORT` | Yes | Frontend UI port (default: 5173) |
| `MARKETDATA_PORT` | Yes | Market data service port (default: 8000) |
| `AI_SERVICE_PORT` | No | AI service port (default: 8100) |
| `QDRANT_PORT` | No | Qdrant port (default: 6333) |
| `API_BASE_URL` | Yes | Backend URL accessible from frontend |
| `MARKETDATA_PROVIDER` | No | Provider: `pykrx` or `naver` (default: pykrx) |
| `MARKETDATA_BASE_URL` | No | Market data service URL (Docker internal) |
| `AI_SERVICE_BASE_URL` | No | AI service URL (Docker internal) |
| `QDRANT_URL` | No | Vector store URL used by ai-service to store and retrieve AI grounding documents |
| `QDRANT_ENABLED` | No | Enable or disable Qdrant grounding memory. Default: `true` |
| `QDRANT_COLLECTION` | No | Qdrant collection for AI grounding memory. Default: `kr_stock_ai_memory_ollama` |
| `QDRANT_VECTOR_PROVIDER` | No | Qdrant vector source: `ollama`, `hash`, or `auto`. Default: `ollama` |
| `QDRANT_EMBEDDING_MODEL` | No | Ollama model used for semantic Qdrant vectors. Default: `llama3.1:latest` |
| `QDRANT_VECTOR_SIZE` | No | Qdrant vector size. Ollama `llama3.1:latest` uses `4096`; hash fallback can use smaller sizes |
| `QDRANT_MAX_DOCUMENTS` | No | Maximum grounding documents stored per AI request. Default: `16` |
| `QDRANT_TIMEOUT_SECONDS` | No | Qdrant HTTP timeout. Default: `2.5` |
| `QDRANT_EMBEDDING_TIMEOUT_SECONDS` | No | Ollama embedding timeout for Qdrant vectorization before hash fallback. Default: `2` |
| `QDRANT_INSIGHTS_SYNC_ENABLED` | No | Run Qdrant upsert/search inside `/api/ai/ollama/insights`. Default: `false` so stock selection shows the local LLM card faster |
| `QDRANT_INSIGHTS_ASYNC_UPSERT_ENABLED` | No | Store `/api/ai/ollama/insights` grounding documents in Qdrant after the fast response path starts. Default: `true` |
| `LLM_PROVIDER` | No | `ollama`, `anthropic_compatible`, `openai_compatible`, `anthropic`, `openai`, or `auto`. Docker default is `ollama` |
| `LLM_MODEL` | No | OpenAI-compatible model name |
| `LLM_BASE_URL` | No | OpenAI-compatible API base URL |
| `LLM_API_KEY` | No | Generic LLM API key. Never commit real values |
| `OPENAI_API_KEY` | No | OpenAI-compatible fallback key. Never commit real values |
| `ZAI_API_KEY` | No | Z.ai OpenAI-compatible fallback key. Never commit real values |
| `ANTHROPIC_AUTH_TOKEN` | No | Anthropic-compatible API key. Never commit real values |
| `ANTHROPIC_API_KEY` | No | Anthropic-compatible fallback key. Never commit real values |
| `ANTHROPIC_MODEL` | No | Anthropic-compatible model override |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | No | Docker default is `glm-5-turbo` |
| `ANTHROPIC_BASE_URL` | No | Docker default is `https://api.z.ai/api/anthropic` |
| `ANTHROPIC_VERSION` | No | Anthropic API version header |
| `LLM_TIMEOUT_SECONDS` | No | AI service live LLM wait time before rule-based fallback |
| `LLM_MAX_TOKENS` | No | Max live LLM response tokens |
| `OLLAMA_BASE_URL` | No | Local Ollama URL. Docker Desktop default: `http://host.docker.internal:11434` |
| `OLLAMA_MODEL` | No | Local Ollama model for `/api/ai/ollama/insights` and `LLM_PROVIDER=ollama`. Docker default: `llama3.1:latest` |
| `OLLAMA_TIMEOUT_SECONDS` | No | Ollama wait time before rule-based fallback for full text answers. Docker default: `18` |
| `OLLAMA_JSON_TIMEOUT_SECONDS` | No | Faster wait time for `/api/ai/ollama/insights` JSON cards before rule-based fallback. Docker default: `10` |
| `OLLAMA_STATUS_TIMEOUT_SECONDS` | No | Short reachability check timeout for `/api/ai/status`. Default: `1.2` |
| `OLLAMA_NUM_PREDICT` | No | Ollama max generated tokens. Docker default: `420` |
| `OLLAMA_JSON_NUM_PREDICT` | No | Shorter Ollama JSON insight token budget. Docker default: `80` |
| `AI_CLIENT_CONNECT_TIMEOUT_SECONDS` | No | Backend connection timeout to ai-service |
| `AI_CLIENT_READ_TIMEOUT_SECONDS` | No | Backend read timeout to ai-service |
| `PUBLIC_KEY` | No | Access gate key (leave empty to disable) |
| `ADMIN_KEY` | Recommended | Admin key for protected operations |
| `APP_ADMIN_TRUSTED_CIDRS` | No | Comma-separated CIDRs for trusted admin bypass |

### LLM 모델 변경

모델은 코드 수정 없이 `.env` 또는 배포 secret에서 환경변수만 바꾸면 된다. 로컬 `.env`는 commit하지 않는다. 이 프로젝트의 Docker 기본값은 로컬 Ollama 우선이다.

Ollama 로컬 기본 예:
```bash
ollama pull llama3.1
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_MODEL=llama3.1:latest
OLLAMA_TIMEOUT_SECONDS=18
OLLAMA_JSON_TIMEOUT_SECONDS=10
OLLAMA_JSON_NUM_PREDICT=80
AI_CLIENT_READ_TIMEOUT_SECONDS=60
docker compose up -d --build ai-service backend frontend
curl http://localhost:8080/api/ai/status
curl -X POST http://localhost:8080/api/ai/ollama/insights \
  -H 'Content-Type: application/json' \
  -d '{"question":"삼성전자 지금 사도 되나요?","context":{"stockCode":"005930","stockName":"삼성전자","newsHeadlines":[{"title":"삼성전자 반도체 실적 개선 기대","sentiment":"positive","matchedKeywords":["실적","반도체"]}]}}'
```

Anthropic-compatible 예:
```bash
LLM_PROVIDER=anthropic_compatible
ANTHROPIC_AUTH_TOKEN=...
ANTHROPIC_DEFAULT_SONNET_MODEL=glm-5-turbo
ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
docker compose up -d --build ai-service backend
curl http://localhost:8080/api/ai/status
```

OpenAI-compatible 예:
```bash
LLM_PROVIDER=openai_compatible
LLM_MODEL=<openai-compatible-model-name>
LLM_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=...
docker compose up -d --build ai-service backend
curl http://localhost:8080/api/ai/status
```

Docker 내부 Ollama를 쓰려면 `docker compose --profile ollama up -d ollama`로 Ollama 컨테이너를 띄우고, `OLLAMA_BASE_URL=http://ollama:11434`와 `OLLAMA_MODEL`을 지정한다. 모델이 없거나 호출이 실패하면 화면은 규칙형 미리보기로 계속 동작한다.

`make ollama-up`은 Docker Ollama 컨테이너를 올리고, `make ollama-pull OLLAMA_MODEL=llama3.1:latest`는 컨테이너 안에 모델을 내려받는다. `/api/ai/status` 또는 `make ollama-status`에서 `provider`, `configured`, `model`, `baseUrl`, `timeoutSeconds`, `jsonTimeoutSeconds`, `runtime.reachable`, `runtime.modelAvailable`을 확인한다. live LLM이 느리거나 실패하면 `/api/ai/chat`과 `/api/ai/ollama/insights`는 규칙형 근거 기반 응답으로 돌아간다.

종목 선택 직후 뜨는 `/api/ai/ollama/insights`는 사용자 체감 속도가 우선이라 기본값에서 Qdrant 동기 검색을 건너뛴다. 대신 `QDRANT_INSIGHTS_ASYNC_UPSERT_ENABLED=true`이면 응답 생성 뒤 같은 근거 문서를 Qdrant에 백그라운드 저장한다. 전체 RAG 근거 저장/검색은 `/api/ai/chat` 경로에서 유지되며, 인사이트 경로까지 동기 검색하려면 `QDRANT_INSIGHTS_SYNC_ENABLED=true`로 바꾼다.

---

## Make Targets

- `make up`: build + start services
- `make down`: stop services
- `make logs`: tail logs
- `make ops-check`: validate Docker Compose config and scan tracked files for env/secret leaks
- `make quality`: ops-check + backend tests + frontend build/audit + investment-language safety check + API smoke + Playwright E2E
- `make frontend-quality`: install frontend dev dependencies, build, audit, and run Playwright E2E
- `make qa`: ops-check + API smoke + public-key gate QA + investment-language safety check
- `make llm-benchmark`: run the repeatable live LLM quality benchmark when live LLM credentials are configured
- `make deploy-smoke`: verify deployed backend/frontend health and core API/search contracts with `DEPLOY_*` URLs
- `make generate-today`: generate today summary (Asia/Seoul date)
- `make latest`: get latest saved summary
- `make ollama-up`: start the optional Docker Ollama service
- `make ollama-pull OLLAMA_MODEL=llama3.1:latest`: pull a local Ollama model into the optional Docker service
- `make ollama-status`: print `/api/ai/status`, including Ollama reachability and model availability

CI also runs the same quality gate on push/PR through `.github/workflows/quality.yml`.
If `DEPLOY_FRONTEND_URL` or `DEPLOY_BACKEND_URL` repository secrets are configured,
CI runs the optional deployment smoke gate after browser E2E.

---

## Docs

- PRD: `./PRD.md`
- AI 개발 방향: `./docs/AI_DEVELOPMENT_DIRECTION_AND_PROMPT.md`
- 운영/배포 가이드: `./docs/OPERATIONS.md`
- 프론트 품질 루프 보고서: `./docs/FRONTEND_QUALITY_LOOP_REPORT.md`
- 프론트 완료 감사: `./docs/FRONTEND_COMPLETION_AUDIT.md`
- 다음 AI 인수인계 프롬프트: `./docs/AI_HANDOFF_PROMPT.md`
- AI 자가 점검/품질 개선 프롬프트: `./docs/AI_SELF_REVIEW_QUALITY_PROMPT.md`
- (추가 문서가 생기면) `docs/` 폴더에 정리
