import React, { useState } from 'react';
import { Bot, ChevronUp, ChevronDown, CheckCircle2, XCircle, ShieldAlert, Clock3, Database, Info, Cpu, Newspaper, TrendingUp } from 'lucide-react';
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

function fundamentalStatusLabel(summary, riskNotes = []) {
  const text = [summary, ...(Array.isArray(riskNotes) ? riskNotes : [])].filter(Boolean).join(' ');
  if (!text) return '재무 확인';
  if (/없어|비어|못했습니다|제한|확인 필요|별도로 확인/.test(text)) return '재무 제한';
  return '재무 반영';
}

export default function FloatingAiCard({ ai, events, asOf }) {
  const [expanded, setExpanded] = useState(false);

  if (!ai) return null;

  const reportStorageLabel = marketReportStorageLabel(ai.marketReport?.storage);
  const reportStorageNote = marketReportStorageNote(ai.marketReport?.storage);
  const insights = ai.ollamaInsights;
  const stockAdvice = insights?.stockAdvice || {};
  const newsSentiment = insights?.newsSentiment || {};
  const nextTradingDay = newsSentiment?.nextTradingDay || {};
  const afterMarketReport = insights?.afterMarketReport || {};
  const personalRisk = stockAdvice.personalRisk || ai.portfolioGuidance?.positionDiagnostics || null;
  const visibleHeadlineCount = newsSentiment?.headlineSignals?.length || 0;
  const adviceDecision = stockAdvice.decision || '관망';
  const adviceSummary = stockAdvice.summary || '차트, 재무, 뉴스, 센티멘트를 합쳐 매수·관망·매도 조건을 정리합니다.';
  const sentimentLabel = newsSentiment.label || '뉴스 감성 확인';
  const sentimentConfidence = newsSentiment.confidence || '확인 중';
  const sentimentSummary = newsSentiment.summary || '뉴스 헤드라인이 다음 거래일 가격 방향에 줄 수 있는 영향을 정리합니다.';
  const sentimentScore = Number.isFinite(Number(newsSentiment.score))
    ? Number(newsSentiment.score)
    : Number(newsSentiment.scoreBreakdown?.adjustedScore || 0);
  const reportMood = ai.marketReport
    ? [ai.marketReport.mood, ai.marketReport.marketBias].filter(Boolean).join(' · ')
    : afterMarketReport.mood || '장후 리포트 확인 중';
  const reportSummary = ai.marketReport?.llmComment || afterMarketReport.llmComment || '장후 브리프와 시장 분위기 코멘트를 확인합니다.';
  const fundamentalLabel = fundamentalStatusLabel(ai.fundamentalGuidance?.summary, stockAdvice.riskNotes);
  const marketDashboard = ai.marketReport?.marketDashboard || null;
  const topGainer = marketDashboard?.topGainer || null;
  const topLoser = marketDashboard?.topLoser || null;

  return (
    <details
      className={clsx(styles.container, expanded && styles.expanded)}
      aria-label="AI 요약 카드"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
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
          {insights && (
            <div className={styles.miniOllamaStrip} aria-label="Ollama 핵심 인사이트">
              <span>상담 {adviceDecision}</span>
              <span>{fundamentalLabel}</span>
              <span>뉴스 상승 {probabilityLabel(nextTradingDay.up)}</span>
              <span>장후 {afterMarketReport.mood || '확인 중'}</span>
              {ai.marketReport?.mood && <span>장후 {ai.marketReport.mood}</span>}
              {reportStorageLabel && <span>{reportStorageLabel}</span>}
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
          </div>

          {ai.storage && (
            <div className={styles.storageNotice}>
              <Database size={15} />
              <span>
                {ai.storage.saved ? `AI 답변 저장 완료: ${ai.storage.table}` : 'AI 답변은 저장되지 않았습니다.'}
              </span>
            </div>
          )}

          {insights && (
            <div className={styles.ollamaWorkflowGrid} aria-label="Ollama 로컬 LLM 기능 실행 상태">
              <article className={styles.workflowCard}>
                <Cpu size={16} />
                <div>
                  <span>1. 종목 상담</span>
                  <strong>{adviceDecision}</strong>
                  <p>{adviceSummary}</p>
                </div>
              </article>
              <article className={styles.workflowCard}>
                <TrendingUp size={16} />
                <div>
                  <span>2. 뉴스 방향</span>
                  <strong>상승 {probabilityLabel(nextTradingDay.up)} · 하락 {probabilityLabel(nextTradingDay.down)}</strong>
                  <p>{sentimentLabel} · 근거 {sentimentConfidence}{visibleHeadlineCount ? ` · 헤드라인 ${visibleHeadlineCount}개` : ''}</p>
                </div>
              </article>
              <article className={styles.workflowCard}>
                <Newspaper size={16} />
                <div>
                  <span>3. 장후 리포트</span>
                  <strong>{reportMood}</strong>
                  <p>{reportStorageLabel || reportSummary}</p>
                </div>
              </article>
            </div>
          )}

          {insights && (
            <div className={styles.section}>
              <div className={styles.ollamaTitleRow}>
                <h4 className={styles.sectionTitle}>로컬 Ollama 인사이트</h4>
                <span>{insights.modeLabel}{insights.model ? ` · ${insights.model}` : ''}</span>
              </div>
              {insights.answer && (
                <p className={styles.ollamaAnswer}>{insights.answer}</p>
              )}
              <div className={styles.ollamaGrid}>
                <article className={styles.ollamaCard}>
                  <Cpu size={16} />
                  <div>
                    <strong>{adviceDecision}</strong>
                    <p>{adviceSummary}</p>
                    {personalRisk && (
                      <div className={styles.personalRiskPanel} aria-label="개인 조건 손익 기준">
                        <div className={styles.personalRiskHeader}>
                          <b>{personalRisk.statusLabel || '개인 조건 확인'}</b>
                          {personalRisk.profitLossText && <span>{personalRisk.profitLossText}</span>}
                        </div>
                        <p>{personalRisk.summary}</p>
                        <div className={styles.personalRiskMetrics}>
                          {personalRisk.averagePriceText && <span>평단 {personalRisk.averagePriceText}</span>}
                          {personalRisk.currentPriceText && <span>현재 {personalRisk.currentPriceText}</span>}
                          {personalRisk.stopLossPriceText && <span>기준 {personalRisk.stopLossPriceText}</span>}
                        </div>
                        {personalRisk.actionLine && <em>{personalRisk.actionLine}</em>}
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
