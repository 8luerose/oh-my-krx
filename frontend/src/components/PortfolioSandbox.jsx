import React, { useState, useEffect, useMemo } from 'react';
import { X, PieChart, PlusCircle, AlertOctagon, TrendingUp, Info, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { invalidateAiCachesForStock, loadPortfolio, updatePortfolioItemWeight, upsertPortfolioItem } from '../services/apiClient';
import styles from './PortfolioSandbox.module.css';

function parseRate(value) {
  const number = Number(String(value || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function parsePrice(value) {
  const number = Number(String(value || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function buildLocalPortfolioItem(activeCode, stockName, weight, personal = {}) {
  const safeWeight = Number(weight);
  const averagePrice = parsePrice(personal.averagePrice);
  const holdingPeriod = personal.holdingPeriod || '미입력';
  const riskTolerance = personal.riskTolerance || '미입력';
  return {
    code: activeCode,
    name: stockName || activeCode,
    group: '현재 차트 종목',
    rate: 0,
    count: null,
    weight: Number.isFinite(safeWeight) ? safeWeight : 10,
    averagePrice,
    holdingPeriod,
    riskTolerance,
    riskNotes: [
      safeWeight >= 35
        ? `${stockName || activeCode}의 가상 비중이 높은 편입니다. 이벤트가 생기면 전체 포트폴리오 변동성이 커질 수 있습니다.`
        : `${stockName || activeCode}의 가상 비중이 과도하게 높지는 않지만, 동일 섹터 집중 여부를 함께 확인해야 합니다.`,
      averagePrice
        ? `평균단가 ${Math.round(averagePrice).toLocaleString()}원 기준으로 현재가와 손익분기점을 함께 봅니다.`
        : '평균단가를 입력하면 AI가 손익 기준 리스크를 더 구체적으로 설명합니다.'
    ],
    nextChecklist: [
      `${stockName || activeCode}의 최근 이벤트와 거래량 급증 여부 확인`,
      `보유기간 ${holdingPeriod}, 손실허용 ${riskTolerance} 기준으로 대응 속도를 구분`,
      '매수/매도 단정 대신 관망, 매수 검토, 리스크 관리 기준을 나누어 작성'
    ],
    recentEvents: []
  };
}

function buildLocalPortfolio(activeCode, stockName, weight, personal = {}) {
  const item = buildLocalPortfolioItem(activeCode, stockName, weight, personal);
  return {
    items: [item],
    summary: {
      totalWeight: item.weight,
      maxWeightStock: item.name,
      maxWeight: item.weight,
      concentration: item.weight >= 50
        ? '한 종목 비중이 50% 이상입니다. 손실 허용 기준을 먼저 정해야 합니다.'
        : '비중이 한 종목에 과도하게 몰리지는 않았습니다.',
      volatility: '서버 점검 결과를 불러오지 못해 현재 화면 기준으로만 확인합니다.',
      nextChecklist: ['비중이 가장 큰 종목의 최근 이벤트 확인', '동일 섹터 종목이 과도하게 몰렸는지 확인']
    },
    source: 'local_screen_review_fallback',
    updatedAt: null
  };
}

export default function PortfolioSandbox({ isOpen, onClose, activeCode, stockName, activeStock }) {
  const [weight, setWeight] = useState(10);
  const [averagePrice, setAveragePrice] = useState('');
  const [holdingPeriod, setHoldingPeriod] = useState('미입력');
  const [riskTolerance, setRiskTolerance] = useState('중간');
  const [added, setAdded] = useState(false);
  const [portfolio, setPortfolio] = useState(null);
  const [loadingPortfolio, setLoadingPortfolio] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncError, setSyncError] = useState('');

  const currentItem = useMemo(
    () => portfolio?.items?.find((item) => item.code === activeCode) || null,
    [activeCode, portfolio]
  );

  useEffect(() => {
    if (!isOpen) return undefined;

    let alive = true;
    setLoadingPortfolio(true);
    setSyncError('');

    loadPortfolio()
      .then((nextPortfolio) => {
        if (!alive) return;
        setPortfolio(nextPortfolio);
      })
      .catch(() => {
        if (!alive) return;
        setPortfolio(null);
        setSyncError('서버 저장소를 불러오지 못해 현재 화면 안에서만 점검합니다.');
      })
      .finally(() => {
        if (alive) setLoadingPortfolio(false);
      });

    return () => {
      alive = false;
    };
  }, [isOpen]);

  useEffect(() => {
    if (currentItem) {
      setAdded(true);
      setWeight(Math.round(currentItem.weight || 10));
      setAveragePrice(currentItem.averagePrice ? String(Math.round(currentItem.averagePrice)) : '');
      setHoldingPeriod(currentItem.holdingPeriod || '미입력');
      setRiskTolerance(currentItem.riskTolerance || '중간');
      return;
    }
    setAdded(false);
    setWeight(10);
    setAveragePrice('');
    setHoldingPeriod('미입력');
    setRiskTolerance('중간');
  }, [activeCode, currentItem]);

  const personalContext = { averagePrice, holdingPeriod, riskTolerance };
  const reviewItem = currentItem || (added ? buildLocalPortfolioItem(activeCode, stockName, weight, personalContext) : null);
  const summary = portfolio?.summary || (added ? buildLocalPortfolio(activeCode, stockName, weight, personalContext).summary : null);
  const primaryRisk = reviewItem?.riskNotes?.[0] || `${stockName || activeCode}의 가상 비중과 최근 이벤트를 함께 확인합니다.`;
  const checklist = reviewItem?.nextChecklist?.slice(0, 2) || [];
  const recentEvent = reviewItem?.recentEvents?.[0] || null;
  const displayedAveragePrice = parsePrice(averagePrice);
  const personalSummary = reviewItem
    ? `평균단가 ${displayedAveragePrice ? `${Math.round(displayedAveragePrice).toLocaleString()}원` : '미입력'} · 보유기간 ${holdingPeriod || '미입력'} · 손실허용 ${riskTolerance || '미입력'}`
    : '';

  async function handleSave() {
    const nextWeight = Number(weight);
    const nextAveragePrice = parsePrice(averagePrice);
    const payload = {
      code: activeCode,
      name: stockName || activeCode,
      group: activeStock?.theme || '현재 차트 종목',
      rate: parseRate(activeStock?.changeRate),
      count: null,
      weight: Number.isFinite(nextWeight) ? nextWeight : 10,
      averagePrice: nextAveragePrice,
      holdingPeriod,
      riskTolerance
    };

    setSaving(true);
    setSyncError('');
    try {
      const nextPortfolio = currentItem
        ? await updatePortfolioItemWeight(activeCode, payload)
        : await upsertPortfolioItem(payload);
      setPortfolio(nextPortfolio);
      setAdded(true);
      invalidateAiCachesForStock(activeCode);
      window.dispatchEvent(new CustomEvent('portfolio-sandbox-updated', { detail: { code: activeCode } }));
    } catch {
      setPortfolio(buildLocalPortfolio(activeCode, stockName, payload.weight, payload));
      setAdded(true);
      setSyncError('서버 저장에 실패해 현재 화면 기준으로만 점검 결과를 표시합니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={clsx(styles.overlay, isOpen && styles.open)}>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.sheet} data-testid="portfolio-sandbox-sheet">
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <PieChart size={20} className={styles.icon} />
            <h2>포트폴리오 샌드박스</h2>
          </div>
          <button onClick={onClose} className={styles.closeBtn}><X /></button>
        </div>

        <div className={styles.content}>
          <div className={styles.sandboxWarning}>
            <Info size={14} /> 본 기능은 실계좌 연동이 아닌 <strong>학습용 가상 샌드박스</strong>입니다. 가상 비중만 서버에 저장합니다.
          </div>
          {(loadingPortfolio || syncError) && (
            <div className={clsx(styles.syncNotice, syncError && styles.syncWarning)}>
              <RefreshCw size={14} className={loadingPortfolio ? styles.spinIcon : undefined} />
              <span>{loadingPortfolio ? '서버 포트폴리오를 불러오는 중입니다.' : syncError}</span>
            </div>
          )}
          <p className={styles.desc}>현재 보고 있는 종목을 가상의 포트폴리오에 담고 AI 리스크를 점검해보세요.</p>

          <div className={styles.addSection}>
            <div className={styles.stockInfo} data-testid="portfolio-stock-info">
              <span className={styles.code}>{activeCode}</span>
              <span className={styles.name}>{stockName || '로딩 중'}</span>
            </div>
            
            <div className={styles.weightControl}>
              <label>가상 비중 설정 (%)</label>
              <input 
                type="range" 
                min="1" 
                max="100" 
                value={weight} 
                onChange={(e) => setWeight(e.target.value)} 
              />
              <div className={styles.weightVal}>{weight}%</div>
            </div>

            <div className={styles.personalGrid} aria-label="AI 개인 조건 입력">
              <label>
                <span>평균단가</span>
                <input
                  inputMode="numeric"
                  value={averagePrice}
                  onChange={(event) => setAveragePrice(event.target.value)}
                  placeholder="예: 72000"
                />
              </label>
              <label>
                <span>보유기간</span>
                <select value={holdingPeriod} onChange={(event) => setHoldingPeriod(event.target.value)}>
                  <option value="미입력">미입력</option>
                  <option value="단기">단기</option>
                  <option value="중기">중기</option>
                  <option value="장기">장기</option>
                </select>
              </label>
              <label>
                <span>손실허용</span>
                <select value={riskTolerance} onChange={(event) => setRiskTolerance(event.target.value)}>
                  <option value="낮음">낮음</option>
                  <option value="중간">중간</option>
                  <option value="높음">높음</option>
                </select>
              </label>
            </div>

            <button 
              className={clsx(styles.addBtn, added && styles.addedBtn)}
              onClick={handleSave}
              disabled={saving || !activeCode}
            >
              <PlusCircle size={18} /> {saving ? '저장 중' : added ? '비중 업데이트' : '가상 포트폴리오에 담기'}
            </button>
          </div>

          {added && (
            <div className={styles.aiReviewSection}>
              <h3>AI 포트폴리오 점검</h3>

              {summary && (
                <div className={styles.summaryGrid}>
                  <div>
                    <span>총 가상 비중</span>
                    <strong>{Math.round(summary.totalWeight || 0)}%</strong>
                  </div>
                  <div>
                    <span>최대 비중</span>
                    <strong>{summary.maxWeightStock || '-'} {Math.round(summary.maxWeight || 0)}%</strong>
                  </div>
                </div>
              )}
              
              <div className={styles.reviewCard}>
                <AlertOctagon size={18} className={styles.warnIcon} />
                <div>
                  <h4>비중 점검</h4>
                  <p>{primaryRisk}</p>
                </div>
              </div>

              <div className={styles.reviewCard}>
                <TrendingUp size={18} className={styles.posIcon} />
                <div>
                  <h4>개인 조건</h4>
                  <p>{personalSummary || '평균단가, 보유기간, 손실허용을 입력하면 AI 상담에 함께 반영됩니다.'}</p>
                </div>
              </div>

              <div className={styles.reviewCard}>
                <Info size={18} className={styles.infoIcon} />
                <div>
                  <h4>시나리오 체크리스트</h4>
                  <p>{checklist.length ? checklist.join(' ') : summary?.concentration || '최근 이벤트와 반대 신호를 함께 확인합니다.'}</p>
                </div>
              </div>

              <div className={styles.reviewCard}>
                <Info size={18} className={styles.infoIcon} />
                <div>
                  <h4>최근 이벤트 근거</h4>
                  <p>
                    {recentEvent
                      ? `${recentEvent.date} ${recentEvent.title}: ${recentEvent.explanation || '이벤트 원인과 가격 반응을 함께 확인합니다.'}`
                      : summary?.volatility || '최근 이벤트가 부족하면 새 공시, 뉴스, 거래량 변화를 추가로 확인합니다.'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
