# frontend

React 기반 사용자 화면입니다. 사용자는 이 폴더에서 구현된 화면을 통해 종목을 선택하고, KRX 기반 차트와 AI 분석 패널을 함께 봅니다.

## 핵심 역할

- `src/app/App.jsx`: 앱 첫 화면과 워크스페이스 상태 연결
- `src/components/ImmersiveChart.jsx`: 종목 차트, 우측 분석 패널, 학습 진입점의 메인 화면
- `src/components/TradingViewPriceChart.jsx`: `lightweight-charts` 기반 캔들차트 렌더러
- `src/services/apiClient.js`: backend API 호출과 화면 데이터 정규화

## 데이터 흐름

```text
사용자 조작
  -> React 상태 변경
  -> backend /api/stocks/* 호출
  -> chart/events/news/trade-zones 조합
  -> 차트 + AI 패널 렌더링
```

## 실행

```bash
npm install
npm run dev
npm run build
```

Docker Compose 실행 시에는 루트에서 `make up`을 사용합니다.

