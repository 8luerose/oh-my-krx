import React, { useState } from 'react';
import { Bot, ChevronUp, ChevronDown, CheckCircle2, XCircle, ShieldAlert, Clock3, Database, Info, Cpu, Newspaper, TrendingUp } from 'lucide-react';
import clsx from 'clsx';
import styles from './FloatingAiCard.module.css';

export default function FloatingAiCard({ ai, events, asOf }) {
  const [expanded, setExpanded] = useState(false);

  if (!ai) return null;

  return (
    <div className={clsx(styles.container, expanded && styles.expanded)}>
      {/* Minimized View (1-line summary) */}
      <button
        type="button"
        className={styles.header}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={expanded ? 'AI 요약 접기' : 'AI 요약 펼치기'}
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
            </div>
          )}
        </div>
        <span className={styles.toggleBtn} aria-hidden="true">
          {expanded ? <ChevronDown /> : <ChevronUp />}
        </span>
      </button>

      {/* Expanded View (Conditions & News) */}
      {expanded && (
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
                    <p>{ai.ollamaInsights.newsSentiment.summary}</p>
                    {ai.ollamaInsights.newsSentiment.headlineSignals?.length > 0 && (
                      <ul className={styles.compactList}>
                        {ai.ollamaInsights.newsSentiment.headlineSignals.slice(0, 3).map((item, index) => (
                          <li key={`${item}-${index}`}>{item}</li>
                        ))}
                      </ul>
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
      )}
    </div>
  );
}
