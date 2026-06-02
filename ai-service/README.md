# ai-service

FastAPI 기반 AI 응답 서비스입니다. 차트, 뉴스, 이벤트, 시장 브리프, 용어 정보를 받아 사용자가 이해하기 쉬운 설명으로 바꿉니다.

## 핵심 역할

- `/chat`: 범용 AI 설명 응답
- `/ollama/insights`: 종목 차트 기반 AI 인사이트
- `/ollama/after-market-report`: 장후 시장 리포트
- `/llm/status`: Ollama와 외부 LLM 설정 상태 확인
- Qdrant 연동: RAG 메모리 확장
- fallback: LLM 설정이 없거나 실패해도 규칙형 응답으로 화면이 끊기지 않게 유지

## LLM 경로

```text
backend /api/ai/*
  -> ai-service
  -> Ollama 또는 외부 LLM
  -> 실패 시 fallback
```

## 실행

```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8100
```

로컬 Ollama를 쓸 경우 먼저 `ollama -v`로 실행 가능 여부를 확인하고, 필요한 모델을 `ollama pull <model>`로 내려받은 뒤 `OLLAMA_BASE_URL=http://host.docker.internal:11434` 를 사용합니다.

Docker Compose 실행 시에는 루트에서 `make up`을 사용합니다.
