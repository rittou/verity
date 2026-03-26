import { extractArticle } from "./extractor";
import { showOverlay, removeOverlay } from "./overlay";
import type { AnalysisResult } from "../lib/types";

chrome.runtime.onMessage.addListener(
  (
    message: { type: string; data?: AnalysisResult },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => {
    switch (message.type) {
      case "GET_ARTICLE_DATA": {
        const article = extractArticle();
        sendResponse({ data: article });
        break;
      }
      case "SHOW_OVERLAY": {
        if (message.data) showOverlay(message.data);
        sendResponse({ ok: true });
        break;
      }
      case "REMOVE_OVERLAY": {
        removeOverlay();
        sendResponse({ ok: true });
        break;
      }
    }
    return true;
  },
);
