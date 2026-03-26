import type { VercelRequest, VercelResponse } from "@vercel/node";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

function setCors(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization",
  );
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();

  if (!GEMINI_API_KEY) {
    return res.status(200).json({ ok: false, code: "NO_KEY" });
  }

  try {
    const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Say ok" }] }],
        generationConfig: { maxOutputTokens: 3 },
      }),
    });

    if (response.status === 429) {
      return res.status(200).json({ ok: false, code: "QUOTA_EXCEEDED" });
    }

    if (!response.ok) {
      return res.status(200).json({ ok: false, code: "API_ERROR" });
    }

    return res.status(200).json({ ok: true });
  } catch {
    return res.status(200).json({ ok: false, code: "NETWORK_ERROR" });
  }
}
