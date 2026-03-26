import type { VercelRequest, VercelResponse } from "@vercel/node";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ArticleInput {
  url: string;
  title: string;
  body: string;
}

interface Claim {
  id: string;
  text: string;
  status: "verified" | "disputed" | "misleading" | "unverified";
  confidence: number;
  rationale: string;
  fallacies?: string;
  existingDebunk?: {
    claimReviewed: string;
    publisher: string;
    url: string;
    rating: string;
  };
}

interface ToneAlert {
  type: "emotional" | "bias" | "manipulation";
  severity: "low" | "medium" | "high";
  description: string;
  excerpt: string;
}

// ─── Config ─────────────────────────────────────────────────────────────────

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const MAX_RETRIES = 3;
const CLAIM_BATCH_SIZE = 3;
const BATCH_DELAY_MS = 600;

// ─── CORS ───────────────────────────────────────────────────────────────────

function setCors(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization",
  );
}

// ─── Quota Error ────────────────────────────────────────────────────────────

class QuotaExceededError extends Error {
  code = "QUOTA_EXCEEDED";
  constructor(message?: string) {
    super(
      message ||
        "Gemini API daily quota exceeded (250 req/day on free tier). Try again tomorrow.",
    );
  }
}

// ─── Gemini Core ────────────────────────────────────────────────────────────

interface GeminiCallOpts {
  useSearch?: boolean;
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
}

interface GeminiResponse {
  text: string;
  groundingChunks: { web?: { uri: string; title: string } }[];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callGemini(
  prompt: string,
  opts: GeminiCallOpts = {},
): Promise<GeminiResponse> {
  const {
    useSearch = false,
    jsonSchema,
    temperature = 0.15,
    maxOutputTokens = 2048,
  } = opts;

  const genConfig: Record<string, unknown> = {
    temperature,
    maxOutputTokens,
  };

  // JSON structured output (not compatible with google_search on 2.5-flash)
  if (jsonSchema && !useSearch) {
    genConfig.responseMimeType = "application/json";
    genConfig.responseJsonSchema = jsonSchema;
  }

  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: genConfig,
  };

  if (useSearch) {
    body.tools = [{ google_search: {} }];
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      return {
        text: data.candidates?.[0]?.content?.parts?.[0]?.text || "",
        groundingChunks:
          data.candidates?.[0]?.groundingMetadata?.groundingChunks || [],
      };
    }

    if (res.status === 429) {
      if (attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 1500;
        console.warn(
          `Rate limited (429), retry ${attempt + 1}/${MAX_RETRIES} after ${delay}ms`,
        );
        await sleep(delay);
        continue;
      }
      throw new QuotaExceededError();
    }

    const errBody = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${errBody}`);
  }

  throw new Error("callGemini: exhausted retries");
}

// ─── Step 1: Decompose Claims (JSON structured output) ─────────────────────

const DECOMPOSE_SCHEMA = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      description:
        "List of atomic, independently verifiable factual claims extracted from the article",
      items: { type: "string" },
      maxItems: 8,
    },
  },
  required: ["claims"],
};

async function decomposeClaims(
  title: string,
  body: string,
): Promise<string[]> {
  const truncated = body.slice(0, 5000);
  const prompt = `You are a professional fact-checker. Extract individual ATOMIC factual claims from this news article.

Rules:
- Each claim must be a single, specific, verifiable statement of fact
- Split compound claims into separate items ("A and B" → two claims)
- Include concrete numbers, dates, names, and statistics when present in the article
- EXCLUDE: opinions, predictions, direct quotes/attributions, hedged language ("might", "could", "allegedly"), and editorial commentary
- Prioritize the most consequential and checkable claims
- Maximum 8 claims

Article title: ${title}
Article text: ${truncated}`;

  const { text } = await callGemini(prompt, {
    jsonSchema: DECOMPOSE_SCHEMA,
  });

  try {
    const parsed = JSON.parse(text);
    return (parsed.claims || []).filter(
      (c: string) => typeof c === "string" && c.length > 15,
    );
  } catch {
    return text
      .split("\n")
      .map((l) => l.replace(/^\d+[\.)]\s*/, "").trim())
      .filter((l) => l.length > 15);
  }
}

// ─── Step 2+3: Search-Grounded Evaluation (chain-of-thought) ───────────────

const AUTHORITY_DOMAINS: Record<string, number> = {
  ".gov": 0.95,
  ".edu": 0.92,
  "reuters.com": 0.93,
  "apnews.com": 0.93,
  "snopes.com": 0.92,
  "politifact.com": 0.92,
  "factcheck.org": 0.92,
  "bbc.com": 0.88,
  "bbc.co.uk": 0.88,
  "nytimes.com": 0.87,
  "washingtonpost.com": 0.87,
  "nature.com": 0.92,
  "who.int": 0.94,
  "cdc.gov": 0.94,
  "wikipedia.org": 0.7,
};

function scoreSourceAuthority(hostname: string): number {
  for (const [domain, score] of Object.entries(AUTHORITY_DOMAINS)) {
    if (hostname.endsWith(domain)) return score;
  }
  return 0.5;
}

interface ClaimEvaluation {
  status: string;
  confidence: number;
  rationale: string;
  fallacies: string;
  sources: { title: string; url: string; authority: number }[];
}

async function evaluateClaim(
  claimText: string,
): Promise<ClaimEvaluation> {
  // Chain-of-thought prompt forces deeper reasoning before verdict
  const prompt = `You are an expert fact-checker with access to web search. Evaluate this claim step by step.

STEP 1 — SEARCH: Search the web for this claim. Look for official sources, fact-checkers, academic research, and reputable news organizations.
STEP 2 — EVIDENCE: What specific evidence did you find? Do multiple independent sources agree or disagree?
STEP 3 — LOGIC: Does the claim contain any logical fallacies? Check for: ad hominem, straw man, false dichotomy, hasty generalization, appeal to emotion, false cause, slippery slope, cherry-picking.
STEP 4 — VERDICT: Based on ALL evidence and reasoning above, give your assessment.

Respond in EXACTLY this format (5 lines, no extra text):
REASONING: 2-3 sentences summarizing the evidence you found and your analysis
STATUS: verified|disputed|misleading|unverified
CONFIDENCE: 0-100
RATIONALE: one clear sentence for the end user
FALLACIES: none OR comma-separated list of detected fallacies

Claim: ${claimText}`;

  const { text, groundingChunks } = await callGemini(prompt, {
    useSearch: true,
    temperature: 0.1,
  });

  const lines = text.split("\n").filter((l) => l.trim());

  let status = "unverified";
  let confidence = 50;
  let rationale = "Unable to determine";
  let fallacies = "none";

  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("STATUS:")) {
      const val = t.replace("STATUS:", "").trim().toLowerCase();
      if (["verified", "disputed", "misleading", "unverified"].includes(val))
        status = val;
    } else if (t.startsWith("CONFIDENCE:")) {
      const val = parseInt(t.replace("CONFIDENCE:", "").trim(), 10);
      if (!isNaN(val)) confidence = Math.max(0, Math.min(100, val));
    } else if (t.startsWith("RATIONALE:")) {
      rationale = t.replace("RATIONALE:", "").trim();
    } else if (t.startsWith("FALLACIES:")) {
      fallacies = t.replace("FALLACIES:", "").trim();
    }
  }

  // Extract and score sources
  const sources: ClaimEvaluation["sources"] = [];
  for (const chunk of groundingChunks) {
    if (chunk.web?.uri) {
      const hostname = safeHostname(chunk.web.uri);
      sources.push({
        title: chunk.web.title || "Source",
        url: chunk.web.uri,
        authority: scoreSourceAuthority(hostname),
      });
    }
  }

  // Adjust confidence based on source authority
  if (sources.length > 0) {
    const avgAuthority =
      sources.reduce((s, src) => s + src.authority, 0) / sources.length;
    const authorityBoost = (avgAuthority - 0.5) * 20;
    confidence = Math.max(0, Math.min(100, Math.round(confidence + authorityBoost)));
  }

  // Confidence thresholding — prevent bold verdicts on weak evidence
  if (confidence < 55 && status !== "unverified") {
    status = "unverified";
    rationale = `Low confidence (${confidence}%). ${rationale}`;
  }
  if (
    (status === "verified" || status === "disputed") &&
    confidence < 65 &&
    sources.length < 2
  ) {
    status = "unverified";
    rationale = `Insufficient sources to confirm. ${rationale}`;
  }

  return { status, confidence, rationale, fallacies, sources };
}

function safeHostname(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}

// Stagger claim evaluation in batches to avoid rate limits
async function evaluateClaimsBatched(
  claimTexts: string[],
): Promise<PromiseSettledResult<ClaimEvaluation>[]> {
  const allResults: PromiseSettledResult<ClaimEvaluation>[] = [];

  for (let i = 0; i < claimTexts.length; i += CLAIM_BATCH_SIZE) {
    const batch = claimTexts.slice(i, i + CLAIM_BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map((text) => evaluateClaim(text)),
    );
    allResults.push(...batchResults);

    if (i + CLAIM_BATCH_SIZE < claimTexts.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  return allResults;
}

// ─── Step 5: Bias & Tone Detection (JSON structured output) ────────────────

const TONE_SCHEMA = {
  type: "object",
  properties: {
    alerts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["emotional", "bias", "manipulation"],
          },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          description: {
            type: "string",
            description: "Brief description of the issue found",
          },
          excerpt: {
            type: "string",
            description:
              "Short verbatim quote from the article demonstrating the issue",
          },
        },
        required: ["type", "severity", "description", "excerpt"],
      },
    },
  },
  required: ["alerts"],
};

async function detectTone(
  title: string,
  body: string,
): Promise<ToneAlert[]> {
  const truncated = body.slice(0, 4000);
  const prompt = `You are a media literacy expert. Analyze this news article for rhetorical issues.

Check for ALL of the following:
1. EMOTIONAL MANIPULATION — fear-mongering, outrage bait, sensationalism, appeal to pity/fear
2. BIAS — gender bias, racial bias, political slant, one-sided framing, missing counter-arguments
3. MANIPULATION — loaded/misleading language, false equivalence, misleading statistics, missing context, cherry-picked data

Be thorough but avoid false positives. Only flag clear, demonstrable issues with specific evidence from the text.
Return an empty alerts array if the article is fair and balanced.

Article title: ${title}
Article text: ${truncated}`;

  const { text } = await callGemini(prompt, { jsonSchema: TONE_SCHEMA });

  try {
    const parsed = JSON.parse(text);
    return (parsed.alerts || []).filter(
      (a: ToneAlert) =>
        ["emotional", "bias", "manipulation"].includes(a.type) &&
        ["low", "medium", "high"].includes(a.severity) &&
        a.description,
    );
  } catch {
    return [];
  }
}

// ─── Score Calculation ──────────────────────────────────────────────────────

function calculateScore(claims: Claim[], toneAlerts: ToneAlert[]): number {
  if (claims.length === 0) return 50;

  let score = 100;

  for (const claim of claims) {
    const weight = claim.confidence / 100;
    switch (claim.status) {
      case "disputed":
        score -= 25 * weight;
        break;
      case "misleading":
        score -= 15 * weight;
        break;
      case "unverified":
        score -= 3;
        break;
    }
  }

  for (const alert of toneAlerts) {
    switch (alert.severity) {
      case "high":
        score -= 10;
        break;
      case "medium":
        score -= 5;
        break;
      case "low":
        score -= 2;
        break;
    }
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreToGrade(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  if (score >= 20) return "D";
  return "F";
}

// ─── Handler ────────────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res.status(200).json({
      status: "ok",
      endpoint: "/api/check",
      keyConfigured: !!GEMINI_API_KEY,
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!GEMINI_API_KEY) {
    return res
      .status(500)
      .json({ error: "GEMINI_API_KEY not configured on server", code: "NO_KEY" });
  }

  try {
    const { url, title, body } = req.body as ArticleInput;

    if (!title || !body) {
      return res
        .status(400)
        .json({ error: "Missing title or body", code: "BAD_REQUEST" });
    }

    // Step 1 — decompose into atomic verifiable claims
    const claimTexts = await decomposeClaims(title, body);

    // Step 2+3 — search-grounded chain-of-thought evaluation (batched)
    const claimResults = await evaluateClaimsBatched(claimTexts);

    const claims: Claim[] = claimTexts.map((text, i): Claim => {
      const result = claimResults[i];

      if (result.status === "fulfilled") {
        const ev = result.value;
        const topSource = ev.sources[0];
        return {
          id: `claim-${i}`,
          text,
          status: ev.status as Claim["status"],
          confidence: ev.confidence,
          rationale: ev.rationale,
          fallacies:
            ev.fallacies !== "none" ? ev.fallacies : undefined,
          existingDebunk: topSource
            ? {
                claimReviewed: text,
                publisher: safeHostname(topSource.url),
                url: topSource.url,
                rating: ev.status,
              }
            : undefined,
        };
      }

      const reason = result.reason;
      const isQuota = reason instanceof QuotaExceededError;

      return {
        id: `claim-${i}`,
        text,
        status: "unverified",
        confidence: 0,
        rationale: isQuota
          ? "Skipped — API quota exceeded"
          : `Evaluation failed: ${reason?.message || "unknown error"}`,
      };
    });

    // Step 5 — bias and tone detection
    let toneAlerts: ToneAlert[] = [];
    try {
      toneAlerts = await detectTone(title, body);
    } catch (e) {
      if (!(e instanceof QuotaExceededError)) {
        console.error("Tone detection failed (non-fatal):", e);
      }
    }

    // Score & grade
    const trustScore = calculateScore(claims, toneAlerts);
    const grade = scoreToGrade(trustScore);

    // Summary
    let trimmedSummary = `Article received a trust score of ${trustScore}/100 (Grade ${grade}).`;
    try {
      const { text: summary } = await callGemini(
        `In exactly one sentence, summarize the credibility of a news article titled "${title}" with trust score ${trustScore}/100 (Grade ${grade}), ${claims.filter((c) => c.status === "disputed").length} disputed claims, ${claims.filter((c) => c.status === "verified").length} verified claims, and ${toneAlerts.length} tone alerts.`,
      );
      if (summary.trim()) trimmedSummary = summary.trim();
    } catch {
      /* use default summary */
    }

    return res.status(200).json({
      url,
      title,
      trustScore,
      grade,
      claims,
      toneAlerts,
      summary: trimmedSummary,
      analyzedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Pipeline error:", error);

    if (error instanceof QuotaExceededError) {
      return res.status(429).json({
        error: error.message,
        code: "QUOTA_EXCEEDED",
      });
    }

    return res.status(500).json({
      error: error instanceof Error ? error.message : "Internal error",
      code: "INTERNAL_ERROR",
    });
  }
}
