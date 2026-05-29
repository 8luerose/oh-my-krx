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

export default function FloatingAiCard({ ai, events, asOf }) {
  const [expanded, setExpanded] = useState(false);

  if (!ai) return null;

  const reportStorageLabel = marketReportStorageLabel(ai.marketReport?.storage);
  const reportStorageNote = marketReportStorageNote(ai.marketReport?.storage);

  return (
    <details
      className={clsx(styles.container, expanded && styles.expanded)}
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      {/* Minimized View (1-line summary) */}
      <summary
        className={styles.header}
        aria-expanded={expanded}
        aria-label={expanded ? 'AI 요약 접기' : 'AI 요약 펼치기'}
        role="button"
        tabIndex={0}
        onClick={(event) => {
          event.preventDefault();
          setExpanded((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          setExpanded((current) => !current);
        }}
      >
        <div className={styles.iconWrapper}>
          <Bot size={24} className={styles.icon} />
        </div>
        <div className={styles.summaryInfo}>
          <span className={styles.direction}>{ai.direction || '분석 중'}</span>
          <p className={styles.conclusion}>{ai.conclusion || '현재 종목의 주요 흐름을 파악하고 있습니다.'}</p>
          {ai.ollamaInsights && (
            <div className={styles.miniOllamaStrip} aria-label="Ollama 핵심 인사이트">
              <span>{ai.ollamaInsights.stockAdvice.decision}</span>
              <span>상승 {ai.ollamaInsights.newsSentiment.nextTradingDay.up}%</span>
              <span>{ai.ollamaInsights.afterMarketReport.mood}</span>
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
      <div className={styles.details}>
          <div className={styles.runtimeNotice}>
            <Info size={15} />
            <span>
              {ai.modeLabel || '근거 기반 답변'}{ai.llmModel ? ` · ${ai.llmModel}` : ''}. 조건 확인용이며 평균단가와 실제 보유 수량은 아직 반영하지 않습니다.
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

          {ai.ollamaInsights && (
            <div className={styles.section}>
              <div className={styles.ollamaTitleRow}>
                <h4 className={styles.sectionTitle}>로컬 Ollama 인사이트</h4>
                <span>{ai.ollamaInsights.modeLabel}{ai.ollamaInsights.model ? ` · ${ai.ollamaInsights.model}` : ''}</span>
              </div>
              {ai.ollamaInsights.answer && (
                <p className={styles.ollamaAnswer}>{ai.ollamaInsights.answer}</p>
              )}
              <div className={styles.ollamaGrid}>
                <article className={styles.ollamaCard}>
                  <Cpu size={16} />
                  <div>
                    <strong>{ai.ollamaInsights.stockAdvice.decision}</strong>
                    <p>{ai.ollamaInsights.stockAdvice.summary}</p>
                  </div>
                </article>
                <article className={styles.ollamaCard}>
                  <TrendingUp size={16} />
                  <div>
                    <strong>
                      상승 {ai.ollamaInsights.newsSentiment.nextTradingDay.up}% · 하락 {ai.ollamaInsights.newsSentiment.nextTradingDay.down}%
                    </strong>
                    <span className={styles.sentimentMeta}>
                      {ai.ollamaInsights.newsSentiment.label} · 근거 {ai.ollamaInsights.newsSentiment.confidence}
                    </span>
                    <p>{ai.ollamaInsights.newsSentiment.summary}</p>
                    {ai.ollamaInsights.newsSentiment.headlineSignals?.length > 0 && (
                      <ul className={styles.compactList}>
                        {ai.ollamaInsights.newsSentiment.headlineSignals.slice(0, 3).map((item, index) => (
                          <li key={`${item}-${index}`}>{item}</li>
                        ))}
                      </ul>
                    )}
                    {(ai.ollamaInsights.newsSentiment.upReasons?.length > 0 || ai.ollamaInsights.newsSentiment.downRisks?.length > 0) && (
                      <div className={styles.sentimentReasonGrid}>
                        <div>
                          <b>상승 쪽 근거</b>
                          <span>{ai.ollamaInsights.newsSentiment.upReasons?.[0] || '가격과 거래량 확인 필요'}</span>
                        </div>
                        <div>
                          <b>주의할 근거</b>
                          <span>{ai.ollamaInsights.newsSentiment.downRisks?.[0] || ai.ollamaInsights.newsSentiment.caution}</span>
                        </div>
                      </div>
                    )}
                    {ai.ollamaInsights.newsSentiment.caution && (
                      <p className={styles.sentimentCaution}>{ai.ollamaInsights.newsSentiment.caution}</p>
                    )}
                  </div>
                </article>
                <article className={styles.ollamaCard}>
                  <Newspaper size={16} />
                  <div>
                    <strong>{ai.ollamaInsights.afterMarketReport.mood}</strong>
                    <p>{ai.ollamaInsights.afterMarketReport.llmComment}</p>
                    {ai.ollamaInsights.afterMarketReport.keyPoints?.length > 0 && (
                      <ul className={styles.compactList}>
                        {ai.ollamaInsights.afterMarketReport.keyPoints.slice(0, 3).map((item, index) => (
                          <li key={`${item}-${index}`}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </article>
              </div>
              {ai.ollamaInsights.afterMarketReport.nextWatch?.length > 0 && (
                <div className={styles.nextWatchBox}>
                  <strong>다음 거래일 확인할 것</strong>
                  <ul>
                    {ai.ollamaInsights.afterMarketReport.nextWatch.slice(0, 3).map((item, index) => (
                      <li key={`${item}-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {ai.ollamaInsights.limitations?.length > 0 && (
                <p className={styles.ollamaLimit}>
                  {ai.ollamaInsights.configured ? '로컬 LLM 기준: ' : 'Ollama 모델 미설정: '}
                  {ai.ollamaInsights.limitations[0]}
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
              {ai.portfolioGuidance.checklist?.length > 0 && (
                <ul className={styles.checklist}>
                  {ai.portfolioGuidance.checklist.slice(0, 4).map((item, index) => (
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
