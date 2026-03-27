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

function findArticleContainer(): Element | null {
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

  return container;
}

function buildCleanClone(container: Element | null): Element | null {
  if (!container) return null;

  const clone = container.cloneNode(true) as Element;
  clone.querySelectorAll(NOISE_SELECTORS).forEach((el) => el.remove());
  return clone;
}

function getBodyText(container: Element | null): string {
  const clone = buildCleanClone(container);
  if (!clone) return "";

  const text = clone.textContent?.replace(/\s+/g, " ").trim() || "";
  return text.slice(0, 8000);
}

function isEmbeddedVideoFrame(src: string | null): boolean {
  if (!src) return false;
  return /youtube|youtu\.be|vimeo|dailymotion|wistia|jwplayer|tiktok/i.test(src);
}

function getMediaSummary(container: Element | null) {
  const clone = buildCleanClone(container);
  if (!clone) {
    return {
      imageCount: 0,
      videoCount: 0,
    };
  }

  const imageCount = clone.querySelectorAll("img, picture img").length;
  const embeddedVideoCount = Array.from(clone.querySelectorAll("iframe")).filter(
    (frame) => isEmbeddedVideoFrame(frame.getAttribute("src")),
  ).length;
  const videoCount = clone.querySelectorAll("video").length + embeddedVideoCount;

  return {
    imageCount,
    videoCount,
  };
}

export function extractArticle(): ArticleData {
  const container = findArticleContainer();

  return {
    url: window.location.href,
    title: getTitle(),
    body: getBodyText(container),
    siteName: getMetaContent("og:site_name"),
    publishedDate: getMetaContent("article:published_time"),
    mediaSummary: getMediaSummary(container),
  };
}
