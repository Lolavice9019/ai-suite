// ============================================
// AI Suite - Unified API Client v3.0.0
// December 2025 - Production Ready
// ============================================

export type Provider = 'openrouter' | 'huggingface' | 'featherless' | 'venice' | 'together';

// ============================================
// Message Types with Vision Support
// ============================================
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

// ============================================
// Request Types
// ============================================
export interface ChatRequest {
  model: string;
  messages: Message[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  // Function calling (Together, OpenRouter)
  tools?: Tool[];
  tool_choice?: 'auto' | 'none' | 'required';
  // Structured output (Together)
  response_format?: { type: 'text' | 'json_object' | 'json_schema'; schema?: Record<string, unknown> };
  // OpenRouter routing
  provider?: {
    order?: string[];
    allow_fallbacks?: boolean;
    sort?: 'price' | 'throughput' | 'latency';
    data_collection?: 'allow' | 'deny';
  };
  // Venice web search & characters
  venice_parameters?: {
    enable_web_search?: 'auto' | 'on' | 'off';
    enable_web_scraping?: boolean;
    enable_web_citations?: boolean;
    strip_thinking_response?: boolean;
    character_slug?: string;
  };
}

export interface ChatResponse {
  id: string;
  choices: Array<{
    index: number;
    message: Message;
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  // Failover endpoint additions
  _provider?: string;
  _model?: string;
}

export interface Model {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt: number | string; completion: number | string };
  // Featherless
  available_on_current_plan?: boolean;
  model_status?: 'cold' | 'loading' | 'warm';
  // Vision detection
  architecture?: { input_modalities?: string[] };
}

export interface ProviderInfo {
  name: string;
  baseUrl: string;
  features: {
    vision: boolean;
    imageGen: boolean;
    functionCalling: boolean;
    webSearch: boolean;
    coldStarts: boolean;
  };
  visionModels?: string[];
}

export interface HealthResponse {
  status: string;
  version: string;
  timestamp: string;
  providers: Record<string, {
    configured: boolean;
    features: ProviderInfo['features'];
    rateLimit: { limit: number; remaining: number; reset: number } | null;
  }>;
}

// ============================================
// Core API Functions
// ============================================

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error('Health check failed');
  return res.json();
}

export async function getProviders(): Promise<{ providers: ProviderInfo[] }> {
  const res = await fetch('/api/providers');
  if (!res.ok) throw new Error('Failed to fetch providers');
  return res.json();
}

export async function getModels(provider: Provider): Promise<{ data: Model[]; cached: boolean }> {
  const res = await fetch(`/api/${provider}/models`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch models: ${res.status}`);
  }
  return res.json();
}

// ============================================
// Chat Functions
// ============================================

export async function chat(provider: Provider, request: ChatRequest): Promise<ChatResponse> {
  const res = await fetch(`/api/${provider}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...request, stream: false }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Chat failed: ${res.status}`);
  }
  return res.json();
}

export async function* chatStream(
  provider: Provider,
  request: ChatRequest
): AsyncGenerator<string, void, unknown> {
  const res = await fetch(`/api/${provider}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...request, stream: true }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Stream failed: ${res.status}`);
  }
  if (!res.body) throw new Error('No response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      // Skip OpenRouter keep-alive comments
      if (line.startsWith(': OPENROUTER')) continue;
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {
          // Skip malformed JSON
        }
      }
    }
  }
}

// ============================================
// Failover Chat (automatic provider switching)
// ============================================
export async function chatWithFailover(
  modelClass: 'gpt-4-class' | 'claude-class' | 'llama-70b-class',
  messages: Message[],
  options?: Omit<ChatRequest, 'model' | 'messages'>
): Promise<ChatResponse> {
  const res = await fetch('/api/failover/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelClass, messages, ...options }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'All providers failed');
  }
  return res.json();
}

// ============================================
// Vision Helpers
// ============================================

export function createImageMessage(text: string, imageUrl: string, detail: 'auto' | 'low' | 'high' = 'auto'): Message {
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      { type: 'image_url', image_url: { url: imageUrl, detail } },
    ],
  };
}

export async function fileToBase64DataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function isVisionModel(model: Model, visionModels?: string[]): boolean {
  // Check architecture
  if (model.architecture?.input_modalities?.includes('image')) return true;
  // Check against known vision models
  if (visionModels?.some(vm => model.id.includes(vm))) return true;
  // Heuristic: common vision model naming patterns
  const visionPatterns = ['vision', 'vl', 'llava', 'gemini', 'gpt-4o', 'claude-3'];
  return visionPatterns.some(p => model.id.toLowerCase().includes(p));
}

// ============================================
// Image Generation
// ============================================

export interface ImageGenRequest {
  prompt: string;
  model?: string;
  n?: number;
  size?: string;
  // Together FLUX options
  width?: number;
  height?: number;
  steps?: number;
  // Venice options
  style_preset?: string;
  negative_prompt?: string;
}

export async function generateImage(provider: Provider, request: ImageGenRequest) {
  const res = await fetch(`/api/${provider}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Image generation failed');
  }
  return res.json();
}

// ============================================
// Venice-Specific
// ============================================

export interface VeniceCharacter {
  slug: string;
  name: string;
  description: string;
}

export async function getVeniceCharacters(): Promise<{ data: VeniceCharacter[] }> {
  const res = await fetch('/api/venice/characters');
  if (!res.ok) throw new Error('Failed to fetch characters');
  return res.json();
}

// ============================================
// HuggingFace → Featherless Routing
// Access Featherless models via HuggingFace router
// ============================================

export async function chatViaHuggingFaceFeatherless(
  model: string,
  messages: Message[],
  options?: Omit<ChatRequest, 'model' | 'messages'>
): Promise<ChatResponse> {
  const res = await fetch('/api/huggingface/featherless/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, ...options, stream: false }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'HF→Featherless request failed');
  }
  return res.json();
}

export async function* chatStreamViaHuggingFaceFeatherless(
  model: string,
  messages: Message[],
  options?: Omit<ChatRequest, 'model' | 'messages' | 'stream'>
): AsyncGenerator<string, void, unknown> {
  const res = await fetch('/api/huggingface/featherless/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, ...options, stream: true }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Stream failed');
  }
  if (!res.body) throw new Error('No response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {
          // Skip malformed JSON
        }
      }
    }
  }
}

// ============================================
// Embeddings
// ============================================

export async function createEmbeddings(
  provider: Provider,
  input: string | string[],
  model: string
): Promise<{ data: Array<{ embedding: number[]; index: number }> }> {
  const res = await fetch(`/api/${provider}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, model }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Embeddings failed');
  }
  return res.json();
}
