import type {
  ArticleData,
  AnalysisDiagnostics,
  AnalysisResult,
  ModelScoreComparisonEntry,
} from "../lib/types";

declare const __PROXY_URL__: string;
const PROXY_URL = __PROXY_URL__;

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const inFlightAnalyses = new Map<string, Promise<AnalysisResult>>();
const inFlightStartTimes = new Map<string, number>();
const inFlightControllers = new Map<string, AbortController>();

interface CachedAnalysisEntry {
  result: AnalysisResult;
}

type StoredAnalysis = CachedAnalysisEntry | AnalysisResult;

function cacheKey(url: string, analysisModel: string): string {
  return `verity_${analysisModel}_${url}`;
}

function inFlightKey(url: string, analysisModel: string): string {
  return `${analysisModel}::${url}`;
}

async function getCachedResult(
  url: string,
  analysisModel: string,
): Promise<AnalysisResult | null> {
  const key = cacheKey(url, analysisModel);
  const data = await chrome.storage.local.get(key);
  const stored = data[key] as CachedAnalysisEntry | AnalysisResult | undefined;
  if (!stored) return null;

  const cached =
    "result" in stored && stored.result
      ? stored.result
      : (stored as AnalysisResult);

  if (!cached) return null;
  if (cached.url !== url) return null;

  const age = Date.now() - new Date(cached.analyzedAt).getTime();
  if (age > CACHE_TTL_MS) {
    await chrome.storage.local.remove(key);
    return null;
  }
  return cached;
}

async function setCachedResult(
  url: string,
  result: AnalysisResult,
  analysisModel: string,
): Promise<void> {
  const key = cacheKey(url, analysisModel);
  const entry: CachedAnalysisEntry = { result };
  await chrome.storage.local.set({ [key]: entry });
}

function gradeToColor(grade: string): string {
  const colors: Record<string, string> = {
    A: "#22c55e",
    B: "#84cc16",
    C: "#eab308",
    D: "#f97316",
    F: "#ef4444",
  };
  return colors[grade] || "#71717a";
}

async function updateBadge(
  grade: string,
  tabId?: number,
): Promise<void> {
  const opts: chrome.action.BadgeTextDetails = { text: grade };
  const colorOpts: chrome.action.BadgeBackgroundColorDetails = {
    color: gradeToColor(grade),
  };
  if (tabId) {
    opts.tabId = tabId;
    colorOpts.tabId = tabId;
  }
  await chrome.action.setBadgeText(opts);
  await chrome.action.setBadgeBackgroundColor(colorOpts);
}

async function clearCachedResult(
  url: string,
  analysisModel: string,
): Promise<void> {
  const key = cacheKey(url, analysisModel);
  await chrome.storage.local.remove(key);
}

async function getModelScoreComparison(
  article: Pick<ArticleData, "url" | "title" | "body">,
): Promise<ModelScoreComparisonEntry[]> {
  const suffix = `_${article.url}`;
  const all = await chrome.storage.local.get(null);
  const rows: ModelScoreComparisonEntry[] = [];

  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith("verity_") || !key.endsWith(suffix)) continue;
    const modelId = key.slice("verity_".length, key.length - suffix.length);
    if (!modelId) continue;

    const stored = value as StoredAnalysis | undefined;
    if (!stored) continue;

    const cached =
      "result" in stored && stored.result
        ? stored.result
        : (stored as AnalysisResult);

    if (!cached) continue;
    if (cached.url !== article.url) continue;

    const age = Date.now() - new Date(cached.analyzedAt).getTime();
    if (age > CACHE_TTL_MS) continue;

    rows.push({
      modelId,
      analysisModel: cached.analysisModel || modelId,
      trustScore: cached.trustScore,
      grade: cached.grade,
      analyzedAt: cached.analyzedAt,
    });
  }

  return rows.sort((a, b) => b.trustScore - a.trustScore);
}

async function analyzeArticle(
  article: ArticleData,
  forceRefresh = false,
  analysisModel = "gemini-grounded",
  signal?: AbortSignal,
): Promise<AnalysisResult> {
  if (forceRefresh) {
    await clearCachedResult(article.url, analysisModel);
  } else {
    const cached = await getCachedResult(article.url, analysisModel);
    if (cached) return cached;
  }

  const response = await fetch(`${PROXY_URL}/api/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      url: article.url,
      title: article.title,
      body: article.body,
      mediaSummary: article.mediaSummary,
      analysisModel,
    }),
  });

  if (!response.ok) {
    const rawBody = await response.text();
    let errBody: { error?: string; code?: string } = {};
    try {
      errBody = JSON.parse(rawBody) as { error?: string; code?: string };
    } catch {
      errBody = { error: rawBody };
    }
    const code = errBody.code || "";
    const msg = errBody.error || `Proxy error ${response.status}`;
    const details =
      typeof errBody === "object" && errBody && "details" in errBody
        ? (errBody as { details?: unknown }).details
        : undefined;
    throw Object.assign(new Error(msg), { code, details });
  }

  const result: AnalysisResult = await response.json();

  await setCachedResult(article.url, result, analysisModel);

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  await updateBadge(result.grade, tab?.id);

  return result;
}

chrome.runtime.onMessage.addListener(
  (
    message: {
      type: string;
      data?: ArticleData;
      url?: string;
      analysisModel?: string;
      forceRefresh?: boolean;
    },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => {
    if (message.type === "ANALYZE_ARTICLE" && message.data) {
      const forceRefresh = !!message.forceRefresh;
      const analysisModel = message.analysisModel || "gemini-grounded";
      const key = inFlightKey(message.data.url, analysisModel);
      const shouldStartNew = forceRefresh || !inFlightAnalyses.has(key);

      if (shouldStartNew) {
        inFlightStartTimes.set(key, Date.now());
        const controller = new AbortController();
        inFlightControllers.set(key, controller);
        const promise = analyzeArticle(
          message.data,
          forceRefresh,
          analysisModel,
          controller.signal,
        )
          .finally(() => {
            if (inFlightAnalyses.get(key) === promise) {
              inFlightAnalyses.delete(key);
              inFlightStartTimes.delete(key);
              inFlightControllers.delete(key);
            }
          });
        inFlightAnalyses.set(key, promise);
      }

      inFlightAnalyses.get(key)!
        .then((result) =>
          sendResponse({ type: "ANALYSIS_RESULT", data: result }),
        )
        .catch((err: Error & { code?: string; details?: AnalysisDiagnostics }) =>
          sendResponse({
            type: "ANALYSIS_ERROR",
            error: err.message,
            code: err.code || "",
            details: err.details || null,
          }),
        );
      return true;
    }

    if (message.type === "CANCEL_ANALYSIS" && message.url) {
      const analysisModel = message.analysisModel || "gemini-grounded";
      const key = inFlightKey(message.url, analysisModel);
      inFlightControllers.get(key)?.abort();
      inFlightControllers.delete(key);
      inFlightAnalyses.delete(key);
      inFlightStartTimes.delete(key);
      sendResponse({ cancelled: true });
      return true;
    }

    if (message.type === "GET_ANALYSIS_STATUS" && (message.url || message.data)) {
      const analysisModel = message.analysisModel || "gemini-grounded";
      const statusUrl = message.data?.url || message.url!;
      const key = inFlightKey(statusUrl, analysisModel);
      const inProgress = inFlightAnalyses.has(key);

      if (inProgress) {
        sendResponse({
          inProgress: true,
          startedAt: inFlightStartTimes.get(key) || Date.now(),
          cached: null,
        });
        return true;
      }

      getCachedResult(statusUrl, analysisModel)
        .then((cached) =>
          sendResponse({
            inProgress,
            cached: cached || null,
          }),
        )
        .catch(() => sendResponse({ inProgress }));
      return true;
    }

    if (message.type === "GET_MODEL_OPTIONS") {
      fetch(`${PROXY_URL}/api/ping`)
        .then((r) => r.json())
        .then((data) => sendResponse(data))
        .catch(() =>
          sendResponse({
            defaultModel: "gemini-grounded",
            models: [],
          }),
        );
      return true;
    }

    if (message.type === "GET_MODEL_SCORE_COMPARISON" && message.data) {
      getModelScoreComparison(message.data)
        .then((comparisons) => sendResponse({ comparisons }))
        .catch(() => sendResponse({ comparisons: [] }));
      return true;
    }

    if (message.type === "GET_PROXY_URL") {
      sendResponse({ url: PROXY_URL });
      return true;
    }
  },
);

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Verity] Extension installed");
});
