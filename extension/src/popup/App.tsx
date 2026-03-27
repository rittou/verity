import { useState, useEffect, useRef } from "react";
import type {
  AnalysisDiagnostics,
  AnalysisModelOption,
  ArticleData,
  AnalysisResult,
  ModelScoreComparisonEntry,
} from "../lib/types";
import { NutritionLabel } from "./components/NutritionLabel";
import { AnalysisProgress } from "./components/AnalysisProgress";
import { Shield, AlertTriangle, RefreshCw, Clock } from "lucide-react";

type AppState =
  | "idle"
  | "extracting"
  | "analyzing"
  | "done"
  | "error"
  | "limit"
  | "no-article";

export default function App() {
  const requestTokenRef = useRef(0);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<AppState>("extracting");
  const [article, setArticle] = useState<ArticleData | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [selectedModel, setSelectedModel] = useState("gemini-grounded");
  const [models, setModels] = useState<AnalysisModelOption[]>([]);
  const [modelComparisons, setModelComparisons] = useState<
    ModelScoreComparisonEntry[]
  >([]);
  const [analysisStartedAt, setAnalysisStartedAt] = useState<number | undefined>();
  const [limitDetails, setLimitDetails] = useState<AnalysisDiagnostics | null>(null);

  const fetchModelComparisons = async (
    articleData: ArticleData | null,
  ): Promise<ModelScoreComparisonEntry[]> => {
    if (!articleData) return [];
    try {
      const response = await chrome.runtime.sendMessage({
        type: "GET_MODEL_SCORE_COMPARISON",
        data: articleData,
      });
      return Array.isArray(response?.comparisons)
        ? (response.comparisons as ModelScoreComparisonEntry[])
        : [];
    } catch {
      return [];
    }
  };

  const loadModelComparisons = async (articleData: ArticleData | null) => {
    if (!articleData) {
      setModelComparisons([]);
      return [];
    }
    const comparisons = await fetchModelComparisons(articleData);
    setModelComparisons(comparisons);
    return comparisons;
  };

  const loadCachedForModel = async (
    articleData: ArticleData | null,
    modelId: string,
  ) => {
    if (!articleData) {
      return null;
    }

    const status = await chrome.runtime
      .sendMessage({
        type: "GET_ANALYSIS_STATUS",
        data: articleData,
        analysisModel: modelId,
      })
      .catch(() => ({ inProgress: false }));

    const cachedResult = status?.cached
      ? (status.cached as AnalysisResult)
      : null;

    return { status, cachedResult };
  };

  const handleAnalysisResponse = async (
    response: {
      type?: string;
      data?: AnalysisResult;
      error?: string;
      code?: string;
      details?: AnalysisDiagnostics;
    },
    articleForComparison: ArticleData | null,
  ) => {
    if (response?.type === "ANALYSIS_ERROR") {
      if (
        response.code === "MODEL_LIMIT_REACHED" ||
        response.code === "QUOTA_EXCEEDED"
      ) {
        setError(
          conciseErrorMessage(
            response.error || "The model provider limited this request.",
          ),
        );
        setLimitDetails(response.details || null);
        console.warn("[Verity] Model limit details", response.details || {});
        setState("limit");
        return;
      }
      throw new Error(conciseErrorMessage(response.error || "Analysis failed"));
    }

    if (!response?.data) {
      throw new Error("No analysis result returned");
    }

    setResult(response.data);
    setLimitDetails(null);
    setState("done");
    await loadModelComparisons(articleForComparison);

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: "SHOW_OVERLAY",
        data: response.data,
      });
    }
  };

  useEffect(() => {
    async function init() {
      const modelCheck = chrome.runtime
        .sendMessage({ type: "GET_MODEL_OPTIONS" })
        .catch(() => ({ defaultModel: "gemini-grounded", models: [] }));

      let extractedArticle: ArticleData | null = null;
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tab?.id) {
          const response = await chrome.tabs.sendMessage(tab.id, {
            type: "GET_ARTICLE_DATA",
          });
          if (response?.data?.body && response.data.body.length > 100) {
            extractedArticle = response.data;
          }
        }
      } catch {
        // no article
      }

      const modelResult = await modelCheck;
      const modelOptions = Array.isArray(modelResult?.models)
        ? (modelResult.models as AnalysisModelOption[])
        : [];
      setModels(modelOptions);

      const availableModelIds = modelOptions
        .filter((m) => m.available)
        .map((m) => m.id);
      const saved = await chrome.storage.local.get("verity_analysis_model");
      const savedModel = saved.verity_analysis_model as string | undefined;
      const fallback =
        (typeof modelResult?.defaultModel === "string" &&
          modelResult.defaultModel) ||
        "gemini-grounded";
      const initialModel =
        savedModel && availableModelIds.includes(savedModel)
          ? savedModel
          : availableModelIds.includes(fallback)
            ? fallback
            : savedModel || fallback;
      setSelectedModel(initialModel);

      if (
        modelOptions.length > 0 &&
        !modelOptions.some((m) => m.available) &&
        extractedArticle
      ) {
        setArticle(extractedArticle);
        setError("No model is configured on the proxy. Add at least one API key.");
        setLimitDetails(null);
        setState("error");
        return;
      }

      if (extractedArticle) {
        setArticle(extractedArticle);
        await loadModelComparisons(extractedArticle);

        const modelCache = await loadCachedForModel(extractedArticle, initialModel);
        const status = modelCache?.status || { inProgress: false };

        if (status?.inProgress) {
          setAnalysisStartedAt(status.startedAt || Date.now());
          setState("analyzing");
          const response = await chrome.runtime.sendMessage({
            type: "ANALYZE_ARTICLE",
            data: extractedArticle,
            forceRefresh: false,
            analysisModel: initialModel,
          });
          await handleAnalysisResponse(response || {}, extractedArticle);
          return;
        }

        setState("idle");
      } else {
        setState("no-article");
      }
    }

    init();
  }, []);

  useEffect(() => {
    if (!article || !selectedModel) return;
    if (state === "analyzing") return;

    loadModelComparisons(article).catch(() => {});
  }, [article, selectedModel, state]);

  useEffect(() => {
    if (state !== "error" && state !== "limit") return;
    contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [state]);

  const analyze = async (forceRefresh = false) => {
    if (!article) return;
    const requestToken = Date.now();
    requestTokenRef.current = requestToken;
    setAnalysisStartedAt(Date.now());
    setState("analyzing");
    setResult(null);
    setModelComparisons([]);
    setLimitDetails(null);
    setError("");

    try {
      const response = await chrome.runtime.sendMessage({
        type: "ANALYZE_ARTICLE",
        data: article,
        forceRefresh,
        analysisModel: selectedModel,
      });
      if (requestTokenRef.current !== requestToken) return;
      await handleAnalysisResponse(response || {}, article);
    } catch (err) {
      if (requestTokenRef.current !== requestToken) return;
      setError(
        conciseErrorMessage(err instanceof Error ? err.message : "Analysis failed"),
      );
      setState("error");
    }
  };

  const cancelAnalysis = () => {
    requestTokenRef.current += 1;
    if (article) {
      chrome.runtime
        .sendMessage({
          type: "CANCEL_ANALYSIS",
          url: article.url,
          analysisModel: selectedModel,
        })
        .catch(() => {});
    }
    setAnalysisStartedAt(undefined);
    setLimitDetails(null);
    setError("");
    setState(article ? "idle" : "no-article");
  };

  const backToDetectedArticle = () => {
    setError("");
    setLimitDetails(null);
    setResult(null);
    setState(article ? "idle" : "no-article");
  };

  const conciseErrorMessage = (input: string): string => {
    let text = input.replace(/\s+/g, " ").trim();
    const providerSaidIndex = text.toLowerCase().indexOf(" provider said:");
    if (providerSaidIndex > 0) {
      text = text.slice(0, providerSaidIndex).trim();
    }
    const forMoreIndex = text.toLowerCase().indexOf(" for more information");
    if (forMoreIndex > 0) {
      text = text.slice(0, forMoreIndex).trim();
    }
    const urlIndex = text.search(/https?:\/\//i);
    if (urlIndex > 0) {
      text = text.slice(0, urlIndex).trim();
    }
    return text.length > 180 ? `${text.slice(0, 177).trimEnd()}...` : text;
  };

  const unavailableSelected =
    models.length > 0 &&
    !models.some((m) => m.id === selectedModel && m.available);
  const selectedMeta = models.find((m) => m.id === selectedModel);
  const modelUsedLabel =
    (result?.analysisModel &&
      models.find((m) => m.id === result.analysisModel)?.label) ||
    result?.analysisModel;
  const labelForModel = (modelId: string) =>
    models.find((m) => m.id === modelId)?.label || modelId;
  const formatAttemptTime = (attemptedAt: string) =>
    new Date(attemptedAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  const shortAttemptReason = (attempt: {
    limitType?: string;
    outcome: "success" | "limit" | "error";
  }) => {
    if (attempt.limitType === "quota_confirmed") return "Quota reached";
    if (attempt.limitType === "rate_limited") return "Rate limit hit";
    if (attempt.limitType === "limit_unknown") return "Provider returned 429";
    if (attempt.outcome === "error") return "Request failed";
    return "Completed";
  };
  const modelComparisonRows = modelComparisons.map((row) => ({
    ...row,
    modelLabel:
      models.find((m) => m.id === row.analysisModel)?.label ||
      models.find((m) => m.id === row.modelId)?.label ||
      row.analysisModel ||
      row.modelId,
  }));

  const renderModelPicker = (compact = false) => (
    <div className="p-3.5 bg-zinc-900/80 rounded-xl border border-zinc-800/60">
      <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-semibold mb-2">
        Analysis Model
      </p>
      <select
        value={selectedModel}
        onChange={async (e) => {
          const next = e.target.value;
          setSelectedModel(next);
          await chrome.storage.local.set({ verity_analysis_model: next });
        }}
        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-2 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      >
        {models.map((model) => (
          <option
            key={model.id}
            value={model.id}
            disabled={!model.available}
          >
            {model.label}
            {!model.available ? " (Unavailable - Missing API key)" : ""}
          </option>
        ))}
        {models.length === 0 && (
          <option value="gemini-grounded">Gemini + Web Search</option>
        )}
      </select>
      {selectedMeta?.description && (
        <p className={`text-[11px] text-zinc-500 ${compact ? "mt-1" : "mt-1.5"}`}>
          {selectedMeta.description}
        </p>
      )}
      {modelUsedLabel && result && (
        <p className={`text-[11px] text-zinc-500 ${compact ? "mt-1" : "mt-1.5"}`}>
          Last run used: {modelUsedLabel}
        </p>
      )}
    </div>
  );

  return (
    <div className="flex flex-col min-h-[520px]">
      <header className="sticky top-0 z-10 bg-zinc-950/90 backdrop-blur-sm flex items-center gap-2.5 px-4 py-3 border-b border-zinc-800/80">
        <div className="p-1.5 bg-emerald-500/10 rounded-lg">
          <Shield className="w-4 h-4 text-emerald-400" />
        </div>
        <h1 className="text-[15px] font-semibold tracking-tight">Verity</h1>
        <span className="text-[10px] text-zinc-600 ml-auto uppercase tracking-wider font-medium">
          Fact Checker
        </span>
      </header>

      <div ref={contentRef} className="flex-1 flex flex-col overflow-y-auto p-4">
        {state === "extracting" && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-zinc-500 animate-pulse">
              Reading page...
            </p>
          </div>
        )}

        {state === "no-article" && (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 px-6">
            <div className="p-3 bg-zinc-900 rounded-full">
              <AlertTriangle className="w-8 h-8 text-zinc-600" />
            </div>
            <p className="text-sm text-zinc-400 font-medium">
              No article detected
            </p>
            <p className="text-xs text-zinc-600 leading-relaxed">
              Navigate to a news article and click the Verity icon to
              fact-check it.
            </p>
          </div>
        )}

        {state === "idle" && article && (
          <div className="flex flex-col gap-4">
            {renderModelPicker()}
            <div className="p-3.5 bg-zinc-900/80 rounded-xl border border-zinc-800/60">
              <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-semibold mb-1.5">
                Detected Article
              </p>
              <p className="text-[13px] font-medium leading-snug text-zinc-200">
                {article.title}
              </p>
              {article.siteName && (
                <p className="text-[11px] text-zinc-500 mt-1.5">
                  {article.siteName}
                </p>
              )}
              <p className="text-[11px] text-zinc-600 mt-1">
                {article.body.length.toLocaleString()} chars extracted
              </p>
              <p className="text-[11px] text-zinc-600 mt-1">
                {article.mediaSummary?.imageCount || 0} images,{" "}
                {article.mediaSummary?.videoCount || 0} videos detected.
                Analysis currently uses text only.
              </p>
            </div>
            <button
              onClick={() => analyze()}
              disabled={unavailableSelected}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-lg shadow-emerald-900/20"
            >
              Analyze for Misinformation
            </button>
            {modelComparisonRows.length > 0 && (
              <div className="p-3 bg-zinc-900/70 rounded-xl border border-zinc-800/70">
                <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-semibold">
                  Previous Scores
                </p>
                <div className="mt-2 space-y-2">
                  {modelComparisonRows.map((scoreRow) => (
                    <div
                      key={`${scoreRow.analysisModel || scoreRow.modelId}-${scoreRow.analyzedAt}`}
                      className="rounded-lg border border-zinc-800/80 bg-zinc-950/70 px-2.5 py-2"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm font-semibold text-zinc-200">
                          {scoreRow.trustScore}/100 ({scoreRow.grade})
                        </p>
                        <p className="text-[11px] text-zinc-500">
                          {scoreRow.modelLabel}
                        </p>
                      </div>
                      <p className="text-[11px] text-zinc-500 mt-1.5">
                        {new Date(scoreRow.analyzedAt).toLocaleString()}
                      </p>
                      <button
                        onClick={async () => {
                          const modelId =
                            scoreRow.analysisModel || scoreRow.modelId;
                          const previousCache = await loadCachedForModel(
                            article,
                            modelId,
                          );
                          if (previousCache?.cachedResult) {
                            setResult(previousCache.cachedResult);
                            setState("done");
                          }
                        }}
                        className="mt-2 text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors"
                      >
                        View report
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {state === "analyzing" && (
          <div className="flex-1 w-full flex flex-col items-center justify-center gap-4">
            <AnalysisProgress startedAt={analysisStartedAt} />
            <button
              onClick={cancelAnalysis}
              className="py-2 px-4 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Cancel Analysis
            </button>
          </div>
        )}

        {state === "done" && result && (
          <div className="flex flex-col gap-3 overflow-y-auto -mx-1 px-1">
            <NutritionLabel
              result={result}
              modelUsedLabel={modelUsedLabel}
              modelComparisons={modelComparisonRows}
            />
            {renderModelPicker(true)}
            <button
              onClick={() => analyze(true)}
              disabled={unavailableSelected}
              className="flex items-center justify-center gap-1.5 py-2.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Re-analyze
            </button>
          </div>
        )}

        {state === "limit" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
            <div className="p-3 bg-amber-950/30 rounded-full">
              <Clock className="w-8 h-8 text-amber-400" />
            </div>
            <p className="text-sm text-amber-300 text-center font-semibold">
              Provider Limit Reached
            </p>
            <p className="text-xs text-zinc-400 text-center leading-relaxed">
              {error || "The model provider blocked this request."}
            </p>
            <div className="w-full p-3 bg-zinc-900 rounded-xl border border-zinc-800 text-xs text-zinc-500 leading-relaxed">
              <p className="font-medium text-zinc-400 mb-1">Options:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Retry after a short wait if it looks like a burst rate limit</li>
                <li>Switch to another configured model</li>
                <li>Upgrade or replenish the provider plan if quota is confirmed</li>
              </ul>
            </div>
            {limitDetails?.attempts?.length ? (
              <div className="w-full p-3 bg-zinc-900 rounded-xl border border-zinc-800">
                <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-semibold mb-2">
                  Attempt Log
                </p>
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {limitDetails.attempts.map((attempt) => {
                    return (
                      <div
                        key={`${attempt.modelId}-${attempt.attemptedAt}-${attempt.outcome}`}
                        className="rounded-lg border border-zinc-800/80 bg-zinc-950/70 px-2.5 py-2"
                      >
                        <p className="text-[11px] text-zinc-300 font-medium">
                          {labelForModel(attempt.modelId)}
                        </p>
                        <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                          {formatAttemptTime(attempt.attemptedAt)} ·{" "}
                          {shortAttemptReason(attempt)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <div className="w-full">
              {renderModelPicker(true)}
            </div>
            <button
              onClick={() => analyze(true)}
              disabled={unavailableSelected}
              className="py-2.5 px-5 text-sm text-zinc-300 bg-zinc-800 rounded-xl hover:bg-zinc-700 transition-colors font-medium"
            >
              Try with Selected Model
            </button>
            <button
              onClick={backToDetectedArticle}
              className="py-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Back to Detected Article
            </button>
          </div>
        )}

        {state === "error" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
            <div className="p-3 bg-red-950/30 rounded-full">
              <AlertTriangle className="w-8 h-8 text-red-400" />
            </div>
            <p className="text-sm text-red-400 text-center font-medium">
              {error}
            </p>
            <button
              onClick={() => analyze()}
              className="py-2.5 px-5 text-sm text-zinc-300 bg-zinc-800 rounded-xl hover:bg-zinc-700 transition-colors font-medium"
            >
              Retry
            </button>
            <button
              onClick={backToDetectedArticle}
              className="py-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Back to Detected Article
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
