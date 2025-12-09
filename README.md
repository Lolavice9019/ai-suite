# AI Suite v3.0 - Multi-Provider AI Platform

Production-ready unified frontend & backend for **OpenRouter**, **Hugging Face**, **Featherless**, **Venice AI**, and **Together AI** — verified December 2025.

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (React + Vite)  →  Backend (Express)  →  AI APIs      │
│       :3000                      :8080                          │
│                                                                 │
│  ✅ Vision/Image Input    ✅ Streaming       ✅ Auto-Retry      │
│  ✅ Model Caching         ✅ Cold Start Handling                │
│  ✅ Provider Failover     ✅ Rate Limit Tracking                │
│  ✅ Venice Web Search     ✅ Together Functions                 │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# 1. Install all dependencies
npm run install:all

# 2. Configure API keys
cp .env.example .env
# Edit .env with your keys (only configure providers you need)

# 3. Start development (frontend + backend)
npm run dev
```

Open http://localhost:3000

## What's New in v3.0

| Feature | Description |
|---------|-------------|
| **Vision Support** | Upload images to vision-capable models (GPT-4o, Claude 3, Gemini, Llama Vision) |
| **Cold Start Handling** | Automatic retry for Featherless (400) and HuggingFace (502) cold starts |
| **Model Caching** | 5-minute cache for model lists — no repeated API calls |
| **Provider Failover** | `/api/failover/chat/completions` tries multiple providers automatically |
| **Rate Limit Tracking** | Parses and tracks rate limit headers per provider |
| **Venice Web Search** | Toggle real-time web search with citations |
| **Together Functions** | Full function calling and JSON mode support |
| **Verified Endpoints** | All URLs confirmed working December 2025 |

## Project Structure

```
ai-suite/
├── package.json          # Root scripts (concurrently)
├── .env                  # API keys (git-ignored)
├── .env.example          # Template with documentation
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       └── server.ts     # Express API with retry, cache, failover
└── frontend/
    ├── package.json
    ├── vite.config.ts    # Proxy to backend
    └── src/
        ├── App.tsx       # Chat UI with vision support
        └── lib/
            └── api.ts    # Unified client with all features
```

## Provider Comparison

| Provider | Vision | Functions | Web Search | Cold Starts | Pricing |
|----------|--------|-----------|------------|-------------|---------|
| OpenRouter | ✅ | ✅ | Via suffix | ❌ | Per-token |
| HuggingFace | ✅ | ❌ | ❌ | ⚠️ 502 | Per-compute |
| Featherless | ✅ | ❌ | ❌ | ⚠️ 400 | Flat-rate |
| Venice | ✅ | ❌ | ✅ | ❌ | Per-token |
| Together | ✅ | ✅ | ❌ | ❌ | Per-token |

### HuggingFace + Featherless Integration

Featherless is HuggingFace's largest inference provider (6,700+ models). You can access Featherless models two ways:

1. **Direct to Featherless** (`FEATHERLESS_API_KEY`): Flat-rate unlimited tokens
2. **Via HuggingFace Router** (`HF_TOKEN`): Per-compute billing through HF

To use HF router with Featherless, append `:featherless-ai` to model names:
```typescript
// Via HuggingFace router → Featherless
await chat('huggingface', {
  model: 'deepseek-ai/DeepSeek-R1-0528:featherless-ai',
  messages: [...]
});

// Or use the dedicated endpoint (auto-appends suffix)
POST /api/huggingface/featherless/chat/completions
{ "model": "deepseek-ai/DeepSeek-R1-0528", "messages": [...] }
```

## API Endpoints

### Core
```
GET  /api/health                    # Status + configured providers
GET  /api/providers                 # List with features
GET  /api/:provider/models          # Cached model list
POST /api/:provider/chat/completions # Chat (streaming supported)
```

### Vision
Send images via the standard OpenAI format:
```typescript
{
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "What's in this image?" },
      { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
    ]
  }]
}
```

### Failover
```
POST /api/failover/chat/completions
Body: { "modelClass": "gpt-4-class", "messages": [...] }
```

Model classes: `gpt-4-class`, `claude-class`, `llama-70b-class`

### Venice Web Search
```typescript
{
  "model": "qwen3-235b",
  "messages": [...],
  "venice_parameters": {
    "enable_web_search": "on",
    "enable_web_citations": true
  }
}
```

### Together Function Calling
```typescript
{
  "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  "messages": [...],
  "tools": [{ "type": "function", "function": { "name": "...", "parameters": {...} } }],
  "tool_choice": "auto"
}
```

## Cold Start Handling

**Featherless:** Returns HTTP 400 when a model is cold. The backend automatically retries with exponential backoff (5s → 7.5s → 11s → ...) up to 5 times.

**HuggingFace:** Returns HTTP 502 during model loading. The backend retries up to 3 times with 5s/10s/20s delays.

You don't need to handle this in your frontend — the backend does it automatically.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Backend port (default: 8080) |
| `APP_URL` | No | Frontend URL for OpenRouter referrer |
| `OPENROUTER_API_KEY` | No | Format: `sk-or-v1-...` |
| `HF_TOKEN` | No | Format: `hf_...` |
| `FEATHERLESS_API_KEY` | No | From dashboard |
| `VENICE_API_KEY` | No | Requires Venice Pro |
| `TOGETHER_API_KEY` | No | From settings |

Only configure providers you plan to use.

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start frontend + backend |
| `npm run dev:frontend` | Start frontend only |
| `npm run dev:backend` | Start backend only |
| `npm run build` | Build both for production |
| `npm run install:all` | Install all dependencies |
| `npm run clean` | Remove node_modules & dist |

## Frontend Usage

```typescript
import { chat, chatStream, createImageMessage, fileToBase64DataUrl } from './lib/api';

// Simple chat
const response = await chat('openrouter', {
  model: 'anthropic/claude-3-sonnet',
  messages: [{ role: 'user', content: 'Hello!' }],
});

// Streaming
for await (const chunk of chatStream('together', {
  model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  messages: [{ role: 'user', content: 'Tell me a story' }],
})) {
  process.stdout.write(chunk);
}

// Vision
const imageDataUrl = await fileToBase64DataUrl(file);
const message = createImageMessage('What is this?', imageDataUrl);
const response = await chat('openrouter', {
  model: 'openai/gpt-4o',
  messages: [message],
});

// Venice with web search
const response = await chat('venice', {
  model: 'qwen3-235b',
  messages: [{ role: 'user', content: 'Latest news about AI?' }],
  venice_parameters: { enable_web_search: 'on' },
});
```

---

**December 2025** | MIT License
