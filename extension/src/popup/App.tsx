import { useState, useEffect } from "react";
import type { ArticleData, AnalysisResult } from "../lib/types";
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

  useEffect(() => {
    async function init() {
      const quotaCheck = chrome.runtime
        .sendMessage({ type: "CHECK_QUOTA" })
        .catch(() => ({ ok: true }));

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

      const quotaResult = await quotaCheck;

      if (quotaResult && !quotaResult.ok && quotaResult.code === "QUOTA_EXCEEDED") {
        if (extractedArticle) setArticle(extractedArticle);
        setError(
          "Gemini API daily quota exceeded (250 req/day on free tier). Try again tomorrow.",
        );
        setState("quota");
        return;
      }

      if (extractedArticle) {
        setArticle(extractedArticle);
        setState("idle");
      } else {
        setState("no-article");
      }
    }

    init();
  }, []);

  const analyze = async (forceRefresh = false) => {
    if (!article) return;
    setState("analyzing");
    setResult(null);
    setError("");

    try {
      const response = await chrome.runtime.sendMessage({
        type: "ANALYZE_ARTICLE",
        data: article,
        forceRefresh,
      });

      if (response?.type === "ANALYSIS_ERROR") {
        if (response.code === "QUOTA_EXCEEDED") {
          setError(response.error);
          setState("quota");
          return;
        }
        throw new Error(response.error);
      }

      setResult(response.data);
      setState("done");

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      setState("error");
    }
  };

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
              Reading page\u2026
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
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-lg shadow-emerald-900/20"
            >
              Analyze for Misinformation
            </button>
          </div>
        )}

        {state === "analyzing" && <AnalysisProgress />}

        {state === "done" && result && (
          <div className="flex flex-col gap-3 overflow-y-auto -mx-1 px-1">
            <NutritionLabel result={result} />
            <button
              onClick={() => analyze(true)}
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
              Daily Quota Reached
            </p>
            <p className="text-xs text-zinc-400 text-center leading-relaxed">
              The free Gemini API tier allows 250 requests per day.
              The quota resets at midnight Pacific Time.
            </p>
            <div className="w-full p-3 bg-zinc-900 rounded-xl border border-zinc-800 text-xs text-zinc-500 leading-relaxed">
              <p className="font-medium text-zinc-400 mb-1">Options:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Wait for the quota to reset (midnight PT)</li>
                <li>Use a different Gemini API key</li>
                <li>Upgrade to Gemini paid tier for higher limits</li>
              </ul>
            </div>
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
