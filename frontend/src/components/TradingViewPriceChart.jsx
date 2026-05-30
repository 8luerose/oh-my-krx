import React, { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Brain, CandlestickChart, Newspaper, RotateCcw, Target } from 'lucide-react';
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
    return { label: '현재 위치', tone: 'inside', distance: 0 };
  }
  if (hasFrom && close < from) {
    const distance = ((from - close) / close) * 100;
    return { label: `진입까지 ${formatPercent(distance)}`, tone: 'below', distance };
  }
  if (hasTo && close > to) {
    const distance = ((close - to) / to) * 100;
    return { label: `상단 초과 ${formatPercent(distance)}`, tone: 'above', distance };
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
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : null;
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
  focusMode = false
}) {
  const containerRef = useRef(null);
  const chartApiRef = useRef(null);
  const [hover, setHover] = useState(null);
  const [chartError, setChartError] = useState('');
  const [visibleLayers, setVisibleLayers] = useState({
    ai: true,
    zones: true,
    events: true,
    personal: true
  });

  const toggleLayer = (key) => {
    setVisibleLayers((current) => ({ ...current, [key]: !current[key] }));
  };

  const handleFitChart = () => {
    chartApiRef.current?.timeScale?.().fitContent?.();
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
    const ollamaStatus = ai?.ollamaInsightsStatus
      || (insights ? 'ready' : ai?.aiLayerStatus === 'ollama_failed' ? 'failed' : ai?.aiLayerStatus === 'loading' ? 'loading' : 'waiting');
    const isWaitingForOllama = ollamaStatus === 'loading' && !insights;
    const isOllamaDelayed = ollamaStatus === 'failed' && !insights;
    const advice = insights?.stockAdvice || {};
    const sentiment = insights?.newsSentiment || {};
    const report = insights?.afterMarketReport || {};
    const beginnerCoach = insights?.beginnerCoach || {};
    const probabilities = sentiment?.nextTradingDay || {};
    const decision = isWaitingForOllama
      ? '분석 중'
      : normalizeDecision(advice.decision || ai?.chartState?.state || '관망');
    const summary = isWaitingForOllama
      ? 'Ollama가 차트, 뉴스, 매매 구간을 합쳐 판단하는 중입니다.'
      : compactText(
        advice.summary || ai?.conclusion,
        isOllamaDelayed ? 'Ollama 응답이 늦어 현재는 규칙형 차트 근거를 보여줍니다.' : '차트와 뉴스 근거를 모으는 중입니다.',
        96
      );
    const up = Number(probabilities.up);
    const down = Number(probabilities.down);
    const flat = Number(probabilities.flat);
    const primaryCondition = decision.includes('매수')
      ? compactText(beginnerCoach.nextAction, '', 104) || firstCompact(advice.buyConditions, '20일선 위 유지와 거래량 증가가 함께 필요합니다.')
      : decision.includes('매도')
        ? compactText(beginnerCoach.nextAction, '', 104) || firstCompact(advice.sellConditions, '지지선 이탈과 하락 거래량 증가를 먼저 확인합니다.')
        : compactText(beginnerCoach.nextAction, '', 104) || firstCompact(advice.watchConditions, '다음 종가와 거래량을 확인할 때까지 관망합니다.');
    const positiveReason = compactText(beginnerCoach.goodReason, '', 88) || firstCompact(sentiment.upReasons, '좋게 볼 근거는 가격 반응과 거래량으로 재확인해야 합니다.');
    const cautionReason = compactText(beginnerCoach.cautionReason, '', 88) || firstCompact(sentiment.downRisks, sentiment.caution || '반대 신호와 뉴스 원문을 확인해야 합니다.');
    const nextWatch = compactText(beginnerCoach.nextAction, '', 104) || firstCompact(report.nextWatch, primaryCondition);
    const avoidAction = compactText(beginnerCoach.avoidAction, '', 96);
    const coachSummary = compactText(beginnerCoach.plainSummary, '', 112);
    const fundamentalLabel = fundamentalStatusLabel(ai?.fundamentalGuidance?.summary, advice.riskNotes).replace(/^재무\s*/, '');
    const model = insights?.model || ai?.llmModel || '';
    const modeLabel = insights?.modeLabel || ai?.modeLabel || '근거 기반 AI';
    const title = insights
      ? (insights.mode === 'ollama_llm' ? 'Ollama AI 판단' : 'Ollama 미리보기')
      : isWaitingForOllama
        ? 'Ollama AI 준비 중'
        : isOllamaDelayed
          ? 'Ollama 응답 지연'
          : ai?.llmProvider === 'ollama'
            ? 'Ollama AI 판단'
            : 'AI 판단 준비 중';
    const statusLabel = isWaitingForOllama
      ? '로컬 LLM이 차트와 뉴스를 읽는 중'
      : isOllamaDelayed
        ? 'Ollama 지연 · 규칙형 근거 유지'
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
    const ollamaStatus = ai?.ollamaInsightsStatus
      || (insights ? 'ready' : ai?.aiLayerStatus === 'ollama_failed' ? 'failed' : ai?.aiLayerStatus === 'loading' ? 'loading' : 'waiting');
    const isWaitingForOllama = ollamaStatus === 'loading' && !insights;
    if (!insights && !isWaitingForOllama) return null;

    const sentiment = insights?.newsSentiment || {};
    const probabilities = sentiment?.nextTradingDay || {};
    const up = probabilityValue(probabilities.up);
    const down = probabilityValue(probabilities.down);
    const flat = probabilityValue(probabilities.flat);
    const score = Number(sentiment.score ?? sentiment.scoreBreakdown?.adjustedScore);
    const tone = isWaitingForOllama ? 'neutral' : probabilityTone(up, down);
    const label = isWaitingForOllama
      ? '계산 중'
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
      isWaitingForOllama ? 'Ollama가 뉴스와 이벤트를 읽는 중입니다.' : sentiment.caution || '뉴스 원문과 거래량 반응을 함께 확인합니다.',
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
      loading: isWaitingForOllama
    };
  }, [ai]);

  const hoverInsight = useMemo(() => {
    if (!hover || !aiDecision) return null;
    const close = Number(hover.close);
    const open = Number(hover.open);
    const candleDirection = Number.isFinite(close) && Number.isFinite(open)
      ? close >= open ? '양봉' : '음봉'
      : '캔들';
    const newsLine = newsDirection
      ? `${newsDirection.label} · 상승 ${newsDirection.up ?? '확인'}% · 하락 ${newsDirection.down ?? '확인'}%`
      : '뉴스 방향 계산 중';
    return {
      candleDirection,
      priceState: hoverPriceState(hover),
      volumeState: hoverVolumeState(hover, chartMetrics?.volumeAvg),
      decision: aiDecision.decision,
      condition: compactText(aiDecision.primaryCondition || aiDecision.nextWatch, 'AI 조건 확인 필요', 92),
      newsLine,
      headline: compactText(newsDirection?.headline || hover.event?.title, '뉴스·이벤트 근거 확인 필요', 92)
    };
  }, [aiDecision, chartMetrics, hover, newsDirection]);

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

      const markerApi = createSeriesMarkers(
      candleSeries,
      visibleLayers.events ? events
        .filter((event) => event?.date)
        .slice(0, compactChart ? 5 : 12)
        .map((event) => markerForEvent(event, compactChart)) : []
    );

      const priceLines = [];
      const addPriceLine = (price, title, color, style = LineStyle.Dashed) => {
      const numericPrice = Number(price);
      if (!Number.isFinite(numericPrice)) return;
      priceLines.push(candleSeries.createPriceLine({
        price: numericPrice,
        color,
        lineWidth: 1,
        lineStyle: style,
        axisLabelVisible: !compactChart,
        title: compactChart ? '' : title
      }));
    };

      addPriceLine(indicatorSnapshot?.supportLevel, '지지선', '#22c55e');
      addPriceLine(indicatorSnapshot?.resistanceLevel, '저항선', '#ef4444');
      if (visibleLayers.zones) {
        zoneSummaries.forEach((zone) => addPriceLine(zone.midPrice, zone.label || 'AI 구간', zone.color, LineStyle.Dotted));
      }
      if (visibleLayers.personal) {
        personalPriceLines.forEach((line) => {
          addPriceLine(line.price, line.label, line.color, line.key === 'average' ? LineStyle.Solid : LineStyle.Dashed);
        });
      }

      chart.subscribeCrosshairMove((param) => {
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
    });

      chart.timeScale().fitContent();

      cleanupChart = () => {
        chartApiRef.current = null;
        if (resizeTimer) window.clearTimeout(resizeTimer);
        resizeObserver.disconnect();
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
  }, [dataByTime, events, indicatorSnapshot, personalPriceLines, prepared, visibleLayers.events, visibleLayers.personal, visibleLayers.zones, zoneSummaries]);

  const latest = prepared.rows[prepared.rows.length - 1];

  return (
    <div className={clsx(styles.stage, focusMode && styles.aiCardFocusMode)}>
      <div ref={containerRef} className={styles.chart} data-testid="tradingview-price-chart" />
      {chartError && <div className={styles.chartError}>{chartError}</div>}
      <div className={styles.brandBadge}>
        <span>TradingView Lightweight Charts · Apache 2.0</span>
        <strong>{stock?.name || '실시간 종목'} · {stock?.code || '000000'} · {intervalLabel(interval)}</strong>
      </div>
      <div className={styles.chartControlDock} aria-label="TradingView 차트 레이어">
        <button type="button" onClick={handleFitChart} aria-label="차트 전체 보기">
          <RotateCcw size={15} aria-hidden="true" />
          <span>맞춤</span>
        </button>
        <button
          type="button"
          className={clsx(visibleLayers.ai && styles.layerActive)}
          onClick={() => toggleLayer('ai')}
          aria-label="AI 레이어"
          aria-pressed={visibleLayers.ai}
        >
          <Brain size={15} aria-hidden="true" />
          <span>AI</span>
        </button>
        <button
          type="button"
          className={clsx(visibleLayers.zones && styles.layerActive)}
          onClick={() => toggleLayer('zones')}
          aria-label="거래 구간 레이어"
          aria-pressed={visibleLayers.zones}
        >
          <Target size={15} aria-hidden="true" />
          <span>구간</span>
        </button>
        <button
          type="button"
          className={clsx(visibleLayers.events && styles.layerActive)}
          onClick={() => toggleLayer('events')}
          aria-label="뉴스 이벤트 레이어"
          aria-pressed={visibleLayers.events}
        >
          <Newspaper size={15} aria-hidden="true" />
          <span>뉴스</span>
        </button>
        <button
          type="button"
          className={clsx(visibleLayers.personal && styles.layerActive)}
          onClick={() => toggleLayer('personal')}
          aria-label="개인 평균단가 레이어"
          aria-pressed={visibleLayers.personal}
        >
          <Target size={15} aria-hidden="true" />
          <span>내 기준</span>
        </button>
      </div>
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
      {visibleLayers.ai && aiDecision && (
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
          </div>
          <p>{aiDecision.summary}</p>
          <div className={styles.aiDecisionStats}>
            <span>뉴스 상승 <strong>{aiDecision.up === null ? '확인 중' : `${aiDecision.up}%`}</strong></span>
            <span>뉴스 하락 <strong>{aiDecision.down === null ? '확인 중' : `${aiDecision.down}%`}</strong></span>
            <span>재무 <strong>{aiDecision.fundamentalLabel}</strong></span>
            <span>장후 <strong>{aiDecision.mood}</strong></span>
          </div>
          <div className={styles.aiDecisionQuickLine}>
            <b>다음 확인</b>
            <span>{aiDecision.primaryCondition || aiDecision.nextWatch}</span>
          </div>
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
            <b>AI</b>
            <strong>{aiDecision.decision}</strong>
          </span>
          <span>
            <b>뉴스</b>
            <strong>상승 {aiDecision.up === null ? '확인' : `${aiDecision.up}%`} · 하락 {aiDecision.down === null ? '확인' : `${aiDecision.down}%`}</strong>
          </span>
          <span>
            <b>다음</b>
            <strong>{aiDecision.nextWatch || aiDecision.primaryCondition}</strong>
          </span>
        </div>
      )}
      {visibleLayers.personal && personalRisk && personalRisk.status !== 'not_saved' && (
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
      {visibleLayers.events && newsDirection && (
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
      {visibleLayers.zones && zoneSummaries.length > 0 && (
        <div className={styles.zoneRail} aria-label="AI 거래 구간">
          <div className={styles.zoneRailHeader}>
            <span>AI 가격 구간 지도</span>
            <strong>{zoneMapSummary}</strong>
          </div>
          {zoneSummaries.map((zone) => (
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
            top: hover.y > 210 ? `${hover.y - 178}px` : `${hover.y + 18}px`
          }}
        >
          <div className={styles.tooltipDate}>{hover.time}</div>
          <div className={clsx(styles.tooltipPrice, hover.close >= hover.open ? styles.up : styles.down)}>
            {formatCurrency(hover.close)}
          </div>
          <div className={styles.tooltipRows}>
            <span>시가 {formatCurrency(hover.open)}</span>
            <span>고가 {formatCurrency(hover.high)}</span>
            <span>저가 {formatCurrency(hover.low)}</span>
            <span>거래량 {formatVolume(hover.volume)}</span>
          </div>
          <div className={styles.tooltipMa}>
            {Number.isFinite(hover.ma5) && <span>5일선 {formatCurrency(hover.ma5)}</span>}
            {Number.isFinite(hover.ma20) && <span>20일선 {formatCurrency(hover.ma20)}</span>}
            {Number.isFinite(hover.ma60) && <span>60일선 {formatCurrency(hover.ma60)}</span>}
            {learningMode && (
              <button type="button" onClick={() => onTermClick?.('이동평균선')}>
                이동평균선 뜻 보기
              </button>
            )}
          </div>
          {hover.event && (
            <div className={styles.eventNote}>
              <b>{hover.event.title}</b>
              <p>{hover.event.reason || hover.event.explanation || hover.event.desc || '이벤트 근거 확인 필요'}</p>
            </div>
          )}
          {hoverInsight && (
            <div className={styles.tooltipAi}>
              <div className={styles.tooltipAiHeader}>
                <Brain size={14} aria-hidden="true" />
                <b>AI 연결</b>
                <span>{hoverInsight.decision}</span>
              </div>
              <div className={styles.tooltipAiGrid}>
                <span>{hoverInsight.candleDirection}</span>
                <span>{hoverInsight.priceState}</span>
                <span>{hoverInsight.volumeState}</span>
              </div>
              <p>{hoverInsight.condition}</p>
              <em>{hoverInsight.newsLine} · {hoverInsight.headline}</em>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
