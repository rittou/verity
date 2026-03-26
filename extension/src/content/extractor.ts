import type { ArticleData } from "../lib/types";

function getMetaContent(name: string): string | undefined {
  const el =
    document.querySelector(`meta[property="${name}"]`) ||
    document.querySelector(`meta[name="${name}"]`);
  return el?.getAttribute("content") || undefined;
}

function getTitle(): string {
  return (
    getMetaContent("og:title") ||
    document.querySelector("h1")?.textContent?.trim() ||
    document.title ||
    ""
  );
}

const CONTENT_SELECTORS = [
  "article",
  '[role="article"]',
  "main",
  '[role="main"]',
  ".post-content",
  ".article-content",
  ".article-body",
  ".entry-content",
  ".story-body",
  "#article-body",
  ".post-body",
];

const NOISE_SELECTORS =
  'script, style, nav, aside, footer, header, .ad, .advertisement, .social-share, .related-articles, .comments, [aria-hidden="true"], figcaption, .newsletter-signup';

function getBodyText(): string {
  let container: Element | null = null;

  for (const selector of CONTENT_SELECTORS) {
    container = document.querySelector(selector);
    if (container && (container.textContent?.length || 0) > 200) break;
    container = null;
  }

  if (!container) {
    const blocks = document.querySelectorAll("div, section");
    let maxLen = 0;
    for (const block of blocks) {
      const len = block.textContent?.length || 0;
      if (len > maxLen && len < 50000) {
        maxLen = len;
        container = block;
      }
    }
  }

  if (!container) return "";

  const clone = container.cloneNode(true) as Element;
  clone.querySelectorAll(NOISE_SELECTORS).forEach((el) => el.remove());

  const text = clone.textContent?.replace(/\s+/g, " ").trim() || "";
  return text.slice(0, 8000);
}

export function extractArticle(): ArticleData {
  return {
    url: window.location.href,
    title: getTitle(),
    body: getBodyText(),
    siteName: getMetaContent("og:site_name"),
    publishedDate: getMetaContent("article:published_time"),
  };
}
