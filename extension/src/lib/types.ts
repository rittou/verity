export interface ArticleData {
  url: string;
  title: string;
  body: string;
  siteName?: string;
  publishedDate?: string;
  mediaSummary?: MediaSummary;
}

export interface MediaSummary {
  imageCount: number;
  videoCount: number;
}

export interface Claim {
  id: string;
  text: string;
  status: "pending" | "verified" | "disputed" | "unverified" | "misleading";
  confidence: number;
  source?: string;
  rationale?: string;
  fallacies?: string;
  existingDebunk?: FactCheckResult;
}

export interface FactCheckResult {
  claimReviewed: string;
  publisher: string; // hostname of the source
  url: string;
  rating: string; // status or textual rating
}

export interface ToneAlert {
  type: "emotional" | "bias" | "manipulation";
  severity: "low" | "medium" | "high";
  description: string;
  excerpt: string;
}

export interface AnalysisResult {
  url: string;
  title: string;
  trustScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
  claims: Claim[];
  toneAlerts: ToneAlert[];
  summary: string;
  analyzedAt: string;
  analysisModel?: string;
  analysisScope?: AnalysisScope;
  diagnostics?: AnalysisDiagnostics;
}

export interface ModelScoreComparisonEntry {
  modelId: string;
  analysisModel: string;
  trustScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
  analyzedAt: string;
}

export interface AnalysisModelOption {
  id: string;
  label: string;
  description: string;
  available: boolean;
}

export type ModelProvider = "gemini" | "openai" | "openrouter";

export type ModelLimitType =
  | "quota_confirmed"
  | "rate_limited"
  | "limit_unknown";

export interface ModelAttemptDiagnostic {
  modelId: string;
  provider: ModelProvider;
  outcome: "success" | "limit" | "error";
  stage?: "claim_decomposition" | "claim_evaluation" | "tone_detection";
  message: string;
  attemptedAt: string;
  httpStatus?: number;
  providerCode?: string;
  requestId?: string;
  retryAfterSeconds?: number;
  limitType?: ModelLimitType;
}

export interface AnalysisDiagnostics {
  attempts: ModelAttemptDiagnostic[];
}

export interface AnalysisScope {
  articleTextIncluded: boolean;
  imagesDetected: number;
  videosDetected: number;
  imagesAnalyzed: boolean;
  videosAnalyzed: boolean;
  note: string;
}

export type ExtensionMessage =
  | { type: "GET_ARTICLE_DATA" }
  | { type: "ARTICLE_DATA"; data: ArticleData }
  | { type: "ANALYZE_ARTICLE"; data: ArticleData; analysisModel?: string }
  | {
      type: "GET_ANALYSIS_STATUS";
      url?: string;
      data?: ArticleData;
      analysisModel?: string;
    }
  | { type: "ANALYSIS_RESULT"; data: AnalysisResult }
  | { type: "ANALYSIS_ERROR"; error: string; code?: string; details?: AnalysisDiagnostics }
  | { type: "SHOW_OVERLAY"; data: AnalysisResult }
  | { type: "REMOVE_OVERLAY" }
  | { type: "GET_MODEL_SCORE_COMPARISON"; data: ArticleData }
  | { type: "GET_PROXY_URL" }
  | { type: "GET_MODEL_OPTIONS" };
