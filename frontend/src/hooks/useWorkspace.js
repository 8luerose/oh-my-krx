import { useState, useEffect, useCallback, useRef } from 'react';
import {
  invalidateAfterMarketReportCache,
  invalidateAiCachesForStock,
  loadLatestOllamaAfterMarketReport,
  loadLatestStockOllamaInsights,
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
    let ollamaDelayTimer = null;
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
            ollamaInsightsStatus: 'loading',
            marketReportStatus: 'loading',
            llmProvider: 'ollama',
            modeLabel: 'AI 판단 준비 중'
          }
        };
        if (mounted && requestId === requestIdRef.current) {
          hasLoadedRef.current = true;
          setData(workspaceWithPendingAi);
          setLoading(false);
          prefetchStockWorkspaces(activeCode, interval);
          ollamaDelayTimer = window.setTimeout(() => {
            if (!mounted || requestId !== requestIdRef.current) return;
            setData((current) => {
              if (!current || current.stock?.code !== workspaceData.stock?.code || current.chart?.interval !== workspaceData.chart?.interval) {
                return current;
              }
              if (current.ai?.ollamaInsights || current.ai?.ollamaInsightsStatus !== 'loading') {
                return current;
              }
              return {
                ...current,
                ai: {
                  ...current.ai,
                  ollamaInsightsStatus: 'delayed',
                  aiLayerStatus: current.ai?.aiLayerStatus === 'loading' ? 'ollama_delayed' : current.ai?.aiLayerStatus,
                  modeLabel: 'AI 판단 지연, 완료 시 자동 반영'
                }
              };
            });
          }, 12000);
          const attachStoredOllamaInsight = async () => {
            try {
              const storedOllamaInsights = await loadLatestStockOllamaInsights(workspaceData.stock?.code);
              if (!storedOllamaInsights || !mounted || requestId !== requestIdRef.current) return;
              setData((current) => {
                if (!current || current.stock?.code !== workspaceData.stock?.code || current.chart?.interval !== workspaceData.chart?.interval) {
                  return current;
                }
                if (current.ai?.ollamaInsights && current.ai?.ollamaInsightsStatus === 'ready') {
                  return current;
                }
                return {
                  ...current,
                  ai: {
                    ...current.ai,
                    ollamaInsights: storedOllamaInsights,
                    ollamaInsightsStatus: 'ready',
                    aiLayerStatus: 'cached_ready',
                    modeLabel: storedOllamaInsights.modeLabel,
                    llmModel: storedOllamaInsights.model,
                    llmProvider: 'ollama',
                    llmUsed: storedOllamaInsights.mode === 'ollama_llm',
                    ollamaInsightsRefreshStatus: 'refreshing'
                  }
                };
              });
            } catch {
              // Stored Ollama insights are an acceleration path; fresh calculation still runs below.
            }
          };
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
                    ollamaInsightsStatus: currentAi.ollamaInsightsStatus || (currentAi.ollamaInsights ? 'ready' : 'loading'),
                    ollamaInsightsRefreshStatus: currentAi.ollamaInsightsRefreshStatus,
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
              if (ollamaDelayTimer) {
                window.clearTimeout(ollamaDelayTimer);
                ollamaDelayTimer = null;
              }
              mergeAiForCurrentWorkspace((current) => {
                return {
                  ...current,
                  ai: {
                    ...current.ai,
                    ollamaInsights,
                    ollamaInsightsStatus: 'ready',
                    aiLayerStatus: 'ready',
                    modeLabel: ollamaInsights.modeLabel,
                    llmModel: ollamaInsights.model,
                    llmProvider: 'ollama',
                    llmUsed: ollamaInsights.mode === 'ollama_llm',
                    ollamaInsightsRefreshStatus: 'fresh'
                  }
                };
              });
            } catch {
              if (mounted && requestId === requestIdRef.current) {
                mergeAiForCurrentWorkspace((current) => ({
                  ...current,
                  ai: current.ai?.ollamaInsights
                    ? {
                      ...current.ai,
                      ollamaInsightsStatus: 'ready',
                      aiLayerStatus: 'ready',
                      modeLabel: current.ai.modeLabel || '이전 판단 유지',
                      ollamaInsightsRefreshStatus: 'kept_cached'
                    }
                    : {
                      ...current.ai,
                      ollamaInsightsStatus: 'failed',
                      aiLayerStatus: current.ai?.aiLayerStatus === 'fallback_ready' ? 'fallback_ready' : 'ollama_failed',
                      modeLabel: 'AI 판단 지연, 차트 기준 판단 유지'
                    }
                }));
              }
            }
          };
          attachStoredOllamaInsight();
          loadOllamaLayer().finally(() => {
            if (!mounted || requestId !== requestIdRef.current) return;
            attachAfterMarketReport();
            loadFallbackAiLayer();
          });
        }
      } catch (err) {
        if (mounted && requestId === requestIdRef.current) {
          setError(err.message || '데이터 로드 실패');
          setLoading(false);
        }
      }
    };
    fetchWorkspace();
    return () => {
      mounted = false;
      if (ollamaDelayTimer) window.clearTimeout(ollamaDelayTimer);
    };
  }, [activeCode, interval, portfolioRefreshKey]);

  const changeInterval = useCallback((newInterval) => {
    setInterval((current) => (current === newInterval ? current : newInterval));
  }, []);

  const changeStock = useCallback((code) => {
    setActiveCode((current) => (current === code ? current : code));
  }, []);

  const refreshAi = useCallback(() => {
    invalidateAiCachesForStock(activeCode);
    invalidateAfterMarketReportCache();
    setPortfolioRefreshKey((value) => value + 1);
  }, [activeCode]);

  return {
    activeCode,
    interval,
    data,
    loading,
    error,
    changeStock,
    changeInterval,
    refreshAi
  };
}
