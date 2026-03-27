# Verity — Real-Time Misinformation Detector

Verity is a Chrome Extension (Manifest V3) for article-level credibility analysis. It extracts article text in the browser, sends that text to a serverless proxy, evaluates verifiable claims and rhetorical tone with a selected model, and returns a trust score, letter grade, and claim-by-claim report.

The current system is model-selectable, cache-aware, and optimized to avoid wasteful repeat calls.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Chrome Extension (MV3)                                  │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │ Content   │  │ Service      │  │ Popup (React +     │ │
│  │ Script    │◄─┤ Worker       │◄─┤ Tailwind)          │ │
│  │ Shadow DOM│  │ (background) │  │ Score + report UI  │ │
│  └──────────┘  └──────┬───────┘  └────────────────────┘ │
└─────────────────────────┼────────────────────────────────┘
                          │ HTTPS
                          ▼
              ┌───────────────────────┐
              │  Vercel Serverless    │
              │  Proxy (api/check)    │
              │  ┌─────────────────┐  │
              │  │ Analysis Flow   │  │
              │  │ 1. Decompose    │  │
              │  │ 2. Evaluate     │──┼──► Gemini / OpenAI / OpenRouter
              │  │ 3. Tone Detect  │  │
              │  │ 4. Score        │  │
              │  └─────────────────┘  │
              └───────────────────────┘
```

## How Verity Works

1. **Article extraction**
The content script detects article pages and extracts title, body text, site metadata, and simple media counts.

2. **Model-specific analysis**
The popup lets the user choose a configured model. The selected model is the only model used for that run. There is no automatic fallback to another provider.

3. **Claim decomposition**
The proxy asks the model to extract up to `5` atomic, verifiable claims from the article text.

4. **Claim evaluation**
Those claims are evaluated in a single batched LLM call. When the chosen model supports search grounding, that evaluation call can use live web search. Each claim receives:
- a status: `verified`, `disputed`, `misleading`, or `unverified`
- a confidence score
- a short rationale
- optional fallacy labels
- optional supporting source links

5. **Tone analysis**
If claims were extracted, Verity runs a separate tone scan for:
- emotional manipulation
- bias / one-sided framing
- misleading or manipulative wording

6. **Score generation**
The proxy turns claims and tone alerts into a trust score from `0-100`, then maps that score to a grade from `A-F`.

## Scoring Model

Verity starts from `100` and subtracts penalties:

- `disputed` claim: `25 * confidenceWeight`
- `misleading` claim: `15 * confidenceWeight`
- `unverified` claim: `3`
- tone alert with `high` severity: `10`
- tone alert with `medium` severity: `5`
- tone alert with `low` severity: `2`

`confidenceWeight` is `claim.confidence / 100`.

Final score is clamped to `0-100` and converted to a grade:

- `A`: `80-100`
- `B`: `60-79`
- `C`: `40-59`
- `D`: `20-39`
- `F`: `0-19`

Special case:
- If no verifiable claims are extracted, Verity returns a neutral baseline score of `50` and skips further claim/tone model calls for efficiency.

## Models

The proxy can expose multiple model options, depending on which API keys are configured:

- `gemini-grounded`
- `gemini-fast`
- `openai-gpt-4.1-mini`
- `openrouter-free-router`
- `openrouter-llama-3.2-3b-free`

Availability is detected at runtime from proxy environment variables.

## Prerequisites

- Node.js 18+
- A [Gemini API key](https://aistudio.google.com/apikey) for Gemini models
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

## Caching And Request Control

Verity caches completed analysis results in the extension service worker using:

- `article URL`
- `selected model`

Cache behavior:

- Cached results live for `1 hour`
- Reopening the popup reuses cached results when available
- Previous scores are shown per analyzed model for the same article URL
- `Re-analyze` clears the cache for the current `URL + model` pair and runs fresh analysis

In-flight protection:

- The background worker deduplicates concurrent requests for the same `URL + model`
- The popup includes a `Cancel Analysis` action
- Cancel aborts the extension-side fetch and clears the in-flight tracking entry

## Token Efficiency

The current implementation is intentionally conservative about token spend:

- One model is used per analysis run; there is no cross-model fallback
- Claim evaluation is batched into one LLM call instead of one call per claim
- Claim extraction is capped to `5` claims
- Article text is truncated before sending to the model
- Empty-claim runs do not retry decomposition
- Empty-claim runs skip tone detection entirely
- Provider `5xx` retries are limited to `1` retry

Typical request pattern per successful run:

- `1` claim decomposition call
- `1` claim evaluation call
- `0` or `1` tone analysis call

## Error Handling

When providers return quota or rate-limit errors:

- The proxy returns short user-facing messages instead of raw provider dumps
- The popup shows attempt diagnostics
- Error and limit screens include a safe way back to the detected article view
- The popup auto-scrolls to the top when an error/limit state is entered so the message is immediately visible

## Current Media Support

- Page images and videos are detected for visibility only
- The current pipeline sends extracted article text only
- No image bytes, video frames, or transcripts are sent to the model yet

## Zero-Budget Strategy

| Resource | Free Tier |
|---|---|
| Gemini 2.5 Flash | 250 requests/day (includes search grounding) |
| Vercel Hobby | 100 GB-hours/month |

Request optimization:
- The pipeline uses batched evaluation rather than one model call per claim.
- Cached results are reused by `URL + model`.
- Empty-claim runs stop early instead of continuing into extra model calls.
- The popup health check does not consume model requests.
- Provider retries are intentionally limited to reduce accidental token spikes.

Provider diagnostics:
- The proxy logs provider limit responses with model id, stage, HTTP status, retry-after, request id, and provider error text so you can distinguish quota exhaustion from rate limiting or an ambiguous `429`.
- The popup mirrors those attempt diagnostics when an analysis is blocked.

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
