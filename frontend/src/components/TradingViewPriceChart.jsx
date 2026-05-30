import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Brain, CandlestickChart, Newspaper } from 'lucide-react';
import styles from './TradingViewPriceChart.module.css';

function loadTradingViewLibrary() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('browser_only_chart_library'));
  }
  if (window.__tradingViewLibraryPromise) {
    return window.__tradingViewLibraryPromise;
  }
  window.__tradingViewLibraryPromise = import('lightweight-charts');
  return window.__tradingViewLibraryPromise;
}

function formatCurrency(value) {
  if (value === null || value === undefined || value === '') return '확인 필요';
  if (!Number.isFinite(Number(value))) return '확인 필요';
  return `${Math.round(Number(value)).toLocaleString()}원`;
}

function formatVolume(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '확인 필요';
  if (number >= 100_000_000) return `${(number / 100_000_000).toFixed(1)}억주`;
  if (number >= 10_000) return `${Math.round(number / 10_000).toLocaleString()}만주`;
  return `${Math.round(number).toLocaleString()}주`;
}

function formatPercent(value) {
  if (value === null || value === undefined || value === '') return '확인 필요';
  const number = Number(value);
  if (!Number.isFinite(number)) return '확인 필요';
  return `${number > 0 ? '+' : ''}${number.toFixed(1)}%`;
}

function formatBriefRate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`;
}

function briefEntryLabel(item) {
  if (!item) return '';
  if (typeof item === 'string') return item;
  const name = item.name || item.stockName || item.code || '종목';
  const rate = formatBriefRate(item.rate ?? item.changeRate);
  const count = Number.isFinite(Number(item.count)) ? `${Number(item.count).toLocaleString()}건` : '';
  return [name, rate || count].filter(Boolean).join(' ');
}

function briefPickLabel(name, rate, fallbackItem) {
  if (name && name !== '-') {
    return [name, formatBriefRate(rate)].filter(Boolean).join(' ');
  }
  return briefEntryLabel(fallbackItem) || '데이터 없음';
}

function briefLine(label, item, empty = '데이터 없음') {
  return `${label}: ${briefEntryLabel(item) || empty}`;
}

function briefTopLines(title, items = []) {
  const entries = Array.isArray(items) ? items.slice(0, 3) : [];
  if (!entries.length) return [`${title}: 데이터 없음`];
  return [
    `${title}:`,
    ...entries.map((item) => briefEntryLabel(item) || '데이터 없음')
  ];
}

function averageVolume(rows, count = 20) {
  const source = rows.slice(-count).map((row) => Number(row.volume)).filter(Number.isFinite);
  if (!source.length) return null;
  return source.reduce((sum, value) => sum + value, 0) / source.length;
}

function compactText(value, fallback = '확인 필요', limit = 90) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function decisionTone(decision) {
  if (String(decision || '').includes('매수')) return 'buy';
  if (String(decision || '').includes('매도')) return 'sell';
  return 'watch';
}

function normalizeDecision(value) {
  const text = compactText(value, '관망', 20);
  if (text === 'buy' || text === 'buy_review') return '매수 검토';
  if (text === 'sell' || text === 'sell_review') return '매도 검토';
  if (text === 'watch' || text === 'neutral') return '관망';
  return text;
}

function plainDecisionLabel(value) {
  const text = normalizeDecision(value);
  if (text.includes('매수')) return '살지 말지 검토';
  if (text.includes('매도')) return '팔지 말지 검토';
  if (text.includes('분석')) return '확인 중';
  return '기다림';
}

function plainDecisionSummary(aiDecision, chartMetrics) {
  const decision = aiDecision?.decision || '';
  const topPrice = formatCurrency(chartMetrics?.resistance);
  const avg20 = formatCurrency(chartMetrics?.ma20);
  const support = formatCurrency(chartMetrics?.support);
  if (decision.includes('매수')) {
    return `지금 바로 사기보다 ${topPrice} 위에서 버티는지 먼저 보세요. ${avg20} 아래로 내려가면 기다리는 쪽이 낫습니다.`;
  }
  if (decision.includes('매도')) {
    return `가격이 더 오르지 못하고 밀리면 팔지 검토하세요. ${support} 아래로 내려가면 위험을 먼저 줄여야 합니다.`;
  }
  if (decision.includes('분석')) {
    return 'AI가 차트와 뉴스를 확인하고 있습니다. 지금은 전일 대비 가격 변화만 먼저 보세요.';
  }
  return `지금은 기다리면서 ${avg20} 위에 머무는지 확인하는 쪽입니다.`;
}

function plainNextCheck(aiDecision, chartMetrics) {
  const decision = aiDecision?.decision || '';
  const topPrice = formatCurrency(chartMetrics?.resistance);
  const avg20 = formatCurrency(chartMetrics?.ma20);
  const support = formatCurrency(chartMetrics?.support);
  if (decision.includes('매수')) return `${topPrice} 위로 올라간 뒤에도 거래가 약해지지 않는지 확인`;
  if (decision.includes('매도')) return `${support} 아래로 내려가거나 가격 회복이 약한지 확인`;
  if (decision.includes('분석')) return 'AI 결과가 나오기 전까지 새로 사지 말고 기다리기';
  return `${avg20} 위에서 장을 마치는지 확인`;
}

function firstCompact(items, fallback, limit = 76) {
  if (!Array.isArray(items)) return compactText(fallback, fallback, limit);
  const found = items.find((item) => String(item || '').trim());
  return compactText(found || fallback, fallback, limit);
}

function parsePriceRange(priceStr) {
  if (!priceStr) return null;
  const numbers = String(priceStr).replace(/,/g, '').match(/\d+/g);
  if (!numbers) return null;
  if (String(priceStr).includes('이상')) return [Number(numbers[0]), null];
  if (String(priceStr).includes('이하') || String(priceStr).includes('이탈')) return [null, Number(numbers[0])];
  if (numbers.length >= 2) return [Number(numbers[0]), Number(numbers[1])];
  const value = Number(numbers[0]);
  return [value * 0.99, value * 1.01];
}

function zoneColor(type) {
  if (type === 'buy' || type === 'split') return '#22c55e';
  if (type === 'sell' || type === 'risk') return '#ef4444';
  return '#f59e0b';
}

function zoneMeta(type) {
  if (type === 'buy') return { role: '공격', action: '돌파 확인' };
  if (type === 'split') return { role: '분할', action: '눌림 확인' };
  if (type === 'sell') return { role: '차익', action: '과열 확인' };
  if (type === 'risk') return { role: '방어', action: '이탈 확인' };
  return { role: '대기', action: '방향 확인' };
}

function simpleZoneLabel(zone) {
  if (zone.type === 'buy') return '매수 검토 기준';
  if (zone.type === 'sell') return '매도 검토 기준';
  if (zone.type === 'risk') return '손실 방어 기준';
  return '관망 기준';
}

function zoneRange(zone) {
  return parsePriceRange(zone?.price);
}

function zoneMidPrice(zone) {
  const range = zoneRange(zone);
  if (!range) return null;
  const [from, to] = range;
  if (Number.isFinite(from) && Number.isFinite(to)) return (from + to) / 2;
  return Number.isFinite(from) ? from : to;
}

function zoneRelation(zone, currentPrice) {
  const close = Number(currentPrice);
  const [from, to] = zone.range || [];
  if (!Number.isFinite(close)) {
    return { label: '현재가 확인', tone: 'neutral', distance: Number.POSITIVE_INFINITY };
  }
  const hasFrom = Number.isFinite(from);
  const hasTo = Number.isFinite(to);
  if ((!hasFrom || close >= from) && (!hasTo || close <= to)) {
    return { label: '현재 이 구간 안', tone: 'inside', distance: 0 };
  }
  if (hasFrom && close < from) {
    const distance = ((from - close) / close) * 100;
    return { label: `기준까지 ${formatPercent(distance)}`, tone: 'below', distance };
  }
  if (hasTo && close > to) {
    const distance = ((close - to) / to) * 100;
    return { label: `기준보다 ${formatPercent(distance)} 높음`, tone: 'above', distance };
  }
  return { label: '범위 확인', tone: 'neutral', distance: Number.POSITIVE_INFINITY };
}

function markerForEvent(event, compact = false) {
  const positive = event?.type === 'positive' || event?.sentimentForPrice === 'positive';
  const negative = event?.type === 'negative' || event?.sentimentForPrice === 'negative';
  return {
    time: event.date,
    position: negative ? 'belowBar' : 'aboveBar',
    color: positive ? '#22c55e' : negative ? '#ef4444' : '#f59e0b',
    shape: negative ? 'arrowDown' : positive ? 'arrowUp' : 'circle',
    text: compact ? '' : positive ? '호재 후보' : negative ? '주의 후보' : '확인'
  };
}

function latestEventForDate(events, date) {
  return events.find((event) => event.date === date) || null;
}

function chartContainerSize(element) {
  const rect = element.getBoundingClientRect();
  return {
    width: Math.max(320, Math.round(rect.width || element.clientWidth || 320)),
    height: Math.max(320, Math.round(rect.height || element.clientHeight || 420))
  };
}

function intervalLabel(interval) {
  if (interval === 'weekly') return '1주';
  if (interval === 'monthly') return '1개월';
  return '1일';
}

function personalRiskTone(status) {
  if (status === 'profit_zone') return 'profit';
  if (status === 'loss_limit_exceeded' || status === 'loss_zone') return 'loss';
  if (status === 'missing_average_price' || status === 'not_saved') return 'missing';
  return 'neutral';
}

function probabilityTone(up, down) {
  if (Number.isFinite(up) && Number.isFinite(down)) {
    if (up >= down + 8) return 'up';
    if (down >= up + 8) return 'down';
  }
  return 'neutral';
}

function factorToneClass(tone, styles) {
  if (tone === 'positive') return styles.factorPositive;
  if (tone === 'negative') return styles.factorNegative;
  return styles.factorNeutral;
}

function probabilityValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : null;
}

function priceLineValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function hoverPriceState(row) {
  const close = Number(row?.close);
  const ma20 = Number(row?.ma20);
  if (!Number.isFinite(close) || !Number.isFinite(ma20) || ma20 <= 0) {
    return '20일선 확인 필요';
  }
  const distance = ((close - ma20) / ma20) * 100;
  if (Math.abs(distance) <= 1) return `20일선 근처 ${formatPercent(distance)}`;
  return close > ma20 ? `20일선 위 ${formatPercent(distance)}` : `20일선 아래 ${formatPercent(distance)}`;
}

function hoverVolumeState(row, volumeAvg) {
  const volume = Number(row?.volume);
  if (!Number.isFinite(volume) || !Number.isFinite(volumeAvg) || volumeAvg <= 0) {
    return '거래량 평균 확인 필요';
  }
  const ratio = (volume / volumeAvg) * 100;
  if (ratio >= 140) return `거래량 강함 ${Math.round(ratio)}%`;
  if (ratio <= 70) return `거래량 약함 ${Math.round(ratio)}%`;
  return `거래량 보통 ${Math.round(ratio)}%`;
}

function fundamentalStatusLabel(summary, riskNotes = []) {
  const text = [summary, ...(Array.isArray(riskNotes) ? riskNotes : [])].filter(Boolean).join(' ');
  if (!text) return '재무 확인';
  if (/없어|비어|못했습니다|제한|확인 필요|별도로 확인/.test(text)) return '재무 제한';
  return '재무 반영';
}

function resolveOllamaStatus(ai, insights = ai?.ollamaInsights) {
  return ai?.ollamaInsightsStatus
    || (insights ? 'ready'
      : ai?.aiLayerStatus === 'ollama_failed' ? 'failed'
        : ai?.aiLayerStatus === 'ollama_delayed' ? 'delayed'
          : ai?.aiLayerStatus === 'loading' ? 'loading' : 'waiting');
}

function isOllamaDelayed(status) {
  return status === 'failed' || status === 'delayed';
}

export default function TradingViewPriceChart({
  stock,
  interval = 'daily',
  chartData,
  zones = [],
  events = [],
  indicatorSnapshot,
  ai,
  learningMode,
  onTermClick,
  focusMode = false,
  onOpenPortfolio,
  onRefreshAi,
  briefArchive,
  briefLoading = false,
  onReloadBrief
}) {
  const containerRef = useRef(null);
  const chartApiRef = useRef(null);
  const [hover, setHover] = useState(null);
  const [chartError, setChartError] = useState('');
  const [activeAssistPanel, setActiveAssistPanel] = useState('none');
  const [visibleLayers, setVisibleLayers] = useState({
    ai: false,
    zones: false,
    events: false,
    personal: false
  });
  const [showDetailPanels, setShowDetailPanels] = useState(false);

  useEffect(() => {
    setHover(null);
    setActiveAssistPanel('none');
  }, [stock?.code, interval]);

  const handleFitChart = () => {
    chartApiRef.current?.timeScale?.().fitContent?.();
  };

  const handleAiHelpClick = () => {
    const nextPanel = activeAssistPanel === 'ai' ? 'none' : 'ai';
    setActiveAssistPanel(nextPanel);
    if (nextPanel === 'ai') onRefreshAi?.();
  };

  const handleBriefClick = () => {
    const nextPanel = activeAssistPanel === 'brief' ? 'none' : 'brief';
    setActiveAssistPanel(nextPanel);
    if (nextPanel === 'brief') onReloadBrief?.();
  };

  const toggleLayer = (key) => {
    setVisibleLayers((current) => ({ ...current, [key]: !current[key] }));
  };

  const prepared = useMemo(() => {
    const rows = (chartData || [])
      .filter((row) => row?.date && Number.isFinite(Number(row.close)))
      .map((row) => ({
        ...row,
        time: row.date,
        open: Number(row.open ?? row.close),
        high: Number(row.high ?? row.close),
        low: Number(row.low ?? row.close),
        close: Number(row.close),
        volume: Number(row.volume || 0),
        ma5: Number(row.ma5),
        ma20: Number(row.ma20),
        ma60: Number(row.ma60)
      }));
    return {
      rows,
      candles: rows.map((row) => ({
        time: row.time,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close
      })),
      volume: rows.map((row) => ({
        time: row.time,
        value: row.volume,
        color: row.close >= row.open ? 'rgba(34, 197, 94, 0.28)' : 'rgba(239, 68, 68, 0.28)'
      })),
      ma5: rows.filter((row) => Number.isFinite(row.ma5)).map((row) => ({ time: row.time, value: row.ma5 })),
      ma20: rows.filter((row) => Number.isFinite(row.ma20)).map((row) => ({ time: row.time, value: row.ma20 })),
      ma60: rows.filter((row) => Number.isFinite(row.ma60)).map((row) => ({ time: row.time, value: row.ma60 }))
    };
  }, [chartData]);

  const dataByTime = useMemo(() => {
    const map = new Map();
    prepared.rows.forEach((row) => map.set(row.time, row));
    return map;
  }, [prepared.rows]);

  const zoneSummaries = useMemo(() => {
    const latestClose = prepared.rows[prepared.rows.length - 1]?.close;
    return zones
      .map((zone) => {
        const range = zoneRange(zone);
        const meta = zoneMeta(zone.type);
        const enriched = {
          ...zone,
          ...meta,
          range,
          midPrice: zoneMidPrice(zone),
          color: zoneColor(zone.type)
        };
        return {
          ...enriched,
          relation: zoneRelation(enriched, latestClose)
        };
      })
      .filter((zone) => Number.isFinite(zone.midPrice))
      .slice(0, 5);
  }, [prepared.rows, zones]);

  const zoneMapSummary = useMemo(() => {
    if (!zoneSummaries.length) return '';
    const current = zoneSummaries.find((zone) => zone.relation?.tone === 'inside');
    if (current) return `현재 ${current.label || 'AI 구간'}`;
    const nearest = [...zoneSummaries].sort((a, b) => (a.relation?.distance ?? 999) - (b.relation?.distance ?? 999))[0];
    return nearest ? `가까운 구간 ${nearest.label || 'AI 구간'}` : '가격 구간 확인';
  }, [zoneSummaries]);

  const personalRisk = useMemo(() => (
    ai?.ollamaInsights?.stockAdvice?.personalRisk
      || ai?.portfolioGuidance?.positionDiagnostics
      || null
  ), [ai]);
  const needsPortfolioSetup = !personalRisk || personalRisk.status === 'not_saved';
  const hasPersonalContext = Boolean(personalRisk && personalRisk.status && personalRisk.status !== 'not_saved');
  const personalContextValue = hasPersonalContext
    ? [personalRisk.statusLabel || '개인 조건', personalRisk.profitLossText].filter(Boolean).join(' · ')
    : '미저장';
  const personalContextSummary = hasPersonalContext
    ? compactText(personalRisk.actionLine || personalRisk.summary, '평균단가 기준을 AI 판단에 반영했습니다.', 92)
    : '평균단가를 저장하면 AI가 내 손익 기준을 함께 봅니다.';

  const personalPriceLines = useMemo(() => {
    if (!personalRisk || personalRisk.status === 'not_saved') return [];
    const lines = [];
    const averagePrice = Number(personalRisk.averagePrice);
    const stopLossPrice = Number(personalRisk.stopLossPrice);
    if (Number.isFinite(averagePrice) && averagePrice > 0) {
      lines.push({
        key: 'average',
        label: '내 평균단가',
        shortLabel: '평단',
        price: averagePrice,
        valueText: personalRisk.averagePriceText || formatCurrency(averagePrice),
        color: '#38bdf8'
      });
    }
    if (Number.isFinite(stopLossPrice) && stopLossPrice > 0) {
      lines.push({
        key: 'risk',
        label: '손실허용선',
        shortLabel: '손실선',
        price: stopLossPrice,
        valueText: personalRisk.stopLossPriceText || formatCurrency(stopLossPrice),
        color: '#f97316'
      });
    }
    return lines;
  }, [personalRisk]);

  const chartMetrics = useMemo(() => {
    const latest = prepared.rows[prepared.rows.length - 1];
    const previous = prepared.rows[prepared.rows.length - 2];
    if (!latest) return null;
    const ma20 = Number(indicatorSnapshot?.movingAverages?.ma20 ?? latest.ma20);
    const support = Number(indicatorSnapshot?.supportLevel);
    const resistance = Number(indicatorSnapshot?.resistanceLevel);
    const volumeAvg = averageVolume(prepared.rows);
    const close = Number(latest.close);
    const changeRate = previous?.close ? ((close - Number(previous.close)) / Number(previous.close)) * 100 : null;
    const ma20Distance = Number.isFinite(ma20) && ma20 !== 0 ? ((close - ma20) / ma20) * 100 : null;
    const resistanceDistance = Number.isFinite(resistance) && resistance !== 0 ? ((resistance - close) / close) * 100 : null;
    const supportDistance = Number.isFinite(support) && support !== 0 ? ((close - support) / close) * 100 : null;
    const volumeRatio = volumeAvg ? (Number(latest.volume) / volumeAvg) * 100 : null;
    const aboveMa20 = Number.isFinite(ma20) && close >= ma20;
    const nearResistance = Number.isFinite(resistanceDistance) && resistanceDistance >= 0 && resistanceDistance <= 3;
    const nearSupport = Number.isFinite(supportDistance) && supportDistance >= 0 && supportDistance <= 3;

    let focus = '관망 기준 확인';
    if (nearResistance) focus = '저항선 근처';
    else if (nearSupport) focus = '지지선 근처';
    else if (aboveMa20 && Number(volumeRatio) >= 110) focus = '20일선 위 거래량 증가';
    else if (!aboveMa20) focus = '20일선 회복 확인';

    return {
      latest,
      changeRate,
      ma20,
      ma20Distance,
      support,
      supportDistance,
      resistance,
      resistanceDistance,
      volumeAvg,
      volumeRatio,
      focus,
      aboveMa20
    };
  }, [indicatorSnapshot, prepared.rows]);

  const aiDecision = useMemo(() => {
    const insights = ai?.ollamaInsights;
    const ollamaStatus = resolveOllamaStatus(ai, insights);
    const isWaitingForOllama = ollamaStatus === 'loading' && !insights;
    const isOllamaWaitingLong = isOllamaDelayed(ollamaStatus) && !insights;
    const advice = insights?.stockAdvice || {};
    const sentiment = insights?.newsSentiment || {};
    const report = insights?.afterMarketReport || {};
    const beginnerCoach = insights?.beginnerCoach || {};
    const probabilities = sentiment?.nextTradingDay || {};
    const decision = isWaitingForOllama
      ? '분석 중'
      : normalizeDecision(advice.decision || ai?.chartState?.state || '관망');
    const summary = isWaitingForOllama
      ? 'AI가 차트와 뉴스를 함께 읽고 판단을 정리하는 중입니다.'
      : compactText(
        advice.summary || ai?.conclusion,
        isOllamaWaitingLong ? 'AI 답변이 늦어 현재는 차트 기준 판단을 먼저 보여줍니다.' : '차트와 뉴스 근거를 확인하는 중입니다.',
        96
      );
    const up = Number(probabilities.up);
    const down = Number(probabilities.down);
    const flat = Number(probabilities.flat);
    const tradeTiming = advice.tradeTiming || {};
    const entryTiming = compactText(tradeTiming.entryTiming, '', 104)
      || firstCompact(advice.buyConditions, '20일선 위 유지와 거래량 증가가 함께 필요합니다.', 104);
    const exitTiming = compactText(tradeTiming.exitTiming, '', 104)
      || firstCompact(advice.sellConditions, '지지선 이탈과 하락 거래량 증가를 먼저 확인합니다.', 104);
    const waitCondition = compactText(tradeTiming.waitCondition, '', 104)
      || firstCompact(advice.watchConditions, '다음 종가와 거래량을 확인할 때까지 관망합니다.', 104);
    const invalidationTrigger = compactText(tradeTiming.invalidationTrigger, '', 104)
      || compactText(beginnerCoach.avoidAction, '', 104)
      || '뉴스·거래량·20일선 흐름이 판단과 반대로 움직이면 다시 확인합니다.';
    const firstTimingCheck = firstCompact(tradeTiming.tomorrowChecklist, '', 104);
    const primaryCondition = decision.includes('매수')
      ? entryTiming || compactText(beginnerCoach.nextAction, '', 104) || firstCompact(advice.buyConditions, '20일선 위 유지와 거래량 증가가 함께 필요합니다.')
      : decision.includes('매도')
        ? exitTiming || compactText(beginnerCoach.nextAction, '', 104) || firstCompact(advice.sellConditions, '지지선 이탈과 하락 거래량 증가를 먼저 확인합니다.')
        : waitCondition || compactText(beginnerCoach.nextAction, '', 104) || firstCompact(advice.watchConditions, '다음 종가와 거래량을 확인할 때까지 관망합니다.');
    const positiveReason = compactText(beginnerCoach.goodReason, '', 88) || firstCompact(sentiment.upReasons, '좋게 볼 근거는 가격 반응과 거래량으로 재확인해야 합니다.');
    const cautionReason = compactText(beginnerCoach.cautionReason, '', 88) || firstCompact(sentiment.downRisks, sentiment.caution || '반대 신호와 뉴스 원문을 확인해야 합니다.');
    const nextWatch = firstTimingCheck || compactText(beginnerCoach.nextAction, '', 104) || firstCompact(report.nextWatch, primaryCondition);
    const avoidAction = compactText(beginnerCoach.avoidAction, '', 96);
    const coachSummary = compactText(beginnerCoach.plainSummary, '', 112);
    const fundamentalLabel = fundamentalStatusLabel(ai?.fundamentalGuidance?.summary, advice.riskNotes).replace(/^재무\s*/, '');
    const timingNextAction = decision.includes('매수')
      ? entryTiming || nextWatch
      : decision.includes('매도')
        ? exitTiming || nextWatch
        : waitCondition || nextWatch;
    const hasTradeTiming = Boolean(entryTiming || exitTiming || waitCondition || invalidationTrigger);
    const model = insights?.model || ai?.llmModel || '';
    const modeLabel = insights?.modeLabel || ai?.modeLabel || '근거 기반 AI';
    const title = insights
      ? (insights.mode === 'ollama_llm' ? 'Ollama AI 판단' : 'Ollama 미리보기')
      : isWaitingForOllama
        ? 'Ollama AI 준비 중'
        : isOllamaWaitingLong
          ? 'Ollama 계산 지연'
          : ai?.llmProvider === 'ollama'
            ? 'Ollama AI 판단'
            : 'AI 판단 준비 중';
    const statusLabel = isWaitingForOllama
      ? '로컬 LLM이 차트와 뉴스를 읽는 중'
      : isOllamaWaitingLong
        ? 'Ollama 지연 · 완료 시 자동 반영'
        : `${modeLabel}${model ? ` · ${model}` : ''}`;

    return {
      decision,
      tone: decisionTone(decision),
      summary,
      up: Number.isFinite(up) ? up : null,
      down: Number.isFinite(down) ? down : null,
      flat: Number.isFinite(flat) ? flat : null,
      mood: compactText(report.mood, '장후 분위기 확인 중', 24),
      fundamentalLabel,
      primaryCondition,
      positiveReason,
      cautionReason,
      nextWatch,
      timingNextAction,
      hasTradeTiming,
      tradeTiming: {
        title: compactText(tradeTiming.title, '언제 사고 팔지', 28),
        entryTiming,
        exitTiming,
        waitCondition,
        invalidationTrigger
      },
      avoidAction,
      coachSummary,
      title,
      modeLabel: compactText(statusLabel, '근거 기반 AI', 48),
      live: insights?.mode === 'ollama_llm' || ai?.llmUsed,
      factors: Array.isArray(insights?.decisionFactors) ? insights.decisionFactors.slice(0, 5) : []
    };
  }, [ai]);

  const newsDirection = useMemo(() => {
    const insights = ai?.ollamaInsights;
    const ollamaStatus = resolveOllamaStatus(ai, insights);
    const isWaitingForOllama = ollamaStatus === 'loading' && !insights;
    const delayed = isOllamaDelayed(ollamaStatus) && !insights;
    if (!insights && !isWaitingForOllama && !delayed) return null;

    const sentiment = insights?.newsSentiment || {};
    const probabilities = sentiment?.nextTradingDay || {};
    const up = probabilityValue(probabilities.up);
    const down = probabilityValue(probabilities.down);
    const flat = probabilityValue(probabilities.flat);
    const score = Number(sentiment.score ?? sentiment.scoreBreakdown?.adjustedScore);
    const tone = (isWaitingForOllama || delayed) ? 'neutral' : probabilityTone(up, down);
    const label = isWaitingForOllama
      ? '계산 중'
      : delayed
        ? '지연 중'
      : tone === 'up'
        ? '상승 우위'
        : tone === 'down'
          ? '하락 주의'
          : '중립';
    const headline = sentiment.headlineAnalyses?.[0]?.title
      || sentiment.headlineSignals?.[0]
      || '뉴스 헤드라인 근거를 확인 중입니다.';
    const action = firstCompact(
      sentiment.actionGuide || sentiment.tradingScenarios,
      isWaitingForOllama
        ? 'AI가 뉴스와 이벤트를 읽는 중입니다.'
        : delayed
          ? 'AI 답변이 도착하면 자동으로 바뀝니다. 지금은 가격과 거래량을 먼저 봅니다.'
          : sentiment.caution || '뉴스 원문과 거래량 반응을 함께 확인합니다.',
      92
    );
    return {
      label,
      tone,
      up,
      down,
      flat,
      score: Number.isFinite(score) ? Math.round(score) : null,
      confidence: compactText(sentiment.confidence || sentiment.evidenceQuality, '근거 확인 중', 28),
      contextLabel: compactText(sentiment.llmContextLabel, '문맥 판단 대기', 26),
      headline: compactText(headline, '뉴스 헤드라인 확인 필요', 88),
      action,
      loading: isWaitingForOllama,
      delayed
    };
  }, [ai]);

  const forecastGuide = useMemo(() => {
    if (!chartMetrics?.latest || !aiDecision) return null;
    const consensus = ai?.ollamaInsights?.crossFeatureConsensus || null;
    const threeFeaturePlan = ai?.ollamaInsights?.threeFeaturePlan || null;
    const close = priceLineValue(chartMetrics.latest.close);
    if (!close) return null;
    const resistance = priceLineValue(chartMetrics.resistance);
    const support = priceLineValue(chartMetrics.support);
    const ma20 = priceLineValue(chartMetrics.ma20);
    const upProbability = probabilityValue(aiDecision.up);
    const downProbability = probabilityValue(aiDecision.down);
    const hasProbability = upProbability !== null && downProbability !== null;
    const edge = hasProbability ? Math.abs(upProbability - downProbability) : 0;
    const bufferRate = Math.max(1.2, Math.min(4.8, 1.2 + edge * 0.06));
    const upTrigger = resistance && resistance > close
      ? resistance
      : close * (1 + bufferRate / 100);
    const defenseBase = support && support < close ? support : ma20 && ma20 < close ? ma20 : close * 0.975;
    const watchBase = ma20 || close;
    const decisionText = aiDecision.decision || '관망';
    const baseTone = decisionText.includes('매수')
      ? 'positive'
      : decisionText.includes('매도')
        ? 'negative'
        : hasProbability && upProbability >= downProbability + 8
          ? 'positive'
          : hasProbability && downProbability >= upProbability + 8
            ? 'negative'
            : 'neutral';
    const consensusTone = ['positive', 'negative', 'mixed', 'neutral'].includes(consensus?.tone)
      ? consensus.tone
      : '';
    const tone = consensusTone || baseTone;
    const headline = tone === 'positive'
      ? compactText(consensus?.headline, '상승 확인선 돌파 후 거래량을 봅니다.', 88)
      : tone === 'negative'
        ? compactText(consensus?.headline, '방어 기준선 이탈 여부를 먼저 봅니다.', 88)
        : tone === 'mixed'
          ? compactText(consensus?.headline, '상담·뉴스·장후 신호가 엇갈려 확인선을 나누어 봅니다.', 88)
          : compactText(consensus?.headline, '확인선과 방어선 사이에서는 관망 기준을 봅니다.', 88);
    const priceAction = tone === 'positive'
      ? `종가가 ${formatCurrency(upTrigger)} 위에서 유지되는지 확인합니다.`
      : tone === 'negative'
        ? `${formatCurrency(defenseBase)} 이탈과 하락 거래량 증가를 같이 확인합니다.`
        : `${formatCurrency(watchBase)} 부근에서 거래량이 늘어나는지 확인합니다.`;
    const nextAction = consensus?.nextAction
      ? `${compactText(consensus.nextAction, '', 84)} ${priceAction}`
      : priceAction;
    const signals = Array.isArray(consensus?.signals)
      ? consensus.signals.slice(0, 3).map((signal) => ({
        label: compactText(signal?.label, '근거', 12),
        state: compactText(signal?.state, '확인 필요', 28),
        tone: ['positive', 'negative', 'neutral'].includes(signal?.tone) ? signal.tone : 'neutral'
      }))
      : [];
    const planSteps = Array.isArray(threeFeaturePlan?.steps)
      ? threeFeaturePlan.steps.slice(0, 4).map((step) => {
        const title = step?.featureTitle || step?.label || '';
        const label = title.includes('뉴스')
          ? '뉴스 감성'
          : title.includes('장후')
            ? '장후 요약'
            : title.includes('사도') || title.includes('상담')
              ? 'AI 상담'
              : title.includes('최종')
                ? '최종 확인'
                : compactText(step?.label, '확인', 12);
        return {
          label,
          featureTitle: compactText(title, '', 32),
          state: compactText(step?.result, '확인 필요', 28),
          action: compactText(step?.action, '', 72),
          tone: ['positive', 'negative', 'mixed', 'neutral'].includes(step?.tone) ? step.tone : 'neutral'
        };
      }).filter((step) => step.label)
      : [];
    const runtime = ai?.ollamaInsights?.runtimeCache || null;
    const refreshStatus = ai?.ollamaInsightsRefreshStatus || '';
    const runtimeLabel = refreshStatus === 'refreshing'
      ? `${runtime?.label || 'DB 저장본 표시'} · 새 계산 중`
      : refreshStatus === 'fresh'
        ? runtime?.label || '새 Ollama 결과 반영'
        : refreshStatus === 'kept_cached'
          ? 'DB 저장본 유지'
          : runtime?.label || '';
    const qdrant = ai?.ollamaInsights?.qdrant || ai?.marketReport?.qdrant || null;
    const qdrantLabel = qdrant?.enabled && !qdrant?.skipped
      ? `Qdrant 근거 ${qdrant.retrievedCount || 0}개`
      : qdrant?.asyncUpsertScheduled
        ? 'Qdrant 저장 중'
        : qdrant?.asyncUpsertDeduped ? 'Qdrant 저장 대기' : '';
    const actionChecks = [
      {
        label: '지금',
        value: compactText(aiDecision.decision || '관망', '관망', 24)
      },
      {
        label: '매수 전',
        value: compactText(aiDecision.tradeTiming.entryTiming || aiDecision.primaryCondition, '20일선과 거래량 확인', 46)
      },
      {
        label: '매도 전',
        value: compactText(aiDecision.tradeTiming.exitTiming || aiDecision.cautionReason, '지지선 이탈 확인', 46)
      }
    ];
    return {
      tone,
      headline,
      nextAction,
      upTrigger,
      defenseBase,
      watchBase,
      agreementLabel: consensus?.agreement ? `종합 ${compactText(consensus.agreement, '', 18)}` : '상담·뉴스·장후 대기',
      consensusSummary: compactText(consensus?.summary, '상담, 뉴스 확률, 장후 리포트를 함께 연결합니다.', 96),
      signals,
      planTitle: compactText(threeFeaturePlan?.title, 'Ollama 3단계 실행', 24),
      planHeadline: compactText(threeFeaturePlan?.headline || threeFeaturePlan?.summary, '상담 → 뉴스 → 장후 순서로 확인합니다.', 86),
      planSteps,
      probabilityLabel: hasProbability ? `상승 ${upProbability}% · 하락 ${downProbability}%` : '확률 계산 중',
      modeLabel: aiDecision.live ? 'Ollama LLM 기준' : aiDecision.modeLabel || '근거 계산 기준',
      runtimeLabel,
      qdrantLabel,
      actionChecks
    };
  }, [ai, aiDecision, chartMetrics]);

  const briefInsight = useMemo(() => {
    const latestBrief = briefArchive?.latest || null;
    const list = Array.isArray(briefArchive?.list) ? briefArchive.list.slice(0, 4) : [];
    const kospiGainers = Array.isArray(latestBrief?.kospiTopGainers) ? latestBrief.kospiTopGainers : [];
    const kospiLosers = Array.isArray(latestBrief?.kospiTopLosers) ? latestBrief.kospiTopLosers : [];
    const kosdaqGainers = Array.isArray(latestBrief?.kosdaqTopGainers) ? latestBrief.kosdaqTopGainers : [];
    const kosdaqLosers = Array.isArray(latestBrief?.kosdaqTopLosers) ? latestBrief.kosdaqTopLosers : [];
    const topGainers = Array.isArray(latestBrief?.topGainers)
      ? latestBrief.topGainers.slice(0, 3)
      : [latestBrief?.topGainer && { name: latestBrief.topGainer, rate: latestBrief.topGainerRate }].filter(Boolean);
    const topLosers = Array.isArray(latestBrief?.topLosers)
      ? latestBrief.topLosers.slice(0, 3)
      : [latestBrief?.topLoser && { name: latestBrief.topLoser }].filter(Boolean);
    const mentioned = Array.isArray(latestBrief?.mostMentionedTop)
      ? latestBrief.mostMentionedTop.slice(0, 3)
      : [latestBrief?.mostMentioned && { name: latestBrief.mostMentioned }].filter(Boolean);
    const basisDate = latestBrief?.date
      || latestBrief?.effectiveDate
      || '';
    const marketDate = latestBrief?.date || basisDate || '날짜 확인 필요';
    const kospiTopGainer = kospiGainers[0] || topGainers[0] || { name: latestBrief?.kospiTopGainer, rate: latestBrief?.kospiTopGainerRate };
    const kospiTopLoser = kospiLosers[0] || topLosers[0] || { name: latestBrief?.kospiTopLoser, rate: latestBrief?.kospiTopLoserRate };
    const kosdaqTopGainer = kosdaqGainers[0] || topGainers[0] || { name: latestBrief?.kosdaqTopGainer, rate: latestBrief?.kosdaqTopGainerRate };
    const kosdaqTopLoser = kosdaqLosers[0] || topLosers[0] || { name: latestBrief?.kosdaqTopLoser, rate: latestBrief?.kosdaqTopLoserRate };
    const briefLines = [
      `📊 ${marketDate} 한국 주식 일간 브리프 (전일 대비)`,
      '',
      briefLine('🟢 KOSPI 상승 1위', kospiTopGainer),
      briefLine('🔴 KOSPI 하락 1위', kospiTopLoser),
      briefLine('🟢 KOSDAQ 상승 1위', kosdaqTopGainer),
      briefLine('🔴 KOSDAQ 하락 1위', kosdaqTopLoser),
      '',
      `💬 최다 언급: ${briefEntryLabel(mentioned[0]) || '데이터 없음'}`,
      `🏆 KOSPI 픽: ${briefPickLabel(latestBrief?.kospiPick, latestBrief?.kospiTopGainerRate, kospiTopGainer)}`,
      `🏆 KOSDAQ 픽: ${briefPickLabel(latestBrief?.kosdaqPick, latestBrief?.kosdaqTopGainerRate, kosdaqTopGainer)}`,
      '',
      ...briefTopLines('📈 KOSPI 전일대비 상승 TOP3', kospiGainers.length ? kospiGainers : topGainers),
      '',
      ...briefTopLines('📉 KOSPI 전일대비 하락 TOP3', kospiLosers.length ? kospiLosers : topLosers),
      '',
      ...briefTopLines('📈 KOSDAQ 전일대비 상승 TOP3', kosdaqGainers.length ? kosdaqGainers : topGainers),
      '',
      ...briefTopLines('📉 KOSDAQ 전일대비 하락 TOP3', kosdaqLosers.length ? kosdaqLosers : topLosers)
    ];
    return {
      basisDate,
      source: briefArchive?.source || '브리프 데이터',
      topGainers,
      topLosers,
      mentioned,
      list,
      lines: briefLines
    };
  }, [briefArchive]);

  const decisionCompass = useMemo(() => {
    if (!forecastGuide) return [];
    const activeZone = zoneSummaries.find((zone) => zone.relation?.tone === 'inside')
      || [...zoneSummaries].sort((a, b) => (a.relation?.distance ?? 999) - (b.relation?.distance ?? 999))[0];
    const personalLine = personalPriceLines.find((line) => line.key === 'average') || personalPriceLines[0];
    return [
      {
        key: 'up',
        label: '상승 확인',
        value: formatCurrency(forecastGuide.upTrigger),
        note: '돌파 후 거래량',
        tone: 'up'
      },
      {
        key: 'watch',
        label: '관망 기준',
        value: formatCurrency(forecastGuide.watchBase),
        note: '20일선 중심',
        tone: 'watch'
      },
      {
        key: 'defense',
        label: '방어 기준',
        value: formatCurrency(forecastGuide.defenseBase),
        note: '이탈 시 리스크',
        tone: 'defense'
      },
      {
        key: 'zone',
        label: 'AI 구간',
        value: activeZone?.price || (activeZone ? formatCurrency(activeZone.midPrice) : '확인 필요'),
        note: activeZone?.label || zoneMapSummary || '가격 구간',
        tone: activeZone?.relation?.tone === 'inside' ? 'zoneActive' : 'zone'
      },
      {
        key: 'personal',
        label: '내 기준',
        value: personalLine?.valueText || personalContextValue,
        note: hasPersonalContext ? personalLine?.shortLabel || '평균단가' : '평단 미저장',
        tone: hasPersonalContext ? 'personal' : 'missing'
      }
    ];
  }, [forecastGuide, hasPersonalContext, personalContextValue, personalPriceLines, zoneMapSummary, zoneSummaries]);

  const hoverInsight = useMemo(() => {
    if (!hover || !aiDecision) return null;
    const close = Number(hover.close);
    const open = Number(hover.open);
    const candleDirection = Number.isFinite(close) && Number.isFinite(open)
      ? close >= open ? '상승 마감' : '하락 마감'
      : '가격 확인';
    const eventText = compactText(hover.event?.title, '해당 날짜 주요 뉴스 없음', 46);
    return {
      candleDirection,
      priceState: hoverPriceState(hover),
      volumeState: hoverVolumeState(hover, chartMetrics?.volumeAvg),
      decision: plainDecisionLabel(aiDecision.decision),
      nextAction: plainNextCheck(aiDecision, chartMetrics),
      eventText
    };
  }, [aiDecision, chartMetrics, hover]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || !prepared.candles.length) return undefined;
    let disposed = false;
    let resizeTimer = null;
    let cleanupChart = () => {};

    loadTradingViewLibrary().then((library) => {
      if (disposed) return;
      setChartError('');
      const {
        CandlestickSeries,
        ColorType,
        CrosshairMode,
        HistogramSeries,
        LineSeries,
        LineStyle,
        createChart,
        createSeriesMarkers
      } = library;

      const initialSize = chartContainerSize(element);
      const compactChart = initialSize.width < 720;
      const chart = createChart(element, {
      width: initialSize.width,
      height: initialSize.height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: 'rgba(226, 232, 240, 0.7)',
        fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
      },
      grid: {
        vertLines: { color: 'rgba(148, 163, 184, 0.08)' },
        horzLines: { color: 'rgba(148, 163, 184, 0.08)' }
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.12, bottom: 0.26 }
      },
      timeScale: {
        borderVisible: false,
        rightOffset: 8,
        barSpacing: 10,
        minBarSpacing: 4,
        fixLeftEdge: false,
        timeVisible: false
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(148, 163, 184, 0.45)',
          width: 1,
          style: LineStyle.Dotted,
          labelVisible: false
        },
        horzLine: {
          color: 'rgba(148, 163, 184, 0.28)',
          width: 1,
          style: LineStyle.Dotted,
          labelVisible: true
        }
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true
      }
    });
      chartApiRef.current = chart;
      const applyChartSize = () => {
        const nextSize = chartContainerSize(element);
        if (typeof chart.resize === 'function') {
          chart.resize(nextSize.width, nextSize.height, true);
        } else {
          chart.applyOptions({ width: nextSize.width, height: nextSize.height });
        }
      };
      const resizeObserver = new ResizeObserver(applyChartSize);
      resizeObserver.observe(element);
      applyChartSize();
      requestAnimationFrame(applyChartSize);
      resizeTimer = window.setTimeout(applyChartSize, 120);

      const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#86efac',
      borderDownColor: '#fca5a5',
      wickUpColor: '#86efac',
      wickDownColor: '#fca5a5',
      priceLineVisible: false,
      lastValueVisible: true
    });
      candleSeries.setData(prepared.candles);

      const ma5Series = chart.addSeries(LineSeries, {
      color: 'rgba(226, 232, 240, 0.82)',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false
    });
      ma5Series.setData(prepared.ma5);

      const ma20Series = chart.addSeries(LineSeries, {
      color: '#60a5fa',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false
    });
      ma20Series.setData(prepared.ma20);

      const ma60Series = chart.addSeries(LineSeries, {
      color: '#f59e0b',
      lineWidth: 1,
      lineStyle: LineStyle.LargeDashed,
      priceLineVisible: false,
      lastValueVisible: false
    });
      ma60Series.setData(prepared.ma60);

      const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      priceLineVisible: false,
      lastValueVisible: false
    });
      volumeSeries.setData(prepared.volume);
      chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 }
    });

      const markerApi = createSeriesMarkers(candleSeries, []);

      const priceLines = [];

      const showHoverForParam = (param) => {
        if (!param?.time || !param.point) {
          setHover(null);
          return;
        }
        const row = dataByTime.get(String(param.time));
        if (!row) {
          setHover(null);
          return;
        }
        setHover({
          ...row,
          x: param.point.x,
          y: param.point.y,
          event: latestEventForDate(events, row.time)
        });
      };

      chart.subscribeCrosshairMove(showHoverForParam);
      if (typeof chart.subscribeClick === 'function') {
        chart.subscribeClick(showHoverForParam);
      }

      chart.timeScale().fitContent();

      cleanupChart = () => {
        chartApiRef.current = null;
        if (resizeTimer) window.clearTimeout(resizeTimer);
        resizeObserver.disconnect();
        if (typeof chart.unsubscribeCrosshairMove === 'function') {
          chart.unsubscribeCrosshairMove(showHoverForParam);
        }
        if (typeof chart.unsubscribeClick === 'function') {
          chart.unsubscribeClick(showHoverForParam);
        }
        markerApi.setMarkers([]);
        priceLines.forEach((line) => candleSeries.removePriceLine(line));
        chart.remove();
      };
    }).catch(() => {
      if (!disposed) setChartError('TradingView 차트 라이브러리를 불러오지 못했습니다.');
    });

    return () => {
      disposed = true;
      cleanupChart();
    };
  }, [dataByTime, events, prepared]);

  const latest = prepared.rows[prepared.rows.length - 1];
  const visibleZoneSummaries = zoneSummaries.slice(0, 3);
  const simpleVisibleZoneSummaries = useMemo(() => {
    const picked = [];
    const addFirst = (types) => {
      if (picked.length >= 2) return;
      const found = zoneSummaries.find((zone) => types.includes(zone.type) && !picked.includes(zone));
      if (found) picked.push(found);
    };
    addFirst(['buy']);
    addFirst(['sell']);
    addFirst(['risk']);
    if (picked.length < 2) {
      zoneSummaries.forEach((zone) => {
        if (picked.length < 2 && !picked.includes(zone) && zone.type !== 'split') {
          picked.push(zone);
        }
      });
    }
    return picked;
  }, [zoneSummaries]);

  return (
    <div className={clsx(styles.stage, focusMode && styles.aiCardFocusMode, showDetailPanels && styles.detailPanelMode)}>
      <div className={styles.chartPane}>
        <div ref={containerRef} className={styles.chart} data-testid="tradingview-price-chart" />
        <div className={styles.chartLineLegend} aria-label="차트 선 설명">
          <span><i className={styles.ma20Dot} />파란 점선 20일 평균</span>
          <span><i className={styles.ma60Dot} />노란 점선 60일 평균</span>
          <span><i className={styles.volumeDot} />아래 막대 거래량</span>
        </div>
        {chartError && <div className={styles.chartError}>{chartError}</div>}
      </div>
      <aside className={styles.decisionSidebar} aria-label="종목 판단 요약">
        <div className={styles.sidebarHeader}>
          <div>
            <span>현재 종목</span>
            <strong>{stock?.name || '종목 선택'} · {stock?.code || '000000'}</strong>
          </div>
          <button type="button" onClick={handleFitChart}>
            차트 맞춤
          </button>
        </div>

        {latest && (
          <section className={styles.sidebarPriceCard}>
            <span>{latest.time} 기준</span>
            <strong>{formatCurrency(latest.close)}</strong>
            <em>전일 대비 {formatPercent(chartMetrics?.changeRate)}</em>
          </section>
        )}

        {aiDecision && (
          <section className={clsx(
            styles.sidebarDecisionCard,
            aiDecision.tone === 'buy' && styles.sidebarDecisionBuy,
            aiDecision.tone === 'sell' && styles.sidebarDecisionSell
          )}>
            <span>AI 도움 요약</span>
            <strong>{plainDecisionLabel(aiDecision.decision)}</strong>
            <p>{plainDecisionSummary(aiDecision, chartMetrics)}</p>
            <div className={styles.sidebarActionBox}>
              <b>지금 확인할 것</b>
              <span>{plainNextCheck(aiDecision, chartMetrics)}</span>
            </div>
          </section>
        )}

        {chartMetrics && (
          <section className={styles.sidebarMetricGrid} aria-label="전일 대비 변화">
            <article className={styles.sidebarMetricPrimary}>
              <span>전일 대비</span>
              <strong className={Number(chartMetrics.changeRate) >= 0 ? styles.up : styles.down}>
                {formatPercent(chartMetrics.changeRate)}
              </strong>
            </article>
          </section>
        )}

        <div className={styles.sidebarActionButtons} aria-label="주요 기능">
          <button
            type="button"
            className={clsx(styles.primaryAiAction, activeAssistPanel === 'ai' && styles.assistActionActive)}
            onClick={handleAiHelpClick}
            aria-label="AI 도움 받기"
            aria-pressed={activeAssistPanel === 'ai'}
          >
            <Brain size={15} aria-hidden="true" />
            <span>AI 도움 받기</span>
          </button>
          <button
            type="button"
            className={clsx(styles.briefAction, activeAssistPanel === 'brief' && styles.assistActionActive)}
            onClick={handleBriefClick}
            aria-label="브리프 불러오기"
            aria-pressed={activeAssistPanel === 'brief'}
          >
            <Newspaper size={15} aria-hidden="true" />
            <span>브리프 불러오기</span>
          </button>
        </div>

        {activeAssistPanel === 'ai' && aiDecision && (
          <section
            className={clsx(
              styles.inlineAssistPanel,
              styles.aiHelpPanel,
              aiDecision.tone === 'buy' && styles.aiHelpPanelBuy,
              aiDecision.tone === 'sell' && styles.aiHelpPanelSell
            )}
            aria-label="AI 도움 받기 결과"
          >
            <div className={styles.assistPanelHeader}>
              <span>{stock?.name || '현재 종목'} AI 도움</span>
              <strong>{plainDecisionLabel(aiDecision.decision)}</strong>
            </div>
            <p>{stock?.name || '이 종목'} 기준으로만 차트, 뉴스, 가격 조건을 정리했습니다.</p>
            <div className={styles.assistTimingGrid} aria-label="언제 사고 언제 팔지">
              <article>
                <b>살 때</b>
                <span>{aiDecision.tradeTiming.entryTiming || aiDecision.primaryCondition}</span>
              </article>
              <article>
                <b>팔 때</b>
                <span>{aiDecision.tradeTiming.exitTiming || aiDecision.cautionReason}</span>
              </article>
              <article>
                <b>기다릴 때</b>
                <span>{aiDecision.tradeTiming.waitCondition || aiDecision.nextWatch}</span>
              </article>
              <article>
                <b>판단 바꿀 때</b>
                <span>{aiDecision.tradeTiming.invalidationTrigger || '가격·뉴스·거래가 예상과 반대로 움직이면 다시 봅니다.'}</span>
              </article>
            </div>
            <div className={styles.aiFeatureGrid} aria-label="AI 세 가지 기능">
              <article>
                <span>1. 종목 판단</span>
                <strong>{aiDecision.decision}</strong>
                <p>{aiDecision.primaryCondition}</p>
              </article>
              <article>
                <span>2. 뉴스 방향</span>
                <strong>{newsDirection ? newsDirection.label : '뉴스 확인 중'}</strong>
                <p>
                  {newsDirection
                    ? `상승 ${newsDirection.up ?? '확인'}% · 하락 ${newsDirection.down ?? '확인'}%. ${newsDirection.action}`
                    : `${stock?.name || '이 종목'} 관련 뉴스와 이벤트를 확인합니다.`}
                </p>
              </article>
              <article>
                <span>3. 가격 기준</span>
                <strong>전일 대비 {formatPercent(chartMetrics?.changeRate)}</strong>
                <p>{plainNextCheck(aiDecision, chartMetrics)}</p>
              </article>
            </div>
          </section>
        )}

        {newsDirection && (
          <section className={styles.sidebarNewsCard}>
            <span>뉴스가 주는 방향</span>
            <strong>{newsDirection.label}</strong>
            <p>상승 {newsDirection.up === null ? '확인 중' : `${newsDirection.up}%`} · 하락 {newsDirection.down === null ? '확인 중' : `${newsDirection.down}%`}</p>
            <em>{newsDirection.action}</em>
          </section>
        )}

        {simpleVisibleZoneSummaries.length > 0 && (
          <section className={styles.sidebarZoneList} aria-label="매수와 위험 기준">
            <span>매수와 위험 기준</span>
            {simpleVisibleZoneSummaries.map((zone) => (
              <article key={`${zone.type}-${zone.label}-${zone.price}`}>
                <b>{simpleZoneLabel(zone)}</b>
                <strong>{zone.price || formatCurrency(zone.midPrice)}</strong>
                <em>{zone.relation?.label || '가격 확인'}</em>
              </article>
            ))}
          </section>
        )}
      </aside>
      <div className={styles.brandBadge}>
        <span>TradingView Lightweight Charts · Apache 2.0</span>
        <strong>{stock?.name || '실시간 종목'} · {stock?.code || '000000'} · {intervalLabel(interval)}</strong>
      </div>
      {activeAssistPanel === 'brief' && typeof document !== 'undefined' && createPortal((
        <div className={styles.briefModalLayer} role="presentation" onClick={() => setActiveAssistPanel('none')}>
          <section
            className={styles.briefModal}
            role="dialog"
            aria-modal="true"
            aria-label="한국 주식 일간 브리프"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.briefModalHeader}>
              <div>
                <span>전체 시장 브리프</span>
                <strong>{briefLoading ? '불러오는 중' : briefInsight.basisDate || '최신 브리프'}</strong>
              </div>
              <button type="button" onClick={() => setActiveAssistPanel('none')} aria-label="브리프 닫기">닫기</button>
            </div>
            <pre className={styles.briefTextBlock}>
              {briefLoading ? '브리프를 불러오는 중입니다.' : briefInsight.lines.join('\n')}
            </pre>
            <p className={styles.briefModalNote}>
              이 브리프는 전체 시장 순위입니다. 현재 차트 종목인 {stock?.name || '선택 종목'} 판단은 우측의 AI 도움 받기에서 따로 봅니다.
            </p>
          </section>
        </div>
      ), document.body)}
      <div className={styles.legend} aria-label="차트 범례">
        <span><CandlestickChart size={14} aria-hidden="true" />캔들</span>
        <span><i className={styles.ma5Dot} />5일선</span>
        <span><i className={styles.ma20Dot} />20일선</span>
        <span><i className={styles.ma60Dot} />60일선</span>
        <span><i className={styles.volumeDot} />거래량</span>
      </div>
      {latest && (
        <div className={styles.latestBar}>
          <span>{latest.time}</span>
          <strong>{formatCurrency(latest.close)}</strong>
          <em>거래량 {formatVolume(latest.volume)}</em>
        </div>
      )}
      {chartMetrics && (
        <aside className={styles.signalPanel} aria-label="현재 차트 핵심 신호">
          <div className={styles.signalHeader}>
            <span>현재 차트 핵심</span>
            <strong>{chartMetrics.focus}</strong>
          </div>
          <div className={styles.signalGrid}>
            <div>
              <span>전일 대비</span>
              <strong className={Number(chartMetrics.changeRate) >= 0 ? styles.up : styles.down}>
                {formatPercent(chartMetrics.changeRate)}
              </strong>
            </div>
            <div>
              <span>20일선 거리</span>
              <strong className={chartMetrics.aboveMa20 ? styles.up : styles.down}>
                {formatPercent(chartMetrics.ma20Distance)}
              </strong>
            </div>
            <div>
              <span>저항선까지</span>
              <strong>{formatPercent(chartMetrics.resistanceDistance)}</strong>
            </div>
            <div>
              <span>거래량 강도</span>
              <strong>{Number.isFinite(chartMetrics.volumeRatio) ? `${Math.round(chartMetrics.volumeRatio)}%` : '확인 필요'}</strong>
            </div>
          </div>
          <p>
            20일선 {formatCurrency(chartMetrics.ma20)} · 지지선 {formatCurrency(chartMetrics.support)} · 저항선 {formatCurrency(chartMetrics.resistance)}
          </p>
        </aside>
      )}
      {visibleLayers.ai && forecastGuide && (
        <aside
          className={clsx(
            styles.forecastHud,
            showDetailPanels && styles.forecastHudDetail,
            forecastGuide.tone === 'positive' && styles.forecastHudPositive,
            forecastGuide.tone === 'negative' && styles.forecastHudNegative,
            forecastGuide.tone === 'mixed' && styles.forecastHudMixed
          )}
          aria-label="TradingView 차트 AI 기준선"
        >
          <div className={styles.forecastHudTopline}>
            <span>TradingView AI 기준선</span>
            <strong>{forecastGuide.agreementLabel}</strong>
          </div>
          <p>{forecastGuide.headline}</p>
          <div className={styles.decisionCompass} aria-label="AI 가격 기준 빠른 비교">
            {decisionCompass.map((item) => (
              <span
                key={item.key}
                className={clsx(
                  item.tone === 'up' && styles.decisionCompassUp,
                  item.tone === 'watch' && styles.decisionCompassWatch,
                  item.tone === 'defense' && styles.decisionCompassDefense,
                  item.tone === 'zoneActive' && styles.decisionCompassZoneActive,
                  item.tone === 'personal' && styles.decisionCompassPersonal,
                  item.tone === 'missing' && styles.decisionCompassMissing
                )}
                aria-label={`${item.label} ${item.value} ${item.note}`}
              >
                <em>{item.label}</em>
                {' '}
                <b>{item.value}</b>
                {' '}
                <small>{item.note}</small>
              </span>
            ))}
          </div>
          {showDetailPanels && (
            <div className={styles.forecastActionStrip} aria-label="AI 매수 관망 매도 행동 기준">
              {forecastGuide.actionChecks.map((item) => (
                <span key={`${item.label}-${item.value}`}>
                  <em>{item.label}</em>
                  <b>{item.value}</b>
                </span>
              ))}
            </div>
          )}
          {showDetailPanels && forecastGuide.signals.length > 0 && (
            <div className={styles.forecastSignalStrip} aria-label="상담 뉴스 장후 연결 상태">
              {forecastGuide.signals.map((signal) => (
                <span
                  key={`${signal.label}-${signal.state}`}
                  className={clsx(
                    signal.tone === 'positive' && styles.forecastSignalPositive,
                    signal.tone === 'negative' && styles.forecastSignalNegative
                  )}
                >
                  <em>{signal.label}</em>
                  <b>{signal.state}</b>
                </span>
              ))}
            </div>
          )}
          {showDetailPanels && forecastGuide.planSteps.length > 0 && (
            <div className={styles.forecastPlanBox} aria-label="Ollama 3단계 차트 실행 순서">
              <div className={styles.forecastPlanHeader}>
                <span>{forecastGuide.planTitle}</span>
                <b>상담 → 뉴스 → 장후</b>
              </div>
              <p>{forecastGuide.planHeadline}</p>
              <div className={styles.forecastPlanStrip}>
                {forecastGuide.planSteps.map((step) => (
                  <span
                    key={`${step.label}-${step.state}`}
                    className={clsx(
                      step.tone === 'positive' && styles.forecastPlanPositive,
                      step.tone === 'negative' && styles.forecastPlanNegative,
                      step.tone === 'mixed' && styles.forecastPlanMixed
                    )}
                  >
                    <em>{step.label}</em>
                    <b>{step.state}</b>
                    {step.action && <small>{step.action}</small>}
                  </span>
                ))}
              </div>
            </div>
          )}
          <small>
            {forecastGuide.probabilityLabel}
            {forecastGuide.qdrantLabel ? ` · ${forecastGuide.qdrantLabel}` : ''}
            {forecastGuide.runtimeLabel ? ` · ${forecastGuide.runtimeLabel}` : ''}
            {` · ${forecastGuide.consensusSummary}`}
          </small>
          <em>{forecastGuide.nextAction} · {forecastGuide.modeLabel}</em>
        </aside>
      )}
      {visibleLayers.ai && showDetailPanels && aiDecision && (
        <aside
          className={clsx(
            styles.aiDecisionPanel,
            aiDecision.tone === 'buy' && styles.aiDecisionBuy,
            aiDecision.tone === 'sell' && styles.aiDecisionSell,
            aiDecision.tone === 'watch' && styles.aiDecisionWatch
          )}
          aria-label="Ollama AI 매매 검토"
        >
          <div className={styles.aiDecisionHeader}>
            <span>{aiDecision.title}</span>
            <strong>{aiDecision.decision}</strong>
            <em className={clsx(styles.personalDecisionBadge, hasPersonalContext && styles.personalDecisionBadgeActive)}>
              {hasPersonalContext ? '내 기준 반영' : '평단 미저장'}
            </em>
          </div>
          <p>{aiDecision.summary}</p>
          <div className={styles.aiDecisionStats}>
            <span>뉴스 상승 <strong>{aiDecision.up === null ? '확인 중' : `${aiDecision.up}%`}</strong></span>
            <span>뉴스 하락 <strong>{aiDecision.down === null ? '확인 중' : `${aiDecision.down}%`}</strong></span>
            <span>재무 <strong>{aiDecision.fundamentalLabel}</strong></span>
            <span>장후 <strong>{aiDecision.mood}</strong></span>
            <span className={clsx(hasPersonalContext && styles.aiDecisionPersonalStat)}>
              내 기준 <strong>{personalContextValue}</strong>
            </span>
          </div>
          <div className={styles.aiDecisionQuickLine}>
            <b>다음 확인</b>
            <span>{aiDecision.timingNextAction || aiDecision.primaryCondition || aiDecision.nextWatch}</span>
          </div>
          {hasPersonalContext && (
            <div className={styles.personalDecisionLine}>
              <b>평균단가 반영</b>
              <span>{personalContextSummary}</span>
            </div>
          )}
          {needsPortfolioSetup && onOpenPortfolio && (
            <button
              type="button"
              className={styles.personalSetupButton}
              onClick={onOpenPortfolio}
            >
              평균단가 저장하고 AI 상담 개인화
            </button>
          )}
          {aiDecision.hasTradeTiming && (
            <div className={styles.aiTimingGrid} aria-label="AI 매매 타이밍">
              <div>
                <b>살 때</b>
                <span>{aiDecision.tradeTiming.entryTiming || aiDecision.primaryCondition}</span>
              </div>
              <div>
                <b>팔 때</b>
                <span>{aiDecision.tradeTiming.exitTiming || aiDecision.cautionReason}</span>
              </div>
              <div>
                <b>기다릴 때</b>
                <span>{aiDecision.tradeTiming.waitCondition || aiDecision.nextWatch}</span>
              </div>
              <div>
                <b>판단 바꿀 때</b>
                <span>{aiDecision.tradeTiming.invalidationTrigger || aiDecision.primaryCondition}</span>
              </div>
            </div>
          )}
          {aiDecision.avoidAction && (
            <div className={styles.aiCoachLine}>
              <b>피할 행동</b>
              <span>{aiDecision.avoidAction}</span>
            </div>
          )}
          {aiDecision.factors.length > 0 && (
            <div className={styles.aiFactorGrid} aria-label="차트 재무 뉴스 센티멘트 판단 근거">
              {aiDecision.factors.map((factor) => (
                <div
                  key={`${factor.label}-${factor.state}`}
                  className={clsx(styles.aiFactorItem, factorToneClass(factor.tone, styles))}
                >
                  <span>{factor.label}</span>
                  <strong>{factor.state}</strong>
                  <em>{factor.summary}</em>
                </div>
              ))}
            </div>
          )}
          <div className={styles.aiDecisionReasonGrid}>
            <div>
              <b>판단 근거</b>
              <span>{aiDecision.positiveReason}</span>
            </div>
            <div>
              <b>주의 근거</b>
              <span>{aiDecision.cautionReason}</span>
            </div>
            <div>
              <b>다음 확인</b>
              <span>{aiDecision.nextWatch || aiDecision.primaryCondition}</span>
            </div>
          </div>
          {aiDecision.coachSummary && <em className={styles.aiCoachSummary}>{aiDecision.coachSummary}</em>}
          <small>{aiDecision.modeLabel}</small>
        </aside>
      )}
      {aiDecision && (
        <div className={styles.mobileChartLens} aria-label="모바일 AI 차트 렌즈">
          <span>
            <b>AI 상담</b>
            <strong>{aiDecision.decision}</strong>
          </span>
          <span>
            <b>뉴스 감성</b>
            <strong>상승 {aiDecision.up === null ? '확인' : `${aiDecision.up}%`} · 하락 {aiDecision.down === null ? '확인' : `${aiDecision.down}%`}</strong>
          </span>
          <span>
            <b>다음</b>
            <strong>{aiDecision.timingNextAction || aiDecision.nextWatch || aiDecision.primaryCondition}</strong>
          </span>
          {forecastGuide?.planSteps?.length > 0 && (
            <span>
              <b>3단계</b>
              <strong>{forecastGuide.planSteps.map((step) => {
                const title = step.featureTitle || step.label;
                if (title.includes('뉴스')) return '뉴스 감성';
                if (title.includes('장후')) return '장후 요약';
                if (title.includes('사도') || title.includes('상담')) return 'AI 상담';
                return title.replace(/^[0-9. ]+/, '');
              }).slice(0, 3).join(' → ')}</strong>
            </span>
          )}
          <span>
            <b>근거</b>
            <strong>{aiDecision.live ? 'Ollama LLM' : compactText(aiDecision.modeLabel, '근거 계산', 24)}</strong>
          </span>
          {hasPersonalContext && (
            <span>
              <b>내 기준</b>
              <strong>{personalContextValue}</strong>
            </span>
          )}
        </div>
      )}
      {needsPortfolioSetup && onOpenPortfolio && (
        <button
          type="button"
          className={styles.mobilePortfolioCta}
          onClick={onOpenPortfolio}
        >
          평균단가 저장
        </button>
      )}
      {visibleLayers.personal && showDetailPanels && needsPortfolioSetup && onOpenPortfolio && (
        <aside
          className={clsx(styles.personalRiskOverlay, styles.personalRiskMissing)}
          aria-label="개인 평균단가 저장 안내"
        >
          <div className={styles.personalRiskTopline}>
            <span>내 기준</span>
            <strong>샌드박스 미저장</strong>
          </div>
          <p>{personalRisk?.summary || '평균단가와 손실허용을 저장하면 AI가 매수보다 리스크 기준을 먼저 계산합니다.'}</p>
          <button
            type="button"
            className={styles.personalRiskAction}
            onClick={onOpenPortfolio}
          >
            평균단가·손실허용 입력
          </button>
        </aside>
      )}
      {visibleLayers.personal && showDetailPanels && personalRisk && personalRisk.status !== 'not_saved' && (
        <aside
          className={clsx(
            styles.personalRiskOverlay,
            personalRiskTone(personalRisk.status) === 'profit' && styles.personalRiskProfit,
            personalRiskTone(personalRisk.status) === 'loss' && styles.personalRiskLoss,
            personalRiskTone(personalRisk.status) === 'missing' && styles.personalRiskMissing
          )}
          aria-label="차트 개인 평균단가 기준"
        >
          <div className={styles.personalRiskTopline}>
            <span>내 기준</span>
            <strong>{personalRisk.statusLabel || '개인 조건'}</strong>
            {personalRisk.profitLossText && <b>{personalRisk.profitLossText}</b>}
          </div>
          <p>{personalRisk.summary}</p>
          {personalPriceLines.length > 0 && (
            <div className={styles.personalLineList}>
              {personalPriceLines.map((line) => (
                <span key={line.key}>
                  <i style={{ background: line.color }} />
                  {line.shortLabel} {line.valueText}
                </span>
              ))}
            </div>
          )}
        </aside>
      )}
      {visibleLayers.events && showDetailPanels && newsDirection && (
        <aside
          className={clsx(
            styles.newsDirectionPanel,
            newsDirection.tone === 'up' && styles.newsDirectionUp,
            newsDirection.tone === 'down' && styles.newsDirectionDown
          )}
          aria-label="뉴스 감성 단기 방향"
        >
          <div className={styles.newsDirectionHeader}>
            <span>뉴스 방향</span>
            <strong>{newsDirection.label}</strong>
            {newsDirection.score !== null && <b>{newsDirection.score > 0 ? '+' : ''}{newsDirection.score}점</b>}
          </div>
          <div className={styles.newsProbabilityBars} aria-label="다음 거래일 확률">
            <span style={{ '--value': `${newsDirection.up ?? 0}%` }}>
              상승 <b>{newsDirection.up === null ? '확인 중' : `${newsDirection.up}%`}</b>
            </span>
            <span style={{ '--value': `${newsDirection.down ?? 0}%` }}>
              하락 <b>{newsDirection.down === null ? '확인 중' : `${newsDirection.down}%`}</b>
            </span>
            <span style={{ '--value': `${newsDirection.flat ?? 0}%` }}>
              횡보 <b>{newsDirection.flat === null ? '확인 중' : `${newsDirection.flat}%`}</b>
            </span>
          </div>
          <p>{newsDirection.headline}</p>
          <em>{newsDirection.loading ? 'Ollama 로컬 LLM 분석 준비 중' : `문맥 ${newsDirection.contextLabel} · ${newsDirection.confidence} · ${newsDirection.action}`}</em>
        </aside>
      )}
      {visibleLayers.zones && visibleZoneSummaries.length > 0 && (
        <div className={styles.zoneRail} aria-label="AI 거래 구간">
          <div className={styles.zoneRailHeader}>
            <span>AI 가격 구간 지도</span>
            <strong>{zoneMapSummary}</strong>
          </div>
          {visibleZoneSummaries.map((zone) => (
            <div
              key={`${zone.type}-${zone.label}-${zone.price}`}
              className={clsx(
                styles.zoneItem,
                zone.relation?.tone === 'inside' && styles.zoneInside,
                zone.relation?.tone === 'below' && styles.zoneBelow,
                zone.relation?.tone === 'above' && styles.zoneAbove
              )}
            >
              <i style={{ background: zone.color }} />
              <div>
                <span>{zone.label || 'AI 구간'}</span>
                <em>{zone.role} · {zone.action}</em>
              </div>
              <strong>{zone.price || formatCurrency(zone.midPrice)}</strong>
              <b>{zone.relation?.label || '가격 확인'}</b>
            </div>
          ))}
        </div>
      )}
      {hover && (
        <div
          className={styles.tooltip}
          style={{
            left: `clamp(12px, ${hover.x + 18}px, calc(100% - 292px))`,
            top: `max(${typeof window !== 'undefined' && window.innerWidth <= 768 ? 148 : 12}px, ${hover.y > 210 ? hover.y - 178 : hover.y + 18}px)`
          }}
        >
          <div className={styles.tooltipHeader}>
            <span>{hover.time}</span>
            <strong className={hover.close >= hover.open ? styles.up : styles.down}>
              {formatCurrency(hover.close)}
            </strong>
          </div>
          <ul className={styles.tooltipBulletList}>
            <li>시가 {formatCurrency(hover.open)} · 고가 {formatCurrency(hover.high)}</li>
            <li>저가 {formatCurrency(hover.low)} · 거래량 {formatVolume(hover.volume)}</li>
            {Number.isFinite(hover.ma20) && <li>파란 점선 20일 평균 {formatCurrency(hover.ma20)}</li>}
            {Number.isFinite(hover.ma60) && <li>노란 점선 60일 평균 {formatCurrency(hover.ma60)}</li>}
            {hoverInsight && <li>{hoverInsight.candleDirection} · {hoverInsight.priceState}</li>}
            {hoverInsight && <li>{hoverInsight.volumeState}</li>}
            {hoverInsight && <li>뉴스: {hoverInsight.eventText}</li>}
          </ul>
          {hoverInsight && (
            <div className={styles.tooltipAi}>
              <div className={styles.tooltipAiHeader}>
                <Brain size={14} aria-hidden="true" />
                <b>AI 도움 요약</b>
                <span>{hoverInsight.decision}</span>
              </div>
              <ul className={styles.tooltipAiList}>
                <li>{hoverInsight.nextAction}</li>
                <li>이 날짜 하나만 보고 매수·매도하지 않습니다.</li>
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
