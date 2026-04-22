import type { VercelRequest, VercelResponse } from "@vercel/node";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";

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

  return res.status(200).json({
    ok: true,
    defaultModel: GEMINI_API_KEY
      ? "gemini-grounded"
      : OPENROUTER_API_KEY
        ? "openrouter-free-router"
        : "openai-gpt-4.1-mini",
    models: [
      {
        id: "gemini-grounded",
        label: "Gemini 2.5 Flash + Web Search",
        description: "Best fact-check quality with live web grounding.",
        available: !!GEMINI_API_KEY,
      },
      {
        id: "gemini-fast",
        label: "Gemini 2.5 Flash (No Search)",
        description: "Lower-cost mode without live web search.",
        available: !!GEMINI_API_KEY,
      },
      {
        id: "openai-gpt-4.1-mini",
        label: "OpenAI GPT-4.1 mini",
        description: "Alternative model for lower-cost analysis.",
        available: !!OPENAI_API_KEY,
      },
      {
        id: "openrouter-free-router",
        label: "OpenRouter Free Router",
        description: "Zero-cost router to available free models.",
        available: !!OPENROUTER_API_KEY,
      },
      {
        id: "openrouter-llama-3.2-3b-free",
        label: "Llama 3.2 3B Instruct (Free)",
        description: "Small free model for low-cost quick checks.",
        available: !!OPENROUTER_API_KEY,
      },
    ],
  });
}
