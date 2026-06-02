# backend

Spring Boot 기반 API 서버입니다. 프런트엔드 요청을 받아 MySQL에 저장된 브리프를 제공하고, marketdata와 ai-service를 호출해 종목 데이터와 AI 응답을 조합합니다.

## 핵심 역할

- `stocks/`: 종목 차트, 이벤트, 뉴스, 기초지표, 매수·매도 검토 구간 API
- `summaries/`: 날짜별 시장 브리프 생성, 조회, backfill, archive
- `ai/`: AI 채팅, Ollama 인사이트, 장후 리포트 프록시와 저장 로그
- `portfolio/`: 포트폴리오 샌드박스 저장과 비중 리스크 요약
- `config/`: Public Key 게이트와 Admin Key 보호
- `resources/db/migration/`: Flyway 기반 MySQL 스키마

## 데이터 흐름

```text
frontend
  -> backend /api/*
  -> MySQL 저장/조회
  -> marketdata-python 데이터 호출
  -> ai-service AI 응답 호출
```

## 실행

```bash
./gradlew test
./gradlew bootRun
```

Docker Compose 실행 시에는 루트에서 `make up`을 사용합니다.

