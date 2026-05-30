import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { RefreshCw } from 'lucide-react';
import TradingViewPriceChart from './TradingViewPriceChart';
import { loadSummaryArchive, loadSummaryByDate, searchStocks, askAiForTerm } from '../services/apiClient';
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

function hasNumericValue(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

const LEARNING_TERMS = [
  { name: '5일선', desc: '1주 평균' },
  { name: '20일선', desc: '1달 평균' },
  { name: '60일선', desc: '3달 평균' },
  { name: '거래량', desc: '매매 수량' },
  { name: '거래대금', desc: '자금 흐름' },
  { name: '골든크로스', desc: '상승 전환' },
  { name: '공매도', desc: '하락 베팅' },
  { name: '공시', desc: '기업 정보' },
  { name: '기관 수급', desc: '기관 매매' },
  { name: '데드크로스', desc: '하락 전환' },
  { name: '등락률', desc: '가격 변화' },
  { name: '매도세', desc: '팔려는 힘' },
  { name: '매수세', desc: '사려는 힘' },
  { name: '물타기', desc: '평단 낮추기' },
  { name: '박스권', desc: '횡보 구간' },
  { name: '변동성', desc: '흔들림 폭' },
  { name: '분할매도', desc: '나눠 팔기' },
  { name: '분할매수', desc: '나눠 사기' },
  { name: '손절매', desc: '손실 차단' },
  { name: '시가총액', desc: '기업 규모' },
  { name: '신고가', desc: '새 고점' },
  { name: '신용잔고', desc: '빚투 잔량' },
  { name: '외국인 수급', desc: '외인 매매' },
  { name: '익절', desc: '이익 확정' },
  { name: '저항선', desc: '돌파 목표' },
  { name: '지지선', desc: '하락 방어' },
  { name: '체결강도', desc: '매수 강도' },
  { name: '추세선', desc: '방향선' },
  { name: '캔들차트', desc: '가격 막대' },
  { name: '테마주', desc: '기대감 주' },
  { name: '평단가', desc: '평균 매수가' },
  { name: 'PER', desc: '이익 대비 가격' },
  { name: 'PBR', desc: '자산 대비 가격' },
  { name: 'ROE', desc: '자본 수익률' }
];

const TERM_EXPLANATION_FALLBACK = {
  '5일선': {
    meaning: '최근 5거래일 종가의 평균값입니다.',
    chart: '짧은 흐름을 보는 선이라 가격이 5일선 위에 있으면 단기 힘이 살아 있다고 봅니다.',
    example: '5일선이 20일선 위로 올라오면 단기 매수세가 강해졌는지 거래량과 함께 확인합니다.',
    caution: '너무 짧은 평균이라 하루 급등락에도 쉽게 흔들립니다.'
  },
  '20일선': {
    meaning: '최근 20거래일 종가의 평균값이며 보통 한 달 평균 가격으로 봅니다.',
    chart: '현재가가 20일선 위인지 아래인지로 중기 흐름을 먼저 확인합니다.',
    example: '20일선 위에서 종가가 유지되고 거래량이 늘면 매수 검토 조건으로 볼 수 있습니다.',
    caution: '20일선만 보고 바로 매수하지 말고 뉴스와 거래량을 같이 봐야 합니다.'
  },
  '60일선': {
    meaning: '최근 60거래일 평균 가격으로 약 3개월 흐름을 보여줍니다.',
    chart: '가격이 60일선 위에 있으면 큰 흐름이 비교적 안정적인지 확인합니다.',
    example: '60일선을 회복한 뒤 눌림이 약하면 중기 반등 가능성을 점검합니다.',
    caution: '반응이 느린 선이라 급변하는 종목에서는 늦게 따라올 수 있습니다.'
  },
  '거래량': {
    meaning: '하루 동안 실제로 사고팔린 주식 수입니다.',
    chart: '가격 상승과 함께 거래량이 늘면 관심이 붙었는지 확인합니다.',
    example: '거래량이 평소보다 크게 늘었는데 가격이 밀리면 매도세도 강한지 봅니다.',
    caution: '거래량 증가가 항상 좋은 신호는 아니며 하락 거래량도 있습니다.'
  },
  '저항선': {
    meaning: '가격이 올라갈 때 자주 막히는 구간입니다.',
    chart: '과거 고점이나 매물이 많았던 가격대를 저항선 후보로 봅니다.',
    example: '저항선을 강하게 돌파하고 거래량이 붙으면 매수 검토 조건이 됩니다.',
    caution: '돌파 직후 바로 밀리면 거짓 돌파일 수 있습니다.'
  },
  '지지선': {
    meaning: '가격이 내려갈 때 버텨주는 구간입니다.',
    chart: '과거 저점이나 반등이 반복된 가격대를 지지선 후보로 봅니다.',
    example: '지지선 근처에서 하락이 멈추면 분할매수 가능성을 검토합니다.',
    caution: '지지선이 깨지면 손실 관리 기준을 먼저 세워야 합니다.'
  },
  'PER': {
    meaning: '주가가 기업 이익에 비해 비싼지 보는 지표입니다.',
    chart: '차트 지표는 아니며 같은 업종 평균과 비교해 봅니다.',
    example: 'PER이 업종보다 높으면 성장 기대가 이미 주가에 반영됐는지 확인합니다.',
    caution: 'PER은 적자 기업이나 일회성 이익이 큰 기업에서는 왜곡될 수 있습니다.'
  },
  'PBR': {
    meaning: '주가가 기업 순자산에 비해 비싼지 보는 지표입니다.',
    chart: '차트보다는 재무 지표에서 확인하고 업종 특성과 비교합니다.',
    example: 'PBR이 낮아도 이익이 줄고 있으면 싸다고 단정하지 않습니다.',
    caution: '자산 가치가 낮아지는 업종에서는 낮은 PBR도 위험할 수 있습니다.'
  },
  'ROE': {
    meaning: '자기자본으로 얼마나 이익을 냈는지 보여주는 수익성 지표입니다.',
    chart: '차트와 함께 보면 주가 상승이 실적 힘을 받는지 확인할 수 있습니다.',
    example: 'ROE가 꾸준히 높은데 20일선도 회복하면 실적과 수급을 함께 점검합니다.',
    caution: '부채가 많아서 ROE가 높아 보이는 경우도 있습니다.'
  }
};

function fallbackLearningExplanation(termName) {
  const item = TERM_EXPLANATION_FALLBACK[termName] || {
    meaning: `${termName}은 주가 흐름이나 기업 상태를 이해할 때 쓰는 기본 용어입니다.`,
    chart: `${termName}이 차트에서 어떤 가격·거래량 변화와 연결되는지 먼저 확인합니다.`,
    example: `${termName}을 볼 때는 오늘 가격만 보지 말고 전일 대비 변화와 거래량을 함께 봅니다.`,
    caution: `${termName} 하나만으로 매수·매도를 결정하면 판단이 흔들릴 수 있습니다.`
  };
  return `뜻: ${item.meaning}\n차트에서: ${item.chart}\n실전 예시: ${item.example}\n주의: ${item.caution}`;
}

function normalizeLearningExplanation(termName, rawAnswer) {
  const fallback = fallbackLearningExplanation(termName);
  if (/기준일\s*[:：]|대상\s*[:：]|분석 범위|검색 맥락|차트 이벤트 근거/.test(String(rawAnswer || ''))) {
    return fallback;
  }
  const cleanedLines = String(rawAnswer || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
    .filter(Boolean)
    .filter((line) => !/^(기준일|대상|분석 범위|분석범위|리포트|출처|면책|종목코드)\s*[:：]/.test(line))
    .filter((line) => !/Ollama AI 학습 도우미|로컬 AI|맞춤형 학습 콘텐츠/.test(line));
  const picked = {
    meaning: '',
    chart: '',
    example: '',
    caution: ''
  };
  cleanedLines.forEach((line) => {
    const value = line.replace(/^(뜻|의미|차트에서|차트|실전 예시|예시|주의|주의점)\s*[:：]\s*/, '').trim();
    if (/^(뜻|의미)\s*[:：]/.test(line)) picked.meaning = value;
    else if (/^(차트에서|차트)\s*[:：]/.test(line)) picked.chart = value;
    else if (/^(실전 예시|예시)\s*[:：]/.test(line)) picked.example = value;
    else if (/^(주의|주의점)\s*[:：]/.test(line)) picked.caution = value;
  });
  const fallbackLines = fallback.split('\n').reduce((acc, line) => {
    const [label, ...rest] = line.split(':');
    acc[label.trim()] = rest.join(':').trim();
    return acc;
  }, {});
  const meaning = picked.meaning || cleanedLines[0] || fallbackLines['뜻'];
  const chart = picked.chart || cleanedLines.find((line) => /차트|가격|거래량|선/.test(line)) || fallbackLines['차트에서'];
  const exampleCandidate = picked.example || cleanedLines.find((line) => line.includes(termName) && /때|면|예/.test(line));
  const example = exampleCandidate && !/기준일|대상|분석/.test(exampleCandidate) ? exampleCandidate : fallbackLines['실전 예시'];
  const caution = picked.caution || cleanedLines.find((line) => /주의|단정|위험|실수|오해/.test(line)) || fallbackLines['주의'];
  return `뜻: ${meaning}\n차트에서: ${chart}\n실전 예시: ${example}\n주의: ${caution}`;
}

function parseLearningExplanation(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, ...rest] = line.split(':');
      return {
        label: rest.length ? label.trim() : '핵심',
        text: rest.length ? rest.join(':').trim() : line
      };
    });
}

export default function ImmersiveChart({ stock, chart, zones, events, ai, indicatorSnapshot, decisionSummary, interval, onChangeInterval, stockOptions = [], onChangeStock, learningMode, onTermClick, aiCardExpanded = false, onPanelOpenChange, onRefreshAi, onOpenPortfolio }) {
  const toolbarRef = useRef(null);
  const [activePanel, setActivePanel] = useState('none'); // 'none', 'stocks', 'calendar', 'guide', 'ai'
  const [guideTab, setGuideTab] = useState('ma'); // 'ma', 'beginner', 'event'
  const [stockCodeInput, setStockCodeInput] = useState(stock?.code || '');
  const [stockCodeError, setStockCodeError] = useState('');
  const [summaryArchive, setSummaryArchive] = useState(null);
  const [summaryArchiveLoading, setSummaryArchiveLoading] = useState(false);

  // AI로 학습하기 용어 사전 모달 상태
  const [learningModalOpen, setLearningModalOpen] = useState(false);
  const [explanationModalOpen, setExplanationModalOpen] = useState(false);
  const [selectedTerm, setSelectedTerm] = useState('');
  const [learningExplanation, setLearningExplanation] = useState('');
  const [loadingTerm, setLoadingTerm] = useState(false);

  // 브리프 달력 용 연월 및 단건 상세 데이터 상태 추가
  const [calendarDate, setCalendarDate] = useState(new Date(2026, 4, 1)); // 2026년 5월 기본값
  const [selectedBriefDate, setSelectedBriefDate] = useState(null);
  const [selectedBriefData, setSelectedBriefData] = useState(null);
  const [selectedBriefLoading, setSelectedBriefLoading] = useState(false);

  const handleAskAiForTerm = async (termName) => {
    setSelectedTerm(termName);
    setExplanationModalOpen(true); // 2차 모달 즉시 팝업!
    setLoadingTerm(true);
    setLearningExplanation('');
    try {
      const ans = await askAiForTerm(termName, stock?.code, stock?.name);
      setLearningExplanation(normalizeLearningExplanation(termName, ans));
    } catch (error) {
      setLearningExplanation(fallbackLearningExplanation(termName));
    } finally {
      setLoadingTerm(false);
    }
  };

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

  useEffect(() => {
    let mounted = true;
    setSummaryArchiveLoading(true);
    const targetYear = calendarDate.getFullYear();
    const targetMonth = calendarDate.getMonth() + 1;
    loadSummaryArchive(targetYear, targetMonth)
      .then((archive) => {
        if (mounted) setSummaryArchive(archive);
      })
      .catch(() => {
        if (mounted) setSummaryArchive({ latest: null, list: [], source: '불러오기 실패' });
      })
      .finally(() => {
        if (mounted) setSummaryArchiveLoading(false);
      });
    return () => { mounted = false; };
  }, [calendarDate]);

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
    const ollamaStatus = resolveOllamaStatus(ai, insights);
    const marketReportStatus = ai?.marketReportStatus || (ai?.marketReport ? 'ready' : '');
    const isLoading = ollamaStatus === 'loading';
    const isDelayed = isOllamaDelayed(ollamaStatus);
    const hasAdvice = Boolean(insights?.stockAdvice?.decision || insights?.stockAdvice?.summary);
    const hasNews = Boolean(insights?.newsSentiment?.summary || insights?.newsSentiment?.nextTradingDay);
    const report = ai?.marketReport || insights?.afterMarketReport || null;
    const isOllamaLlm = insights?.mode === 'ollama_llm' || ai?.llmUsed;
    const refreshStatus = ai?.ollamaInsightsRefreshStatus || '';
    const adviceState = hasAdvice ? 'ready' : isLoading ? 'loading' : isDelayed ? 'delayed' : 'waiting';
    const newsState = hasNews ? 'ready' : isLoading ? 'loading' : isDelayed ? 'delayed' : 'waiting';
    const adviceDecision = insights?.stockAdvice?.decision || (isLoading ? '분석 중' : isDelayed ? '규칙형 유지' : '대기');
    const newsDirection = insights?.newsSentiment?.nextTradingDay;
    const newsText = insights
      ? `상승 ${newsDirection?.up ?? '확인 중'}% · 하락 ${newsDirection?.down ?? '확인 중'}%`
      : isLoading
        ? '뉴스와 이벤트 문맥 확인 중'
        : isDelayed ? '규칙형 뉴스 근거 유지' : '뉴스 방향 대기';
    const reportText = report
      ? (ai?.marketReport?.storage?.cached ? 'DB 저장본 재사용' : '장후 리포트 준비 완료')
      : marketReportStatus === 'loading'
        ? '최신 저장 브리프 확인 중'
        : marketReportStatus === 'unavailable' ? '장후 리포트 지연' : '장후 리포트 대기';
    const reportState = report ? 'ready' : marketReportStatus === 'loading' ? 'loading' : marketReportStatus === 'unavailable' ? 'delayed' : 'waiting';
    const llmLabel = isOllamaLlm ? 'Ollama LLM 응답' : isLoading ? 'Ollama 계산 중' : isDelayed ? 'Ollama 지연 · 도착 시 자동 반영' : 'Ollama 대기';
    const storageLabel = refreshStatus === 'refreshing'
      ? `${insights?.runtimeCache?.label || 'DB 저장본 표시'} · 새 계산 중`
      : refreshStatus === 'fresh'
        ? insights?.runtimeCache?.label || '새 계산 반영'
        : refreshStatus === 'kept_cached'
          ? 'DB 저장본 유지'
          : insights?.runtimeCache?.label
      || (insights?.storage?.saved ? '상담 DB 저장' : hasAdvice ? '상담 저장 확인 필요' : '저장 전');
    const qdrantLabel = insights?.qdrant?.enabled && !insights.qdrant?.skipped
      ? `Qdrant ${insights.qdrant.retrievedCount || 0}개`
      : insights?.qdrant?.asyncUpsertScheduled
        ? 'Qdrant 저장 중'
        : insights?.qdrant?.asyncUpsertDeduped ? 'Qdrant 저장 대기' : '빠른 AI 응답';
    const reportStorageLabel = ai?.marketReport?.runtimeCache?.label
      || (ai?.marketReport?.storage?.cached ? '장후 DB 재사용'
        : ai?.marketReport?.storage?.saved ? '장후 DB 저장'
          : report ? '장후 결과 반영' : '장후 저장 전');

    return [
      {
        label: '1. 이 종목 지금 사도 되나요?',
        value: adviceDecision,
        detail: '차트, 재무, 뉴스, 센티멘트를 합쳐 조건형 상담',
        state: adviceState,
        meta: [llmLabel, storageLabel]
      },
      {
        label: '2. 뉴스 감성 단기 방향',
        value: newsText,
        detail: '헤드라인 문맥을 읽고 다음 거래일 방향 확률 표시',
        state: newsState,
        meta: [llmLabel, qdrantLabel]
      },
      {
        label: '3. 장후 시장 요약 리포트',
        value: reportText,
        detail: '저장된 일간 브리프에 Ollama 코멘트 추가',
        state: reportState,
        meta: [reportStorageLabel, report?.modeLabel || report?.title || '최신 브리프 기준']
      }
    ];
  }, [ai]);

  const aiPipelineSummary = useMemo(() => {
    const readyCount = aiExecutionSteps.filter((step) => step.state === 'ready').length;
    const hasLoading = aiExecutionSteps.some((step) => step.state === 'loading');
    const hasDelayed = aiExecutionSteps.some((step) => step.state === 'delayed');
    const insights = ai?.ollamaInsights;
    const report = ai?.marketReport || insights?.afterMarketReport;
    const qdrant = insights?.qdrant || ai?.marketReport?.qdrant;
    const storage = insights?.storage || ai?.storage;
    const runtimeCache = insights?.runtimeCache;
    const refreshStatus = ai?.ollamaInsightsRefreshStatus || '';
    const reportRuntimeCache = ai?.marketReport?.runtimeCache;
    const ollamaStatus = resolveOllamaStatus(ai, insights);
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
      storageLabel: refreshStatus === 'refreshing'
        ? `${runtimeCache?.label || 'DB 저장본 표시'} · 새 계산 중`
        : refreshStatus === 'fresh'
          ? runtimeCache?.label || '새 계산 반영'
          : refreshStatus === 'kept_cached'
            ? 'DB 저장본 유지'
            : runtimeCache?.label
        || (ollamaStatus === 'loading' ? '새 Ollama 계산 중'
          : isOllamaDelayed(ollamaStatus) ? '도착 시 자동 반영'
            : storage?.saved ? `상담 DB #${storage.id || '저장'}` : '기업 선택 저장 안 함'),
      reportStorageLabel: reportRuntimeCache?.label
        || (ai?.marketReport?.storage?.cached ? '장후 DB 재사용'
          : ai?.marketReport?.storage?.saved ? '장후 DB 저장'
            : report ? '장후 결과 반영'
            : marketReportStatus === 'loading' ? '장후 확인 중'
              : marketReportStatus === 'unavailable' ? '장후 리포트 지연' : '장후 대기'),
      qdrantLabel: qdrant?.enabled && !qdrant?.skipped
        ? `Qdrant ${qdrant.retrievedCount || 0}개`
        : qdrant?.asyncUpsertScheduled
          ? 'Qdrant 저장 중'
          : qdrant?.asyncUpsertDeduped ? 'Qdrant 저장 대기' : '빠른 AI 응답',
      tone: hasLoading ? 'loading' : hasDelayed ? 'delayed' : readyCount === aiExecutionSteps.length ? 'ready' : 'waiting'
    };
  }, [ai, aiExecutionSteps]);

  const stockPanelAdvice = useMemo(() => {
    const insights = ai?.ollamaInsights;
    const ollamaStatus = resolveOllamaStatus(ai, insights);
    const loading = ollamaStatus === 'loading' && !insights;
    const delayed = isOllamaDelayed(ollamaStatus) && !insights;
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
    const newsLabel = hasNumericValue(news.up) && hasNumericValue(news.down)
      ? `상승 ${Math.round(Number(news.up))}% · 하락 ${Math.round(Number(news.down))}%`
      : loading ? '뉴스 계산 중' : delayed ? 'Ollama 지연 중' : '뉴스 확인 필요';

    return {
      decision,
      tone: stockAdviceTone(decision),
      summary,
      nextAction,
      caution,
      priceLabel: formatCurrency(latest?.close),
      ma20Label: formatCurrency(ma20),
      newsLabel,
      sourceLabel: ai?.ollamaInsightsRefreshStatus === 'refreshing'
        ? '저장본 표시 · 새 계산 중'
        : ai?.ollamaInsightsRefreshStatus === 'kept_cached'
          ? 'DB 저장본 유지'
          : insights?.mode === 'ollama_llm' || ai?.llmUsed ? 'Ollama LLM' : loading ? 'Ollama 계산 중' : delayed ? '지연 · 자동 반영' : '근거 계산'
    };
  }, [ai, chartData, decisionSummary, indicatorSnapshot]);

  const stockPanelNews = useMemo(() => {
    const insights = ai?.ollamaInsights;
    const sentiment = insights?.newsSentiment || {};
    const ollamaStatus = resolveOllamaStatus(ai, insights);
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
      headline?.priceCheck ? [headline.priceCheck, ...(sentiment.actionGuide || sentiment.tradingScenarios || [])] : sentiment.actionGuide || sentiment.tradingScenarios,
      loading ? '로컬 AI 답변이 붙기 전까지는 원문 뉴스와 거래량 변화를 함께 봅니다.' : '뉴스 원문과 거래량 반응을 함께 확인합니다.',
      98
    );
    const effect = headline?.effect || (loading ? '문맥 계산 중' : sentiment.label || '확인 필요');

    return {
      title: compactPanelText(headline?.title || fallbackHeadline, loading ? '뉴스 헤드라인 문맥 계산 중' : '뉴스 헤드라인 확인 필요', 96),
      effect: compactPanelText(effect, '확인 필요', 28),
      reason: compactPanelText(headline?.impactPath || headline?.reason || sentiment.llmContextReason || sentiment.summary, loading ? '뉴스 제목과 이벤트를 함께 읽어 단기 방향을 계산합니다.' : '뉴스 문맥 근거를 확인합니다.', 104),
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
      report?.tomorrowChecklist || report?.actionPlan || report?.nextWatch,
      loading
        ? '저장된 장후 브리프를 확인한 뒤 오늘 시장 분위기를 종목 판단에 연결합니다.'
        : report?.llmComment || '다음 거래일 시초가, 거래량, 20일선 유지 여부를 확인합니다.',
      108
    );
    const stockImpact = report?.stockImpact
      ? compactPanelText(report.stockImpact, '', 132)
      : tone === 'risk'
      ? `${stock?.name || '선택 종목'} 기준으로는 추격보다 지지선·20일선 이탈 기준을 먼저 정해야 합니다.`
      : tone === 'positive'
        ? `${stock?.name || '선택 종목'} 기준으로는 시장 관심이 거래량으로 이어지는지 확인한 뒤 검토합니다.`
        : `${stock?.name || '선택 종목'} 기준으로는 시장 리더와 다른 움직임인지 비교하며 선별 접근합니다.`;

    return {
      mood,
      bias,
      tone,
      summary: compactPanelText(report?.marketReadThrough || report?.sessionBrief || report?.llmComment, loading ? '장후 시장 요약을 불러오는 중입니다.' : '장후 시장 흐름을 종목 판단에 연결합니다.', 116),
      stockImpact,
      action,
      gainerText,
      loserText,
      storageLabel: report?.storage?.cached ? 'DB 저장본 재사용' : report?.storage?.saved ? 'DB 저장' : loading ? '저장본 확인 중' : '리포트 확인',
      basisDate: report?.basisDate || report?.marketDashboard?.basisDate || ''
    };
  }, [ai, stock?.name]);

  const stockPanelConsensus = useMemo(() => {
    const consensus = ai?.ollamaInsights?.crossFeatureConsensus || null;
    const status = resolveOllamaStatus(ai);
    if (consensus) {
      return {
        ...consensus,
        headline: compactPanelText(consensus.headline, '상담·뉴스·장후 흐름을 함께 확인합니다.', 92),
        summary: compactPanelText(consensus.summary, '세 기능의 방향이 같은지 확인합니다.', 108),
        nextAction: compactPanelText(consensus.nextAction, '다음 종가와 거래량을 확인합니다.', 104),
        signals: Array.isArray(consensus.signals) ? consensus.signals.slice(0, 3) : []
      };
    }
    if (status === 'loading') {
      return {
        title: '상담·뉴스·장후 종합 확인',
        agreement: '계산 중',
        tone: 'neutral',
        headline: 'Ollama가 세 기능의 방향을 맞춰 보는 중입니다.',
        summary: '상담 의견, 뉴스 확률, 장후 리포트가 붙으면 서로 일치하는지 표시합니다.',
        nextAction: '결과가 붙기 전에는 20일선과 거래량을 먼저 확인합니다.',
        caution: '계산 중에는 단일 뉴스 제목만 보고 판단하지 않습니다.',
        signals: [
          { label: '상담', state: '계산 중', tone: 'neutral' },
          { label: '뉴스', state: '계산 중', tone: 'neutral' },
          { label: '장후', state: ai?.marketReport ? '장후 반영' : '확인 중', tone: 'neutral' }
        ]
      };
    }
    if (isOllamaDelayed(status)) {
      return {
        title: '상담·뉴스·장후 종합 확인',
        agreement: '지연 중',
        tone: 'mixed',
        headline: 'Ollama 응답이 늦어 기본 근거를 먼저 보여줍니다.',
        summary: '차트와 장후 저장본은 계속 사용할 수 있고, 로컬 LLM 결과가 도착하면 자동으로 바뀝니다.',
        nextAction: '기다리는 동안 현재가, 20일선, 거래량, 뉴스 원문을 먼저 확인합니다.',
        caution: '지연 상태를 매수·매도 신호로 해석하지 않습니다.',
        signals: [
          { label: '상담', state: '지연 중', tone: 'neutral' },
          { label: '뉴스', state: '지연 중', tone: 'neutral' },
          { label: '장후', state: ai?.marketReport ? '장후 반영' : '확인 중', tone: 'neutral' }
        ]
      };
    }
    return null;
  }, [ai]);

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
  const summaryDates = Array.isArray(summaryArchive?.list) ? summaryArchive.list.slice(0, 6) : [];
  const latestBrief = summaryArchive?.latest || null;
  const handleStockCodeSubmit = async (event) => {
    event.preventDefault();
    const keyword = stockCodeInput.trim();
    if (!keyword) {
      setStockCodeError('검색어를 입력하세요.');
      return;
    }
    setStockCodeError('');
    
    // 6자리 종목코드인 경우 즉시 바로 이동
    const digitCode = keyword.replace(/\D/g, '').slice(0, 6);
    if (/^\d{6}$/.test(digitCode)) {
      if (digitCode !== stock.code) {
        onChangeStock?.(digitCode);
      }
      setActivePanel('none');
      return;
    }

    // 6자리 종목코드가 아닌 경우 백엔드 API 검색 호출
    try {
      setStockCodeError('검색 중...');
      const searchResults = await searchStocks(keyword);
      if (searchResults && searchResults.length > 0) {
        const bestMatch = searchResults[0];
        setStockCodeError('');
        if (bestMatch.code !== stock.code) {
          onChangeStock?.(bestMatch.code);
        }
        setStockCodeInput(bestMatch.name);
        setActivePanel('none');
      } else {
        setStockCodeError('일치하는 종목을 찾지 못했습니다.');
      }
    } catch (e) {
      setStockCodeError('검색 중 오류가 발생했습니다.');
    }
  };

  // 캘린더 그리드 계산 헬퍼
  const calendarDays = useMemo(() => {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const firstDayIndex = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    
    const tempDays = [];
    // 빈 칸 채우기 (첫 주 시작 전 요일)
    for (let i = 0; i < firstDayIndex; i++) {
      tempDays.push(null);
    }
    // 실제 날짜 채우기
    for (let day = 1; day <= totalDays; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      tempDays.push({ day, dateStr });
    }
    return tempDays;
  }, [calendarDate]);

  const handlePrevMonth = () => {
    setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1));
  };

  const handleCalendarDateClick = async (dateStr) => {
    setSelectedBriefDate(dateStr);
    setSelectedBriefLoading(true);
    try {
      const data = await loadSummaryByDate(dateStr);
      setSelectedBriefData(data);
    } catch (error) {
      setSelectedBriefData({
        date: dateStr,
        lines: ["해당 날짜의 브리프 상세 데이터를 백엔드에서 불러오지 못했습니다.", "날짜를 다시 확인하거나 관리자에게 문의하세요."]
      });
    } finally {
      setSelectedBriefLoading(false);
    }
  };

  return (
    <div className={styles.container}>
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

        <form className={styles.quickSearchForm} onSubmit={handleStockCodeSubmit} aria-label="기업 검색">
          <label htmlFor="quick-stock-search">기업 검색</label>
          <input
            id="quick-stock-search"
            value={stockCodeInput}
            placeholder="삼성전자 또는 005930"
            autoComplete="off"
            aria-invalid={Boolean(stockCodeError)}
            aria-describedby={stockCodeError ? 'quick-stock-search-error' : undefined}
            onChange={(event) => {
              setStockCodeInput(event.target.value);
              setStockCodeError('');
            }}
          />
          <button type="submit">검색</button>
          {stockCodeError && <em id="quick-stock-search-error">{stockCodeError}</em>}
        </form>

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
              <div className={clsx(styles.dropdownPanel, styles.dropdownRight)} data-testid="stock-selector-panel" role="listbox" aria-label="기업 목록">
                <div className={styles.stockPanelHeader}>
                  <span>기업 검색</span>
                  <strong>{stock.name} ({stock.code})</strong>
                  <p className={styles.stockSaveNotice}>
                    기업 이름이나 종목코드를 고르면 차트가 바뀝니다. 판단은 아래 AI 카드에서 바로 확인하세요.
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
              className={clsx(styles.actionBtn, activePanel === 'calendar' && styles.actionBtnActive)}
              onClick={() => setActivePanel(activePanel === 'calendar' ? 'none' : 'calendar')}
              data-testid="brief-calendar-button"
              aria-label="브리프 달력"
            >
              <span>▣</span> 브리프 달력 <span className={styles.chevron}>▼</span>
            </button>
            {activePanel === 'calendar' && (
              <div className={clsx(styles.dropdownPanel, styles.dropdownRight)} data-testid="brief-calendar-panel" aria-label="pykrx 브리프 달력">
                <div className={styles.calendarPanelHeader}>
                  <span>pykrx 시장 브리프</span>
                  <div className={styles.calendarMonthSelector}>
                    <button type="button" onClick={handlePrevMonth} className={styles.monthNavBtn}>&lt;</button>
                    <strong>{calendarDate.getFullYear()}년 {calendarDate.getMonth() + 1}월</strong>
                    <button type="button" onClick={handleNextMonth} className={styles.monthNavBtn}>&gt;</button>
                  </div>
                  <p className={styles.calendarNoticeDesc}>
                    날짜를 누르면 백엔드가 pykrx 기준 시장 브리프를 조회합니다. 파란 동그라미는 이미 빠르게 불러올 수 있는 날짜입니다.
                  </p>
                </div>
                {summaryArchiveLoading && <p className={styles.calendarEmpty}>브리프 데이터를 로드하고 있습니다.</p>}
                
                {!summaryArchiveLoading && (
                  <div className={styles.calendarGrid}>
                    {['일', '월', '화', '수', '목', '금', '토'].map((d) => (
                      <div key={d} className={styles.calendarGridHeaderItem}>{d}</div>
                    ))}
                    {calendarDays.map((item, idx) => {
                      if (!item) return <div key={`empty-${idx}`} className={styles.calendarDayEmpty} />;
                      const hasBrief = summaryArchive?.list?.some((b) => b.date === item.dateStr) || (latestBrief?.date === item.dateStr);
                      return (
                        <button
                          type="button"
                          key={item.dateStr}
                          onClick={() => handleCalendarDateClick(item.dateStr)}
                          className={clsx(
                            styles.calendarDayBtn,
                            hasBrief && styles.calendarDayHasBrief,
                            item.dateStr === (latestBrief?.date) && styles.calendarDayToday
                          )}
                          aria-label={`${item.dateStr} 브리프 보기`}
                        >
                          <span>{item.day}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {latestBrief && (
                  <div className={styles.calendarLatestBox}>
                    <b>최근 브리프 요약 ({latestBrief.date})</b>
                    <span>상승 대표: {latestBrief.topGainer || latestBrief.kospiTopGainer || '확인 필요'}</span>
                    <span>하락 대표: {latestBrief.topLoser || latestBrief.kospiTopLoser || '확인 필요'}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

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
          onOpenPortfolio={onOpenPortfolio}
          onRefreshAi={onRefreshAi}
          briefArchive={summaryArchive}
          briefLoading={summaryArchiveLoading}
          onOpenLearningModal={(termName) => {
            setLearningModalOpen(true);
            handleAskAiForTerm(termName);
          }}
          onReloadBrief={() => {
            setSummaryArchiveLoading(true);
            const targetYear = calendarDate.getFullYear();
            const targetMonth = calendarDate.getMonth() + 1;
            loadSummaryArchive(targetYear, targetMonth)
              .then((archive) => setSummaryArchive(archive))
              .catch(() => setSummaryArchive({ latest: null, list: [], source: '불러오기 실패' }))
              .finally(() => setSummaryArchiveLoading(false));
          }}
        />
      </div>

      {/* Hero Stock Info */}
      <div className={styles.heroInfo}>
        <div className={styles.heroCode}>{stock.code}</div>
        <h1 className={styles.heroName}>{stock.name}</h1>
        <div className={clsx(styles.heroRate, parseFloat(stock.changeRate) > 0 ? styles.pos : styles.neg)}>
          {stock.changeRate}
        </div>
      </div>

      {/* 하단 정중앙 세련된 AI로 학습하기 버튼 */}
      <div className={styles.learningFloatingBox}>
        <button
          type="button"
          className={styles.learningFloatingBtn}
          onClick={() => setLearningModalOpen(true)}
          aria-label="AI로 주식 용어 학습하기"
        >
          <span>💡</span> AI로 학습하기
        </button>
      </div>

      {/* AI 주식용어 학습 모달창 포탈 */}
      {learningModalOpen && typeof document !== 'undefined' && createPortal((
        <div className={styles.briefModalLayer} role="presentation" onClick={() => {
          setLearningModalOpen(false);
          setLearningExplanation('');
          setSelectedTerm('');
        }}>
          <section
            className={styles.learningModal}
            role="dialog"
            aria-modal="true"
            aria-label="로컬 AI 주식 용어 학습관"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.briefModalHeader}>
              <div>
                <span>로컬 AI 학습관</span>
                <strong>쉽게 배우는 주식 용어 사전</strong>
              </div>
              <button type="button" onClick={() => {
                setLearningModalOpen(false);
                setLearningExplanation('');
                setSelectedTerm('');
              }} aria-label="학습관 닫기">닫기</button>
            </div>
            <div className={styles.learningModalBody}>
              <p className={styles.learningIntro}>
                이해하기 어려운 주식 용어를 클릭해보세요. 사용자 PC에 연결된 <strong>Ollama AI</strong>가 초보자 눈높이로 뜻과 실제 사용 예시를 정리합니다.
              </p>

              <div className={styles.termButtonGrid}>
                {LEARNING_TERMS.map((term) => (
                  <button
                    type="button"
                    key={term.name}
                    className={clsx(styles.termBubbleBtn, selectedTerm === term.name && styles.termBubbleBtnActive)}
                    onClick={() => handleAskAiForTerm(term.name)}
                  >
                    <strong>{term.name}</strong>
                    <span>({term.desc})</span>
                  </button>
                ))}
              </div>
              
              <div className={styles.learningFooterNotice}>
                ※ 각 용어를 클릭하면 로컬 AI 비서가 즉석 뜻풀이를 제공합니다.
              </div>
            </div>
          </section>
        </div>
      ), document.body)}

      {/* 2차 AI 뜻풀이 모달창 포탈 */}
      {explanationModalOpen && typeof document !== 'undefined' && createPortal((
        <div className={clsx(styles.briefModalLayer, styles.explanationModalLayer)} role="presentation" onClick={() => {
          setExplanationModalOpen(false);
          setLearningExplanation('');
          setSelectedTerm('');
        }}>
          <section
            className={clsx(styles.briefModal, styles.learningExplanationModal)}
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedTerm} AI 설명`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.briefModalHeader}>
              <div>
                <span>Ollama AI 학습 도우미</span>
                <strong>{selectedTerm} 뜻풀이</strong>
              </div>
              <button type="button" onClick={() => {
                setExplanationModalOpen(false);
                setLearningExplanation('');
                setSelectedTerm('');
              }} aria-label="설명 닫기">닫기</button>
            </div>
            <div className={clsx(styles.briefTextBlock, styles.learningExplanationBody)}>
              {loadingTerm ? (
                <div className={styles.learningSpinnerBox}>
                  <div className={styles.spinner} />
                  <span>로컬 AI 비서가 '{selectedTerm}'의 뜻을 분석하여 불러오는 중...</span>
                </div>
              ) : learningExplanation ? (
                <div className={styles.learningSuccessBox}>
                  {parseLearningExplanation(learningExplanation).map((line) => (
                    <article key={`${line.label}-${line.text}`} className={styles.learningExplanationItem}>
                      <b>{line.label}</b>
                      <p>{line.text}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className={styles.learningPlaceholder}>AI 설명을 가져오지 못했습니다.</p>
              )}
            </div>
            <div className={styles.briefModalNote}>
              기준일이나 종목 추천 문구는 빼고, 용어 뜻과 실제 사용 예시만 초보자용으로 정리합니다.
            </div>
          </section>
        </div>
      ), document.body)}

      {/* 캘린더 날짜 클릭 시 오픈되는 시장 브리프 모달창 포탈 */}
      {selectedBriefDate && typeof document !== 'undefined' && createPortal((
        <div className={styles.briefModalLayer} role="presentation" onClick={() => setSelectedBriefDate(null)}>
          <section
            className={styles.briefModal}
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedBriefDate} 시장 브리프 상세`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.briefModalHeader}>
              <div>
                <span>{selectedBriefDate} 시장 리포트</span>
                <strong>일간 종합 시장 브리프</strong>
              </div>
              <button type="button" onClick={() => setSelectedBriefDate(null)} aria-label="브리프 닫기">닫기</button>
            </div>
            <pre className={styles.briefTextBlock}>
              {selectedBriefLoading 
                ? 'pykrx 기준 시장 브리프를 불러오는 중입니다...'
                : selectedBriefData?.lines?.length 
                  ? selectedBriefData.lines.join('\n') 
                  : selectedBriefData?.content 
                    || '해당 날짜의 리포트 본문 텍스트가 존재하지 않습니다.'}
            </pre>
            <p className={styles.briefModalNote}>
              이 브리프는 현재 차트 종목과 별개인 전체 시장 순위입니다. {stock?.name || '현재 종목'} 판단은 우측 AI 도움 받기에서 따로 확인합니다.
            </p>
          </section>
        </div>
      ), document.body)}
    </div>
  );
}
