import { useState, useEffect, useCallback, useRef } from 'react';
import {
  loadLatestOllamaAfterMarketReport,
  loadStockAi,
  loadStockCoreWorkspace,
  loadStockOllamaInsights,
  prefetchStockWorkspaces
} from '../services/apiClient';

export function useWorkspace(initialCode = '005930', initialInterval = 'daily') {
  const [activeCode, setActiveCode] = useState(initialCode);
  const [interval, setInterval] = useState(initialInterval);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [portfolioRefreshKey, setPortfolioRefreshKey] = useState(0);
  const requestIdRef = useRef(0);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    function handlePortfolioUpdated(event) {
      if (!event.detail?.code || event.detail.code === activeCode) {
        setPortfolioRefreshKey((value) => value + 1);
      }
    }
    window.addEventListener('portfolio-sandbox-updated', handlePortfolioUpdated);
    return () => window.removeEventListener('portfolio-sandbox-updated', handlePortfolioUpdated);
  }, [activeCode]);

  useEffect(() => {
    let mounted = true;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const fetchWorkspace = async () => {
      setLoading(!hasLoadedRef.current);
      setError(null);
      try {
        const workspaceData = await loadStockCoreWorkspace(activeCode, interval);
        const workspaceWithPendingAi = {
          ...workspaceData,
          ai: {
            ...workspaceData.ai,
            aiLayerStatus: 'loading',
            marketReportStatus: 'loading',
            llmProvider: 'ollama',
            modeLabel: 'Ollama 로컬 LLM 준비 중'
          }
        };
        if (mounted && requestId === requestIdRef.current) {
          hasLoadedRef.current = true;
          setData(workspaceWithPendingAi);
          setLoading(false);
          prefetchStockWorkspaces(activeCode, interval);
          let marketReportStarted = false;
          const attachAfterMarketReport = async () => {
            if (marketReportStarted) return;
            marketReportStarted = true;
            try {
              const marketReport = await loadLatestOllamaAfterMarketReport();
              if (!mounted || requestId !== requestIdRef.current) return;
              setData((current) => {
                if (!current || current.stock?.code !== workspaceData.stock?.code || current.chart?.interval !== workspaceData.chart?.interval) {
                  return current;
                }
                return { ...current, ai: { ...current.ai, marketReport, marketReportStatus: 'ready' } };
              });
            } catch {
              if (!mounted || requestId !== requestIdRef.current) return;
              setData((current) => {
                if (!current || current.stock?.code !== workspaceData.stock?.code || current.chart?.interval !== workspaceData.chart?.interval) {
                  return current;
                }
                return { ...current, ai: { ...current.ai, marketReportStatus: 'unavailable' } };
              });
            }
          };
          const mergeAiForCurrentWorkspace = (updater) => {
            setData((current) => {
              if (!current || current.stock?.code !== workspaceData.stock?.code || current.chart?.interval !== workspaceData.chart?.interval) {
                return current;
              }
              return updater(current);
            });
          };
          const loadFallbackAiLayer = async () => {
            try {
              const ai = await loadStockAi(workspaceData, interval);
              if (!mounted || requestId !== requestIdRef.current) return;
              mergeAiForCurrentWorkspace((current) => {
                const currentAi = current.ai || {};
                return {
                  ...current,
                  ai: {
                    ...ai,
                    ollamaInsights: currentAi.ollamaInsights,
                    marketReport: currentAi.marketReport,
                    marketReportStatus: currentAi.marketReportStatus,
                    aiLayerStatus: currentAi.ollamaInsights ? 'ready' : 'fallback_ready',
                    modeLabel: currentAi.ollamaInsights ? currentAi.modeLabel : ai.modeLabel,
                    llmModel: currentAi.ollamaInsights ? currentAi.llmModel : ai.llmModel,
                    llmProvider: currentAi.ollamaInsights ? currentAi.llmProvider : ai.llmProvider,
                    llmUsed: currentAi.ollamaInsights ? currentAi.llmUsed : ai.llmUsed
                  }
                };
              });
            } catch {
              // The core chart remains usable without the secondary AI chat response.
            }
          };
          const loadOllamaLayer = async () => {
            try {
              const ollamaInsights = await loadStockOllamaInsights(workspaceData, interval);
              if (!mounted || requestId !== requestIdRef.current) return;
              mergeAiForCurrentWorkspace((current) => {
                return {
                  ...current,
                  ai: {
                    ...current.ai,
                    ollamaInsights,
                    aiLayerStatus: 'ready',
                    modeLabel: ollamaInsights.modeLabel,
                    llmModel: ollamaInsights.model,
                    llmProvider: 'ollama',
                    llmUsed: ollamaInsights.mode === 'ollama_llm'
                  }
                };
              });
            } catch {
              if (mounted && requestId === requestIdRef.current) {
                mergeAiForCurrentWorkspace((current) => ({
                  ...current,
                  ai: {
                    ...current.ai,
                    aiLayerStatus: current.ai?.aiLayerStatus === 'fallback_ready' ? 'fallback_ready' : 'ollama_failed',
                    modeLabel: 'Ollama 응답 지연, 규칙형 근거 유지'
                  }
                }));
              }
            }
          };
          attachAfterMarketReport();
          loadFallbackAiLayer();
          loadOllamaLayer();
        }
      } catch (err) {
        if (mounted && requestId === requestIdRef.current) {
          setError(err.message || '데이터 로드 실패');
          setLoading(false);
        }
      }
    };
    fetchWorkspace();
    return () => { mounted = false; };
  }, [activeCode, interval, portfolioRefreshKey]);

  const changeInterval = useCallback((newInterval) => {
    setInterval((current) => (current === newInterval ? current : newInterval));
  }, []);

  const changeStock = useCallback((code) => {
    setActiveCode((current) => (current === code ? current : code));
  }, []);

  return {
    activeCode,
    interval,
    data,
    loading,
    error,
    changeStock,
    changeInterval
  };
}
