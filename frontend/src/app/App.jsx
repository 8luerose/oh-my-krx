import React, { useEffect, useMemo, useState } from 'react';
import { useWorkspace } from '../hooks/useWorkspace';
import { loadLearningTerms, loadStockOptions } from '../services/apiClient';
import ImmersiveChart from '../components/ImmersiveChart';
import FloatingAiCard from '../components/FloatingAiCard';
import FloatingLearningMode from '../components/FloatingLearningMode';
import DeepDiveLearningSheet from '../components/DeepDiveLearningSheet';
import HiddenAdminSheet from '../components/HiddenAdminSheet';
import PortfolioSandbox from '../components/PortfolioSandbox';
import { Activity, Briefcase } from 'lucide-react';
import styles from './App.module.css';

function intervalLabel(interval) {
  if (interval === 'weekly') return '1주';
  if (interval === 'monthly') return '1개월';
  return '1일';
}

function buildPipelineToast({ data, activeCode, interval, loading }) {
  const waitingAiSteps = [
    { label: '상담', state: 'waiting' },
    { label: '뉴스', state: 'waiting' },
    { label: '장후', state: 'waiting' }
  ];
  if (!data && loading) {
    return {
      title: '초기 차트 준비 중',
      detail: 'TradingView 차트와 기본 브리프를 불러오고 있습니다.',
      tone: 'loading',
      steps: waitingAiSteps
    };
  }
  if (!data) return null;

  if (data.stock?.code !== activeCode) {
    return {
      title: `${activeCode} 차트 불러오는 중`,
      detail: `${intervalLabel(interval)} 차트, 매매 구간, 뉴스 근거를 먼저 준비합니다.`,
      tone: 'loading',
      steps: waitingAiSteps
    };
  }

  const aiStatus = data.ai?.aiLayerStatus || (data.ai?.ollamaInsights ? 'ready' : '');
  const ollamaStatus = data.ai?.ollamaInsightsStatus
    || (data.ai?.ollamaInsights ? 'ready' : aiStatus === 'ollama_failed' ? 'failed' : aiStatus === 'loading' ? 'loading' : 'waiting');
  const reportStatus = data.ai?.marketReportStatus || (data.ai?.marketReport ? 'ready' : '');
  if (ollamaStatus === 'loading') {
    return {
      title: `${data.stock?.name || activeCode} Ollama 3대 기능 실행 중`,
      detail: '상담 의견과 뉴스 방향을 계산하고, 장후 리포트 저장본을 함께 확인합니다.',
      tone: 'loading',
      steps: [
        { label: '상담', state: 'loading' },
        { label: '뉴스', state: 'loading' },
        { label: '장후', state: reportStatus === 'ready' ? 'ready' : 'loading' }
      ]
    };
  }
  if (ollamaStatus === 'failed') {
    return {
      title: 'Ollama 응답 지연',
      detail: '화면은 규칙형 근거로 유지하고, 로컬 LLM 응답은 다시 붙일 수 있습니다.',
      tone: 'delayed',
      steps: [
        { label: '상담', state: 'delayed' },
        { label: '뉴스', state: 'delayed' },
        { label: '장후', state: reportStatus === 'ready' ? 'ready' : 'waiting' }
      ]
    };
  }
  if (reportStatus === 'loading') {
    return {
      title: '장후 리포트 확인 중',
      detail: '저장된 일간 브리프에 Ollama 시장 코멘트를 연결하고 있습니다.',
      tone: 'loading',
      steps: [
        { label: '상담', state: 'ready' },
        { label: '뉴스', state: 'ready' },
        { label: '장후', state: 'loading' }
      ]
    };
  }
  return null;
}

function App() {
  const {
    activeCode,
    interval,
    data,
    loading,
    error,
    changeStock,
    changeInterval
  } = useWorkspace();

  const [learningMode, setLearningMode] = useState(false);
  const [learningSheetOpen, setLearningSheetOpen] = useState(false);
  const [termData, setTermData] = useState(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [stockOptions, setStockOptions] = useState([]);
  const pipelineToast = useMemo(
    () => buildPipelineToast({ data, activeCode, interval, loading }),
    [activeCode, data, interval, loading]
  );

  const chartContext = useMemo(() => {
    if (!data) return null;
    const latest = data.chart?.rows?.[data.chart.rows.length - 1] || null;
    return {
      stockName: data.stock?.name,
      code: data.stock?.code,
      asOf: data.asOf,
      interval,
      latestClose: latest?.close,
      latestVolume: latest?.volume,
      ma20: data.indicatorSnapshot?.movingAverages?.ma20,
      supportLevel: data.indicatorSnapshot?.supportLevel,
      resistanceLevel: data.indicatorSnapshot?.resistanceLevel,
      priceVsMa20: data.indicatorSnapshot?.priceVsMa20,
      summary: data.currentDecisionSummary?.summary,
      buyCondition: data.currentDecisionSummary?.buyReviewCondition,
      riskCondition: data.currentDecisionSummary?.riskCondition
    };
  }, [data, interval]);

  useEffect(() => {
    let mounted = true;
    loadStockOptions()
      .then((options) => {
        if (mounted) setStockOptions(options);
      })
      .catch(() => {
        if (mounted) setStockOptions([]);
      });
    return () => { mounted = false; };
  }, []);

  const handleToggleLearningMode = () => {
    if (!learningMode) {
      setLearningMode(true);
      // Just toggle the mode, don't open the sheet automatically unless a term is selected
    } else {
      setLearningMode(false);
      setLearningSheetOpen(false);
    }
  };

  const handleSelectTerm = async (termName) => {
    try {
      const terms = await loadLearningTerms();
      const found = terms.find(t => t.term === termName || t.title === termName);
      if (found) {
        setTermData(found);
      } else {
        // Create a fallback object if not found
        setTermData({
          term: termName,
          coreSummary: '용어 설명을 준비 중입니다.',
          longExplanation: '학습 콘텐츠가 아직 등록되지 않았습니다.',
          chartUsage: '차트에서 어떻게 보는지 업데이트 예정입니다.',
          commonMisunderstanding: '알려진 오해가 없습니다.',
          scenario: '실전 시나리오는 준비 중입니다.',
          askEntry: `${termName}에 대해 질문하기`
        });
      }
      setLearningMode(true);
      setLearningSheetOpen(true);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className={styles.appContainer}>
      {/* Background Hero Layer */}
      <div className={styles.chartLayer}>
        {data && (
          <ImmersiveChart 
            stock={data.stock} 
            chart={data.chart} 
            zones={data.zones} 
            events={data.events}
            ai={data.ai}
            indicatorSnapshot={data.indicatorSnapshot}
            decisionSummary={data.currentDecisionSummary}
            interval={interval}
            onChangeInterval={changeInterval}
            stockOptions={stockOptions}
            onChangeStock={changeStock}
            learningMode={learningMode}
            onTermClick={handleSelectTerm}
          />
        )}
      </div>

      {/* Loading Overlay */}
      {loading && !data && (
        <div className={styles.loadingOverlay}>
          <div className={styles.spinner} />
        </div>
      )}

      {/* Error / Fallback Toast */}
      {error && (
        <div className={styles.errorToast}>
          {error}
        </div>
      )}

      {pipelineToast && (
        <div className={styles.pipelineToast} data-testid="pipeline-toast" role="status" aria-live="polite">
          <Activity size={16} aria-hidden="true" />
          <div className={styles.pipelineToastBody}>
            <strong>{pipelineToast.title}</strong>
            <span>{pipelineToast.detail}</span>
          </div>
          <div className={styles.pipelineToastSteps} aria-label="데이터와 AI 준비 단계">
            {pipelineToast.steps.map((step) => (
              <span
                key={step.label}
                className={styles[`pipelineStep_${step.state}`] || ''}
              >
                {step.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Floating UI Layer */}
      <div className={styles.uiLayer}>
        {data && (
          <div className={styles.rightActionGroup}>
            <FloatingLearningMode
              isActive={learningMode}
              onToggle={handleToggleLearningMode}
            />
            <button
              className={styles.floatingIconBtn}
              onClick={() => setPortfolioOpen(true)}
              aria-label="Open Portfolio"
              title="포트폴리오 샌드박스"
            >
              <Briefcase size={20} />
            </button>
          </div>
        )}
        {data && !loading && (
          <FloatingAiCard ai={data.ai} events={data.events} asOf={data.asOf} />
        )}
      </div>

      <DeepDiveLearningSheet 
        isOpen={learningSheetOpen} 
        onClose={() => setLearningSheetOpen(false)} 
        termData={termData}
        chartContext={chartContext}
      />

      <PortfolioSandbox 
        isOpen={portfolioOpen} 
        onClose={() => setPortfolioOpen(false)} 
        activeCode={activeCode} 
        stockName={data?.stock?.name}
        activeStock={data?.stock}
      />

      <HiddenAdminSheet isOpen={adminOpen} onClose={() => setAdminOpen(false)} asOf={data?.asOf} />

      {/* Hidden toggle for admin in top left corner (developer friendly) */}
      <button 
        className={styles.secretAdminToggle} 
        onDoubleClick={() => setAdminOpen(true)}
        aria-label="Open Admin"
      />
    </div>
  );
}

export default App;
