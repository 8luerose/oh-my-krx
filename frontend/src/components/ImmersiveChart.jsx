import React, { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import TradingViewPriceChart from './TradingViewPriceChart';
import styles from './ImmersiveChart.module.css';

function formatCurrency(value) {
  if (value === null || value === undefined || value === '') return '확인 필요';
  if (!Number.isFinite(Number(value))) return '확인 필요';
  return `${Math.round(Number(value)).toLocaleString()}원`;
}

function getEventLabel(type) {
  if (type === 'positive') return '호재 후보';
  if (type === 'negative') return '악재 후보';
  return '확인 필요';
}

function pipelineStateLabel(state) {
  if (state === 'ready') return '완료';
  if (state === 'loading') return '실행 중';
  if (state === 'delayed') return '지연';
  return '대기';
}

function compactPanelText(value, fallback = '확인 필요', limit = 92) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function normalizePanelDecision(value) {
  const text = compactPanelText(value, '관망', 24);
  if (text === 'buy' || text === 'buy_review') return '매수 검토';
  if (text === 'sell' || text === 'sell_review') return '매도 검토';
  if (text === 'watch' || text === 'neutral') return '관망';
  return text;
}

function stockAdviceTone(decision) {
  if (String(decision || '').includes('매수')) return 'buy';
  if (String(decision || '').includes('매도')) return 'sell';
  if (String(decision || '').includes('분석')) return 'loading';
  return 'watch';
}

function firstPanelItem(items, fallback, limit = 90) {
  if (!Array.isArray(items)) return compactPanelText(fallback, fallback, limit);
  const found = items.find((item) => String(item || '').trim());
  return compactPanelText(found || fallback, fallback, limit);
}

function newsEffectTone(effect = '') {
  const text = String(effect || '');
  if (text.includes('상승') || text.includes('우호') || text.includes('긍정')) return 'positive';
  if (text.includes('하락') || text.includes('주의') || text.includes('부정') || text.includes('위험')) return 'negative';
  return 'neutral';
}

function marketMoodTone(value = '') {
  const text = String(value || '');
  if (text.includes('위험') || text.includes('방어') || text.includes('하락')) return 'risk';
  if (text.includes('관심') || text.includes('확대') || text.includes('상승')) return 'positive';
  if (text.includes('준비') || text.includes('확인')) return 'loading';
  return 'neutral';
}

export default function ImmersiveChart({ stock, chart, zones, events, ai, indicatorSnapshot, decisionSummary, interval, onChangeInterval, stockOptions = [], onChangeStock, learningMode, onTermClick, aiCardExpanded = false, onPanelOpenChange }) {
  const toolbarRef = useRef(null);
  const [activePanel, setActivePanel] = useState('none'); // 'none', 'stocks', 'guide', 'ai'
  const [guideTab, setGuideTab] = useState('ma'); // 'ma', 'beginner', 'event'
  const [stockCodeInput, setStockCodeInput] = useState(stock?.code || '');
  const [stockCodeError, setStockCodeError] = useState('');

  useEffect(() => {
    setStockCodeInput(stock?.code || '');
    setStockCodeError('');
  }, [stock?.code]);

  useEffect(() => {
    if (activePanel === 'none') return undefined;
    const handlePointerDown = (event) => {
      if (toolbarRef.current?.contains(event.target)) return;
      setActivePanel('none');
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setActivePanel('none');
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activePanel]);

  useEffect(() => {
    onPanelOpenChange?.(activePanel !== 'none');
  }, [activePanel, onPanelOpenChange]);

  const chartData = useMemo(() => {
    if (!chart?.rows) return [];

    const eventsMap = new Map();
    if (events) {
      events.forEach(e => eventsMap.set(e.date, e));
    }

    let temp = chart.rows.map(row => ({ ...row }));
    for (let i = 0; i < temp.length; i++) {
      if (i >= 4) {
        let sum = 0;
        for (let j = 0; j < 5; j++) sum += temp[i - j].close;
        temp[i].ma5 = sum / 5;
      }
      if (i >= 19) {
        let sum = 0;
        for (let j = 0; j < 20; j++) sum += temp[i - j].close;
        temp[i].ma20 = sum / 20;
      }
      if (i >= 59) {
        let sum = 0;
        for (let j = 0; j < 60; j++) sum += temp[i - j].close;
        temp[i].ma60 = sum / 60;
      }
      temp[i].event = eventsMap.get(temp[i].date) || null;
    }

    return temp;
  }, [chart, events]);

  const aiExecutionSteps = useMemo(() => {
    const insights = ai?.ollamaInsights;
    const ollamaStatus = ai?.ollamaInsightsStatus
      || (insights ? 'ready' : ai?.aiLayerStatus === 'ollama_failed' ? 'failed' : ai?.aiLayerStatus === 'loading' ? 'loading' : 'waiting');
    const marketReportStatus = ai?.marketReportStatus || (ai?.marketReport ? 'ready' : '');
    const isLoading = ollamaStatus === 'loading';
    const isDelayed = ollamaStatus === 'failed';
    const adviceDecision = insights?.stockAdvice?.decision || (isLoading ? '분석 중' : '대기');
    const newsDirection = insights?.newsSentiment?.nextTradingDay;
    const newsText = insights
      ? `상승 ${newsDirection?.up ?? '확인 중'}% · 하락 ${newsDirection?.down ?? '확인 중'}%`
      : isLoading
        ? '뉴스와 이벤트 문맥 확인 중'
        : '뉴스 방향 대기';
    const reportText = ai?.marketReport
      ? (ai.marketReport.storage?.cached ? 'DB 저장본 재사용' : '장후 리포트 준비 완료')
      : marketReportStatus === 'loading'
        ? '최신 저장 브리프 확인 중'
        : '장후 리포트 대기';
    const state = insights ? 'ready' : isLoading ? 'loading' : isDelayed ? 'delayed' : 'waiting';
    const reportState = ai?.marketReport ? 'ready' : marketReportStatus === 'loading' ? 'loading' : 'waiting';

    return [
      {
        label: '1. 이 종목 지금 사도 되나요?',
        value: adviceDecision,
        detail: '차트, 재무, 뉴스, 센티멘트를 합쳐 조건형 상담',
        state
      },
      {
        label: '2. 뉴스 감성 단기 방향',
        value: newsText,
        detail: '헤드라인 문맥을 읽고 다음 거래일 방향 확률 표시',
        state
      },
      {
        label: '3. 장후 시장 요약 리포트',
        value: reportText,
        detail: '저장된 일간 브리프에 Ollama 코멘트 추가',
        state: reportState
      }
    ];
  }, [ai]);

  const aiPipelineSummary = useMemo(() => {
    const readyCount = aiExecutionSteps.filter((step) => step.state === 'ready').length;
    const hasLoading = aiExecutionSteps.some((step) => step.state === 'loading');
    const hasDelayed = aiExecutionSteps.some((step) => step.state === 'delayed');
    const insights = ai?.ollamaInsights;
    const qdrant = insights?.qdrant || ai?.marketReport?.qdrant;
    const storage = insights?.storage || ai?.storage;
    const runtimeCache = insights?.runtimeCache;
    const reportRuntimeCache = ai?.marketReport?.runtimeCache;
    const ollamaStatus = ai?.ollamaInsightsStatus
      || (insights ? 'ready' : ai?.aiLayerStatus === 'ollama_failed' ? 'failed' : ai?.aiLayerStatus === 'loading' ? 'loading' : 'waiting');
    const marketReportStatus = ai?.marketReportStatus || (ai?.marketReport ? 'ready' : 'waiting');
    const status = hasLoading
      ? 'AI 실행 중'
      : hasDelayed
        ? '규칙형 보강'
        : readyCount === aiExecutionSteps.length
          ? '3개 기능 완료'
          : '선택 대기';
    return {
      status,
      readyCount,
      totalCount: aiExecutionSteps.length,
      mode: ollamaStatus === 'loading' ? 'Ollama LLM 준비' : insights?.mode === 'ollama_llm' || ai?.llmUsed ? 'Ollama LLM' : '근거 계산',
      storageLabel: runtimeCache?.label
        || (ollamaStatus === 'loading' ? '새 Ollama 계산 중'
          : ollamaStatus === 'failed' ? '규칙형 근거 유지'
            : storage?.saved ? `상담 DB #${storage.id || '저장'}` : '기업 선택 저장 안 함'),
      reportStorageLabel: reportRuntimeCache?.label
        || (ai?.marketReport?.storage?.cached ? '장후 DB 재사용'
          : ai?.marketReport?.storage?.saved ? '장후 DB 저장'
            : marketReportStatus === 'loading' ? '장후 확인 중'
              : marketReportStatus === 'unavailable' ? '장후 리포트 지연' : '장후 대기'),
      qdrantLabel: qdrant?.enabled ? `Qdrant ${qdrant.retrievedCount || 0}개` : 'Qdrant 대기',
      tone: hasLoading ? 'loading' : hasDelayed ? 'delayed' : readyCount === aiExecutionSteps.length ? 'ready' : 'waiting'
    };
  }, [ai, aiExecutionSteps]);

  const stockPanelAdvice = useMemo(() => {
    const insights = ai?.ollamaInsights;
    const ollamaStatus = ai?.ollamaInsightsStatus
      || (insights ? 'ready' : ai?.aiLayerStatus === 'ollama_failed' ? 'failed' : ai?.aiLayerStatus === 'loading' ? 'loading' : 'waiting');
    const loading = ollamaStatus === 'loading' && !insights;
    const delayed = ollamaStatus === 'failed' && !insights;
    const advice = insights?.stockAdvice || {};
    const sentiment = insights?.newsSentiment || {};
    const coach = insights?.beginnerCoach || {};
    const latest = chartData[chartData.length - 1] || null;
    const ma20 = indicatorSnapshot?.movingAverages?.ma20 || latest?.ma20;
    const decision = loading
      ? '분석 중'
      : normalizePanelDecision(advice.decision || ai?.chartState?.state || '관망');
    const summary = loading
      ? 'Ollama가 차트, 재무, 뉴스, 센티멘트를 합쳐 이 종목을 사도 되는지 계산하고 있습니다.'
      : compactPanelText(
        coach.plainSummary || advice.summary || ai?.conclusion || decisionSummary?.summary,
        delayed ? 'Ollama 응답이 지연되어 현재는 차트와 뉴스 기반 규칙형 판단을 먼저 보여줍니다.' : '차트와 뉴스 근거를 확인 중입니다.',
        108
      );
    const nextAction = loading
      ? '계산이 끝나기 전에는 현재가와 20일선, 거래량을 먼저 확인하세요.'
      : compactPanelText(
        coach.nextAction,
        '',
        96
      ) || firstPanelItem(
        advice.watchConditions || advice.buyConditions || advice.sellConditions,
        decisionSummary?.watchCondition || '다음 종가와 거래량을 확인한 뒤 판단합니다.',
        96
      );
    const caution = loading
      ? 'AI 응답 전 추격 매수는 피하고, 장 마감 후 리포트와 뉴스 원문을 함께 확인하세요.'
      : compactPanelText(
        coach.cautionReason || coach.avoidAction,
        '',
        96
      ) || firstPanelItem(
        sentiment.downRisks || advice.riskNotes,
        sentiment.caution || decisionSummary?.riskCondition || '반대 신호와 지지선 이탈 여부를 확인합니다.',
        96
      );
    const news = sentiment.nextTradingDay || {};
    const newsLabel = Number.isFinite(Number(news.up)) && Number.isFinite(Number(news.down))
      ? `상승 ${Math.round(Number(news.up))}% · 하락 ${Math.round(Number(news.down))}%`
      : loading ? '뉴스 계산 중' : '뉴스 확인 필요';

    return {
      decision,
      tone: stockAdviceTone(decision),
      summary,
      nextAction,
      caution,
      priceLabel: formatCurrency(latest?.close),
      ma20Label: formatCurrency(ma20),
      newsLabel,
      sourceLabel: insights?.mode === 'ollama_llm' || ai?.llmUsed ? 'Ollama LLM' : loading ? 'Ollama 계산 중' : delayed ? '규칙형 유지' : '근거 계산'
    };
  }, [ai, chartData, decisionSummary, indicatorSnapshot]);

  const stockPanelNews = useMemo(() => {
    const insights = ai?.ollamaInsights;
    const sentiment = insights?.newsSentiment || {};
    const ollamaStatus = ai?.ollamaInsightsStatus
      || (insights ? 'ready' : ai?.aiLayerStatus === 'ollama_failed' ? 'failed' : ai?.aiLayerStatus === 'loading' ? 'loading' : 'waiting');
    const loading = ollamaStatus === 'loading' && !insights;
    const headline = sentiment.headlineAnalyses?.[0] || null;
    const fallbackHeadline = sentiment.headlineSignals?.[0] || events?.[0]?.title;
    const upReason = firstPanelItem(
      sentiment.upReasons,
      loading ? '뉴스와 이벤트 문맥을 로컬 AI가 읽는 중입니다.' : '상승 쪽 근거는 가격 반응과 거래량으로 확인해야 합니다.',
      92
    );
    const downRisk = firstPanelItem(
      sentiment.downRisks,
      loading ? '계산 중에는 뉴스 제목 하나만 보고 추격 매수하지 않습니다.' : sentiment.caution || '하락 쪽 반대 근거와 지지선 이탈 여부를 확인합니다.',
      92
    );
    const action = firstPanelItem(
      sentiment.actionGuide || sentiment.tradingScenarios,
      loading ? '로컬 AI 답변이 붙기 전까지는 원문 뉴스와 거래량 변화를 함께 봅니다.' : '뉴스 원문과 거래량 반응을 함께 확인합니다.',
      98
    );
    const effect = headline?.effect || (loading ? '문맥 계산 중' : sentiment.label || '확인 필요');

    return {
      title: compactPanelText(headline?.title || fallbackHeadline, loading ? '뉴스 헤드라인 문맥 계산 중' : '뉴스 헤드라인 확인 필요', 96),
      effect: compactPanelText(effect, '확인 필요', 28),
      reason: compactPanelText(headline?.reason || sentiment.llmContextReason || sentiment.summary, loading ? '뉴스 제목과 이벤트를 함께 읽어 단기 방향을 계산합니다.' : '뉴스 문맥 근거를 확인합니다.', 104),
      upReason,
      downRisk,
      action,
      scoreLabel: Number.isFinite(Number(sentiment.score)) ? `${Number(sentiment.score) > 0 ? '+' : ''}${Math.round(Number(sentiment.score))}점` : loading ? '계산 중' : '확인 필요',
      confidence: compactPanelText(sentiment.confidence || sentiment.evidenceQuality, loading ? '근거 수집 중' : '근거 확인 필요', 34),
      tone: newsEffectTone(effect)
    };
  }, [ai, events]);

  const stockPanelMarketReport = useMemo(() => {
    const insights = ai?.ollamaInsights;
    const report = ai?.marketReport || insights?.afterMarketReport || null;
    const status = ai?.marketReportStatus || (report ? 'ready' : 'waiting');
    const loading = status === 'loading' || !report;
    const dashboard = report?.marketDashboard || {};
    const topGainer = dashboard.topGainer || {};
    const topLoser = dashboard.topLoser || {};
    const gainerText = topGainer?.name
      ? `${topGainer.name}${Number.isFinite(Number(topGainer.rate)) ? ` ${Number(topGainer.rate).toFixed(1)}%` : ''}`
      : '상승 리더 확인 중';
    const loserText = topLoser?.name
      ? `${topLoser.name}${Number.isFinite(Number(topLoser.rate)) ? ` ${Number(topLoser.rate).toFixed(1)}%` : ''}`
      : '하락 리더 확인 중';
    const mood = compactPanelText(report?.mood, loading ? '장후 리포트 확인 중' : '선별 접근', 28);
    const bias = compactPanelText(report?.marketBias, loading ? '시장 방향 확인 중' : '중립', 28);
    const tone = marketMoodTone(`${mood} ${bias}`);
    const action = firstPanelItem(
      report?.actionPlan || report?.nextWatch,
      loading
        ? '저장된 장후 브리프를 확인한 뒤 오늘 시장 분위기를 종목 판단에 연결합니다.'
        : report?.llmComment || '다음 거래일 시초가, 거래량, 20일선 유지 여부를 확인합니다.',
      108
    );
    const stockImpact = tone === 'risk'
      ? `${stock?.name || '선택 종목'} 기준으로는 추격보다 지지선·20일선 이탈 기준을 먼저 정해야 합니다.`
      : tone === 'positive'
        ? `${stock?.name || '선택 종목'} 기준으로는 시장 관심이 거래량으로 이어지는지 확인한 뒤 검토합니다.`
        : `${stock?.name || '선택 종목'} 기준으로는 시장 리더와 다른 움직임인지 비교하며 선별 접근합니다.`;

    return {
      mood,
      bias,
      tone,
      summary: compactPanelText(report?.sessionBrief || report?.llmComment, loading ? '장후 시장 요약을 불러오는 중입니다.' : '장후 시장 흐름을 종목 판단에 연결합니다.', 116),
      stockImpact,
      action,
      gainerText,
      loserText,
      storageLabel: report?.storage?.cached ? 'DB 저장본 재사용' : report?.storage?.saved ? 'DB 저장' : loading ? '저장본 확인 중' : '리포트 확인',
      basisDate: report?.basisDate || report?.marketDashboard?.basisDate || ''
    };
  }, [ai, stock?.name]);

  if (!chartData || chartData.length === 0) return null;

  const latestPoint = chartData[chartData.length - 1];
  const latestMa20 = indicatorSnapshot?.movingAverages?.ma20 || latestPoint?.ma20;
  const priceVsMa20 = indicatorSnapshot?.priceVsMa20?.position
    || (Number.isFinite(latestMa20) && latestPoint?.close >= latestMa20 ? 'above' : 'below');
  const ma20Distance = indicatorSnapshot?.priceVsMa20?.distanceRate;
  const ma20StatusText = priceVsMa20 === 'above'
    ? `현재가 ${formatCurrency(latestPoint?.close)}은 20일선 ${formatCurrency(latestMa20)} 위입니다.`
    : `현재가 ${formatCurrency(latestPoint?.close)}은 20일선 ${formatCurrency(latestMa20)} 아래입니다.`;
  const ma20DistanceText = Number.isFinite(Number(ma20Distance))
    ? `20일선과 약 ${Math.abs(Number(ma20Distance)).toFixed(1)}% 차이`
    : '20일선과의 거리는 데이터 확인 필요';
  const beginnerChecklist = [
    '현재가가 20일선 위인지 아래인지',
    '거래량이 평균보다 늘었는지',
    '저항선 근처에서 밀리는지'
  ];
  const conditionRows = [
    {
      type: 'buy',
      label: '매수 검토',
      short: '20일선 위 + 거래량 증가 확인',
      fallback: decisionSummary?.buyReviewCondition || ai?.buyCondition || '20일선 위 종가 유지와 거래량 재확대가 함께 확인되면 검토합니다.'
    },
    {
      type: 'split',
      label: '분할매수 검토',
      short: '지지선 부근 하락 둔화 확인',
      fallback: '지지선 부근에서 하락 폭이 줄고 거래량 과열이 없으면 나누어 검토합니다.'
    },
    {
      type: 'watch',
      label: '관망',
      short: '거래량 없는 돌파는 보류',
      fallback: decisionSummary?.watchCondition || ai?.waitCondition || '거래량이 동반되지 않거나 전고점 돌파가 확인되지 않으면 관망합니다.'
    },
    {
      type: 'sell',
      label: '매도 검토',
      short: '거래량 둔화와 윗꼬리 반복 확인',
      fallback: decisionSummary?.sellReviewCondition || ai?.sellCondition || '급등 뒤 거래량 둔화와 긴 윗꼬리가 반복되면 검토합니다.'
    },
    {
      type: 'risk',
      label: '리스크 관리',
      short: '지지선 이탈 시 관리 기준 확인',
      fallback: decisionSummary?.riskCondition || ai?.riskCondition || '주요 지지선이 깨지면 리스크 관리 기준을 먼저 확인합니다.'
    }
  ].map((item) => {
    const matched = zones?.find((zone) => zone.type === item.type);
    return {
      ...item,
      price: matched?.price,
      condition: matched?.condition || item.fallback,
      opposite: matched?.oppositeSignal || matched?.invalidationSignal || matched?.opposite
    };
  });
  const visibleEvents = (events || []).slice(0, 2);
  const intervalLabel = interval === 'daily' ? '1일' : interval === 'weekly' ? '1주' : '1개월';
  const normalizedStockOptions = stockOptions.length ? stockOptions : [stock].filter(Boolean);
  const handleStockCodeSubmit = (event) => {
    event.preventDefault();
    const nextCode = stockCodeInput.replace(/\D/g, '').slice(0, 6);
    if (!/^\d{6}$/.test(nextCode)) {
      setStockCodeError('6자리 종목코드를 입력하세요. 예: 005930');
      return;
    }
    setStockCodeError('');
    if (nextCode !== stock.code) onChangeStock?.(nextCode);
    setActivePanel('none');
  };

  return (
    <div className={styles.container}>
      <div className={styles.chartWrapper}>
        <TradingViewPriceChart
          stock={stock}
          interval={interval}
          chartData={chartData}
          zones={zones}
          events={events}
          indicatorSnapshot={indicatorSnapshot}
          ai={ai}
          learningMode={learningMode}
          onTermClick={onTermClick}
          focusMode={aiCardExpanded}
        />
      </div>

      {/* Top Unified Toolbar */}
      <div className={styles.topToolbar} data-testid="chart-toolbar" ref={toolbarRef}>
        <div className={styles.intervalGroup}>
          {['daily', 'weekly', 'monthly'].map(intv => (
            <button
              type="button"
              key={intv}
              className={clsx(styles.intervalBtn, interval === intv && styles.intervalActive)}
              onClick={() => onChangeInterval(intv)}
              aria-pressed={interval === intv}
            >
              {intv === 'daily' ? '1일' : intv === 'weekly' ? '1주' : '1개월'}
            </button>
          ))}
          <span className={styles.intervalStatus} data-testid="interval-status" aria-live="polite">
            {intervalLabel}
          </span>
        </div>

        <div className={styles.actionGroup}>
          <div className={styles.actionItem}>
            <button
              className={clsx(styles.actionBtn, activePanel === 'stocks' && styles.actionBtnActive)}
              onClick={() => setActivePanel(activePanel === 'stocks' ? 'none' : 'stocks')}
              data-testid="stock-selector-button"
              aria-label="기업 선택"
            >
              <span>▦</span> 기업 선택 <span className={styles.chevron}>▼</span>
            </button>
            {activePanel === 'stocks' && (
              <div className={styles.dropdownPanel} data-testid="stock-selector-panel" role="listbox" aria-label="기업 목록">
                <div className={styles.stockPanelHeader}>
                  <span>기준 기업</span>
                  <strong>{stock.name} ({stock.code})</strong>
                  <p className={styles.stockSaveNotice}>
                    기업 선택은 화면의 차트와 AI 설명만 바꿉니다. DB에 저장하려면 포트폴리오 샌드박스에 담아야 합니다.
                  </p>
                  <form className={styles.stockCodeForm} onSubmit={handleStockCodeSubmit}>
                    <label htmlFor="stock-code-direct-input">종목코드 직접 입력</label>
                    <div>
                      <input
                        id="stock-code-direct-input"
                        value={stockCodeInput}
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        placeholder="005930"
                        aria-invalid={Boolean(stockCodeError)}
                        aria-describedby={stockCodeError ? 'stock-code-direct-error' : undefined}
                        onChange={(event) => {
                          setStockCodeInput(event.target.value.replace(/\D/g, '').slice(0, 6));
                          setStockCodeError('');
                        }}
                      />
                      <button type="submit">분석</button>
                    </div>
                    {stockCodeError && <em id="stock-code-direct-error">{stockCodeError}</em>}
                  </form>
                  <div
                    className={clsx(
                      styles.stockAdviceSnapshot,
                      stockPanelAdvice.tone === 'buy' && styles.stockAdviceBuy,
                      stockPanelAdvice.tone === 'sell' && styles.stockAdviceSell,
                      stockPanelAdvice.tone === 'loading' && styles.stockAdviceLoading
                    )}
                    aria-label="선택 종목 즉시 AI 상담 요약"
                  >
                    <div className={styles.stockAdviceTopline}>
                      <span>이 종목 지금 사도 되나요?</span>
                      <strong>{stockPanelAdvice.decision}</strong>
                    </div>
                    <p>{stockPanelAdvice.summary}</p>
                    <div className={styles.stockAdviceMetrics}>
                      <span>현재가 <b>{stockPanelAdvice.priceLabel}</b></span>
                      <span>20일선 <b>{stockPanelAdvice.ma20Label}</b></span>
                      <span>뉴스 <b>{stockPanelAdvice.newsLabel}</b></span>
                      <span>근거 <b>{stockPanelAdvice.sourceLabel}</b></span>
                    </div>
                    <div className={styles.stockAdviceActions}>
                      <article>
                        <b>다음 확인</b>
                        <span>{stockPanelAdvice.nextAction}</span>
                      </article>
                      <article>
                        <b>주의할 점</b>
                        <span>{stockPanelAdvice.caution}</span>
                      </article>
                    </div>
                  </div>
                  <div className={styles.stockNewsSnapshot} aria-label="뉴스 감성 호재 악재 근거">
                    <div className={styles.stockNewsTopline}>
                      <span>뉴스가 왜 호재/악재인가요?</span>
                      <strong
                        className={clsx(
                          stockPanelNews.tone === 'positive' && styles.stockNewsPositive,
                          stockPanelNews.tone === 'negative' && styles.stockNewsNegative
                        )}
                      >
                        {stockPanelNews.effect}
                      </strong>
                    </div>
                    <article className={styles.stockNewsHeadline}>
                      <b>{stockPanelNews.title}</b>
                      <span>{stockPanelNews.reason}</span>
                    </article>
                    <div className={styles.stockNewsReasonGrid}>
                      <article>
                        <b>좋게 볼 이유</b>
                        <span>{stockPanelNews.upReason}</span>
                      </article>
                      <article>
                        <b>주의할 이유</b>
                        <span>{stockPanelNews.downRisk}</span>
                      </article>
                    </div>
                    <div className={styles.stockNewsFooter}>
                      <span>감성 {stockPanelNews.scoreLabel}</span>
                      <span>{stockPanelNews.confidence}</span>
                    </div>
                    <p>{stockPanelNews.action}</p>
                  </div>
                  <div
                    className={clsx(
                      styles.stockMarketSnapshot,
                      stockPanelMarketReport.tone === 'risk' && styles.stockMarketRisk,
                      stockPanelMarketReport.tone === 'positive' && styles.stockMarketPositive,
                      stockPanelMarketReport.tone === 'loading' && styles.stockMarketLoading
                    )}
                    aria-label="장후 시장 리포트가 종목 판단에 주는 영향"
                  >
                    <div className={styles.stockMarketTopline}>
                      <span>오늘 시장 분위기가 내 종목에 주는 영향</span>
                      <strong>{stockPanelMarketReport.mood} · {stockPanelMarketReport.bias}</strong>
                    </div>
                    <p>{stockPanelMarketReport.summary}</p>
                    <div className={styles.stockMarketLeaderGrid}>
                      <span>상승 리더 <b>{stockPanelMarketReport.gainerText}</b></span>
                      <span>하락 리더 <b>{stockPanelMarketReport.loserText}</b></span>
                    </div>
                    <div className={styles.stockMarketImpact}>
                      <b>내 종목 적용</b>
                      <span>{stockPanelMarketReport.stockImpact}</span>
                    </div>
                    <div className={styles.stockMarketFooter}>
                      <span>{stockPanelMarketReport.storageLabel}</span>
                      {stockPanelMarketReport.basisDate && <span>기준 {stockPanelMarketReport.basisDate}</span>}
                    </div>
                    <em>{stockPanelMarketReport.action}</em>
                  </div>
                  <div className={styles.aiPipelinePanel} aria-label="종목 선택 후 Ollama 실행 흐름">
                    <b>종목을 고르면 AI가 바로 확인하는 3가지</b>
                    <div className={styles.aiPipelineSummary} aria-label="Ollama 실행 상태 요약">
                      <span className={clsx(
                        styles.aiPipelineStatusChip,
                        aiPipelineSummary.tone === 'ready' && styles.aiPipelineReadyChip,
                        aiPipelineSummary.tone === 'loading' && styles.aiPipelineLoadingChip,
                        aiPipelineSummary.tone === 'delayed' && styles.aiPipelineDelayedChip
                      )}>
                        {aiPipelineSummary.status}
                      </span>
                      <span>{aiPipelineSummary.readyCount}/{aiPipelineSummary.totalCount} 완료</span>
                      <span>{aiPipelineSummary.mode}</span>
                      <span>{aiPipelineSummary.storageLabel}</span>
                      <span>{aiPipelineSummary.reportStorageLabel}</span>
                      <span>{aiPipelineSummary.qdrantLabel}</span>
                    </div>
                    <p className={styles.aiPipelineHint}>
                      {stock.name}을 선택하면 차트·재무·뉴스를 먼저 불러오고, Ollama 상담과 장후 리포트는 뒤에서 이어 붙입니다.
                    </p>
                    {aiExecutionSteps.map((step) => (
                      <div className={styles.aiPipelineRow} key={step.label}>
                        <span className={clsx(
                          styles.aiPipelineDot,
                          step.state === 'ready' && styles.aiPipelineReady,
                          step.state === 'loading' && styles.aiPipelineLoading,
                          step.state === 'delayed' && styles.aiPipelineDelayed
                        )} />
                        <div>
                          <strong>
                            {step.label}
                            <small>{pipelineStateLabel(step.state)}</small>
                          </strong>
                          <em>{step.value}</em>
                          <p>{step.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className={styles.stockList}>
                  {normalizedStockOptions.map((option) => {
                    const selected = option.code === stock.code;
                    return (
                      <button
                        type="button"
                        key={option.id || `${option.label}-${option.code}`}
                        role="option"
                        aria-selected={selected}
                        className={clsx(styles.stockOption, selected && styles.stockOptionActive)}
                        onClick={() => {
                          if (option.code !== stock.code) onChangeStock?.(option.code);
                          setActivePanel('none');
                        }}
                      >
                        <span>
                          <strong>{option.label || option.name}</strong>
                          <em>{option.name} · {option.code} · {option.market}</em>
                        </span>
                        <b>{selected ? '선택됨' : option.changeRate || '실제 데이터'}</b>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className={styles.actionItem}>
            <button 
              className={clsx(styles.actionBtn, activePanel === 'guide' && styles.actionBtnActive)}
              onClick={() => setActivePanel(activePanel === 'guide' ? 'none' : 'guide')}
              aria-label="차트 가이드"
            >
              <span>💡</span> 차트 가이드 <span className={styles.chevron}>▼</span>
            </button>
            {activePanel === 'guide' && (
              <div className={styles.dropdownPanel} data-testid="chart-guide-panel">
                <div className={styles.panelTabs}>
                  <button className={clsx(guideTab === 'ma' && styles.activeTab)} onClick={() => setGuideTab('ma')}>이동평균선</button>
                  <button className={clsx(guideTab === 'beginner' && styles.activeTab)} onClick={() => setGuideTab('beginner')}>체크리스트</button>
                  {visibleEvents.length > 0 && <button className={clsx(guideTab === 'event' && styles.activeTab)} onClick={() => setGuideTab('event')}>이벤트 해석</button>}
                </div>
                
                <div className={styles.panelBody}>
                  {guideTab === 'ma' && (
                    <section className={styles.maSection}>
                      <div className={styles.legendGrid}>
                        <span className={styles.legendItem}><i className={styles.priceLine} />현재가</span>
                        <span className={styles.legendItem}><i className={styles.ma5Line} />5일선</span>
                        <span className={styles.legendItem}><i className={styles.ma20Line} />20일선</span>
                        <span className={styles.legendItem}><i className={styles.ma60Line} />60일선</span>
                      </div>
                      <p className={styles.maStatus}>
                        <strong>{ma20StatusText}</strong> {ma20DistanceText}. 위라고 무조건 좋은 것도, 아래라고 무조건 나쁜 것도 아니며 거래량, 지지선, 저항선을 함께 봅니다.
                      </p>
                      <button type="button" className={styles.maDetailButton} onClick={() => onTermClick('이동평균선')}>
                        이동평균선 뜻 보기
                      </button>
                    </section>
                  )}

                  {guideTab === 'beginner' && (
                    <section className={styles.beginnerSection}>
                      <div className={styles.chartCueGrid}>
                        <button type="button" onClick={() => onTermClick?.('이동평균선')}>
                          20일선 {formatCurrency(latestMa20)}
                        </button>
                        <button type="button" onClick={() => onTermClick?.('지지선')}>
                          지지선 {formatCurrency(indicatorSnapshot?.supportLevel)}
                        </button>
                        <button type="button" onClick={() => onTermClick?.('저항선')}>
                          저항선 {formatCurrency(indicatorSnapshot?.resistanceLevel)}
                        </button>
                        <button type="button" onClick={() => onTermClick?.('거래량')}>
                          거래량 {Number(latestPoint?.volume || 0).toLocaleString()}
                        </button>
                      </div>
                      <ol className={styles.beginnerList}>
                        {beginnerChecklist.map((item) => <li key={item}>{item}</li>)}
                      </ol>
                      <p className={styles.subtext}>반대 신호가 나오면 결론을 보류하고 다음 거래량과 종가를 다시 확인합니다.</p>
                    </section>
                  )}

                  {guideTab === 'event' && (
                    <section className={styles.eventSection}>
                      {visibleEvents.map((event) => (
                        <article key={event.id || `${event.date}-${event.title}`} className={styles.eventItem}>
                          <div className={styles.eventHeader}>
                            <span className={clsx(styles.eventBadge, event.type === 'positive' ? styles.badgePos : event.type === 'negative' ? styles.badgeNeg : styles.badgeNeutral)}>
                              {getEventLabel(event.type)}
                            </span>
                            <strong>{event.title}</strong>
                          </div>
                          <p className={styles.subtext}>
                            <strong>{event.type === 'positive' ? '호재 판단 이유: ' : event.type === 'negative' ? '악재 판단 이유: ' : '판단 이유: '}</strong>
                            {event.reason || event.desc || 'AI가 시장 반응과 거래량을 종합해 주요 이벤트로 판단했습니다.'}
                          </p>
                          {event.opposite && <p className={styles.subtext} style={{marginTop: 4, opacity: 0.8}}>반대 해석: {event.opposite}</p>}
                        </article>
                      ))}
                    </section>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className={styles.actionItem}>
            <button 
              className={clsx(styles.actionBtn, activePanel === 'ai' && styles.actionBtnActive)}
              onClick={() => setActivePanel(activePanel === 'ai' ? 'none' : 'ai')}
              aria-label="AI 검토 조건"
            >
              <span>🤖</span> AI 검토 조건 <span className={styles.chevron}>▼</span>
            </button>
            {activePanel === 'ai' && (
              <div className={clsx(styles.dropdownPanel, styles.dropdownRight)} data-testid="chart-ai-condition-panel">
                <p className={styles.conditionNotice}>
                  직접 사라·팔아라가 아니라, 내 기준에서 확인할 조건을 나누어 보여주는 교육용 보조입니다.
                </p>
                <div className={styles.conditionGrid}>
                  {conditionRows.map((row) => (
                    <article key={row.type} className={clsx(styles.conditionItem, styles[`condition-${row.type}`])}>
                      <div className={styles.conditionHeader}>
                        <strong>{row.label}</strong>
                        {row.price && <span>{row.price}</span>}
                      </div>
                      <p className={styles.conditionDetail}>{row.condition}</p>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Hero Stock Info */}
      <div className={styles.heroInfo}>
        <div className={styles.heroCode}>{stock.code}</div>
        <h1 className={styles.heroName}>{stock.name}</h1>
        <div className={clsx(styles.heroRate, parseFloat(stock.changeRate) > 0 ? styles.pos : styles.neg)}>
          {stock.changeRate}
        </div>
      </div>
    </div>
  );
}
