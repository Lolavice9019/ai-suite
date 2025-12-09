import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { Readable } from 'stream';
import { createParser, type ParseEvent } from 'eventsource-parser';

config(); // Load .env from root

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Support large base64 images

// ============================================
// Types (December 2025 - Verified)
// ============================================
interface ProviderConfig {
  baseUrl: string;
  getHeaders: () => Record<string, string>;
  features: {
    vision: boolean;
    imageGen: boolean;
    functionCalling: boolean;
    webSearch: boolean;
    coldStarts: boolean;
  };
  visionModels?: string[]; // Models that support image input
}

interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
}

interface CachedModels {
  data: unknown[];
  fetchedAt: number;
}

// ============================================
// Provider Configuration (December 2025)
// ============================================
const PROVIDERS: Record<string, ProviderConfig> = {
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    getHeaders: () => ({
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
      'X-Title': 'AI Suite',
      'Content-Type': 'application/json',
    }),
    features: {
      vision: true,
      imageGen: true,
      functionCalling: true,
      webSearch: false, // Use :online suffix instead
      coldStarts: false,
    },
    visionModels: [
      'google/gemini-2.0-flash-exp', 'google/gemini-pro-vision',
      'anthropic/claude-3-opus', 'anthropic/claude-3-sonnet', 'anthropic/claude-3-haiku',
      'openai/gpt-4o', 'openai/gpt-4-vision-preview',
      'meta-llama/llama-3.2-90b-vision-instruct',
    ],
  },
  huggingface: {
    baseUrl: 'https://router.huggingface.co/v1',
    getHeaders: () => ({
      'Authorization': `Bearer ${process.env.HF_TOKEN}`,
      'Content-Type': 'application/json',
    }),
    features: {
      vision: true,
      imageGen: true,
      functionCalling: false,
      webSearch: false,
      coldStarts: true, // May return 502 during model loading
    },
    visionModels: [
      'Qwen/Qwen2-VL-7B-Instruct', 'Qwen/Qwen2-VL-72B-Instruct',
      'llava-hf/llava-1.5-7b-hf',
      'google/gemma-3-27b-it:featherless-ai', // Via Featherless
    ],
    // NOTE: To route HuggingFace requests through Featherless, append :featherless-ai to model name
    // e.g., "deepseek-ai/DeepSeek-R1-0528:featherless-ai"
    // This uses HF billing unless you configure your Featherless key in HF settings
  },
  featherless: {
    baseUrl: 'https://api.featherless.ai/v1',
    getHeaders: () => ({
      'Authorization': `Bearer ${process.env.FEATHERLESS_API_KEY}`,
      'Content-Type': 'application/json',
    }),
    features: {
      vision: true,
      imageGen: false,
      functionCalling: false,
      webSearch: false,
      coldStarts: true, // Returns 400 when model is cold
    },
    visionModels: [
      'google/gemma-3-27b-it',
      'mistralai/Mistral-Small-3.1-24B-Instruct-2503',
    ],
  },
  venice: {
    baseUrl: 'https://api.venice.ai/api/v1',
    getHeaders: () => ({
      'Authorization': `Bearer ${process.env.VENICE_API_KEY}`,
      'Content-Type': 'application/json',
    }),
    features: {
      vision: true,
      imageGen: true,
      functionCalling: false,
      webSearch: true, // venice_parameters.enable_web_search
      coldStarts: false,
    },
    visionModels: [
      'mistral-31-24b', 'llama-4-maverick',
    ],
  },
  together: {
    baseUrl: 'https://api.together.xyz/v1',
    getHeaders: () => ({
      'Authorization': `Bearer ${process.env.TOGETHER_API_KEY}`,
      'Content-Type': 'application/json',
    }),
    features: {
      vision: true,
      imageGen: true,
      functionCalling: true,
      webSearch: false,
      coldStarts: false,
    },
    visionModels: [
      'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo',
      'meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo',
      'Qwen/Qwen2-VL-72B-Instruct',
    ],
  },
};

type ProviderName = keyof typeof PROVIDERS;

// ============================================
// Rate Limit Tracking
// ============================================
const rateLimits = new Map<string, RateLimitInfo>();

function parseRateLimitHeaders(headers: Headers, provider: string): void {
  const limit = headers.get('x-ratelimit-limit') || headers.get('X-RateLimit-Limit');
  const remaining = headers.get('x-ratelimit-remaining') || headers.get('X-RateLimit-Remaining');
  const reset = headers.get('x-ratelimit-reset') || headers.get('X-RateLimit-Reset');

  if (limit && remaining) {
    rateLimits.set(provider, {
      limit: parseInt(limit),
      remaining: parseInt(remaining),
      reset: reset ? parseInt(reset) * 1000 : Date.now() + 60000,
    });
  }
}

// ============================================
// Model Cache (5-minute TTL)
// ============================================
const modelCache = new Map<string, CachedModels>();
const MODEL_CACHE_TTL = 5 * 60 * 1000;

// ============================================
// Retry Logic with Exponential Backoff
// ============================================
const RETRY_STATUS_CODES = [429, 500, 502, 503, 504];
const MAX_RETRIES = 3;

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  provider: string,
  attempt = 0
): Promise<Response> {
  const response = await fetch(url, options);

  // Track rate limits
  parseRateLimitHeaders(response.headers, provider);

  // Handle Featherless cold starts (returns 400 with specific message)
  if (provider === 'featherless' && response.status === 400) {
    const cloned = response.clone();
    try {
      const error = await cloned.json();
      if (error.message?.includes('Cold') || error.message?.includes('Not Ready')) {
        if (attempt < 5) { // More retries for cold starts
          const delay = Math.min(30000, 5000 * Math.pow(1.5, attempt));
          console.log(`[featherless] Model cold, retry in ${delay / 1000}s (attempt ${attempt + 1})`);
          await sleep(delay);
          return fetchWithRetry(url, options, provider, attempt + 1);
        }
      }
    } catch {
      // Not JSON, return original response
    }
    return response;
  }

  // Handle HuggingFace cold starts (502)
  if (provider === 'huggingface' && response.status === 502 && attempt < MAX_RETRIES) {
    const delay = 5000 * Math.pow(2, attempt);
    console.log(`[huggingface] Model loading, retry in ${delay / 1000}s`);
    await sleep(delay);
    return fetchWithRetry(url, options, provider, attempt + 1);
  }

  // Standard retry logic
  if (RETRY_STATUS_CODES.includes(response.status) && attempt < MAX_RETRIES) {
    const retryAfter = response.headers.get('Retry-After');
    const delay = retryAfter
      ? parseInt(retryAfter) * 1000
      : Math.min(1000 * Math.pow(2, attempt) * (0.5 + Math.random()), 30000);

    console.warn(`[${provider}] ${response.status} - Retry in ${Math.round(delay)}ms (attempt ${attempt + 1})`);
    await sleep(delay);
    return fetchWithRetry(url, options, provider, attempt + 1);
  }

  return response;
}

// ============================================
// Health Check
// ============================================
app.get('/api/health', (_req, res) => {
  const providers = Object.keys(PROVIDERS).reduce((acc, name) => {
    const envKey = name === 'huggingface' ? 'HF_TOKEN' : `${name.toUpperCase()}_API_KEY`;
    acc[name] = {
      configured: !!process.env[envKey],
      features: PROVIDERS[name].features,
      rateLimit: rateLimits.get(name) || null,
    };
    return acc;
  }, {} as Record<string, unknown>);

  res.json({
    status: 'ok',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    providers,
  });
});

// ============================================
// List Available Providers with Features
// ============================================
app.get('/api/providers', (_req, res) => {
  const available = Object.entries(PROVIDERS)
    .filter(([name]) => {
      const envKey = name === 'huggingface' ? 'HF_TOKEN' : `${name.toUpperCase()}_API_KEY`;
      return !!process.env[envKey];
    })
    .map(([name, config]) => ({
      name,
      baseUrl: config.baseUrl,
      features: config.features,
      visionModels: config.visionModels,
    }));

  res.json({ providers: available });
});

// ============================================
// Chat Completions with Full Feature Support
// ============================================
app.post('/api/:provider/chat/completions', async (req, res) => {
  const provider = req.params.provider as ProviderName;
  const config = PROVIDERS[provider];

  if (!config) {
    return res.status(400).json({ error: `Unknown provider: ${provider}` });
  }

  const isStreaming = req.body.stream === true;

  try {
    const response = await fetchWithRetry(
      `${config.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: config.getHeaders(),
        body: JSON.stringify(req.body),
      },
      provider
    );

    if (!response.ok) {
      const error = await response.text();
      return res.status(response.status).json({
        error,
        provider,
        hint: response.status === 400 && provider === 'featherless'
          ? 'Model may be cold. The system will retry automatically.'
          : undefined,
      });
    }

    if (isStreaming && response.body) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Provider', provider);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      const stream = new Readable({
        async read() {
          try {
            const { done, value } = await reader.read();
            if (done) {
              this.push(null);
              return;
            }
            const chunk = decoder.decode(value, { stream: true });
            // Filter OpenRouter keep-alive comments
            if (!chunk.includes(': OPENROUTER PROCESSING')) {
              this.push(chunk);
            }
          } catch (err) {
            this.destroy(err as Error);
          }
        },
      });

      stream.pipe(res);
    } else {
      const data = await response.json();
      res.json(data);
    }
  } catch (error) {
    console.error(`[${provider}] Error:`, error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Provider request failed',
      provider,
    });
  }
});

// ============================================
// Models with Caching
// ============================================
app.get('/api/:provider/models', async (req, res) => {
  const provider = req.params.provider as ProviderName;
  const config = PROVIDERS[provider];

  if (!config) {
    return res.status(400).json({ error: `Unknown provider: ${provider}` });
  }

  // Check cache
  const cached = modelCache.get(provider);
  if (cached && Date.now() - cached.fetchedAt < MODEL_CACHE_TTL) {
    return res.json({ data: cached.data, cached: true });
  }

  try {
    const response = await fetchWithRetry(
      `${config.baseUrl}/models`,
      { headers: config.getHeaders() },
      provider
    );

    if (!response.ok) {
      const error = await response.text();
      return res.status(response.status).json({ error, provider });
    }

    const data = await response.json();
    const models = data.data || data.models || [];

    // Cache the result
    modelCache.set(provider, { data: models, fetchedAt: Date.now() });

    res.json({ data: models, cached: false });
  } catch (error) {
    console.error(`[${provider}] Models error:`, error);
    res.status(500).json({ error: 'Failed to fetch models', provider });
  }
});

// ============================================
// Image Generation (Together, Venice, OpenRouter)
// ============================================
app.post('/api/:provider/images/generations', async (req, res) => {
  const provider = req.params.provider as ProviderName;
  const config = PROVIDERS[provider];

  if (!config || !config.features.imageGen) {
    return res.status(400).json({ error: `Image generation not supported: ${provider}` });
  }

  // Venice uses different endpoint
  const endpoint = provider === 'venice'
    ? `${config.baseUrl}/image/generate`
    : `${config.baseUrl}/images/generations`;

  try {
    const response = await fetchWithRetry(
      endpoint,
      {
        method: 'POST',
        headers: config.getHeaders(),
        body: JSON.stringify(req.body),
      },
      provider
    );

    if (!response.ok) {
      const error = await response.text();
      return res.status(response.status).json({ error, provider });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Image generation failed', provider });
  }
});

// ============================================
// HuggingFace → Featherless Routing
// Use HF router to access Featherless models (billed via HF or your Featherless key)
// ============================================
app.post('/api/huggingface/featherless/chat/completions', async (req, res) => {
  const config = PROVIDERS.huggingface;
  
  // Append :featherless-ai to model name if not already present
  let model = req.body.model;
  if (!model.includes(':featherless-ai')) {
    model = `${model}:featherless-ai`;
  }

  try {
    const response = await fetchWithRetry(
      `${config.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: config.getHeaders(),
        body: JSON.stringify({ ...req.body, model }),
      },
      'huggingface' // Use HF retry logic (handles 502)
    );

    if (!response.ok) {
      const error = await response.text();
      return res.status(response.status).json({
        error,
        provider: 'huggingface→featherless',
        hint: 'Using HuggingFace router to access Featherless. Check model availability.',
      });
    }

    if (req.body.stream && response.body) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Provider', 'huggingface→featherless');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      const stream = new Readable({
        async read() {
          try {
            const { done, value } = await reader.read();
            if (done) {
              this.push(null);
              return;
            }
            this.push(decoder.decode(value, { stream: true }));
          } catch (err) {
            this.destroy(err as Error);
          }
        },
      });

      stream.pipe(res);
    } else {
      const data = await response.json();
      res.json(data);
    }
  } catch (error) {
    console.error('[huggingface→featherless] Error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Request failed',
      provider: 'huggingface→featherless',
    });
  }
});

// ============================================
// Venice: Characters
// ============================================
app.get('/api/venice/characters', async (_req, res) => {
  try {
    const response = await fetch(`${PROVIDERS.venice.baseUrl}/characters`, {
      headers: PROVIDERS.venice.getHeaders(),
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch characters' });
  }
});

// ============================================
// Embeddings (All providers)
// ============================================
app.post('/api/:provider/embeddings', async (req, res) => {
  const provider = req.params.provider as ProviderName;
  const config = PROVIDERS[provider];

  if (!config) {
    return res.status(400).json({ error: `Unknown provider: ${provider}` });
  }

  try {
    const response = await fetchWithRetry(
      `${config.baseUrl}/embeddings`,
      {
        method: 'POST',
        headers: config.getHeaders(),
        body: JSON.stringify(req.body),
      },
      provider
    );

    if (!response.ok) {
      const error = await response.text();
      return res.status(response.status).json({ error, provider });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Embeddings request failed', provider });
  }
});

// ============================================
// File Upload (Together AI)
// ============================================
app.post('/api/together/files', async (req, res) => {
  try {
    const response = await fetch(`${PROVIDERS.together.baseUrl}/files`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.TOGETHER_API_KEY}`,
      },
      body: req.body, // Pass through multipart form data
    });

    if (!response.ok) {
      const error = await response.text();
      return res.status(response.status).json({ error });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'File upload failed' });
  }
});

// ============================================
// Provider Failover Endpoint
// ============================================
const FAILOVER_CHAINS: Record<string, Array<{ provider: string; model: string }>> = {
  'gpt-4-class': [
    { provider: 'openrouter', model: 'openai/gpt-4o' },
    { provider: 'together', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  ],
  'claude-class': [
    { provider: 'openrouter', model: 'anthropic/claude-3-sonnet' },
    { provider: 'venice', model: 'qwen3-235b' },
  ],
  'llama-70b-class': [
    { provider: 'together', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
    { provider: 'featherless', model: 'meta-llama/Meta-Llama-3.1-70B-Instruct' },
    { provider: 'openrouter', model: 'meta-llama/llama-3.1-70b-instruct' },
  ],
};

app.post('/api/failover/chat/completions', async (req, res) => {
  const { modelClass, messages, ...rest } = req.body;

  const chain = FAILOVER_CHAINS[modelClass];
  if (!chain) {
    return res.status(400).json({ error: `Unknown model class: ${modelClass}` });
  }

  for (const { provider, model } of chain) {
    const config = PROVIDERS[provider];
    if (!config) continue;

    // Check if provider is configured
    const envKey = provider === 'huggingface' ? 'HF_TOKEN' : `${provider.toUpperCase()}_API_KEY`;
    if (!process.env[envKey]) continue;

    try {
      const response = await fetchWithRetry(
        `${config.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: config.getHeaders(),
          body: JSON.stringify({ model, messages, ...rest }),
        },
        provider
      );

      if (response.ok) {
        const data = await response.json();
        return res.json({ ...data, _provider: provider, _model: model });
      }
    } catch (error) {
      console.warn(`[failover] ${provider}/${model} failed:`, error);
      continue;
    }
  }

  res.status(503).json({ error: 'All providers in failover chain failed' });
});

// ============================================
// Generic Proxy (catch-all)
// ============================================
app.all('/api/:provider/*', async (req, res) => {
  const provider = req.params.provider as ProviderName;
  const config = PROVIDERS[provider];

  if (!config) {
    return res.status(400).json({ error: `Unknown provider: ${provider}` });
  }

  const path = req.params[0];
  const url = `${config.baseUrl}/${path}`;

  try {
    const response = await fetchWithRetry(
      url,
      {
        method: req.method,
        headers: {
          ...config.getHeaders(),
          ...(req.method !== 'GET' && { 'Content-Type': 'application/json' }),
        },
        ...(req.method !== 'GET' && { body: JSON.stringify(req.body) }),
      },
      provider
    );

    if (!response.ok) {
      const error = await response.text();
      return res.status(response.status).json({ error, provider });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Request failed', provider });
  }
});

// ============================================
// Start Server
// ============================================
app.listen(PORT, () => {
  const configured = Object.keys(PROVIDERS).filter(name => {
    const envKey = name === 'huggingface' ? 'HF_TOKEN' : `${name.toUpperCase()}_API_KEY`;
    return !!process.env[envKey];
  });

  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           AI Suite Backend v3.0.0 (December 2025)             ║
╠═══════════════════════════════════════════════════════════════╣
║  🚀 Server: http://localhost:${PORT}                             ║
║                                                               ║
║  Configured Providers (${configured.length}/5):                             ║
║  ${process.env.OPENROUTER_API_KEY ? '✅' : '❌'} OpenRouter   - routing, vision, 400+ models         ║
║  ${process.env.HF_TOKEN ? '✅' : '❌'} HuggingFace  - serverless, dedicated endpoints       ║
║  ${process.env.FEATHERLESS_API_KEY ? '✅' : '❌'} Featherless  - flat pricing, 12K+ models           ║
║  ${process.env.VENICE_API_KEY ? '✅' : '❌'} Venice       - web search, uncensored, privacy      ║
║  ${process.env.TOGETHER_API_KEY ? '✅' : '❌'} Together     - functions, JSON mode, images        ║
║                                                               ║
║  Features: ✅ Vision ✅ Streaming ✅ Retry ✅ Cache ✅ Failover  ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
