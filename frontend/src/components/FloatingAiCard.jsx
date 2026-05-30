import React, { useState } from 'react';
import { Bot, ChevronUp, ChevronDown, CheckCircle2, XCircle, ShieldAlert, Clock3, Database, Info, Cpu, Newspaper, TrendingUp, Lightbulb, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import styles from './FloatingAiCard.module.css';

function marketReportStorageLabel(storage) {
  if (!storage?.saved || storage.table !== 'ai_after_market_reports') return '';
  const date = storage.date ? `${storage.date} · ` : '';
  return `${date}${storage.cached ? 'DB 저장본 재사용' : '생성 후 DB 저장'}`;
}

function marketReportStorageNote(storage) {
  if (!storage?.saved || storage.table !== 'ai_after_market_reports') return '';
  if (storage.cached) return storage.note || '저장된 장후 AI 리포트를 재사용했습니다.';
  const auditId = storage.audit?.id ? `감사 로그 #${storage.audit.id}` : '감사 로그 저장';
  return `${storage.note || '장후 AI 리포트 전체 응답을 DB에 저장했습니다.'} ${auditId}`;
}

function probabilityLabel(value) {
  if (value === null || value === undefined || value === '') return '확인 중';
  const text = String(value).trim();
  return text.includes('%') ? text : `${text}%`;
}

function scoreLabel(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0점';
  return `${number > 0 ? '+' : ''}${Math.round(number)}점`;
}

function effectClass(effect = '') {
  if (effect.includes('상승') || effect.includes('우호')) return styles.effectPositive;
  if (effect.includes('하락') || effect.includes('위험')) return styles.effectNegative;
  if (effect.includes('혼재')) return styles.effectMixed;
  return styles.effectNeutral;
}

function leaderRate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`;
}

function leaderName(entry, fallback) {
  return entry?.name && entry.name !== '-' ? entry.name : fallback;
}

function compactProbabilityPair(nextTradingDay = {}) {
  return `↑${probabilityLabel(nextTradingDay.up)} · ↓${probabilityLabel(nextTradingDay.down)}`;
}

function compactStorageChip(storage) {
  if (!storage?.saved) return '';
  if (storage.table === 'ai_chat_interactions') return storage.id ? `상담 DB #${storage.id}` : '상담 DB 저장';
  if (storage.table === 'ai_after_market_reports') return storage.cached ? '장후 DB 재사용' : '장후 DB 저장';
  return 'DB 저장';
}

function fundamentalStatusLabel(summary, riskNotes = []) {
  const text = [summary, ...(Array.isArray(riskNotes) ? riskNotes : [])].filter(Boolean).join(' ');
  if (!text) return '재무 확인';
  if (/없어|비어|못했습니다|제한|확인 필요|별도로 확인/.test(text)) return '재무 제한';
  return '재무 반영';
}

function ollamaRuntimeLabel(status, hasInsights, runtime) {
  if (runtime?.label) return runtime.label;
  if (status === 'loading') return '새 Ollama 계산 중';
  if (status === 'failed') return '규칙형 근거 유지';
  if (hasInsights) return 'Ollama 응답 반영';
  return 'Ollama 대기';
}

function ollamaRuntimeNote(status, hasInsights, runtime) {
  if (runtime?.note) return runtime.note;
  if (status === 'loading') return '차트와 기본 근거는 먼저 보여주고, 상담·뉴스 방향 답변은 로컬 LLM 응답이 오면 이어 붙입니다.';
  if (status === 'failed') return '로컬 LLM 응답이 지연되어 화면은 규칙형 근거로 유지합니다.';
  if (hasInsights) return '현재 종목의 상담·뉴스 방향·장후 요약을 Ollama 결과로 반영했습니다.';
  return '종목을 선택하면 로컬 Ollama가 상담과 뉴스 방향을 계산합니다.';
}

function reportRuntimeLabel(status, hasReport, runtime, storageLabel) {
  if (runtime?.label) return runtime.label;
  if (storageLabel) return storageLabel;
  if (status === 'loading') return '장후 리포트 확인 중';
  if (status === 'unavailable') return '장후 리포트 지연';
  if (hasReport) return '장후 리포트 준비 완료';
  return '장후 리포트 대기';
}

function reportRuntimeNote(status, hasReport, runtime, storageNote) {
  if (runtime?.note) return runtime.note;
  if (storageNote) return storageNote;
  if (status === 'loading') return '저장된 장후 브리프가 있으면 먼저 재사용하고, 없으면 새 리포트를 준비합니다.';
  if (status === 'unavailable') return '최신 브리프가 없거나 AI 서비스 응답이 지연되었습니다.';
  if (hasReport) return '시장 분위기와 다음 거래일 확인 포인트를 장후 리포트로 정리했습니다.';
  return '장후 리포트는 최신 저장 브리프를 기준으로 연결됩니다.';
}

export default function FloatingAiCard({ ai, events, asOf, onExpandedChange, onRefreshAi }) {
  const [expanded, setExpanded] = useState(false);

  if (!ai) return null;

  const reportStorageLabel = marketReportStorageLabel(ai.marketReport?.storage);
  const reportStorageNote = marketReportStorageNote(ai.marketReport?.storage);
  const insights = ai.ollamaInsights;
  const stockAdvice = insights?.stockAdvice || {};
  const newsSentiment = insights?.newsSentiment || {};
  const nextTradingDay = newsSentiment?.nextTradingDay || {};
  const afterMarketReport = insights?.afterMarketReport || {};
  const beginnerCoach = insights?.beginnerCoach || null;
  const decisionFactors = Array.isArray(insights?.decisionFactors) ? insights.decisionFactors.slice(0, 5) : [];
  const qdrant = insights?.qdrant || ai.marketReport?.qdrant || null;
  const qdrantModeLabel = qdrant?.embeddingUsed
    ? 'Ollama 의미검색'
    : qdrant?.vectorProvider === 'hash'
      ? '해시 검색'
      : '벡터 검색';
  const qdrantLabel = qdrant?.enabled
    ? `Qdrant ${qdrantModeLabel} ${qdrant.retrievedCount || 0}개 · 저장 ${qdrant.storedCount || 0}개`
    : '';
  const insightRuntime = insights?.runtimeCache || null;
  const reportRuntime = ai.marketReport?.runtimeCache || null;
  const ollamaStatus = ai.ollamaInsightsStatus
    || (insights ? 'ready' : ai.aiLayerStatus === 'ollama_failed' ? 'failed' : ai.aiLayerStatus === 'loading' ? 'loading' : 'waiting');
  const marketReportStatus = ai.marketReportStatus || (ai.marketReport ? 'ready' : 'waiting');
  const insightRuntimeLabel = ollamaRuntimeLabel(ollamaStatus, Boolean(insights), insightRuntime);
  const insightRuntimeNote = ollamaRuntimeNote(ollamaStatus, Boolean(insights), insightRuntime);
  const reportRuntimeLabelText = reportRuntimeLabel(marketReportStatus, Boolean(ai.marketReport), reportRuntime, reportStorageLabel);
  const reportRuntimeNoteText = reportRuntimeNote(marketReportStatus, Boolean(ai.marketReport), reportRuntime, reportStorageNote);
  const personalRisk = stockAdvice.personalRisk || ai.portfolioGuidance?.positionDiagnostics || null;
  const personalAdjustment = stockAdvice.personalAdjustment || null;
  const tradeTiming = stockAdvice.tradeTiming || null;
  const visibleHeadlineCount = newsSentiment?.headlineSignals?.length || 0;
  const adviceDecision = stockAdvice.decision || '관망';
  const adviceSummary = stockAdvice.summary || '차트, 재무, 뉴스, 센티멘트를 합쳐 매수·관망·매도 조건을 정리합니다.';
  const sentimentLabel = newsSentiment.label || '뉴스 감성 확인';
  const sentimentConfidence = newsSentiment.confidence || '확인 중';
  const sentimentSummary = newsSentiment.summary || '뉴스 헤드라인이 다음 거래일 가격 방향에 줄 수 있는 영향을 정리합니다.';
  const contextLabel = newsSentiment.llmContextLabel || (insights?.mode === 'ollama_llm' ? 'Ollama 문맥 판단' : '규칙형 점수 우선');
  const contextReason = newsSentiment.llmContextReason || '뉴스 제목과 이벤트를 함께 읽어 문맥상 방향을 보강합니다.';
  const sentimentScore = Number.isFinite(Number(newsSentiment.score))
    ? Number(newsSentiment.score)
    : Number(newsSentiment.scoreBreakdown?.adjustedScore || 0);
  const reportMood = ai.marketReport
    ? [ai.marketReport.mood, ai.marketReport.marketBias].filter(Boolean).join(' · ')
    : afterMarketReport.mood || '장후 리포트 확인 중';
  const reportSummary = ai.marketReport?.llmComment || afterMarketReport.llmComment || '장후 브리프와 시장 분위기 코멘트를 확인합니다.';
  const workflowChips = [
    `1 상담 ${adviceDecision}`,
    insightRuntimeLabel,
    `2 뉴스 ${compactProbabilityPair(nextTradingDay)}`,
    `3 장후 ${ai.marketReport?.mood || afterMarketReport.mood || '확인 중'}`,
    reportRuntimeLabelText,
    compactStorageChip(insights?.storage || ai.storage),
    compactStorageChip(ai.marketReport?.storage),
    qdrant?.enabled ? `Qdrant 근거 ${qdrant.retrievedCount || 0}개` : ''
  ].filter(Boolean);
  const marketDashboard = ai.marketReport?.marketDashboard || null;
  const topGainer = marketDashboard?.topGainer || null;
  const topLoser = marketDashboard?.topLoser || null;
  const hasBeginnerCoach = Boolean(
    beginnerCoach?.plainSummary
    || beginnerCoach?.goodReason
    || beginnerCoach?.cautionReason
    || beginnerCoach?.nextAction
    || beginnerCoach?.avoidAction
  );
  const hasTradeTiming = Boolean(
    tradeTiming?.entryTiming
    || tradeTiming?.exitTiming
    || tradeTiming?.waitCondition
    || tradeTiming?.invalidationTrigger
  );

  return (
    <details
      className={clsx(styles.container, expanded && styles.expanded)}
      aria-label="AI 요약 카드"
      onToggle={(event) => {
        const nextExpanded = event.currentTarget.open;
        setExpanded(nextExpanded);
        onExpandedChange?.(nextExpanded);
      }}
    >
      {/* Minimized View (1-line summary) */}
      <summary
        className={styles.header}
        aria-expanded={expanded}
        aria-controls="floating-ai-card-details"
        aria-label={expanded ? 'AI 요약 접기' : 'AI 요약 펼치기'}
      >
        <div className={styles.iconWrapper}>
          <Bot size={24} className={styles.icon} />
        </div>
        <div className={styles.summaryInfo}>
          <span className={styles.direction}>{ai.direction || '분석 중'}</span>
          <p className={styles.conclusion}>{ai.conclusion || '현재 종목의 주요 흐름을 파악하고 있습니다.'}</p>
          {workflowChips.length > 0 && (
            <div className={styles.miniOllamaStrip} aria-label="Ollama 핵심 인사이트">
              {workflowChips.slice(0, 6).map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          )}
        </div>
        <span className={styles.toggleBtn} aria-hidden="true">
          {expanded ? <ChevronDown /> : <ChevronUp />}
        </span>
      </summary>

      {/* Expanded View (Conditions & News) */}
      <div id="floating-ai-card-details" className={styles.details}>
          <div className={styles.runtimeNotice}>
            <Info size={15} />
            <span>
              {ai.modeLabel || '근거 기반 답변'}{ai.llmModel ? ` · ${ai.llmModel}` : ''}. 조건 확인용이며 평균단가·보유기간·손실허용은 샌드박스에 저장된 값만 반영합니다.
            </span>
            {onRefreshAi && (
              <button
                type="button"
                className={styles.aiRefreshButton}
                onClick={onRefreshAi}
                aria-label="Ollama AI 새로 계산"
              >
                <RefreshCw size={13} aria-hidden="true" />
                새로 계산
              </button>
            )}
          </div>

          {ai.storage && (
            <div className={styles.storageNotice}>
              <Database size={15} />
              <span>
                {ai.storage.saved ? `AI 답변 저장 완료: ${ai.storage.table}` : 'AI 답변은 저장되지 않았습니다.'}
              </span>
            </div>
          )}

          <div className={styles.storageNotice}>
            <Database size={15} />
            <span>{insightRuntimeLabel}. {insightRuntimeNote}</span>
          </div>

          <div className={styles.storageNotice}>
            <Database size={15} />
            <span>{reportRuntimeLabelText}. {reportRuntimeNoteText}</span>
          </div>

          {qdrantLabel && (
            <div className={styles.storageNotice}>
              <Database size={15} />
              <span>{qdrantLabel}. 비슷한 차트·뉴스 근거를 벡터 검색으로 함께 참고합니다.</span>
            </div>
          )}

          <div className={styles.ollamaWorkflowGrid} aria-label="Ollama 로컬 LLM 기능 실행 상태">
            <article className={styles.workflowCard}>
              <Cpu size={16} />
              <div>
                <span>1. 종목 상담</span>
                <strong>{adviceDecision}</strong>
                <p>{insights ? adviceSummary : insightRuntimeNote}</p>
              </div>
            </article>
            <article className={styles.workflowCard}>
              <TrendingUp size={16} />
              <div>
                <span>2. 뉴스 방향</span>
                <strong>상승 {probabilityLabel(nextTradingDay.up)} · 하락 {probabilityLabel(nextTradingDay.down)}</strong>
                <p>{insights ? `${sentimentLabel} · 문맥 ${contextLabel}${visibleHeadlineCount ? ` · 헤드라인 ${visibleHeadlineCount}개` : ''}` : '뉴스 헤드라인과 이벤트 문맥을 로컬 LLM 판단에 연결합니다.'}</p>
              </div>
            </article>
            <article className={styles.workflowCard}>
              <Newspaper size={16} />
              <div>
                <span>3. 장후 리포트</span>
                <strong>{reportMood}</strong>
                <p>{reportRuntimeLabelText || reportStorageLabel || reportSummary}</p>
              </div>
            </article>
          </div>

          {insights && (
            <div className={styles.section}>
              <div className={styles.ollamaTitleRow}>
                <h4 className={styles.sectionTitle}>로컬 Ollama 인사이트</h4>
                <span>{insights.modeLabel}{insights.model ? ` · ${insights.model}` : ''}</span>
              </div>
              {insights.answer && (
                <p className={styles.ollamaAnswer}>{insights.answer}</p>
              )}
              {hasBeginnerCoach && (
                <div className={styles.beginnerCoachCard} aria-label="초보자 AI 코치">
                  <div className={styles.beginnerCoachHeader}>
                    <div>
                      <Lightbulb size={16} />
                      <strong>{beginnerCoach.title || '초보자 AI 코치'}</strong>
                    </div>
                    <span>{adviceDecision}</span>
                  </div>
                  {beginnerCoach.plainSummary && <p>{beginnerCoach.plainSummary}</p>}
                  <div className={styles.beginnerCoachReasonGrid}>
                    <article>
                      <b>좋게 볼 이유</b>
                      <span>{beginnerCoach.goodReason || newsSentiment.upReasons?.[0] || '가격과 거래량 확인이 필요합니다.'}</span>
                    </article>
                    <article>
                      <b>주의할 이유</b>
                      <span>{beginnerCoach.cautionReason || newsSentiment.downRisks?.[0] || newsSentiment.caution}</span>
                    </article>
                  </div>
                  <div className={styles.beginnerCoachActionGrid}>
                    <article>
                      <b>다음 행동</b>
                      <span>{beginnerCoach.nextAction || stockAdvice.watchConditions?.[0] || '다음 종가와 거래량을 확인합니다.'}</span>
                    </article>
                    <article>
                      <b>피할 행동</b>
                      <span>{beginnerCoach.avoidAction || '뉴스 제목이나 확률 하나만 보고 바로 매매하지 않습니다.'}</span>
                    </article>
                  </div>
                  {beginnerCoach.checklist?.length > 0 && (
                    <ul className={styles.beginnerCoachChecklist}>
                      {beginnerCoach.checklist.slice(0, 3).map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <div className={styles.ollamaGrid}>
                <article className={styles.ollamaCard}>
                  <Cpu size={16} />
                  <div>
                    <strong>{adviceDecision}</strong>
                    <p>{adviceSummary}</p>
                    {decisionFactors.length > 0 && (
                      <div className={styles.decisionFactorPanel} aria-label="AI 종합 판단 근거">
                        {decisionFactors.map((factor) => (
                          <span
                            key={`${factor.label}-${factor.state}`}
                            className={clsx(
                              factor.tone === 'positive' && styles.factorPositive,
                              factor.tone === 'negative' && styles.factorNegative
                            )}
                          >
                            <b>{factor.label}</b>
                            <strong>{factor.state}</strong>
                            <em>{factor.summary}</em>
                          </span>
                        ))}
                      </div>
                    )}
                    {personalRisk && (
                      <div className={styles.personalRiskPanel} aria-label="개인 조건 손익 기준">
                        <div className={styles.personalRiskHeader}>
                          <b>{personalRisk.statusLabel || '개인 조건 확인'}</b>
                          {personalRisk.profitLossText && <span>{personalRisk.profitLossText}</span>}
                        </div>
                        <p>{personalAdjustment?.applied ? personalAdjustment.summary : personalRisk.summary}</p>
                        <div className={styles.personalRiskMetrics}>
                          {personalRisk.averagePriceText && <span>평단 {personalRisk.averagePriceText}</span>}
                          {personalRisk.currentPriceText && <span>현재 {personalRisk.currentPriceText}</span>}
                          {personalRisk.stopLossPriceText && <span>기준 {personalRisk.stopLossPriceText}</span>}
                        </div>
                        {(personalAdjustment?.actionLine || personalRisk.actionLine) && <em>{personalAdjustment?.actionLine || personalRisk.actionLine}</em>}
                      </div>
                    )}
                    {hasTradeTiming && (
                      <div
                        className={clsx(
                          styles.tradeTimingPanel,
                          tradeTiming.tone === 'positive' && styles.tradeTimingPositive,
                          tradeTiming.tone === 'negative' && styles.tradeTimingNegative
                        )}
                        aria-label="AI 매매 타이밍 계획"
                      >
                        <strong>{tradeTiming.title || '언제 사고 언제 팔아야 하나요?'}</strong>
                        <div className={styles.tradeTimingGrid}>
                          <article>
                            <b>살 때</b>
                            <span>{tradeTiming.entryTiming || stockAdvice.buyConditions?.[0] || '20일선과 거래량 확인 필요'}</span>
                          </article>
                          <article>
                            <b>팔 때</b>
                            <span>{tradeTiming.exitTiming || stockAdvice.sellConditions?.[0] || '지지선 이탈 여부 확인 필요'}</span>
                          </article>
                          <article>
                            <b>기다릴 때</b>
                            <span>{tradeTiming.waitCondition || stockAdvice.watchConditions?.[0] || '다음 종가와 거래량 확인 필요'}</span>
                          </article>
                          <article>
                            <b>판단 바꿀 때</b>
                            <span>{tradeTiming.invalidationTrigger || '반대 신호가 거래량으로 확인될 때 다시 봅니다.'}</span>
                          </article>
                        </div>
                        {tradeTiming.tomorrowChecklist?.length > 0 && (
                          <ul>
                            {tradeTiming.tomorrowChecklist.slice(0, 3).map((item, index) => (
                              <li key={`${item}-${index}`}>{item}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                </article>
                <article className={styles.ollamaCard}>
                  <TrendingUp size={16} />
                  <div>
                    <strong>
                      상승 {probabilityLabel(nextTradingDay.up)} · 하락 {probabilityLabel(nextTradingDay.down)}
                    </strong>
                    <span className={styles.sentimentMeta}>
                      {sentimentLabel} · 근거 {sentimentConfidence}
                    </span>
                    <p>{sentimentSummary}</p>
                    <div className={styles.sentimentScorePanel} aria-label="뉴스 감성 점수 산식">
                      <div>
                        <span>보정 점수</span>
                        <strong className={sentimentScore > 0 ? styles.posIcon : sentimentScore < 0 ? styles.negIcon : styles.waitIcon}>
                          {scoreLabel(sentimentScore)}
                        </strong>
                      </div>
                      <div>
                        <span>이벤트</span>
                        <strong>{scoreLabel(newsSentiment.scoreBreakdown?.eventScore)}</strong>
                      </div>
                      <div>
                        <span>헤드라인</span>
                        <strong>{scoreLabel(newsSentiment.scoreBreakdown?.headlineScore)}</strong>
                      </div>
                    </div>
                    {newsSentiment.confidenceReason && (
                      <p className={styles.sentimentCaution}>{newsSentiment.confidenceReason}</p>
                    )}
                    {(contextLabel || contextReason) && (
                      <div className={styles.contextJudgement} aria-label="Ollama 뉴스 문맥 판단">
                        <b>Ollama 문맥 판단 · {contextLabel}</b>
                        <p>{contextReason}</p>
                        {newsSentiment.llmContextEvidence?.length > 0 && (
                          <ul>
                            {newsSentiment.llmContextEvidence.slice(0, 2).map((item, index) => (
                              <li key={`${item}-${index}`}>{item}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                    {newsSentiment.headlineSignals?.length > 0 && (
                      <ul className={styles.compactList}>
                        {newsSentiment.headlineSignals.slice(0, 3).map((item, index) => (
                          <li key={`${item}-${index}`}>{item}</li>
                        ))}
                      </ul>
                    )}
                    {newsSentiment.headlineAnalyses?.length > 0 && (
                      <div className={styles.headlineAnalysisList} aria-label="뉴스 헤드라인별 해석">
                        {newsSentiment.headlineAnalyses.slice(0, 3).map((item, index) => (
                          <article key={`${item.title}-${index}`}>
                            <b className={effectClass(item.effect)}>{item.effect}</b>
                            <span>{item.title}</span>
                            <em>{item.reason}{item.evidenceLevel ? ` · 근거 ${item.evidenceLevel}` : ''}</em>
                          </article>
                        ))}
                      </div>
                    )}
                    {(newsSentiment.upReasons?.length > 0 || newsSentiment.downRisks?.length > 0) && (
                      <div className={styles.sentimentReasonGrid}>
                        <div>
                          <b>상승 쪽 근거</b>
                          <span>{newsSentiment.upReasons?.[0] || '가격과 거래량 확인 필요'}</span>
                        </div>
                        <div>
                          <b>주의할 근거</b>
                          <span>{newsSentiment.downRisks?.[0] || newsSentiment.caution}</span>
                        </div>
                      </div>
                    )}
                    {newsSentiment.caution && (
                      <p className={styles.sentimentCaution}>{newsSentiment.caution}</p>
                    )}
                    {newsSentiment.tradingScenarios?.length > 0 && (
                      <ul className={styles.compactList}>
                        {newsSentiment.tradingScenarios.slice(0, 2).map((item, index) => (
                          <li key={`${item}-${index}`}>{item}</li>
                        ))}
                      </ul>
                    )}
                    {newsSentiment.actionGuide?.length > 0 && (
                      <div className={styles.nextWatchBox}>
                        <strong>뉴스 보고 바로 할 행동</strong>
                        <ul>
                          {newsSentiment.actionGuide.slice(0, 2).map((item, index) => (
                            <li key={`${item}-${index}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </article>
                <article className={styles.ollamaCard}>
                  <Newspaper size={16} />
                  <div>
                    <strong>{afterMarketReport.mood || '장후 확인 중'}</strong>
                    <p>{afterMarketReport.llmComment || reportSummary}</p>
                    {afterMarketReport.keyPoints?.length > 0 && (
                      <ul className={styles.compactList}>
                        {afterMarketReport.keyPoints.slice(0, 3).map((item, index) => (
                          <li key={`${item}-${index}`}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </article>
              </div>
              {(stockAdvice.buyConditions?.length > 0
                || stockAdvice.watchConditions?.length > 0
                || stockAdvice.sellConditions?.length > 0) && (
                <div className={styles.ollamaConditionGrid} aria-label="Ollama 매매 조건 체크">
                  <article>
                    <CheckCircle2 size={15} className={styles.posIcon} />
                    <div>
                      <b>매수 검토 조건</b>
                      <span>{stockAdvice.buyConditions?.[0] || '20일선과 거래량 확인 필요'}</span>
                    </div>
                  </article>
                  <article>
                    <Clock3 size={15} className={styles.waitIcon} />
                    <div>
                      <b>관망 조건</b>
                      <span>{stockAdvice.watchConditions?.[0] || '다음 종가와 거래량 확인 필요'}</span>
                    </div>
                  </article>
                  <article>
                    <XCircle size={15} className={styles.negIcon} />
                    <div>
                      <b>매도 검토 조건</b>
                      <span>{stockAdvice.sellConditions?.[0] || '지지선 이탈 여부 확인 필요'}</span>
                    </div>
                  </article>
                </div>
              )}
              {afterMarketReport.nextWatch?.length > 0 && (
                <div className={styles.nextWatchBox}>
                  <strong>다음 거래일 확인할 것</strong>
                  <ul>
                    {afterMarketReport.nextWatch.slice(0, 3).map((item, index) => (
                      <li key={`${item}-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {insights.beginnerNotes?.length > 0 && (
                <div className={styles.beginnerNoteBox}>
                  <strong>초보자 기준으로 기억할 것</strong>
                  <ul>
                    {insights.beginnerNotes.slice(0, 3).map((item, index) => (
                      <li key={`${item}-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {insights.limitations?.length > 0 && (
                <p className={styles.ollamaLimit}>
                  {insights.configured ? '로컬 LLM 기준: ' : 'Ollama 모델 미설정: '}
                  {insights.limitations[0]}
                </p>
              )}
            </div>
          )}

          {(ai.marketReport || ai.marketReportStatus === 'loading' || ai.marketReportStatus === 'unavailable') && (
            <div className={styles.section}>
              <div className={styles.ollamaTitleRow}>
                <h4 className={styles.sectionTitle}>시장 전체 장후 리포트</h4>
                <div className={styles.reportTitleMeta}>
                  <span>
                    {ai.marketReport
                      ? `${ai.marketReport.modeLabel}${ai.marketReport.model ? ` · ${ai.marketReport.model}` : ''}`
                      : ai.marketReportStatus === 'loading'
                        ? 'Ollama 장후 리포트 준비 중'
                        : '장후 리포트 확인 필요'}
                  </span>
                  {reportStorageLabel && <b>{reportStorageLabel}</b>}
                </div>
              </div>
              <article className={styles.marketReportBox}>
                <Newspaper size={17} />
                <div>
                  <strong>
                    {ai.marketReport
                      ? `${ai.marketReport.mood} · ${ai.marketReport.marketBias}`
                      : ai.marketReportStatus === 'loading'
                        ? '최신 저장 브리프를 읽는 중'
                        : '장후 리포트를 불러오지 못했습니다'}
                  </strong>
                  <p>
                    {ai.marketReport?.llmComment
                      || (ai.marketReportStatus === 'loading'
                        ? 'Ollama가 시장 상승·하락 후보와 다음 거래일 확인 포인트를 정리하고 있습니다.'
                        : '최신 브리프가 없거나 AI 서비스 응답이 지연되었습니다.')}
                  </p>
                  {ai.marketReport?.sessionBrief && (
                    <p className={styles.sessionBrief}>{ai.marketReport.sessionBrief}</p>
                  )}
                  {marketDashboard && (
                    <div className={styles.marketDashboard} aria-label="장후 시장 대시보드">
                      <div>
                        <span>상승 리더</span>
                        <strong className={styles.posIcon}>
                          {leaderName(topGainer, '확인 필요')} {leaderRate(topGainer?.rate)}
                        </strong>
                      </div>
                      <div>
                        <span>하락 리더</span>
                        <strong className={styles.negIcon}>
                          {leaderName(topLoser, '확인 필요')} {leaderRate(topLoser?.rate)}
                        </strong>
                      </div>
                    </div>
                  )}
                  {ai.marketReport?.leaderSummaries?.length > 0 && (
                    <div className={styles.leaderSummaryList} aria-label="상승 하락 리더 해석">
                      {ai.marketReport.leaderSummaries.slice(0, 2).map((item, index) => (
                        <article key={`${item.type}-${item.name}-${index}`}>
                          <b>{item.type}</b>
                          <strong>{item.name} {leaderRate(item.rate)}</strong>
                          <p>{item.summary}</p>
                          <span>{item.watch}</span>
                        </article>
                      ))}
                    </div>
                  )}
                  {ai.marketReport?.keyPoints?.length > 0 && (
                    <ul className={styles.compactList}>
                      {ai.marketReport.keyPoints.slice(0, 3).map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  )}
                  {reportStorageNote && (
                    <span className={styles.reportStorageNote}>{reportStorageNote}</span>
                  )}
                </div>
              </article>
              {ai.marketReport?.nextWatch?.length > 0 && (
                <div className={styles.nextWatchBox}>
                  <strong>장후 리포트 다음 확인</strong>
                  <ul>
                    {ai.marketReport.nextWatch.slice(0, 3).map((item, index) => (
                      <li key={`${item}-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {ai.marketReport?.actionPlan?.length > 0 && (
                <div className={styles.nextWatchBox}>
                  <strong>내일 장 시작 전 행동 계획</strong>
                  <ul>
                    {ai.marketReport.actionPlan.slice(0, 3).map((item, index) => (
                      <li key={`${item}-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className={styles.section}>
            <h4 className={styles.sectionTitle}>조건별 확인 순서</h4>
            <div className={styles.conditionGrid}>
              <div className={styles.conditionBox}>
                <CheckCircle2 size={16} className={styles.posIcon} />
                <p><strong>매수 검토:</strong> {ai.buyCondition || '확인된 매수 조건 없음'}</p>
              </div>
              <div className={styles.conditionBox}>
                <XCircle size={16} className={styles.negIcon} />
                <p><strong>매도 검토:</strong> {ai.sellCondition || '확인된 매도 조건 없음'}</p>
              </div>
              <div className={styles.conditionBox}>
                <Clock3 size={16} className={styles.waitIcon} />
                <p><strong>관망:</strong> {ai.waitCondition || '방향이 엇갈리면 다음 신호 확인'}</p>
              </div>
              <div className={styles.conditionBox}>
                <ShieldAlert size={16} className={styles.negIcon} />
                <p><strong>리스크 관리:</strong> {ai.riskCondition || '전저점 이탈과 하락 거래량 확인'}</p>
              </div>
            </div>
            {ai.movingAverageExplanation && (
              <p className={styles.maNote}>
                <strong>이동평균선:</strong> {ai.movingAverageExplanation}
              </p>
            )}
            {(ai.waitCondition || ai.opposingSignals?.length > 0) && (
              <p className={styles.neutralNote}>
                <strong>관망 시나리오:</strong> {ai.waitCondition || ai.opposingSignals?.[0]}
              </p>
            )}
          </div>

          <div className={styles.section}>
            <h4 className={styles.sectionTitle}>좋게 볼 이유와 주의할 이유</h4>
            <div className={styles.newsGrid}>
              <div className={styles.newsBox}>
                <h5>좋게 볼 수 있는 이유 ({ai.positives?.length || 0})</h5>
                {ai.positives?.map((n, i) => <div key={i} className={styles.newsItem}>{n}</div>)}
              </div>
              <div className={styles.newsBox}>
                <h5>주의할 이유 ({ai.negatives?.length || 0})</h5>
                {ai.negatives?.map((n, i) => <div key={i} className={styles.newsItem}>{n}</div>)}
              </div>
            </div>
          </div>

          {ai.portfolioGuidance && (
            <div className={styles.section}>
              <h4 className={styles.sectionTitle}>내 샌드박스 기준</h4>
              <p className={styles.limitNote}>{ai.portfolioGuidance.summary}</p>
              {ai.portfolioGuidance.positionDiagnostics && (
                <div className={styles.personalRiskPanel} aria-label="샌드박스 손익 진단">
                  <div className={styles.personalRiskHeader}>
                    <b>{ai.portfolioGuidance.positionDiagnostics.statusLabel}</b>
                    {ai.portfolioGuidance.positionDiagnostics.profitLossText && (
                      <span>{ai.portfolioGuidance.positionDiagnostics.profitLossText}</span>
                    )}
                  </div>
                  <p>{ai.portfolioGuidance.positionDiagnostics.summary}</p>
                  {ai.portfolioGuidance.positionDiagnostics.actionLine && (
                    <em>{ai.portfolioGuidance.positionDiagnostics.actionLine}</em>
                  )}
                </div>
              )}
              {ai.portfolioGuidance.checklist?.length > 0 && (
                <ul className={styles.checklist}>
                  {ai.portfolioGuidance.checklist.slice(0, 4).map((item, index) => (
                    <li key={`${item}-${index}`}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {ai.fundamentalGuidance && (
            <div className={styles.section}>
              <h4 className={styles.sectionTitle}>재무 스냅샷</h4>
              <p className={styles.limitNote}>{ai.fundamentalGuidance.summary}</p>
              {ai.fundamentalGuidance.points?.length > 0 && (
                <ul className={styles.checklist}>
                  {ai.fundamentalGuidance.points.slice(0, 4).map((item, index) => (
                    <li key={`${item}-${index}`}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {ai.checklist?.length > 0 && (
            <div className={styles.section}>
              <h4 className={styles.sectionTitle}>초보자 확인 순서</h4>
              <ul className={styles.checklist}>
                {ai.checklist.slice(0, 5).map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {(ai.limitation || ai.sourceTitles?.length > 0) && (
            <div className={styles.section}>
              <h4 className={styles.sectionTitle}>근거와 한계</h4>
              {ai.limitation && <p className={styles.limitNote}>{ai.limitation}</p>}
              {ai.sourceTitles?.length > 0 && (
                <div className={styles.sourceList}>
                  {ai.sourceTitles.slice(0, 4).map((source) => <span key={source}>{source}</span>)}
                </div>
              )}
            </div>
          )}
          
          <div className={styles.footer}>
            <span>기준일: {asOf}</span>
            <span>신뢰도: {ai.confidence}</span>
          </div>
        </div>
    </details>
  );
}
