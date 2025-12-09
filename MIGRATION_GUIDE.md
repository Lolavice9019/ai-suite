# Migration Guide: From Basic to Production-Ready AI Suite

## What Changed and Why

This guide compares the **previous basic integration** with the **new production-ready approach** based on December 2025 API documentation.

---

## Step 1: Endpoint URLs — Several Were Incorrect

### ❌ Previous (Incorrect/Outdated)
```typescript
huggingface: {
  baseUrl: 'https://router.huggingface.co/v1',  // Limited, router-only
},
venice: {
  baseUrl: 'https://api.venice.ai/api/v1',  // Correct but missing /v1 prefix handling
},
```

### ✅ New (Verified December 2025)
```typescript
const PROVIDERS = {
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    // Supports: /chat/completions, /models, /embeddings, /generation
  },
  huggingface: {
    baseUrl: 'https://router.huggingface.co/v1',
    // OR for specific providers: https://api-inference.huggingface.co/models/{model_id}
    // Note: Router may return 502 during cold starts
  },
  featherless: {
    baseUrl: 'https://api.featherless.ai/v1',
    // Supports: /chat/completions, /completions, /models, /tokenize
  },
  venice: {
    baseUrl: 'https://api.venice.ai/api/v1',
    // Supports: /chat/completions, /image/generate, /characters, /embeddings
  },
  together: {
    baseUrl: 'https://api.together.xyz/v1',
    // Supports: /chat/completions, /images/generations, /embeddings, /files
  },
};
```

**Action Required:** Update all base URLs and verify endpoint paths.

---

## Step 2: Model Availability — No Downloads Needed, But Cold Starts Matter

### ❌ Previous Assumption
Models are always ready; just call the API.

### ✅ New Understanding

| Provider | Model State | Handling Required |
|----------|-------------|-------------------|
| OpenRouter | Always warm | None — models hosted by underlying providers |
| Together | Always warm | None — dedicated infrastructure |
| Venice | Always warm | None — managed service |
| HuggingFace | May be cold | Handle HTTP 502 with retry; consider Dedicated Endpoints |
| Featherless | Often cold | **Critical:** HTTP 400 = model loading, retry with backoff |

### HuggingFace + Featherless Integration (NEW)

Featherless is HuggingFace's largest inference provider (6,700+ models). There are **two ways** to access Featherless:

```typescript
// Option 1: Direct to Featherless API (flat-rate billing)
const response = await fetch('https://api.featherless.ai/v1/chat/completions', {
  headers: { 'Authorization': `Bearer ${FEATHERLESS_API_KEY}` },
  body: JSON.stringify({ model: 'deepseek-ai/DeepSeek-R1-0528', messages })
});

// Option 2: Via HuggingFace Router (billed via HF)
// Append :featherless-ai to route through Featherless
const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
  headers: { 'Authorization': `Bearer ${HF_TOKEN}` },
  body: JSON.stringify({ model: 'deepseek-ai/DeepSeek-R1-0528:featherless-ai', messages })
});
```

The suite provides both:
- `POST /api/featherless/chat/completions` — Direct to Featherless
- `POST /api/huggingface/featherless/chat/completions` — Via HF router (auto-appends suffix)

### Featherless Cold Start Handling (NEW)
```typescript
async function callFeatherlessWithWarmup(model: string, messages: Message[], maxRetries = 10) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch('https://api.featherless.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${process.env.FEATHERLESS_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model, messages }),
      });
      
      if (response.status === 400) {
        const error = await response.json();
        if (error.message?.includes('Cold') || error.message?.includes('Not Ready')) {
          // Model is loading — wait and retry
          const delay = Math.min(30000, 5000 * Math.pow(1.5, attempt));
          console.log(`Model ${model} is cold. Retrying in ${delay/1000}s...`);
          await sleep(delay);
          continue;
        }
      }
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    } catch (e) {
      if (attempt === maxRetries - 1) throw e;
    }
  }
}
```

**Action Required:** Add cold-start retry logic for Featherless and HuggingFace.

---

## Step 3: Image/Vision Support — Was Missing Entirely

### ❌ Previous
No vision or image upload support.

### ✅ New (Full Multimodal Support)

**Vision Input Format (All Providers)**
```typescript
interface VisionMessage {
  role: 'user';
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }  // URL or base64 data URI
  >;
}

// Example: Sending an image
const message: VisionMessage = {
  role: 'user',
  content: [
    { type: 'text', text: 'What is in this image?' },
    { 
      type: 'image_url', 
      image_url: { 
        url: 'data:image/png;base64,iVBORw0KGgo...'  // Or https:// URL
      }
    }
  ]
};
```

**Vision-Capable Models by Provider**

| Provider | Models with Vision |
|----------|-------------------|
| OpenRouter | `google/gemini-2.0-flash-exp`, `anthropic/claude-3-sonnet`, `openai/gpt-4o` |
| Together | `meta-llama/Llama-3.2-90B-Vision-Instruct`, `Qwen/Qwen2-VL-72B-Instruct` |
| Featherless | `google/gemma-3-27b-it`, Mistral vision variants |
| Venice | `mistral-31-24b` (Venice Medium), `llama-4-maverick` |
| HuggingFace | `Qwen/Qwen2-VL-7B-Instruct`, `CohereLabs/command-a-vision` |

**Action Required:** Add vision message handling to frontend and backend.

---

## Step 4: File Upload — New Capability

### ❌ Previous
Not supported.

### ✅ New (Provider-Specific)

**OpenRouter PDF Processing**
```typescript
// Any model can process PDFs via built-in extraction
const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}` },
  body: JSON.stringify({
    model: 'anthropic/claude-3-sonnet',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Summarize this PDF' },
        { type: 'file', file: { url: 'https://example.com/doc.pdf' } }
      ]
    }],
    plugins: [{ id: 'file-parser' }]  // Optional: Use mistral-ocr for scanned docs
  })
});
```

**Together AI File Upload (for Fine-tuning)**
```typescript
// Upload training data
const formData = new FormData();
formData.append('file', fs.createReadStream('train.jsonl'));
formData.append('purpose', 'fine-tune');

await fetch('https://api.together.xyz/v1/files', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${TOGETHER_API_KEY}` },
  body: formData
});
```

**Action Required:** Implement file upload endpoints for providers that support it.

---

## Step 5: Provider-Specific Features — Were Ignored

### ❌ Previous
Generic OpenAI-compatible calls only.

### ✅ New (Leverage Unique Capabilities)

**OpenRouter: Provider Routing**
```typescript
{
  model: 'anthropic/claude-3-sonnet',
  provider: {
    order: ['anthropic', 'aws-bedrock'],  // Prefer direct, fallback to Bedrock
    allow_fallbacks: true,
    sort: 'throughput',                    // Or 'price', 'latency'
    data_collection: 'deny'                // Privacy mode
  }
}
```

**Venice: Web Search + Characters**
```typescript
{
  model: 'qwen3-235b',
  messages: [...],
  venice_parameters: {
    enable_web_search: 'auto',           // Real-time web results
    enable_web_scraping: true,           // Parse URLs in messages
    enable_web_citations: true,
    strip_thinking_response: false,      // Show <think> tags
    character_slug: 'venice-uncensored'  // Use persona
  }
}
```

**Together: Function Calling + JSON Mode**
```typescript
{
  model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  messages: [...],
  tools: [{
    type: 'function',
    function: {
      name: 'get_weather',
      parameters: { type: 'object', properties: { location: { type: 'string' } } }
    }
  }],
  tool_choice: 'auto',
  response_format: {                     // Structured output
    type: 'json_schema',
    schema: { type: 'object', properties: { ... } }
  }
}
```

**Action Required:** Expose provider-specific features in UI and API.

---

## Step 6: Error Handling — Was Minimal

### ❌ Previous
```typescript
if (!response.ok) {
  return res.status(response.status).json({ error: 'Request failed' });
}
```

### ✅ New (Production-Grade)

```typescript
const RETRY_STATUS_CODES = [429, 500, 502, 503, 504];
const MAX_RETRIES = 3;

async function callWithRetry(
  provider: string, 
  endpoint: string, 
  body: object,
  attempt = 0
): Promise<Response> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: getHeaders(provider),
    body: JSON.stringify(body),
  });

  // Check for retryable errors
  if (RETRY_STATUS_CODES.includes(response.status) && attempt < MAX_RETRIES) {
    // Honor Retry-After header if present
    const retryAfter = response.headers.get('Retry-After');
    const delay = retryAfter 
      ? parseInt(retryAfter) * 1000 
      : Math.min(1000 * Math.pow(2, attempt) * (0.5 + Math.random()), 30000);
    
    console.warn(`[${provider}] ${response.status} - Retrying in ${delay}ms (attempt ${attempt + 1})`);
    await sleep(delay);
    return callWithRetry(provider, endpoint, body, attempt + 1);
  }

  // Handle specific error types
  if (response.status === 401 || response.status === 403) {
    throw new AuthError(`Invalid API key for ${provider}`);
  }
  if (response.status === 402) {
    throw new InsufficientCreditsError(`Out of credits on ${provider}`);
  }
  if (response.status === 400) {
    const error = await response.json();
    if (error.message?.includes('context length')) {
      throw new ContextLengthError(error.message);
    }
  }

  return response;
}
```

**Action Required:** Implement retry logic with exponential backoff and jitter.

---

## Step 7: Rate Limit Handling — Was Missing

### ❌ Previous
No rate limit awareness.

### ✅ New (Track and Respect Limits)

```typescript
interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;  // Unix timestamp
}

function parseRateLimitHeaders(headers: Headers): RateLimitInfo | null {
  const limit = headers.get('x-ratelimit-limit') || headers.get('X-RateLimit-Limit');
  const remaining = headers.get('x-ratelimit-remaining') || headers.get('X-RateLimit-Remaining');
  const reset = headers.get('x-ratelimit-reset') || headers.get('X-RateLimit-Reset');
  
  if (!limit || !remaining) return null;
  
  return {
    limit: parseInt(limit),
    remaining: parseInt(remaining),
    reset: reset ? parseInt(reset) : Date.now() + 60000,
  };
}

// Track per-provider limits
const rateLimits = new Map<string, RateLimitInfo>();

// Before making request, check if we should wait
function shouldWait(provider: string): number {
  const info = rateLimits.get(provider);
  if (!info || info.remaining > 0) return 0;
  return Math.max(0, info.reset - Date.now());
}
```

**Provider-Specific Limits**

| Provider | Free Tier | Paid Tier |
|----------|-----------|-----------|
| OpenRouter | 20 req/min on :free models | No enforced limit |
| Together | 60 RPM (Tier 0) | 600-6000 RPM (Tier 1-5) |
| Featherless | Concurrency-based (2-8 slots) | N/A |
| Venice | Included in Pro | Rate based on model |
| HuggingFace | ~100 req/hr (free) | 20x higher (Pro) |

**Action Required:** Parse rate limit headers and implement request throttling.

---

## Step 8: Streaming — Needs Proper SSE Handling

### ❌ Previous
Basic pipe-through without proper SSE parsing.

### ✅ New (Robust SSE Parser)

```typescript
import { createParser, type ParseEvent } from 'eventsource-parser';

async function* streamChat(provider: string, body: object): AsyncGenerator<string> {
  const response = await fetch(`${getBaseUrl(provider)}/chat/completions`, {
    method: 'POST',
    headers: getHeaders(provider),
    body: JSON.stringify({ ...body, stream: true }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Stream failed: ${response.status}`);
  }

  const parser = createParser((event: ParseEvent) => {
    if (event.type === 'event') {
      // Handle OpenRouter keep-alive comments
      if (event.data.startsWith(': OPENROUTER')) return;
      if (event.data === '[DONE]') return;
      
      try {
        const json = JSON.parse(event.data);
        const content = json.choices?.[0]?.delta?.content;
        if (content) return content;
      } catch {
        // Skip malformed chunks
      }
    }
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value, { stream: true });
    const parsed = parser.feed(chunk);
    if (parsed) yield parsed;
  }
}
```

**Action Required:** Use `eventsource-parser` for reliable SSE handling.

---

## Step 9: Model Caching — New Optimization

### ❌ Previous
Fetched models list on every provider switch.

### ✅ New (Cache with TTL)

```typescript
interface CachedModels {
  data: Model[];
  fetchedAt: number;
}

const modelCache = new Map<string, CachedModels>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getModels(provider: string): Promise<Model[]> {
  const cached = modelCache.get(provider);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.data;
  }

  const response = await fetch(`${getBaseUrl(provider)}/models`, {
    headers: getHeaders(provider),
  });
  
  const data = await response.json();
  const models = data.data || data.models || [];
  
  modelCache.set(provider, {
    data: models,
    fetchedAt: Date.now(),
  });
  
  return models;
}
```

**Action Required:** Implement model list caching with 5-minute TTL.

---

## Step 10: Provider Failover — New Resilience Pattern

### ❌ Previous
Single provider per request; failure = error.

### ✅ New (Automatic Failover)

```typescript
const FAILOVER_CHAINS: Record<string, string[]> = {
  'gpt-4': ['openrouter/openai/gpt-4o', 'together/meta-llama/Llama-3.3-70B-Instruct-Turbo'],
  'claude-3': ['openrouter/anthropic/claude-3-sonnet', 'venice/qwen3-235b'],
  'llama-70b': ['together/meta-llama/Llama-3.3-70B', 'featherless/meta-llama/Meta-Llama-3.1-70B-Instruct'],
};

async function chatWithFailover(
  modelGroup: string, 
  messages: Message[]
): Promise<ChatResponse> {
  const chain = FAILOVER_CHAINS[modelGroup] || [modelGroup];
  
  for (const model of chain) {
    const [provider, modelId] = model.split('/');
    try {
      return await chat(provider, { model: modelId, messages });
    } catch (error) {
      console.warn(`[${provider}] Failed, trying next: ${error.message}`);
      continue;
    }
  }
  
  throw new Error(`All providers failed for ${modelGroup}`);
}
```

**Action Required:** Define failover chains for critical model classes.

---

## Summary: Key Implementation Changes

| Area | Previous | New |
|------|----------|-----|
| Endpoints | Hardcoded, some wrong | Verified December 2025 |
| Cold starts | Not handled | Retry logic for Featherless/HF |
| Vision | Not supported | Full multimodal support |
| Files | Not supported | PDF, image upload |
| Provider features | Generic only | Routing, web search, functions |
| Error handling | Basic | Retry + backoff + jitter |
| Rate limits | Ignored | Track + throttle |
| Streaming | Basic pipe | Proper SSE parser |
| Model list | Fetch every time | 5-minute cache |
| Resilience | None | Cross-provider failover |

---

## Recommended Implementation Order

1. **Update endpoints and verify connectivity**
2. **Add proper error handling with retries**
3. **Implement cold-start handling for Featherless**
4. **Add vision/image support**
5. **Implement model caching**
6. **Add provider-specific features (Venice web search, Together functions)**
7. **Set up failover chains**
8. **Add rate limit tracking**

---

## Testing Checklist

- [ ] Each provider authenticates successfully
- [ ] Models list loads and caches correctly
- [ ] Basic chat completion works (non-streaming)
- [ ] Streaming works with proper SSE parsing
- [ ] Vision models accept and process images
- [ ] Cold models warm up with retry logic
- [ ] Rate limit 429s trigger backoff
- [ ] Provider failover activates on errors
- [ ] Venice web search returns citations
- [ ] Together function calling executes tools
