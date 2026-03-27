import { useState, useEffect } from "react";
import type {
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
  | "quota"
  | "no-article";

export default function App() {
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

  const loadModelComparisons = async (articleData: ArticleData | null) => {
    if (!articleData) {
      setModelComparisons([]);
      return;
    }
    try {
      const response = await chrome.runtime.sendMessage({
        type: "GET_MODEL_SCORE_COMPARISON",
        data: articleData,
      });
      const comparisons = Array.isArray(response?.comparisons)
        ? (response.comparisons as ModelScoreComparisonEntry[])
        : [];
      setModelComparisons(comparisons);
    } catch {
      setModelComparisons([]);
    }
  };

  const handleAnalysisResponse = async (
    response: {
    type?: string;
    data?: AnalysisResult;
    error?: string;
    code?: string;
  },
    articleForComparison: ArticleData | null,
  ) => {
    if (response?.type === "ANALYSIS_ERROR") {
      if (response.code === "QUOTA_EXCEEDED") {
        setError(response.error || "Model quota exceeded");
        setState("quota");
        return;
      }
      throw new Error(response.error || "Analysis failed");
    }

    if (!response?.data) {
      throw new Error("No analysis result returned");
    }

    setResult(response.data);
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
        setState("error");
        return;
      }

      if (extractedArticle) {
        setArticle(extractedArticle);
        const status = await chrome.runtime
          .sendMessage({
            type: "GET_ANALYSIS_STATUS",
            data: extractedArticle,
            analysisModel: initialModel,
          })
          .catch(() => ({ inProgress: false }));

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

        if (status?.cached) {
          setResult(status.cached as AnalysisResult);
          setState("done");
          await loadModelComparisons(extractedArticle);
          return;
        }

        setState("idle");
      } else {
        setState("no-article");
      }
    }

    init();
  }, []);

  const analyze = async (forceRefresh = false) => {
    if (!article) return;
    setAnalysisStartedAt(Date.now());
    setState("analyzing");
    setResult(null);
    setModelComparisons([]);
    setError("");

    try {
      const response = await chrome.runtime.sendMessage({
        type: "ANALYZE_ARTICLE",
        data: article,
        forceRefresh,
        analysisModel: selectedModel,
      });
      await handleAnalysisResponse(response || {}, article);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      setState("error");
    }
  };

  const unavailableSelected =
    models.length > 0 &&
    !models.some((m) => m.id === selectedModel && m.available);
  const selectedMeta = models.find((m) => m.id === selectedModel);
  const modelUsedLabel =
    (result?.analysisModel &&
      models.find((m) => m.id === result.analysisModel)?.label) ||
    result?.analysisModel;
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

      <div className="flex-1 flex flex-col p-4">
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
            </div>
            <button
              onClick={() => analyze()}
              disabled={unavailableSelected}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-lg shadow-emerald-900/20"
            >
              Analyze for Misinformation
            </button>
          </div>
        )}

        {state === "analyzing" && <AnalysisProgress startedAt={analysisStartedAt} />}

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

        {state === "quota" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
            <div className="p-3 bg-amber-950/30 rounded-full">
              <Clock className="w-8 h-8 text-amber-400" />
            </div>
            <p className="text-sm text-amber-300 text-center font-semibold">
              Model Limit Reached
            </p>
            <p className="text-xs text-zinc-400 text-center leading-relaxed">
              Your selected model hit rate limits or daily quota.
              Try another model or wait for quota reset.
            </p>
            <div className="w-full p-3 bg-zinc-900 rounded-xl border border-zinc-800 text-xs text-zinc-500 leading-relaxed">
              <p className="font-medium text-zinc-400 mb-1">Options:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Wait for quota reset</li>
                <li>Switch to another configured model</li>
                <li>Upgrade API plan for higher limits</li>
              </ul>
            </div>
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
          </div>
        )}
      </div>
    </div>
  );
}
