import type { VercelRequest, VercelResponse } from "@vercel/node";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

function setCors(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function safeHostname(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      status: "ok",
      endpoint: "/api/factcheck",
      keyConfigured: !!GEMINI_API_KEY,
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!GEMINI_API_KEY) {
    return res
      .status(500)
      .json({ error: "GEMINI_API_KEY not configured on server" });
  }

  const { query } = req.body || {};
  if (!query) {
    return res.status(400).json({ error: "Missing query parameter" });
  }

  try {
    const prompt = `Search the web for fact-checks or authoritative sources about this claim. Return ONLY what you find—no opinions.\n\nClaim: ${query}`;

    const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const groundingChunks: { web?: { uri: string; title: string } }[] =
      data.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

    const claims = groundingChunks
      .filter((c) => c.web?.uri)
      .map((c) => ({
        claimReviewed: query,
        publisher: safeHostname(c.web!.uri),
        url: c.web!.uri,
        rating: text.slice(0, 200),
      }));

    return res.status(200).json({ claims });
  } catch (error) {
    console.error("Fact check search error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Fact check search failed",
    });
  }
}
