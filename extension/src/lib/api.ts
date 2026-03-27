import type { ArticleData, AnalysisResult } from "./types";

const PROXY_URL =
  (typeof import.meta !== "undefined" &&
    (import.meta as Record<string, unknown>).env &&
    (
      (import.meta as unknown as { env: Record<string, string | undefined> })
        .env
    ).VITE_PROXY_URL) ||
  "http://localhost:3000";

export function getProxyUrl(): string {
  return PROXY_URL;
}

export async function analyzeArticle(
  article: ArticleData,
  analysisModel = "gemini-grounded",
): Promise<AnalysisResult> {
  const response = await fetch(`${PROXY_URL}/api/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: article.url,
      title: article.title,
      body: article.body,
      analysisModel,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Analysis failed (${response.status}): ${error}`);
  }

  return response.json();
}

export async function searchFactChecks(
  query: string,
): Promise<{ claims: unknown[] }> {
  const response = await fetch(`${PROXY_URL}/api/factcheck`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error("Fact check search failed");
  }

  return response.json();
}
