# marketdata-python

FastAPI 기반 시장 데이터 서비스입니다. KRX 계열 데이터를 `pykrx`로 우선 조회하고, 필요한 경우 Naver 데이터를 보조 경로로 사용합니다.

## 핵심 역할

- `/stocks/{code}/chart`: KRX/pykrx 기반 OHLCV 차트 데이터
- `/stocks/{code}/events`: 차트 이벤트 후보
- `/stocks/{code}/news`: 국내 뉴스 후보
- `/stocks/{code}/fundamentals`: 기초 지표 후보
- `/leaders`: 날짜별 상승·하락·언급 대표 종목 계산
- `/stocks/universe`, `/stocks/sectors`, `/stocks/themes`: 종목 선택과 분류 데이터

## 데이터 흐름

```text
backend
  -> marketdata-python
  -> pykrx / KRX 데이터
  -> 실패 시 Naver OHLCV fallback
```

## 실행

```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Docker Compose 실행 시에는 루트에서 `make up`을 사용합니다.
