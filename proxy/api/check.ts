import type { VercelRequest, VercelResponse } from "@vercel/node";

interface ArticleInput {
  url: string;
  title: string;
  body: string;
  mediaSummary?: MediaSummary;
  analysisModel?: string;
}

interface MediaSummary {
  imageCount: number;
  videoCount: number;
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

type ModelProvider = "gemini" | "openai" | "openrouter";
type AnalysisStage =
  | "claim_decomposition"
  | "claim_evaluation"
  | "tone_detection";
type ModelLimitType =
  | "quota_confirmed"
  | "rate_limited"
  | "limit_unknown";

interface ModelConfig {
  id: string;
  label: string;
  provider: ModelProvider;
  modelName: string;
  supportsWebSearch: boolean;
}

interface LlmCallOpts {
  useSearch?: boolean;
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
  stage?: AnalysisStage;
}

interface LlmResponse {
  text: string;
  groundingChunks: { web?: { uri: string; title: string } }[];
}

interface ClaimEvaluation {
  index: number;
  status: Claim["status"];
  confidence: number;
  rationale: string;
  fallacies: string;
  sources: { title: string; url: string; authority: number }[];
}

interface AnalysisScope {
  articleTextIncluded: boolean;
  imagesDetected: number;
  videosDetected: number;
  imagesAnalyzed: boolean;
  videosAnalyzed: boolean;
  note: string;
}

interface ModelAttemptDiagnostic {
  modelId: string;
  provider: ModelProvider;
  outcome: "success" | "limit" | "error";
  stage?: AnalysisStage;
  message: string;
  attemptedAt: string;
  httpStatus?: number;
  providerCode?: string;
  requestId?: string;
  retryAfterSeconds?: number;
  limitType?: ModelLimitType;
}

interface AnalysisDiagnostics {
  attempts: ModelAttemptDiagnostic[];
}

interface ProviderErrorPayload {
  rawBody: string;
  providerMessage: string;
  providerCode?: string;
  requestId?: string;
  retryAfterSeconds?: number;
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";

const GEMINI_URL_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const MAX_RETRIES = 3;
const MAX_ARTICLE_CHARS = 3600;
const MAX_CLAIMS = 5;

const MODELS: ModelConfig[] = [
  {
    id: "gemini-grounded",
    label: "Gemini 2.5 Flash + Web Search",
    provider: "gemini",
    modelName: "gemini-2.5-flash",
    supportsWebSearch: true,
  },
  {
    id: "gemini-fast",
    label: "Gemini 2.5 Flash (No Search)",
    provider: "gemini",
    modelName: "gemini-2.5-flash",
    supportsWebSearch: false,
  },
  {
    id: "openai-gpt-4.1-mini",
    label: "OpenAI GPT-4.1 mini",
    provider: "openai",
    modelName: "gpt-4.1-mini",
    supportsWebSearch: false,
  },
  {
    id: "openrouter-free-router",
    label: "OpenRouter Free Router",
    provider: "openrouter",
    modelName: "openrouter/free",
    supportsWebSearch: false,
  },
  {
    id: "openrouter-llama-3.2-3b-free",
    label: "Llama 3.2 3B Instruct (Free)",
    provider: "openrouter",
    modelName: "meta-llama/llama-3.2-3b-instruct:free",
    supportsWebSearch: false,
  },
];

const DECOMPOSE_SCHEMA = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      items: { type: "string" },
      maxItems: MAX_CLAIMS,
    },
  },
  required: ["claims"],
};

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
          description: { type: "string" },
          excerpt: { type: "string" },
        },
        required: ["type", "severity", "description", "excerpt"],
      },
    },
  },
  required: ["alerts"],
};

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

class ModelLimitError extends Error {
  code = "MODEL_LIMIT_REACHED";
  readonly limitType: ModelLimitType;
  readonly provider: ModelProvider;
  readonly modelId: string;
  readonly stage?: AnalysisStage;
  readonly httpStatus: number;
  readonly providerCode?: string;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;

  constructor(input: {
    provider: ModelProvider;
    modelId: string;
    stage?: AnalysisStage;
    httpStatus: number;
    limitType: ModelLimitType;
    providerCode?: string;
    providerMessage?: string;
    requestId?: string;
    retryAfterSeconds?: number;
  }) {
    super(buildLimitMessage(input.provider, input.limitType, input.providerMessage));
    this.limitType = input.limitType;
    this.provider = input.provider;
    this.modelId = input.modelId;
    this.stage = input.stage;
    this.httpStatus = input.httpStatus;
    this.providerCode = input.providerCode;
    this.requestId = input.requestId;
    this.retryAfterSeconds = input.retryAfterSeconds;
  }

  toDiagnostic(): ModelAttemptDiagnostic {
    return {
      modelId: this.modelId,
      provider: this.provider,
      outcome: "limit",
      stage: this.stage,
      message: this.message,
      attemptedAt: new Date().toISOString(),
      httpStatus: this.httpStatus,
      providerCode: this.providerCode,
      requestId: this.requestId,
      retryAfterSeconds: this.retryAfterSeconds,
      limitType: this.limitType,
    };
  }
}

function providerLabel(provider: ModelProvider): string {
  if (provider === "openai") return "OpenAI";
  if (provider === "openrouter") return "OpenRouter";
  return "Gemini";
}

function buildLimitMessage(
  provider: ModelProvider,
  limitType: ModelLimitType,
): string {
  const label = providerLabel(provider);

  if (limitType === "quota_confirmed") {
    return `${label} confirmed that this request is out of quota.`;
  }

  if (limitType === "rate_limited") {
    return `${label} rate-limited this request.`;
  }

  return `${label} returned HTTP 429, but did not clearly confirm whether this is quota exhaustion or temporary rate limiting.`;
}

function truncateForLog(input: string, maxLen = 500): string {
  if (input.length <= maxLen) return input;
  return `${input.slice(0, maxLen)}…`;
}

function parseJsonSafely(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function getObjectValue(
  value: unknown,
  key: string,
): unknown {
  if (!value || typeof value !== "object") return undefined;
  return (value as Record<string, unknown>)[key];
}

function extractProviderMessage(parsedBody: unknown, rawBody: string): string {
  const directMessage = getObjectValue(parsedBody, "message");
  if (typeof directMessage === "string" && directMessage.trim()) {
    return directMessage.trim();
  }

  const errorValue = getObjectValue(parsedBody, "error");
  if (typeof errorValue === "string" && errorValue.trim()) {
    return errorValue.trim();
  }

  const errorMessage = getObjectValue(errorValue, "message");
  if (typeof errorMessage === "string" && errorMessage.trim()) {
    return errorMessage.trim();
  }

  return rawBody.trim();
}

function extractProviderCode(parsedBody: unknown): string | undefined {
  const directCode = getObjectValue(parsedBody, "code");
  if (typeof directCode === "string" && directCode.trim()) {
    return directCode.trim();
  }

  const errorValue = getObjectValue(parsedBody, "error");
  const errorCode = getObjectValue(errorValue, "code");
  if (typeof errorCode === "string" && errorCode.trim()) {
    return errorCode.trim();
  }

  const errorType = getObjectValue(errorValue, "type");
  if (typeof errorType === "string" && errorType.trim()) {
    return errorType.trim();
  }

  const errorStatus = getObjectValue(errorValue, "status");
  if (typeof errorStatus === "string" && errorStatus.trim()) {
    return errorStatus.trim();
  }

  return undefined;
}

function parseRetryAfterSeconds(value: string | null): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return numeric;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return undefined;

  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
}

function classifyLimitType(
  providerCode: string | undefined,
  providerMessage: string,
  rawBody: string,
): ModelLimitType {
  const haystack = `${providerCode || ""} ${providerMessage} ${rawBody}`.toLowerCase();

  if (
    /insufficient_quota|quota|daily limit|billing|credit balance|payment required/.test(
      haystack,
    )
  ) {
    return "quota_confirmed";
  }

  if (/rate limit|rate_limit|too many requests|retry after/.test(haystack)) {
    return "rate_limited";
  }

  return "limit_unknown";
}

async function readProviderErrorPayload(
  res: Response,
): Promise<ProviderErrorPayload> {
  const rawBody = await res.text();
  const parsedBody = parseJsonSafely(rawBody);
  return {
    rawBody,
    providerMessage: extractProviderMessage(parsedBody, rawBody),
    providerCode: extractProviderCode(parsedBody),
    requestId:
      res.headers.get("x-request-id") ||
      res.headers.get("request-id") ||
      res.headers.get("x-vercel-id") ||
      undefined,
    retryAfterSeconds: parseRetryAfterSeconds(res.headers.get("retry-after")),
  };
}

function createModelLimitError(input: {
  provider: ModelProvider;
  modelId: string;
  stage?: AnalysisStage;
  res: Response;
  payload: ProviderErrorPayload;
}): ModelLimitError {
  const { provider, modelId, stage, res, payload } = input;
  const limitType = classifyLimitType(
    payload.providerCode,
    payload.providerMessage,
    payload.rawBody,
  );

  console.warn("[Verity][provider-limit]", {
    provider,
    modelId,
    stage,
    httpStatus: res.status,
    limitType,
    providerCode: payload.providerCode,
    requestId: payload.requestId,
    retryAfterSeconds: payload.retryAfterSeconds,
    providerMessage: truncateForLog(payload.providerMessage || payload.rawBody),
    rawBody: truncateForLog(payload.rawBody),
  });

  return new ModelLimitError({
    provider,
    modelId,
    stage,
    httpStatus: res.status,
    limitType,
    providerCode: payload.providerCode,
    providerMessage: payload.providerMessage,
    requestId: payload.requestId,
    retryAfterSeconds: payload.retryAfterSeconds,
  });
}

function buildAnalysisScope(mediaSummary?: MediaSummary): AnalysisScope {
  const imagesDetected = mediaSummary?.imageCount || 0;
  const videosDetected = mediaSummary?.videoCount || 0;

  return {
    articleTextIncluded: true,
    imagesDetected,
    videosDetected,
    imagesAnalyzed: false,
    videosAnalyzed: false,
    note:
      imagesDetected > 0 || videosDetected > 0
        ? `Detected ${imagesDetected} image${imagesDetected === 1 ? "" : "s"} and ${videosDetected} video${videosDetected === 1 ? "" : "s"} on the page, but the current analysis only sends extracted article text to the model.`
        : "The current analysis only sends extracted article text to the model. No page images or videos are included yet.",
  };
}

function setCors(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization",
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getModelById(id?: string): ModelConfig {
  if (!id) return MODELS[0];
  return MODELS.find((m) => m.id === id) || MODELS[0];
}

function isModelConfigured(model: ModelConfig): boolean {
  if (model.provider === "gemini") return !!GEMINI_API_KEY;
  if (model.provider === "openai") return !!OPENAI_API_KEY;
  return !!OPENROUTER_API_KEY;
}

function safeHostname(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}

function scoreSourceAuthority(hostname: string): number {
  for (const [domain, score] of Object.entries(AUTHORITY_DOMAINS)) {
    if (hostname.endsWith(domain)) return score;
  }
  return 0.5;
}

async function callGemini(
  prompt: string,
  model: ModelConfig,
  opts: LlmCallOpts,
): Promise<LlmResponse> {
  const {
    useSearch = false,
    jsonSchema,
    temperature = 0.15,
    maxOutputTokens = 1536,
    stage,
  } = opts;

  const genConfig: Record<string, unknown> = {
    temperature,
    maxOutputTokens,
  };

  if (jsonSchema && !useSearch) {
    genConfig.responseMimeType = "application/json";
    genConfig.responseJsonSchema = jsonSchema;
  }

  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: genConfig,
  };

  if (useSearch && model.supportsWebSearch) {
    body.tools = [{ google_search: {} }];
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(
      `${GEMINI_URL_BASE}/${model.modelName}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    if (res.ok) {
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      if (!text && data.candidates?.[0]?.finishReason === "SAFETY") {
        throw new Error("Response blocked by Gemini safety filters");
      }
      return {
        text,
        groundingChunks:
          data.candidates?.[0]?.groundingMetadata?.groundingChunks || [],
      };
    }

    if (res.status === 429) {
      const payload = await readProviderErrorPayload(res);
      throw createModelLimitError({
        provider: "gemini",
        modelId: model.id,
        stage,
        res,
        payload,
      });
    }

    const payload = await readProviderErrorPayload(res);
    lastError = new Error(
      `Gemini API error (${res.status}): ${payload.providerMessage || payload.rawBody}`,
    );
    console.error("[Verity][provider-error]", {
      provider: "gemini",
      modelId: model.id,
      stage,
      httpStatus: res.status,
      providerCode: payload.providerCode,
      requestId: payload.requestId,
      providerMessage: truncateForLog(payload.providerMessage || payload.rawBody),
      rawBody: truncateForLog(payload.rawBody),
    });

    if (res.status >= 500 && attempt < MAX_RETRIES) {
      console.warn(`Gemini 5xx (${res.status}), retry ${attempt + 1}/${MAX_RETRIES}`);
      await sleep(Math.pow(2, attempt) * 1000);
      continue;
    }

    throw lastError;
  }

  throw lastError || new Error("Gemini call exhausted retries");
}

async function callOpenAI(
  prompt: string,
  model: ModelConfig,
  opts: LlmCallOpts,
): Promise<LlmResponse> {
  const { temperature = 0.15, maxOutputTokens = 1536, stage } = opts;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: model.modelName,
        temperature,
        max_tokens: maxOutputTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (res.ok) {
      const data = await res.json();
      return {
        text: data.choices?.[0]?.message?.content || "",
        groundingChunks: [],
      };
    }

    if (res.status === 429) {
      const payload = await readProviderErrorPayload(res);
      throw createModelLimitError({
        provider: "openai",
        modelId: model.id,
        stage,
        res,
        payload,
      });
    }

    const payload = await readProviderErrorPayload(res);
    lastError = new Error(
      `OpenAI API error (${res.status}): ${payload.providerMessage || payload.rawBody}`,
    );
    console.error("[Verity][provider-error]", {
      provider: "openai",
      modelId: model.id,
      stage,
      httpStatus: res.status,
      providerCode: payload.providerCode,
      requestId: payload.requestId,
      providerMessage: truncateForLog(payload.providerMessage || payload.rawBody),
      rawBody: truncateForLog(payload.rawBody),
    });

    if (res.status >= 500 && attempt < MAX_RETRIES) {
      console.warn(`OpenAI 5xx (${res.status}), retry ${attempt + 1}/${MAX_RETRIES}`);
      await sleep(Math.pow(2, attempt) * 1000);
      continue;
    }

    throw lastError;
  }

  throw lastError || new Error("OpenAI call exhausted retries");
}

async function callOpenRouter(
  prompt: string,
  model: ModelConfig,
  opts: LlmCallOpts,
): Promise<LlmResponse> {
  const { temperature = 0.15, maxOutputTokens = 1536, stage } = opts;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: model.modelName,
        temperature,
        max_tokens: maxOutputTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || "";
      if (data.error) {
        lastError = new Error(`OpenRouter error: ${JSON.stringify(data.error)}`);
        if (attempt < MAX_RETRIES) {
          console.warn(`OpenRouter returned error in body, retry ${attempt + 1}/${MAX_RETRIES}`);
          await sleep(Math.pow(2, attempt) * 1000);
          continue;
        }
        throw lastError;
      }
      return { text, groundingChunks: [] };
    }

    if (res.status === 429) {
      const payload = await readProviderErrorPayload(res);
      throw createModelLimitError({
        provider: "openrouter",
        modelId: model.id,
        stage,
        res,
        payload,
      });
    }

    const payload = await readProviderErrorPayload(res);
    lastError = new Error(
      `OpenRouter API error (${res.status}): ${payload.providerMessage || payload.rawBody}`,
    );
    console.error("[Verity][provider-error]", {
      provider: "openrouter",
      modelId: model.id,
      stage,
      httpStatus: res.status,
      providerCode: payload.providerCode,
      requestId: payload.requestId,
      providerMessage: truncateForLog(payload.providerMessage || payload.rawBody),
      rawBody: truncateForLog(payload.rawBody),
    });

    if (res.status >= 500 && attempt < MAX_RETRIES) {
      console.warn(`OpenRouter 5xx (${res.status}), retry ${attempt + 1}/${MAX_RETRIES}`);
      await sleep(Math.pow(2, attempt) * 1000);
      continue;
    }

    throw lastError;
  }

  throw lastError || new Error("OpenRouter call exhausted retries");
}

async function callLlm(
  prompt: string,
  model: ModelConfig,
  opts: LlmCallOpts = {},
): Promise<LlmResponse> {
  if (model.provider === "gemini") {
    return callGemini(prompt, model, opts);
  }
  if (model.provider === "openrouter") {
    return callOpenRouter(prompt, model, opts);
  }
  return callOpenAI(prompt, model, opts);
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

function normalizeClaim(claim: string): string {
  return claim.trim().toLowerCase().replace(/\s+/g, " ");
}

async function decomposeClaims(
  title: string,
  body: string,
  model: ModelConfig,
): Promise<string[]> {
  const truncated = body.slice(0, MAX_ARTICLE_CHARS);
  const prompt = `You are a professional fact-checker. Extract up to ${MAX_CLAIMS} ATOMIC factual claims from this article.

Rules:
- A claim must be specific and verifiable
- Split compound claims into separate items
- Exclude opinions, predictions, quotes, and speculative language
- Prioritize consequential and checkable claims
- Return only clear claim text

Article title: ${title}
Article text: ${truncated}`;

  const { text } = await callLlm(prompt, model, {
    jsonSchema: DECOMPOSE_SCHEMA,
    maxOutputTokens: 700,
    temperature: 0.05,
    stage: "claim_decomposition",
  });

  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed.claims)) {
      return parsed.claims
        .filter((c: unknown) => typeof c === "string" && c.length > 15)
        .slice(0, MAX_CLAIMS);
    }
  } catch {
    // fallback parsing below
  }

  return trimmed
    .split("\n")
    .map((line) => line.replace(/^\d+[\.)]\s*/, "").trim())
    .filter((line) => line.length > 15)
    .slice(0, MAX_CLAIMS);
}

async function evaluateClaims(
  claimTexts: string[],
  model: ModelConfig,
): Promise<ClaimEvaluation[]> {
  if (claimTexts.length === 0) return [];

  const indexedClaims = claimTexts
    .map((claim, i) => `${i + 1}. ${claim}`)
    .join("\n");

  const prompt = `You are an expert fact-checker.
${model.supportsWebSearch ? "Use web search to gather evidence before deciding." : "Use your best factual reasoning and conservative confidence."}

Evaluate every claim below and return ONLY valid JSON in this exact shape:
{
  "evaluations": [
    {
      "index": 1,
      "status": "verified|disputed|misleading|unverified",
      "confidence": 0,
      "rationale": "one sentence for user",
      "fallacies": "none or comma-separated terms"
    }
  ]
}

Claims:
${indexedClaims}`;

  const { text, groundingChunks } = await callLlm(prompt, model, {
    useSearch: model.supportsWebSearch,
    temperature: 0.1,
    maxOutputTokens: 1700,
    stage: "claim_evaluation",
  });

  const parsedText = extractJsonObject(text) || text;

  type ParsedEval = {
    index?: number;
    status?: string;
    confidence?: number;
    rationale?: string;
    fallacies?: string;
  };

  let parsedEvals: ParsedEval[] = [];
  try {
    const parsed = JSON.parse(parsedText);
    parsedEvals = Array.isArray(parsed.evaluations) ? parsed.evaluations : [];
  } catch {
    parsedEvals = [];
  }

  const sourceMap = new Map<number, ClaimEvaluation["sources"]>();
  for (let i = 1; i <= claimTexts.length; i++) sourceMap.set(i, []);

  if (model.supportsWebSearch && groundingChunks.length > 0) {
    const sharedSources: ClaimEvaluation["sources"] = groundingChunks
      .filter((chunk) => chunk.web?.uri)
      .slice(0, 8)
      .map((chunk) => {
        const url = chunk.web!.uri;
        const hostname = safeHostname(url);
        return {
          title: chunk.web!.title || "Source",
          url,
          authority: scoreSourceAuthority(hostname),
        };
      });
    for (let i = 1; i <= claimTexts.length; i++) {
      sourceMap.set(i, sharedSources);
    }
  }

  const results: ClaimEvaluation[] = claimTexts.map((claimText, idx) => {
    const index = idx + 1;
    const ev =
      parsedEvals.find((item) => item.index === index) ||
      parsedEvals.find(
        (item) =>
          typeof item.rationale === "string" &&
          normalizeClaim(item.rationale).includes(normalizeClaim(claimText).slice(0, 20)),
      );

    let status: Claim["status"] = "unverified";
    const rawStatus = String(ev?.status || "").toLowerCase();
    if (
      rawStatus === "verified" ||
      rawStatus === "disputed" ||
      rawStatus === "misleading" ||
      rawStatus === "unverified"
    ) {
      status = rawStatus;
    }

    let confidence =
      typeof ev?.confidence === "number" && Number.isFinite(ev.confidence)
        ? Math.round(ev.confidence)
        : 45;
    confidence = Math.max(0, Math.min(100, confidence));

    const sources = sourceMap.get(index) || [];
    if (sources.length > 0) {
      const avgAuthority =
        sources.reduce((sum, src) => sum + src.authority, 0) / sources.length;
      const authorityBoost = (avgAuthority - 0.5) * 20;
      confidence = Math.max(0, Math.min(100, Math.round(confidence + authorityBoost)));
    }

    let rationale =
      typeof ev?.rationale === "string" && ev.rationale.trim()
        ? ev.rationale.trim()
        : "Unable to determine from available evidence.";

    if (confidence < 55 && status !== "unverified") {
      status = "unverified";
      rationale = `Low confidence (${confidence}%). ${rationale}`;
    }

    return {
      index,
      status,
      confidence,
      rationale,
      fallacies:
        typeof ev?.fallacies === "string" && ev.fallacies.trim()
          ? ev.fallacies.trim()
          : "none",
      sources,
    };
  });

  return results;
}

async function detectTone(
  title: string,
  body: string,
  model: ModelConfig,
): Promise<ToneAlert[]> {
  const truncated = body.slice(0, 3000);
  const prompt = `You are a media literacy expert. Analyze this article for rhetorical problems.

Check:
1. emotional manipulation
2. bias or one-sided framing
3. misleading/manipulative wording

Return an empty alerts array if no clear issue exists.

Article title: ${title}
Article text: ${truncated}`;

  const { text } = await callLlm(prompt, model, {
    jsonSchema: TONE_SCHEMA,
    temperature: 0.1,
    maxOutputTokens: 650,
    stage: "tone_detection",
  });

  try {
    const parsed = JSON.parse(text);
    const alerts = Array.isArray(parsed.alerts) ? parsed.alerts : [];
    return alerts.filter(
      (a: ToneAlert) =>
        ["emotional", "bias", "manipulation"].includes(a.type) &&
        ["low", "medium", "high"].includes(a.severity) &&
        !!a.description &&
        !!a.excerpt,
    );
  } catch {
    return [];
  }
}

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

function buildSummary(
  trustScore: number,
  grade: string,
  claims: Claim[],
  toneAlerts: ToneAlert[],
): string {
  if (claims.length === 0) {
    return `Trust score ${trustScore}/100 (Grade ${grade}). No atomic verifiable claims were extracted from the article text, and ${toneAlerts.length} tone alerts were detected.`;
  }

  const disputed = claims.filter((c) => c.status === "disputed").length;
  const verified = claims.filter((c) => c.status === "verified").length;
  return `Trust score ${trustScore}/100 (Grade ${grade}) with ${disputed} disputed claims, ${verified} verified claims, and ${toneAlerts.length} tone alerts.`;
}

async function analyzeWithModel(
  model: ModelConfig,
  input: {
    url: string;
    title: string;
    body: string;
    mediaSummary?: MediaSummary;
  },
) {
  const { url, title, body, mediaSummary } = input;
  let claimTexts = await decomposeClaims(title, body, model);

  if (claimTexts.length === 0) {
    console.warn("decomposeClaims returned 0 claims, retrying once");
    claimTexts = await decomposeClaims(title, body, model);
  }

  if (claimTexts.length === 0) {
    console.warn("No verifiable claims extracted after retry; continuing with tone-only analysis.");
  }

  const evaluatedClaims = await evaluateClaims(claimTexts, model);

  const claims: Claim[] = claimTexts.map((text, i) => {
    const ev =
      evaluatedClaims.find((item) => item.index === i + 1) ||
      ({
        index: i + 1,
        status: "unverified",
        confidence: 0,
        rationale: "Evaluation unavailable",
        fallacies: "none",
        sources: [],
      } as ClaimEvaluation);

    const topSource = ev.sources[0];
    return {
      id: `claim-${i}`,
      text,
      status: ev.status,
      confidence: ev.confidence,
      rationale: ev.rationale,
      fallacies: ev.fallacies !== "none" ? ev.fallacies : undefined,
      existingDebunk: topSource
        ? {
            claimReviewed: text,
            publisher: safeHostname(topSource.url),
            url: topSource.url,
            rating: ev.status,
          }
        : undefined,
    };
  });

  let toneAlerts: ToneAlert[] = [];
  try {
    toneAlerts = await detectTone(title, body, model);
  } catch (err) {
    if (err instanceof ModelLimitError) {
      console.warn("[Verity][tone-skip-limit]", err.toDiagnostic());
    } else {
      console.error("Tone detection failed (non-fatal):", err);
    }
  }

  const trustScore = calculateScore(claims, toneAlerts);
  const grade = scoreToGrade(trustScore);
  const summary = buildSummary(trustScore, grade, claims, toneAlerts);

  return {
    url,
    title,
    trustScore,
    grade,
    claims,
    toneAlerts,
    summary,
    analysisModel: model.id,
    analyzedAt: new Date().toISOString(),
    analysisScope: buildAnalysisScope(mediaSummary),
  };
}

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
      models: MODELS.map((m) => ({
        id: m.id,
        label: m.label,
        available: isModelConfigured(m),
      })),
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { url, title, body, mediaSummary, analysisModel } =
      req.body as ArticleInput;

    if (!title || !body) {
      return res
        .status(400)
        .json({ error: "Missing title or body", code: "BAD_REQUEST" });
    }

    const model = getModelById(analysisModel);
    if (!isModelConfigured(model)) {
      const keyName =
        model.provider === "gemini"
          ? "GEMINI_API_KEY"
          : model.provider === "openai"
            ? "OPENAI_API_KEY"
            : "OPENROUTER_API_KEY";
      return res.status(500).json({
        error: `${keyName} not configured on server for model ${model.id}`,
        code: "NO_KEY",
      });
    }

    try {
      const result = await analyzeWithModel(model, {
        url,
        title,
        body,
        mediaSummary,
      });
      return res.status(200).json({
        ...result,
        diagnostics: {
          attempts: [
            {
              modelId: model.id,
              provider: model.provider,
              outcome: "success",
              message: "Analysis completed successfully.",
              attemptedAt: new Date().toISOString(),
            },
          ],
        } as AnalysisDiagnostics,
      });
    } catch (err) {
      if (err instanceof ModelLimitError) {
        throw Object.assign(err, {
          diagnostics: {
            attempts: [err.toDiagnostic()],
          } as AnalysisDiagnostics,
        });
      }
      throw err;
    }
  } catch (error) {
    console.error("Pipeline error:", error);

    if (error instanceof ModelLimitError) {
      const diagnostics =
        typeof error === "object" &&
        error &&
        "diagnostics" in error &&
        (error as { diagnostics?: AnalysisDiagnostics }).diagnostics
          ? (error as { diagnostics: AnalysisDiagnostics }).diagnostics
          : { attempts: [error.toDiagnostic()] };
      return res.status(429).json({
        error: error.message,
        code: error.code,
        details: diagnostics,
      });
    }

    return res.status(500).json({
      error: error instanceof Error ? error.message : "Internal error",
      code: "INTERNAL_ERROR",
    });
  }
}
