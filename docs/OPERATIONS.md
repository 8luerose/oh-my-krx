# 운영/배포 가이드

## 로컬 기동

```bash
cp .env.example .env
make up
make health
```

서비스:
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8080`
- Marketdata: `http://localhost:8000`
- AI service: `http://localhost:8100`
- Qdrant: `http://localhost:6333`

## 출시 전 점검

```bash
make ops-check
./gradlew test
(cd frontend && npm run build)
python3 -m py_compile marketdata-python/app/main.py
python3 -m py_compile ai-service/app/main.py
docker compose up -d --build
./scripts/test_all_apis.sh
```

정상 기준:
- `docker compose config -q`가 통과하고 tracked `.env`/명백한 secret token이 없다.
- `docker compose ps`에서 mysql/backend/frontend/marketdata/ai-service/qdrant가 모두 `Up`
- `GET /actuator/health`가 `{"status":"UP"}`
- `GET /api/stocks/005930/chart` 응답에 `data[]` 존재
- `POST /api/ai/chat` 응답에 `sources`, `limitations`, `oppositeSignals` 존재
- 브라우저에서 첫 화면, 종목 차트, AI 차트 해석 버튼, 포트폴리오 샌드박스가 보임

## Live LLM 품질 점검

live LLM credential이 있는 환경에서는 다음 벤치마크를 추가로 실행한다.

```bash
make llm-benchmark
```

정상 기준:
- `/api/ai/status`가 `configured=true`를 반환한다.
- 3개 고정 케이스가 모두 `mode=rag_llm`으로 응답한다.
- 각 응답이 근거 문서 id를 2개 이상 인용한다.
- 직접 매수/매도 지시나 수익 보장 표현이 없다.
- `/api/ai/chat` 응답의 `storage.saved=true`면 `ai_chat_interactions`에 감사 로그가 저장된 것이다.

자세한 기준은 `docs/LLM_QUALITY_BENCHMARK.md`에 기록한다.

## AI 답변 저장과 모델 변경

기업 선택은 DB에 저장하지 않는다. 사용자가 기업을 고르면 프론트 상태가 바뀌고 차트, 이벤트, 거래 구간, AI 설명을 다시 조회한다.

저장되는 것은 두 가지다.

- `portfolio_items`: 포트폴리오 샌드박스에서 종목을 담거나 비중을 바꿀 때 저장된다.
- `ai_chat_interactions`: `/api/ai/chat` 응답이 생성된 직후 질문, 종목, 응답 모드, 모델명, 답변 요약을 감사 로그로 저장한다.

최근 AI 기록 확인:

```bash
curl 'http://localhost:8080/api/ai/chat/history?stockCode=005930'
```

모델은 코드 수정 없이 환경변수로 바꾼다. 로컬 `.env`와 secret 값은 commit하지 않는다.

Anthropic-compatible 기본 흐름:

```bash
LLM_PROVIDER=anthropic_compatible
ANTHROPIC_AUTH_TOKEN=...
ANTHROPIC_DEFAULT_SONNET_MODEL=glm-5-turbo
ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
docker compose up -d --build ai-service backend
curl http://localhost:8080/api/ai/status
```

OpenAI-compatible 흐름:

```bash
LLM_PROVIDER=openai_compatible
LLM_MODEL=<openai-compatible-model-name>
LLM_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=...
docker compose up -d --build ai-service backend
curl http://localhost:8080/api/ai/status
```

응답 속도 조절은 `LLM_TIMEOUT_SECONDS`, `LLM_MAX_TOKENS`, `AI_CLIENT_READ_TIMEOUT_SECONDS`로 한다.
`LLM_TIMEOUT_SECONDS`가 지나면 ai-service가 규칙형 근거 기반 응답으로 돌아가고, backend는 `AI_CLIENT_READ_TIMEOUT_SECONDS` 안에 응답을 받아야 한다.

Ollama 로컬 LLM은 별도 API로도 쓴다.

```bash
ollama pull llama3.1
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_MODEL=llama3.1
docker compose up -d --build ai-service backend frontend
curl http://localhost:8080/api/ai/status
curl -X POST http://localhost:8080/api/ai/ollama/insights \
  -H 'Content-Type: application/json' \
  -d '{"question":"삼성전자 지금 사도 되나요?","context":{"stockCode":"005930","stockName":"삼성전자","newsHeadlines":[{"title":"삼성전자 반도체 실적 개선 기대","sentiment":"positive","matchedKeywords":["실적","반도체"]}]}}'
```

`/api/ai/ollama/insights`는 한 번에 세 가지를 반환한다.

- "이 종목 지금 사도 되나요?" 조건형 매수/관망/매도 상담
- 국내 뉴스 헤드라인과 이벤트 감성 점수, 다음 거래일 상승/하락/횡보 확률
- 장후 시장 요약 리포트용 로컬 LLM 코멘트

Ollama 모델명이 없거나 로컬 서버가 꺼져 있으면 `mode=ollama_fallback_rule_based`로 즉시 규칙형 미리보기를 반환한다.

## 원격 배포 smoke

배포된 backend/frontend URL이 있으면 다음 명령으로 운영 URL을 직접 확인한다.

```bash
DEPLOY_BACKEND_URL=https://api.example.com \
DEPLOY_FRONTEND_URL=https://app.example.com \
make deploy-smoke
```

frontend에 public key gate가 있으면 `DEPLOY_PUBLIC_KEY`를 함께 전달한다.

정상 기준:
- backend `/actuator/health`가 `UP`이다.
- backend `/api/ai/status`가 provider/configuration 상태를 반환한다.
- backend `/api/search?query=삼성전자`가 `005930`을 반환한다.
- frontend `/health`가 `UP`이다.
- frontend HTML이 `한국 주식 AI 리서치` title을 포함한다.

GitHub Actions는 `DEPLOY_FRONTEND_URL` 또는 `DEPLOY_BACKEND_URL` secret이 설정된 경우
`make deploy-smoke`를 자동 실행한다. 두 URL secret이 모두 없으면 해당 단계는 skip한다.

## 운영 주의

- `.env`, API key, DB password, webhook URL은 commit하지 않는다.
- 공개 배포 전 `ADMIN_KEY`를 설정하고 `APP_ADMIN_TRUSTED_CIDRS`를 엄격하게 제한한다.
- AI 응답은 교육용 분석 보조이며 매수/매도 지시로 표시하지 않는다.
- pykrx/KRX 장애 시 생성이 지연될 수 있으므로 `marketdata` 로그를 먼저 확인한다.
