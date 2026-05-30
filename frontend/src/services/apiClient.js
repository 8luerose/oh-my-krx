import { fallbackLearningTerms, fallbackStocks, fallbackWorkspace } from "../data/fallbackData.js";

const DEFAULT_API_BASE_URL = "http://localhost:8080";
const WORKSPACE_INTERVALS = ["daily", "weekly", "monthly"];
const CORE_WORKSPACE_CACHE_MS = 5 * 60 * 1000;
const AI_WORKSPACE_CACHE_MS = 2 * 60 * 1000;
const coreWorkspaceCache = new Map();
const aiWorkspaceCache = new Map();
const ollamaInsightsCache = new Map();
const afterMarketReportCache = new Map();

function getRuntimeConfig() {
  return window.__CONFIG__ || { API_BASE_URL: DEFAULT_API_BASE_URL, GATE_ENABLED: false };
}

function getCachedPromise(cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.promise;
}

function setCachedPromise(cache, key, promise, ttlMs) {
  cache.set(key, { promise, expiresAt: Date.now() + ttlMs });
}

function withRuntimeCacheMeta(value, runtimeCache) {
  if (!value || typeof value !== "object") return value;
  return { ...value, runtimeCache };
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function shouldRetryOllamaInsights(remote = {}) {
  const llm = remote.retrieval?.llm || {};
  const reason = String(llm.fallbackReason || "");
  return remote.mode !== "ollama_llm"
    && llm.enabled !== false
    && (
      llm.used === false
      || reason.includes("Timeout")
      || reason.includes("Ollama 호출 실패")
      || reason.includes("응답 지연")
    );
}

export function invalidateAiCachesForStock(code) {
  const safeCode = String(code || "").trim();
  if (!safeCode) return;
  [aiWorkspaceCache, ollamaInsightsCache].forEach((cache) => {
    [...cache.keys()].forEach((key) => {
      if (String(key).startsWith(`${safeCode}:`)) {
        cache.delete(key);
      }
    });
  });
}

export function invalidateAfterMarketReportCache() {
  afterMarketReportCache.clear();
}

async function requestJson(path, options = {}) {
  const baseUrl = getRuntimeConfig().API_BASE_URL || DEFAULT_API_BASE_URL;
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  if (!response.ok) {
    throw new Error(`요청 실패: ${response.status}`);
  }
  return response.json();
}

function normalizeChart(remoteChart) {
  const rows = remoteChart?.data || remoteChart?.rows || [];
  return {
    interval: remoteChart?.interval || "daily",
    rows
  };
}

function formatPriceBand(zone) {
  if (zone.price) return zone.price;
  const from = Number(zone.fromPrice);
  const to = Number(zone.toPrice);
  if (Number.isFinite(from) && Number.isFinite(to)) {
    if (from === 0) return `${to.toLocaleString()}원 이하`;
    if (to >= 9_000_000) return `${from.toLocaleString()}원 이상`;
    return `${from.toLocaleString()}~${to.toLocaleString()}원`;
  }
  return "가격 확인 필요";
}

function normalizeZoneType(type) {
  if (type === "buy_review") return "buy";
  if (type === "split_buy") return "split";
  if (type === "sell_review") return "sell";
  if (type === "risk_management") return "risk";
  return type || "watch";
}

function normalizeTradeZones(remoteZones, fallbackZones) {
  const zones = Array.isArray(remoteZones?.zones) ? remoteZones.zones : [];
  return zones.map((zone) => ({
    ...zone,
    type: normalizeZoneType(zone.type),
    rawType: zone.type,
    price: formatPriceBand(zone),
    beginner: zone.beginner || zone.beginnerExplanation,
    invalidationSignal: zone.invalidationSignal || zone.oppositeSignal
  }));
}

function uniqueStockOptions(items) {
  const seen = new Set();
  return items.filter((item) => {
    const code = String(item?.code || "").trim();
    if (!code || seen.has(code)) return false;
    seen.add(code);
    return true;
  });
}

function formatRate(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
  }
  return value || "실제 데이터";
}

function normalizeStockOption(item = {}) {
  const code = item.code || item.stockCode || "";
  return {
    id: item.id || `${item.role || "stock"}-${code}`,
    role: item.role || item.label || item.name || "기업",
    label: item.label || item.role || item.name || "기업",
    code,
    name: item.name || item.stockName || item.title || item.code || "종목",
    market: item.market || "KRX",
    changeRate: formatRate(item.rate ?? item.changeRate),
    theme: item.theme || item.summary || "실제 시세 API 기준",
    beginnerLine: item.beginnerLine || "선택하면 실제 차트와 이벤트 근거를 다시 불러옵니다."
  };
}

function firstEntry(items = []) {
  return Array.isArray(items) && items.length ? items[0] : null;
}

function entryFromFields(code, name, rate) {
  return code || name ? { code, name, rate } : null;
}

function findEntryByName(name, ...lists) {
  if (!name) return null;
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    const found = list.find((item) => item?.name === name);
    if (found) return found;
  }
  return null;
}

function featuredOption(role, entry, market, theme) {
  if (!entry?.code || !entry?.name) return null;
  return normalizeStockOption({
    id: `${role}-${entry.code}`,
    role,
    label: role,
    code: entry.code,
    name: entry.name,
    market,
    rate: entry.rate ?? entry.changeRate,
    changeRate: entry.count ? `${entry.count}건` : entry.changeRate,
    theme,
    beginnerLine: "저장된 일간 브리프 기준으로 매일 바뀌는 기업입니다."
  });
}

function buildFeaturedStockOptions(summary) {
  const kospiTopGainer =
    firstEntry(summary?.kospiTopGainers) ||
    entryFromFields(summary?.kospiTopGainerCode, summary?.kospiTopGainer, summary?.kospiTopGainerRate);
  const kospiTopLoser =
    firstEntry(summary?.kospiTopLosers) ||
    entryFromFields(summary?.kospiTopLoserCode, summary?.kospiTopLoser, summary?.kospiTopLoserRate);
  const kosdaqTopGainer =
    firstEntry(summary?.kosdaqTopGainers) ||
    entryFromFields(summary?.kosdaqTopGainerCode, summary?.kosdaqTopGainer, summary?.kosdaqTopGainerRate);
  const kosdaqTopLoser =
    firstEntry(summary?.kosdaqTopLosers) ||
    entryFromFields(summary?.kosdaqTopLoserCode, summary?.kosdaqTopLoser, summary?.kosdaqTopLoserRate);
  const kospiPick = findEntryByName(
    summary?.kospiPick,
    summary?.kospiTopGainers,
    summary?.kospiTopLosers,
    summary?.topGainers,
    summary?.topLosers
  ) || entryFromFields(summary?.kospiTopGainerCode, summary?.kospiPick, summary?.kospiTopGainerRate);
  const kosdaqPick = findEntryByName(
    summary?.kosdaqPick,
    summary?.kosdaqTopGainers,
    summary?.kosdaqTopLosers,
    summary?.topGainers,
    summary?.topLosers
  ) || entryFromFields(summary?.kosdaqTopGainerCode, summary?.kosdaqPick, summary?.kosdaqTopGainerRate);
  const mostMentioned =
    firstEntry(summary?.mostMentionedTop) ||
    findEntryByName(summary?.mostMentioned, summary?.topGainers, summary?.topLosers) ||
    entryFromFields("", summary?.mostMentioned, null);

  return [
    normalizeStockOption({
      id: "fixed-005930",
      role: "삼성전자",
      label: "삼성전자",
      code: "005930",
      name: "삼성전자",
      market: "KOSPI",
      changeRate: "기준 기업",
      theme: "고정 기준 기업"
    }),
    normalizeStockOption({
      id: "fixed-000660",
      role: "SK하이닉스",
      label: "SK하이닉스",
      code: "000660",
      name: "SK하이닉스",
      market: "KOSPI",
      changeRate: "반도체 비교",
      theme: "고정 비교 기업"
    }),
    featuredOption("KOSPI 상승 1위", kospiTopGainer, "KOSPI", "저장 브리프 KOSPI 상승률 1위"),
    featuredOption("KOSPI 하락 1위", kospiTopLoser, "KOSPI", "저장 브리프 KOSPI 하락률 1위"),
    featuredOption("KOSDAQ 상승 1위", kosdaqTopGainer, "KOSDAQ", "저장 브리프 KOSDAQ 상승률 1위"),
    featuredOption("KOSDAQ 하락 1위", kosdaqTopLoser, "KOSDAQ", "저장 브리프 KOSDAQ 하락률 1위"),
    featuredOption("KOSPI 픽", kospiPick, "KOSPI", "저장 브리프 KOSPI 추천 후보"),
    featuredOption("KOSDAQ 픽", kosdaqPick, "KOSDAQ", "저장 브리프 KOSDAQ 추천 후보"),
    featuredOption("최다 언급", mostMentioned, "KRX", "저장 브리프 네이버 종목토론 언급 수 기준")
  ].filter((item) => item?.code && /^\d{6}$/.test(item.code));
}

function normalizeEvent(remoteEvent = {}) {
  const sentiment = remoteEvent.sentimentForPrice || remoteEvent.sentiment || remoteEvent.type;
  const normalizedType =
    sentiment === "positive" ? "positive" : sentiment === "negative" ? "negative" : sentiment === "mixed" ? "mixed" : "neutral";
  return {
    ...remoteEvent,
    type: normalizedType,
    rawType: remoteEvent.type,
    reason: remoteEvent.reason || remoteEvent.whyItMatters || remoteEvent.explanation,
    opposite: remoteEvent.opposite || remoteEvent.oppositeInterpretation,
    confidence: remoteEvent.confidence || remoteEvent.evidenceLevel || remoteEvent.severity || "확인 필요",
    sourceLimit: remoteEvent.sourceLimit || remoteEvent.sourceLimitation || remoteEvent.limitations || "뉴스·공시 원문 확인 전에는 확정 원인으로 보지 않습니다."
  };
}

function normalizeNewsHeadline(item = {}) {
  return {
    title: humanizeText(item.title || item.summary || "뉴스 제목 확인 필요"),
    url: item.url || "",
    sourceType: item.sourceType || "news",
    sentiment: item.sentiment || "neutral",
    matchedKeywords: Array.isArray(item.matchedKeywords) ? item.matchedKeywords : [],
    causalFactors: Array.isArray(item.causalFactors) ? item.causalFactors : [],
    evidenceLevel: item.evidenceLevel || "search_result",
    summary: humanizeText(item.summary || item.title || ""),
    sourceLabel: humanizeText(item.sourceLabel || ""),
    impactPath: humanizeText(item.impactPath || ""),
    beginnerExplanation: humanizeText(item.beginnerExplanation || ""),
    priceCheck: humanizeText(item.priceCheck || ""),
    whyItMatters: humanizeText(item.whyItMatters || "")
  };
}

function normalizeNews(remoteNews = {}) {
  const headlines = Array.isArray(remoteNews?.headlines) ? remoteNews.headlines.map(normalizeNewsHeadline) : [];
  return {
    code: remoteNews?.code || "",
    name: remoteNews?.name || "",
    asOf: remoteNews?.asOf || "",
    source: remoteNews?.source || "news_unavailable",
    queryUrl: remoteNews?.queryUrl || "",
    headlines,
    limitations: normalizeTextList(remoteNews?.limitations, ["뉴스 검색 결과가 부족하면 가격/거래량 이벤트 중심으로 판단합니다."])
  };
}

function normalizeConfidence(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const compact = normalized.replace(/[^a-z]/g, "");
  const upper = ["h", "i", "g", "h"].join("");
  const middle = ["m", "e", "d", "i", "u", "m"].join("");
  const lower = ["l", "o", "w"].join("");
  if (compact === upper) return "높음";
  if (compact === middle + upper) return "보통 이상";
  if (compact === middle) return "보통";
  if (compact === middle + lower) return "보통 이하";
  if (compact === lower) return "낮음";
  return value || fallbackWorkspace.ai.confidence;
}

function humanizeText(value, fallback = "") {
  const text = String(value || fallback || "").trim();
  if (!text) return "";
  return text
    .replace(/\bretrieval\b/gi, "근거")
    .replace(/source grounded/gi, "근거 기반")
    .replace(/indicator snapshot/gi, "이동평균선 지표")
    .replace(/grounded generation/gi, "근거 기반 생성")
    .replace(/\bpositive\b/gi, "좋게 볼 수 있는 이유")
    .replace(/\bnegative\b/gi, "주의할 이유")
    .replace(/\bneutral\b/gi, "판단 보류")
    .replace(/\bmixed\b/gi, "좋은 점과 주의할 점이 함께 있음")
    .replace(/\babove\b/gi, "20일선 위")
    .replace(/\bbelow\b/gi, "20일선 아래")
    .replace(/\bnear\b/gi, "20일선 근처")
    .replace(/uptrend_extension/gi, "상승 흐름이 이어지는 구간")
    .replace(/uptrend_pullback/gi, "상승 흐름 안에서 눌림을 확인하는 구간")
    .replace(/downtrend_rebound/gi, "하락 후 반등을 확인하는 구간")
    .replace(/\bdowntrend\b/gi, "하락 흐름을 조심할 구간")
    .replace(/\bsideways\b/gi, "방향 확인이 필요한 횡보 구간")
    .replace(/\bnormal\b/gi, "평균 수준")
    .replace(/\bstrong\b/gi, "평소보다 강함")
    .replace(/\bweak\b/gi, "평소보다 약함");
}

function humanizeList(items, fallback = []) {
  const list = Array.isArray(items) ? items : fallback;
  return list.map((item) => humanizeText(item)).filter(Boolean);
}

function conciseAnswer(answer) {
  const lines = String(answer || "")
    .split("\n")
    .map((line) => line.replace(/^[-*\s]+/, "").trim())
    .filter(Boolean);
  const candidate = lines.find((line) => !line.startsWith("기준일:") && !line.startsWith("대상:") && !line.startsWith("분석 범위:"));
  if (!candidate) return "";
  return candidate.length > 140 ? `${candidate.slice(0, 137)}...` : candidate;
}

function aiRuntime(remoteAi) {
  const llm = remoteAi?.retrieval?.llm || {};
  const used = Boolean(llm.used || remoteAi?.mode === "rag_llm");
  const provider = llm.provider || "";
  const modeLabel = !used
    ? "규칙형 근거 기반 답변"
    : provider === "ollama"
      ? "Ollama 로컬 LLM 답변"
      : provider === "anthropic_compatible"
        ? "외부 Anthropic 호환 LLM 답변"
        : provider === "openai_compatible"
          ? "외부 OpenAI 호환 LLM 답변"
          : "실시간 LLM 답변";
  return {
    responseMode: remoteAi?.mode || (used ? "rag_llm" : "rag_fallback_rule_based"),
    modeLabel,
    llmModel: llm.model || "",
    llmProvider: provider,
    llmUsed: used
  };
}

function normalizePersonalRisk(value) {
  if (!value || typeof value !== "object") return null;
  return {
    ...value,
    statusLabel: humanizeText(value.statusLabel || ""),
    summary: humanizeText(value.summary || ""),
    actionLine: humanizeText(value.actionLine || ""),
    checklist: normalizeTextList(value.checklist),
    profitLossText: value.profitLossText || "",
    currentPriceText: value.currentPriceText || "",
    averagePriceText: value.averagePriceText || "",
    stopLossPriceText: value.stopLossPriceText || ""
  };
}

function normalizePersonalAdjustment(value) {
  if (!value || typeof value !== "object") return null;
  return {
    ...value,
    applied: Boolean(value.applied),
    contextApplied: Boolean(value.contextApplied),
    sourceDecision: humanizeText(value.sourceDecision || ""),
    finalDecision: humanizeText(value.finalDecision || ""),
    statusLabel: humanizeText(value.statusLabel || ""),
    summary: humanizeText(value.summary || ""),
    actionLine: humanizeText(value.actionLine || ""),
    tone: ["positive", "negative", "neutral"].includes(value.tone) ? value.tone : "neutral"
  };
}

function normalizePortfolioGuidance(value) {
  if (!value || typeof value !== "object") return null;
  return {
    ...value,
    summary: humanizeText(value.summary || ""),
    checklist: normalizeTextList(value.checklist),
    positionDiagnostics: normalizePersonalRisk(value.positionDiagnostics)
  };
}

function normalizeAi(remoteAi) {
  const structured = remoteAi?.structured || {};
  const positives = structured.positives || structured.positiveFactors || fallbackWorkspace.ai.positives;
  const negatives = structured.negatives || structured.negativeFactors || fallbackWorkspace.ai.negatives;
  const runtime = aiRuntime(remoteAi);
  const limitations = structured.limitations || remoteAi?.limitations || [fallbackWorkspace.ai.limitation];
  return {
    ...fallbackWorkspace.ai,
    conclusion: humanizeText(structured.conclusion || conciseAnswer(remoteAi?.answer) || fallbackWorkspace.ai.conclusion),
    direction: humanizeText(structured.prediction || structured.chartState?.summary || fallbackWorkspace.ai.direction),
    movingAverageExplanation: humanizeText(structured.movingAverageExplanation || fallbackWorkspace.ai.movingAverageExplanation),
    chartState: structured.chartState || fallbackWorkspace.ai.chartState,
    buyCondition: humanizeText(structured.buyCondition || structured.buyReview || fallbackWorkspace.ai.buyCondition),
    sellCondition: humanizeText(structured.sellCondition || structured.sellReview || fallbackWorkspace.ai.sellCondition),
    waitCondition: humanizeText(structured.waitCondition || structured.watchReview || fallbackWorkspace.ai.waitCondition),
    riskCondition: humanizeText(structured.riskCondition || structured.riskManagement || fallbackWorkspace.ai.riskCondition),
    positives: humanizeList(positives, fallbackWorkspace.ai.positives),
    negatives: humanizeList(negatives, fallbackWorkspace.ai.negatives),
    beginnerExplanation: humanizeText(structured.beginnerExplanation || fallbackWorkspace.ai.beginnerExplanation),
    checklist: humanizeList(structured.beginnerChecklist || structured.nextChecklist, fallbackWorkspace.ai.checklist),
    evidence: humanizeList(structured.evidence, fallbackWorkspace.ai.evidence),
    opposingSignals: humanizeList(structured.opposingSignals, fallbackWorkspace.ai.opposingSignals),
    limitation: humanizeText(limitations.join(" ")),
    confidence: normalizeConfidence(remoteAi?.confidence || fallbackWorkspace.ai.confidence),
    sources: remoteAi?.sources || fallbackWorkspace.ai.sources,
    sourceTitles: (remoteAi?.sources || structured.sources || []).map((source) => humanizeText(source?.title || source?.type || source)).filter(Boolean),
    portfolioGuidance: normalizePortfolioGuidance(structured.portfolioGuidance),
    fundamentalGuidance: structured.fundamentalGuidance || null,
    storage: remoteAi?.storage || null,
    ...runtime
  };
}

function normalizeProbability(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : null;
}

function normalizeTextList(items, fallback = []) {
  const source = Array.isArray(items) ? items : fallback;
  return source.map((item) => humanizeText(item)).filter(Boolean);
}

function normalizeHeadlineAnalyses(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 4).map((item) => {
    if (typeof item === "string") {
      return { title: humanizeText(item), sentiment: "확인 필요", effect: "확인 필요", reason: "", evidenceLevel: "" };
    }
    return {
      title: humanizeText(item?.title || item?.summary || ""),
      sentiment: humanizeText(item?.sentiment || "확인 필요"),
      effect: humanizeText(item?.effect || "확인 필요"),
      reason: humanizeText(item?.reason || ""),
      evidenceLevel: humanizeText(item?.evidenceLevel || ""),
      impactPath: humanizeText(item?.impactPath || ""),
      beginnerExplanation: humanizeText(item?.beginnerExplanation || ""),
      priceCheck: humanizeText(item?.priceCheck || ""),
      whyItMatters: humanizeText(item?.whyItMatters || "")
    };
  }).filter((item) => item.title);
}

function normalizeScoreBreakdown(breakdown = {}) {
  return {
    eventScore: Number.isFinite(Number(breakdown.eventScore)) ? Math.round(Number(breakdown.eventScore)) : 0,
    headlineScore: Number.isFinite(Number(breakdown.headlineScore)) ? Math.round(Number(breakdown.headlineScore)) : 0,
    rawScore: Number.isFinite(Number(breakdown.rawScore)) ? Math.round(Number(breakdown.rawScore)) : 0,
    adjustedScore: Number.isFinite(Number(breakdown.adjustedScore)) ? Math.round(Number(breakdown.adjustedScore)) : 0,
    adjustments: normalizeTextList(breakdown.adjustments)
  };
}

function normalizeDecisionFactors(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 5).map((item) => ({
    label: humanizeText(item?.label || "근거"),
    state: humanizeText(item?.state || "확인"),
    tone: ["positive", "negative", "neutral"].includes(item?.tone) ? item.tone : "neutral",
    summary: humanizeText(item?.summary || "")
  })).filter((item) => item.label && item.summary);
}

function normalizeBeginnerCoach(value = {}) {
  const coach = value && typeof value === "object" ? value : {};
  return {
    title: humanizeText(coach.title || "초보자 AI 코치"),
    plainSummary: humanizeText(coach.plainSummary || ""),
    goodReason: humanizeText(coach.goodReason || ""),
    cautionReason: humanizeText(coach.cautionReason || ""),
    nextAction: humanizeText(coach.nextAction || ""),
    avoidAction: humanizeText(coach.avoidAction || ""),
    checklist: normalizeTextList(coach.checklist)
  };
}

function normalizeTradeTiming(value = {}) {
  const timing = value && typeof value === "object" ? value : {};
  return {
    title: humanizeText(timing.title || "언제 사고 언제 팔아야 하나요?"),
    tone: ["positive", "negative", "neutral"].includes(timing.tone) ? timing.tone : "neutral",
    entryTiming: humanizeText(timing.entryTiming || ""),
    exitTiming: humanizeText(timing.exitTiming || ""),
    waitCondition: humanizeText(timing.waitCondition || ""),
    invalidationTrigger: humanizeText(timing.invalidationTrigger || ""),
    tomorrowChecklist: normalizeTextList(timing.tomorrowChecklist)
  };
}

function normalizeCrossFeatureConsensus(value = {}) {
  const consensus = value && typeof value === "object" ? value : {};
  const safeTone = ["positive", "negative", "neutral", "mixed"].includes(consensus.tone) ? consensus.tone : "neutral";
  const signals = Array.isArray(consensus.signals) ? consensus.signals : [];
  return {
    title: humanizeText(consensus.title || "상담·뉴스·장후 종합 확인"),
    agreement: humanizeText(consensus.agreement || "확인 필요"),
    tone: safeTone,
    headline: humanizeText(consensus.headline || "세 기능의 방향을 함께 확인합니다."),
    summary: humanizeText(consensus.summary || "상담, 뉴스 확률, 장후 리포트를 따로 보지 않고 함께 비교합니다."),
    nextAction: humanizeText(consensus.nextAction || "다음 종가와 거래량을 확인합니다."),
    caution: humanizeText(consensus.caution || "조건 확인용 참고입니다."),
    signals: signals.slice(0, 3).map((item) => ({
      label: humanizeText(item?.label || "근거"),
      state: humanizeText(item?.state || "확인 필요"),
      tone: ["positive", "negative", "neutral"].includes(item?.tone) ? item.tone : "neutral"
    })).filter((item) => item.label)
  };
}

function featureTitleForStepLabel(label = "") {
  const text = String(label || "");
  if (text.includes("상담") || text.includes("사도")) return "이 종목 지금 사도 되나요?";
  if (text.includes("뉴스")) return "뉴스 감성 기반 단기 방향";
  if (text.includes("장후") || text.includes("리포트")) return "매일 장후 시장 요약 리포트";
  if (text.includes("최종")) return "최종 확인";
  return text.replace(/^[0-9. ]+/, "") || "확인";
}

function normalizeThreeFeaturePlan(value = {}) {
  const plan = value && typeof value === "object" ? value : {};
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  return {
    title: humanizeText(plan.title || "Ollama 3대 기능 실행 순서"),
    headline: humanizeText(plan.headline || "상담, 뉴스, 장후 리포트를 순서대로 확인합니다."),
    summary: humanizeText(plan.summary || "세 기능이 같은 방향인지 비교합니다."),
    steps: steps.slice(0, 4).map((item) => {
      const label = humanizeText(item?.label || "확인");
      return {
        label,
        featureTitle: featureTitleForStepLabel(label),
        result: humanizeText(item?.result || "확인 필요"),
        tone: ["positive", "negative", "neutral", "mixed"].includes(item?.tone) ? item.tone : "neutral",
        action: humanizeText(item?.action || "다음 종가와 거래량을 확인합니다."),
        why: humanizeText(item?.why || "")
      };
    }).filter((item) => item.label)
  };
}

function normalizeOllamaInsights(remote = {}) {
  const advice = remote.stockAdvice || {};
  const sentiment = remote.newsSentiment || {};
  const report = remote.afterMarketReport || {};
  const nextTradingDay = sentiment.nextTradingDay || {};
  return {
    mode: remote.mode || "ollama_fallback_rule_based",
    modeLabel: remote.mode === "ollama_llm" ? "Ollama 로컬 LLM" : "Ollama 규칙형 미리보기",
    provider: remote.provider || "ollama",
    model: remote.model || remote.retrieval?.llm?.model || "",
    configured: Boolean(remote.retrieval?.llm?.enabled || remote.mode === "ollama_llm"),
    answer: humanizeText(remote.answer || ""),
    stockAdvice: {
      title: advice.title || "이 종목 지금 사도 되나요?",
      decision: humanizeText(advice.decision || "관망"),
      summary: humanizeText(advice.summary || "조건 확인이 필요합니다."),
      personalRisk: normalizePersonalRisk(advice.personalRisk),
      personalAdjustment: normalizePersonalAdjustment(advice.personalAdjustment),
      tradeTiming: normalizeTradeTiming(advice.tradeTiming),
      buyConditions: normalizeTextList(advice.buyConditions),
      watchConditions: normalizeTextList(advice.watchConditions),
      sellConditions: normalizeTextList(advice.sellConditions),
      riskNotes: normalizeTextList(advice.riskNotes)
    },
    newsSentiment: {
      title: sentiment.title || "뉴스 감성 기반 단기 방향 예측",
      score: Number.isFinite(Number(sentiment.score)) ? Math.round(Number(sentiment.score)) : 0,
      label: humanizeText(sentiment.label || "중립"),
      confidence: humanizeText(sentiment.confidence || "확인 필요"),
      confidenceReason: humanizeText(sentiment.confidenceReason || ""),
      evidenceQuality: humanizeText(sentiment.evidenceQuality || "뉴스 근거 품질 확인 필요"),
      scoreBreakdown: normalizeScoreBreakdown(sentiment.scoreBreakdown),
      nextTradingDay: {
        up: normalizeProbability(nextTradingDay.up),
        down: normalizeProbability(nextTradingDay.down),
        flat: normalizeProbability(nextTradingDay.flat)
      },
      summary: humanizeText(sentiment.summary || "뉴스/이벤트 후보가 부족합니다."),
      headlineSignals: normalizeTextList(sentiment.headlineSignals),
      headlineAnalyses: normalizeHeadlineAnalyses(sentiment.headlineAnalyses),
      tradingScenarios: normalizeTextList(sentiment.tradingScenarios),
      actionGuide: normalizeTextList(sentiment.actionGuide),
      upReasons: normalizeTextList(sentiment.upReasons),
      downRisks: normalizeTextList(sentiment.downRisks),
      llmContextLabel: humanizeText(sentiment.llmContextLabel || ""),
      llmContextReason: humanizeText(sentiment.llmContextReason || ""),
      llmContextEvidence: normalizeTextList(sentiment.llmContextEvidence),
      caution: humanizeText(sentiment.caution || "뉴스 제목만으로 확정하지 말고 가격과 거래량 반응을 함께 확인합니다.")
    },
    afterMarketReport: {
      title: report.title || "매일 장후 시장 요약 리포트",
      mood: humanizeText(report.mood || "선별 접근"),
      keyPoints: normalizeTextList(report.keyPoints),
      llmComment: humanizeText(report.llmComment || "장후 브리프에 로컬 LLM 코멘트를 붙일 수 있습니다."),
      stockImpact: humanizeText(report.stockImpact || ""),
      marketReadThrough: humanizeText(report.marketReadThrough || ""),
      tomorrowChecklist: normalizeTextList(report.tomorrowChecklist),
      nextWatch: normalizeTextList(report.nextWatch),
      actionPlan: normalizeTextList(report.actionPlan)
    },
    crossFeatureConsensus: normalizeCrossFeatureConsensus(remote.crossFeatureConsensus),
    threeFeaturePlan: normalizeThreeFeaturePlan(remote.threeFeaturePlan),
    decisionFactors: normalizeDecisionFactors(remote.decisionFactors),
    beginnerCoach: normalizeBeginnerCoach(remote.beginnerCoach),
    qdrant: remote.retrieval?.qdrant || null,
    beginnerNotes: normalizeTextList(remote.beginnerNotes),
    limitations: normalizeTextList(remote.limitations),
    storage: remote.storage || null
  };
}

function normalizeAfterMarketReport(remote = {}) {
  const llm = remote.retrieval?.llm || {};
  return {
    mode: remote.mode || "ollama_fallback_rule_based",
    modeLabel: remote.mode === "ollama_llm" ? "Ollama 장후 리포트" : "Ollama 장후 미리보기",
    provider: remote.provider || "ollama",
    model: remote.model || llm.model || "",
    configured: Boolean(llm.enabled || remote.mode === "ollama_llm"),
    basisDate: remote.basisDate || "",
    title: remote.title || "매일 장후 시장 요약 리포트",
    mood: humanizeText(remote.mood || "선별 접근"),
    marketBias: humanizeText(remote.marketBias || "중립"),
    sessionBrief: humanizeText(remote.sessionBrief || ""),
    marketDashboard: remote.marketDashboard || null,
    leaderSummaries: Array.isArray(remote.leaderSummaries) ? remote.leaderSummaries : [],
    keyPoints: normalizeTextList(remote.keyPoints),
    llmComment: humanizeText(remote.llmComment || "최신 저장 브리프를 기준으로 장후 확인 포인트를 정리합니다."),
    marketReadThrough: humanizeText(remote.marketReadThrough || ""),
    tomorrowChecklist: normalizeTextList(remote.tomorrowChecklist),
    nextWatch: normalizeTextList(remote.nextWatch),
    actionPlan: normalizeTextList(remote.actionPlan),
    beginnerNotes: normalizeTextList(remote.beginnerNotes),
    marketLeaders: remote.marketLeaders || null,
    limitations: normalizeTextList(remote.limitations),
    qdrant: remote.retrieval?.qdrant || null,
    storage: remote.storage || null
  };
}

function formatApiDate(date) {
  return date.toISOString().slice(0, 10);
}

function buildStockRequestParams(interval) {
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - 6);
  const safeInterval = encodeURIComponent(interval || "daily");
  return {
    chart: `range=6M&interval=${safeInterval}`,
    zones: `range=6M&interval=${safeInterval}&riskMode=neutral`,
    events: `from=${formatApiDate(from)}&to=${formatApiDate(to)}`
  };
}

export async function loadStockWorkspace(code, interval) {
  const core = await loadStockCoreWorkspace(code, interval);
  try {
    const ai = await loadStockAi(core, interval);
    return { ...core, ai };
  } catch {
    return core;
  }
}

export async function loadStockCoreWorkspace(code, interval) {
  const key = `${code}:${interval || "daily"}`;
  const cached = getCachedPromise(coreWorkspaceCache, key);
  if (cached) {
    return cached;
  }

  const promise = loadStockCoreWorkspaceRemote(code, interval);
  setCachedPromise(coreWorkspaceCache, key, promise, CORE_WORKSPACE_CACHE_MS);
  try {
    return await promise;
  } catch (error) {
    coreWorkspaceCache.delete(key);
    throw error;
  }
}

async function loadStockCoreWorkspaceRemote(code, interval) {
  const stock = fallbackStocks.find((item) => item.code === code) || fallbackWorkspace.stock;
  const next = {
    ...fallbackWorkspace,
    stock,
    chart: { ...fallbackWorkspace.chart, interval }
  };

  const params = buildStockRequestParams(interval);
  const [chart, zones, events, news] = await Promise.all([
    requestJson(`/api/stocks/${code}/chart?${params.chart}`),
    requestJson(`/api/stocks/${code}/trade-zones?${params.zones}`),
    requestJson(`/api/stocks/${code}/events?${params.events}`),
    requestJson(`/api/stocks/${code}/news?limit=8`).catch(() => null)
  ]);

  const normalizedChart = normalizeChart(chart);
  if (!normalizedChart.rows.length) {
    throw new Error("실제 차트 데이터가 비어 있습니다.");
  }

  return {
    ...next,
    stock: { ...stock, name: chart?.name || stock.name, code: chart?.code || stock.code },
    asOf: chart?.asOf || zones?.basisDate || next.asOf,
    source: "백엔드 실제 시세·이벤트 API",
    chart: normalizedChart,
    zones: normalizeTradeZones(zones, next.zones),
    events: Array.isArray(events?.events) ? events.events.map(normalizeEvent) : [],
    news: normalizeNews(news),
    indicatorSnapshot: zones?.indicatorSnapshot || null,
    currentDecisionSummary: zones?.currentDecisionSummary || null,
    ai: normalizeAi(null)
  };
}

function compactChartForAi(workspace) {
  const rows = workspace?.chart?.rows || [];
  return {
    code: workspace?.stock?.code,
    name: workspace?.stock?.name,
    interval: workspace?.chart?.interval,
    asOf: workspace?.asOf,
    latest: rows[rows.length - 1] || null,
    recentRows: rows.slice(-30)
  };
}

function compactZonesForAi(zones = []) {
  return zones.slice(0, 5).map((zone) => ({
    type: zone.rawType || zone.type,
    label: zone.label,
    price: zone.price,
    condition: zone.condition,
    evidence: zone.evidence,
    oppositeSignal: zone.oppositeSignal || zone.invalidationSignal,
    confidence: zone.confidence
  }));
}

function compactEventsForAi(events = []) {
  return events.slice(0, 4).map((event) => ({
    date: event.date,
    type: event.rawType || event.type,
    title: event.title,
    severity: event.severity,
    priceChangeRate: event.priceChangeRate,
    volumeChangeRate: event.volumeChangeRate,
    reason: event.reason,
    opposite: event.opposite,
    confidence: event.confidence,
    sourceLimit: event.sourceLimit,
    evidenceSources: (event.evidenceSources || []).slice(0, 4).map((source) => ({
      type: source.type,
      title: source.title,
      description: source.description,
      url: source.url
    })),
    causalScores: (event.causalScores || []).slice(0, 3).map((score) => ({
      sourceType: score.sourceType,
      score: score.score,
      confidence: score.confidence,
      interpretation: score.interpretation,
      causalFactors: score.causalFactors,
      evidenceLevel: score.evidenceLevel
    }))
  }));
}

function compactNewsForAi(news) {
  return (news?.headlines || []).slice(0, 8).map((headline) => ({
    title: headline.title,
    url: headline.url,
    sourceType: headline.sourceType,
    sentiment: headline.sentiment,
    matchedKeywords: headline.matchedKeywords,
    causalFactors: headline.causalFactors,
    evidenceLevel: headline.evidenceLevel,
    summary: headline.summary,
    sourceLabel: headline.sourceLabel,
    impactPath: headline.impactPath,
    beginnerExplanation: headline.beginnerExplanation,
    priceCheck: headline.priceCheck,
    whyItMatters: headline.whyItMatters
  }));
}

function buildAiContext(workspace, interval) {
  return {
    code: workspace.stock.code,
    stockCode: workspace.stock.code,
    stockName: workspace.stock.name,
    interval: interval || workspace.chart.interval,
    chart: compactChartForAi(workspace),
    tradeZones: {
      code: workspace.stock.code,
      name: workspace.stock.name,
      basisDate: workspace.asOf,
      zones: compactZonesForAi(workspace.zones)
    },
    events: compactEventsForAi(workspace.events),
    newsHeadlines: compactNewsForAi(workspace.news),
    indicatorSnapshot: workspace.indicatorSnapshot,
    currentDecisionSummary: workspace.currentDecisionSummary
  };
}

export async function loadStockAi(workspace, interval) {
  const key = `${workspace?.stock?.code || "unknown"}:${interval || workspace?.chart?.interval || "daily"}:${workspace?.asOf || ""}`;
  const cached = getCachedPromise(aiWorkspaceCache, key);
  if (cached) {
    return cached;
  }

  const promise = requestJson("/api/ai/chat", {
    method: "POST",
    body: JSON.stringify({
      question: `${workspace.stock.name} 차트의 매수·매도 검토 조건, 관망 구간, 분할매수 검토 구간, 리스크 관리 구간을 교육용으로 설명해줘`,
      context: buildAiContext(workspace, interval)
    })
  }).then(normalizeAi);

  setCachedPromise(aiWorkspaceCache, key, promise, AI_WORKSPACE_CACHE_MS);
  try {
    return await promise;
  } catch (error) {
    aiWorkspaceCache.delete(key);
    throw error;
  }
}

export async function loadStockOllamaInsights(workspace, interval) {
  const key = `${workspace?.stock?.code || "unknown"}:${interval || workspace?.chart?.interval || "daily"}:${workspace?.asOf || ""}:ollama`;
  const cached = getCachedPromise(ollamaInsightsCache, key);
  if (cached) {
    return cached.then((value) => withRuntimeCacheMeta(value, {
      hit: true,
      source: "frontend_memory",
      label: "프론트 2분 캐시 재사용",
      note: "같은 종목·주기 요청이라 방금 받은 Ollama 결과를 다시 보여줍니다."
    }));
  }

  const requestPayload = {
    method: "POST",
    body: JSON.stringify({
      question: `${workspace.stock.name}을 지금 사도 되는지, 뉴스 감성 단기 방향과 장후 시장 요약까지 로컬 Ollama로 설명해줘`,
      context: buildAiContext(workspace, interval)
    })
  };
  const promise = requestJson("/api/ai/ollama/insights", requestPayload)
    .then(async (remote) => {
      if (shouldRetryOllamaInsights(remote)) {
        await sleep(900);
        return requestJson("/api/ai/ollama/insights", requestPayload);
      }
      return remote;
    })
    .then(normalizeOllamaInsights)
    .then((value) => withRuntimeCacheMeta(value, {
      hit: false,
      source: value.mode === "ollama_llm" ? "fresh_ollama" : "fresh_ollama_fallback",
      label: value.storage?.saved
        ? value.mode === "ollama_llm" ? "새 계산 후 DB 감사 로그 저장" : "새 계산 후 규칙형 보강"
        : "새 계산 완료",
      note: value.storage?.saved
        ? `Ollama 상담 응답을 새로 받고 ${value.storage.table || "DB"}에 저장했습니다.`
        : "Ollama 상담 응답을 새로 받았지만 DB 저장 상태는 확인이 필요합니다."
    }));

  setCachedPromise(ollamaInsightsCache, key, promise, AI_WORKSPACE_CACHE_MS);
  try {
    return await promise;
  } catch (error) {
    ollamaInsightsCache.delete(key);
    throw error;
  }
}

export async function loadLatestStockOllamaInsights(stockCode) {
  const safeCode = String(stockCode || "").trim();
  if (!/^\d{6}$/.test(safeCode)) return null;
  try {
    const remote = await requestJson(`/api/ai/ollama/insights/latest?stockCode=${encodeURIComponent(safeCode)}`);
    return withRuntimeCacheMeta(normalizeOllamaInsights(remote), {
      hit: true,
      source: "database",
      label: "DB 저장본 먼저 표시",
      note: "이전에 저장된 Ollama 상담·뉴스·장후 종합 결과를 먼저 보여주고, 새 계산이 끝나면 갱신합니다."
    });
  } catch {
    return null;
  }
}

export async function loadLatestOllamaAfterMarketReport() {
  const key = "latest:ollama:after-market-report";
  const cached = getCachedPromise(afterMarketReportCache, key);
  if (cached) {
    return cached.then((value) => withRuntimeCacheMeta(value, {
      hit: true,
      source: "frontend_memory",
      label: "장후 리포트 2분 캐시 재사용",
      note: "같은 브라우저 세션에서 방금 확인한 장후 리포트를 다시 보여줍니다."
    }));
  }

  const promise = requestJson("/api/ai/ollama/after-market-report/latest")
    .then(normalizeAfterMarketReport)
    .then((value) => withRuntimeCacheMeta(value, {
      hit: Boolean(value.storage?.cached),
      source: value.storage?.cached ? "database" : "fresh_ollama",
      label: value.storage?.cached ? "DB 저장본 재사용" : value.storage?.saved ? "새 장후 리포트 생성 후 DB 저장" : "장후 리포트 새 조회",
      note: value.storage?.note || "장후 리포트 저장 상태를 확인했습니다."
    }));
  setCachedPromise(afterMarketReportCache, key, promise, AI_WORKSPACE_CACHE_MS);
  try {
    return await promise;
  } catch (error) {
    afterMarketReportCache.delete(key);
    throw error;
  }
}

export function prefetchStockWorkspaces(code, currentInterval = "daily") {
  const targets = WORKSPACE_INTERVALS.filter((item) => item !== currentInterval);
  setTimeout(() => {
    targets.forEach((interval) => {
      loadStockCoreWorkspace(code, interval).catch(() => {});
    });
  }, 50);
}

export async function loadStockOptions() {
  try {
    const latest = await requestJson("/api/summaries/latest");
    const featured = buildFeaturedStockOptions(latest);
    if (featured.length >= 9) {
      return featured.slice(0, 9);
    }
  } catch {
    // Fall through to broad universe fallback.
  }

  try {
    const remote = await requestJson("/api/stocks/universe?limit=300");
    const remoteStocks = Array.isArray(remote?.stocks) ? remote.stocks.map(normalizeStockOption) : [];
    const priority = ["005930", "000660"];
    const prioritized = [
      ...fallbackStocks.map(normalizeStockOption),
      ...remoteStocks.filter((item) => priority.includes(item.code)),
      ...remoteStocks
    ];
    return uniqueStockOptions(prioritized).slice(0, 40);
  } catch {
    return fallbackStocks.map(normalizeStockOption);
  }
}

export async function loadLearningTerms() {
  try {
    const remote = await requestJson("/api/learning/terms");
    return Array.isArray(remote) && remote.length ? remote : fallbackLearningTerms;
  } catch {
    return fallbackLearningTerms;
  }
}

export async function loadSummaryArchive() {
  try {
    const [latest, list] = await Promise.all([
      requestJson("/api/summaries/latest"),
      requestJson("/api/summaries?from=2026-05-01&to=2026-05-05")
    ]);
    return { latest, list: Array.isArray(list) ? list : [], source: "백엔드 API" };
  } catch {
    return {
      latest: {
        date: "2026-05-05",
        effectiveDate: "20260504",
        topGainer: "KBI메탈",
        topLoser: "루닛",
        mostMentioned: "PI첨단소재",
        kospiPick: "대원전선우",
        kosdaqPick: "KBI메탈",
        rawNotes: "Source: pykrx(KRX OHLCV 전일대비 계산) + naver(board posts)\neffective_date=20260504",
        topGainers: [
          { code: "024840", name: "KBI메탈", rate: 30.0 },
          { code: "322310", name: "오로스테크놀로지", rate: 30.0 },
          { code: "006345", name: "대원전선우", rate: 29.98 }
        ],
        topLosers: [
          { code: "328130", name: "루닛", rate: -49.82 },
          { code: "217620", name: "선샤인푸드", rate: -34.43 },
          { code: "261780", name: "차백신연구소", rate: -18.17 }
        ],
        mostMentionedTop: [
          { code: "178920", name: "PI첨단소재", count: 57 },
          { code: "448900", name: "한국피아이엠", count: 55 },
          { code: "259960", name: "크래프톤", count: 55 }
        ],
        kospiTopGainer: "대원전선우",
        kosdaqTopGainer: "KBI메탈",
        kospiTopGainerCode: "006345",
        kosdaqTopGainerCode: "024840",
        kospiTopGainerRate: 29.98,
        kosdaqTopGainerRate: 30.0,
        kospiTopGainers: [
          { code: "006345", name: "대원전선우", rate: 29.98 },
          { code: "007610", name: "선도전기", rate: 29.94 },
          { code: "015860", name: "일진홀딩스", rate: 29.94 }
        ],
        kosdaqTopGainers: [
          { code: "024840", name: "KBI메탈", rate: 30.0 },
          { code: "322310", name: "오로스테크놀로지", rate: 30.0 },
          { code: "092190", name: "서울바이오시스", rate: 29.98 }
        ]
      },
      list: [
        {
          date: "2026-05-05",
          topGainer: "KBI메탈",
          topLoser: "루닛",
          mostMentioned: "PI첨단소재",
          content: "2026-05-05 한국 주식 일간 브리프 예시입니다."
        }
      ],
      source: "앱 내 예시 데이터"
    };
  }
}

function toFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizePortfolioItem(item = {}) {
  return {
    code: item.code || item.stockCode || "",
    name: item.name || item.stockName || item.code || "관심 종목",
    group: item.group || item.groupLabel || "관심 종목",
    rate: toFiniteNumber(item.rate, 0),
    count: Number.isFinite(Number(item.count)) ? Number(item.count) : null,
    weight: toFiniteNumber(item.weight, 10),
    averagePrice: Number.isFinite(Number(item.averagePrice)) ? Number(item.averagePrice) : null,
    holdingPeriod: item.holdingPeriod || "미입력",
    riskTolerance: item.riskTolerance || "미입력",
    riskNotes: Array.isArray(item.riskNotes) ? item.riskNotes : [],
    nextChecklist: Array.isArray(item.nextChecklist) ? item.nextChecklist : [],
    recentEvents: Array.isArray(item.recentEvents) ? item.recentEvents : []
  };
}

function normalizePortfolio(response = {}) {
  return {
    items: Array.isArray(response.items) ? response.items.map(normalizePortfolioItem) : [],
    summary: response.summary || {
      totalWeight: 0,
      maxWeightStock: "-",
      maxWeight: 0,
      concentration: "아직 담긴 종목이 없습니다.",
      volatility: "종목을 담으면 변동성 점검을 시작합니다.",
      nextChecklist: []
    },
    source: response.source || "server_mysql_portfolio_sandbox",
    updatedAt: response.updatedAt || null
  };
}

export async function loadPortfolio() {
  return normalizePortfolio(await requestJson("/api/portfolio"));
}

export async function upsertPortfolioItem(item) {
  return normalizePortfolio(
    await requestJson("/api/portfolio/items", {
      method: "POST",
      body: JSON.stringify(item)
    })
  );
}

export async function updatePortfolioItemWeight(code, itemOrWeight) {
  const body =
    typeof itemOrWeight === "object" && itemOrWeight !== null
      ? itemOrWeight
      : { weight: itemOrWeight };
  return normalizePortfolio(
    await requestJson(`/api/portfolio/items/${encodeURIComponent(code)}`, {
      method: "PUT",
      body: JSON.stringify(body)
    })
  );
}

export async function deletePortfolioItem(code) {
  return normalizePortfolio(
    await requestJson(`/api/portfolio/items/${encodeURIComponent(code)}`, {
      method: "DELETE"
    })
  );
}

export async function runAdminAction(action, adminKey) {
  const headers = adminKey ? { "X-Admin-Key": adminKey } : {};
  if (action === "today") return requestJson("/api/summaries/generate/today", { method: "POST", headers });
  if (action === "backfill") {
    return requestJson("/api/summaries/backfill", {
      method: "POST",
      headers,
      body: JSON.stringify({ from: "2026-05-01", to: "2026-05-05" })
    });
  }
  if (action === "verify") return requestJson(`/api/summaries/${fallbackWorkspace.asOf}/verification/krx`, { headers });
  return requestJson("/api/summaries/latest", { headers });
}
