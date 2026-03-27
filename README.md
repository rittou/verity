# Verity — Real-Time Misinformation Detector

A Chrome Extension (Manifest V3) that identifies misinformation in news articles using zero-shot LLM reasoning. Built with the **SAFE** (Search-Augmented Factuality Evaluator) pipeline.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Chrome Extension (MV3)                                  │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │ Content   │  │ Service      │  │ Popup (React +     │ │
│  │ Script    │◄─┤ Worker       │◄─┤ Tailwind)          │ │
│  │ Shadow DOM│  │ (background) │  │ Nutrition Label UI │ │
│  └──────────┘  └──────┬───────┘  └────────────────────┘ │
└─────────────────────────┼────────────────────────────────┘
                          │ HTTPS
                          ▼
              ┌───────────────────────┐
              │  Vercel Serverless    │
              │  Proxy (api/check)    │
              │  ┌─────────────────┐  │
              │  │ SAFE Pipeline   │  │
              │  │ 1. Decompose    │  │
              │  │ 2. Web Search   │──┼──► Gemini + Google Search
              │  │ 3. LLM Reason  │──┼──►   (grounding tool)
              │  │ 4. Tone Detect  │  │
              │  │ 5. Score        │  │
              │  └─────────────────┘  │
              └───────────────────────┘
```

## The SAFE Pipeline

1. **Claim Decomposition** — LLM extracts individual verifiable claims from the article
2. **Verification** — Claims are evaluated in a single batched LLM call (instead of one call per claim) to drastically reduce request count and token usage
3. **Fallacy Detection** — The same grounded call checks for logical fallacies (ad hominem, straw man, false dichotomy, hasty generalization, etc.)
4. **Bias & Tone Detection** — Automated scan for emotional manipulation, gender/racial bias, and loaded language
5. **Scoring** — Aggregated trust score (0–100) with letter grade (A–F)

## Prerequisites

- Node.js 18+
- A [Gemini API key](https://aistudio.google.com/apikey) (recommended for search-grounded mode)
- Optional: an OpenAI API key for alternative model selection
- Optional: an [OpenRouter API key](https://openrouter.ai) for free-model routing (`openrouter/free`, `:free` variants)
- A [Vercel](https://vercel.com) Hobby account (free)

## Setup

### 1. Proxy (Vercel Serverless)

```bash
cd proxy
cp .env.example .env     # Add your API keys
npm install
vercel dev               # Local dev server on :3000
```

To deploy:

```bash
vercel --prod
```

Then set environment variable(s) in the Vercel dashboard:
- `GEMINI_API_KEY` (for Gemini models)
- `OPENAI_API_KEY` (optional, for OpenAI model)
- `OPENROUTER_API_KEY` (optional, for OpenRouter free models)

### 2. Extension

```bash
cd extension
cp .env.example .env     # Set VITE_PROXY_URL to your proxy URL
npm install
npm run build
```

### 3. Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `extension/dist` folder

## Development

Run the proxy locally:

```bash
cd proxy && vercel dev
```

Build the extension in watch mode (rebuild on changes):

```bash
cd extension && npm run build
```

After rebuilding, click the refresh icon on `chrome://extensions` to reload.

## Configuration

| Variable | Location | Description |
|---|---|---|
| `GEMINI_API_KEY` | `proxy/.env` | Enables `gemini-grounded` and `gemini-fast` |
| `OPENAI_API_KEY` | `proxy/.env` | Enables `openai-gpt-4.1-mini` |
| `OPENROUTER_API_KEY` | `proxy/.env` | Enables `openrouter-free-router` and free variant models |
| `VITE_PROXY_URL` | `extension/.env` | URL of the deployed proxy |

## Zero-Budget Strategy

| Resource | Free Tier |
|---|---|
| Gemini 2.5 Flash | 250 requests/day (includes search grounding) |
| Vercel Hobby | 100 GB-hours/month |

Request optimization:
- Pipeline now uses 2 core LLM calls per analysis (claim decomposition + batched verification) plus optional tone pass, replacing many per-claim calls.
- Popup health check no longer consumes model requests.
- Claims are capped to a smaller, high-impact set to reduce token and request usage.

## Project Structure

```
verity/
├── extension/                 # Chrome Extension (MV3)
│   ├── manifest.json
│   ├── popup.html
│   ├── src/
│   │   ├── popup/             # React popup UI
│   │   │   ├── App.tsx
│   │   │   └── components/
│   │   │       ├── NutritionLabel.tsx
│   │   │       ├── TrustBadge.tsx
│   │   │       ├── ClaimCard.tsx
│   │   │       ├── ToneAlerts.tsx
│   │   │       └── AnalysisProgress.tsx
│   │   ├── content/           # Content scripts (Shadow DOM)
│   │   │   ├── extractor.ts
│   │   │   └── overlay.ts
│   │   ├── background/        # Service worker
│   │   │   └── service-worker.ts
│   │   └── lib/               # Shared types & utilities
│   └── dist/                  # Build output → load in Chrome
└── proxy/                     # Vercel serverless proxy
    └── api/
        ├── check.ts           # SAFE pipeline endpoint
        └── factcheck.ts       # Standalone claim search endpoint
```

## Security

The single `GEMINI_API_KEY` never touches the client-side bundle. All Gemini and search-grounded calls are proxied through the Vercel serverless layer, which reads the key from `process.env` at runtime.

## License

MIT
