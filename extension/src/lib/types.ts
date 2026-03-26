export interface ArticleData {
  url: string;
  title: string;
  body: string;
  siteName?: string;
  publishedDate?: string;
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
}

export type ExtensionMessage =
  | { type: "GET_ARTICLE_DATA" }
  | { type: "ARTICLE_DATA"; data: ArticleData }
  | { type: "ANALYZE_ARTICLE"; data: ArticleData }
  | { type: "ANALYSIS_RESULT"; data: AnalysisResult }
  | { type: "ANALYSIS_ERROR"; error: string }
  | { type: "SHOW_OVERLAY"; data: AnalysisResult }
  | { type: "REMOVE_OVERLAY" }
  | { type: "GET_PROXY_URL" };
