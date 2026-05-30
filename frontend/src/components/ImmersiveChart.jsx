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

export default function ImmersiveChart({ stock, chart, zones, events, ai, indicatorSnapshot, decisionSummary, interval, onChangeInterval, stockOptions = [], onChangeStock, learningMode, onTermClick, aiCardExpanded = false }) {
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
