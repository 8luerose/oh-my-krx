# UI 단순화 백업 기록 2026-05-30

## 목적

이번 정리는 화면을 `종목 검색 -> 차트 확인 -> AI 판단 확인` 흐름으로 단순하게 만들기 위한 작업이다.
기능 코드는 바로 삭제하지 않고, 사용자가 보던 화면에서만 숨겼다. 나중에 필요하면 아래 목록을 기준으로 되살릴 수 있다.

## 화면에서 숨긴 것

1. 포트폴리오 샌드박스 진입 버튼
   - 이유: 가상 비중, 평균단가, 손실허용 입력은 지금 핵심 흐름을 복잡하게 만든다.
   - 복원 위치: `frontend/src/app/App.jsx`의 `PortfolioSandbox` import, `portfolioOpen` 상태, 우측 플로팅 버튼 렌더링.

2. 학습 모드 플로팅 버튼
   - 이유: 첫 화면에서 차트와 AI 판단보다 먼저 보이면 사용 흐름이 갈라진다.
   - 복원 위치: `frontend/src/app/App.jsx`의 `FloatingLearningMode` import와 `rightActionGroup`.

3. 종목 선택 패널의 AI 실행 상태, 저장 상태, 내부 근거 상태
   - 이유: 사용자는 DB, Qdrant, Ollama 실행 단계를 몰라도 된다.
   - 복원 위치: `frontend/src/components/ImmersiveChart.jsx`의 `stockAdviceSnapshot`, `stockNewsSnapshot`, `stockMarketSnapshot`, `stockConsensusSnapshot`, `aiPipelinePanel` 영역.

4. 차트 위에 겹쳐 올라가던 상세 패널
   - 이유: 그래프, 메뉴, 판단 카드가 서로를 가려 PC 화면에서 읽기 어렵다.
   - 복원 위치: `frontend/src/components/TradingViewPriceChart.jsx`의 기존 오버레이 렌더링과 `TradingViewPriceChart.module.css`의 `.brandBadge`, `.signalPanel`, `.forecastHud`, `.zoneRail` 등.

5. AI 카드의 개발자용 저장, 검색, 감사 로그 문구
   - 이유: 투자 판단에 직접 필요하지 않은 내부 시스템 상태다.
   - 복원 위치: `frontend/src/components/FloatingAiCard.jsx`와 `FloatingAiCard.module.css`의 `storageNotice`, `ollamaWorkflowGrid`, `threeFeaturePlan` 관련 영역.

6. 오른쪽 판단 패널의 세부 가격 구간 목록
   - 이유: `분할매수 검토 구간`, `관망 구간`까지 동시에 보이면 사용자가 지금 해야 할 판단을 놓치기 쉽다.
   - 현재 노출: `매수 검토 기준`, `매도 검토 기준`, `손실 방어 기준` 중 핵심 2개만 표시한다.
   - 복원 위치: `frontend/src/components/TradingViewPriceChart.jsx`의 `visibleZoneSummaries` 렌더링.

## 새로 남긴 핵심 흐름

1. 기업 이름이나 종목코드로 검색한다.
2. 차트를 본다.
3. 오른쪽 판단 패널에서 현재가, AI 판단, 뉴스 방향, 핵심 가격 기준을 확인한다.
4. 하단 AI 카드에서 더 자세한 매수, 관망, 매도 조건을 확인한다.
5. 브리프 달력에서 pykrx 기준으로 저장된 날짜별 시장 브리프를 확인한다.

## 원인 정리

- 기존 화면은 차트 위에 여러 `absolute` 패널을 겹쳐 올리는 구조였다.
- hover 툴팁이 마우스 이벤트를 받아 차트 hover 상태가 반복해서 꺼졌다 켜질 수 있었다.
- 사용자에게 필요하지 않은 DB, Qdrant, Ollama 내부 상태가 화면에 직접 노출됐다.
- 종목 선택 패널이 검색 도구가 아니라 운영 상태 대시보드처럼 커졌다.
- `거래량이 붙다`, `윗꼬리`, `추격`, `분할매수`처럼 초보자가 바로 이해하기 어려운 표현이 화면에 그대로 보였다.

## 복원 원칙

기능을 되살릴 때도 첫 화면에 한꺼번에 다시 올리지 않는다.
필요하면 별도 설정 화면, 관리자 화면, 또는 접힌 고급 보기로만 복원한다.

## 문구 정리 원칙

- `Ollama`, `Qdrant`, `DB 감사 로그` 같은 내부 구현명은 사용자 화면에 직접 쓰지 않는다.
- `거래량이 붙다`는 `거래량이 늘어나다`로 쓴다.
- `윗꼬리`는 `장중에 올랐다가 다시 밀린 흐름`처럼 풀어서 쓴다.
- `추격 매수`는 `급하게 따라 사기`처럼 행동이 바로 이해되는 말로 바꾼다.
