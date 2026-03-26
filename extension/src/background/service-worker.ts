import type { ArticleData, AnalysisResult } from "../lib/types";

declare const __PROXY_URL__: string;
const PROXY_URL = __PROXY_URL__;

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function getCachedResult(
  url: string,
): Promise<AnalysisResult | null> {
  const key = `verity_${url}`;
  const data = await chrome.storage.local.get(key);
  const cached = data[key] as AnalysisResult | undefined;
  if (!cached) return null;
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
): Promise<void> {
  const key = `verity_${url}`;
  await chrome.storage.local.set({ [key]: result });
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

async function clearCachedResult(url: string): Promise<void> {
  const key = `verity_${url}`;
  await chrome.storage.local.remove(key);
}

async function analyzeArticle(
  article: ArticleData,
  forceRefresh = false,
): Promise<AnalysisResult> {
  if (forceRefresh) {
    await clearCachedResult(article.url);
  } else {
    const cached = await getCachedResult(article.url);
    if (cached) return cached;
  }

  const response = await fetch(`${PROXY_URL}/api/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: article.url,
      title: article.title,
      body: article.body,
    }),
  });

  if (!response.ok) {
    let errBody: { error?: string; code?: string } = {};
    try {
      errBody = await response.json();
    } catch {
      errBody = { error: await response.text() };
    }
    const code = errBody.code || "";
    const msg = errBody.error || `Proxy error ${response.status}`;
    throw Object.assign(new Error(msg), { code });
  }

  const result: AnalysisResult = await response.json();

  await setCachedResult(article.url, result);

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  await updateBadge(result.grade, tab?.id);

  return result;
}

chrome.runtime.onMessage.addListener(
  (
    message: { type: string; data?: ArticleData },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => {
    if (message.type === "ANALYZE_ARTICLE" && message.data) {
      const forceRefresh = !!(message as { forceRefresh?: boolean }).forceRefresh;
      analyzeArticle(message.data, forceRefresh)
        .then((result) =>
          sendResponse({ type: "ANALYSIS_RESULT", data: result }),
        )
        .catch((err: Error & { code?: string }) =>
          sendResponse({
            type: "ANALYSIS_ERROR",
            error: err.message,
            code: err.code || "",
          }),
        );
      return true;
    }

    if (message.type === "CHECK_QUOTA") {
      fetch(`${PROXY_URL}/api/ping`)
        .then((r) => r.json())
        .then((data) => sendResponse(data))
        .catch(() => sendResponse({ ok: true }));
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
