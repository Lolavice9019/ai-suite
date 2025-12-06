import type {
  ChatMessage,
  ChatCompletionOptions,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderConfig,
  Provider,
} from '../types/index.js';
import { BaseProvider } from './base.js';

const DEFAULT_BASE_URL = 'https://api.featherless.ai/v1';

interface FeatherlessMessage {
  role: string;
  content: string;
}

interface FeatherlessRequest {
  model: string;
  messages: FeatherlessMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  stream?: boolean;
}

interface FeatherlessResponse {
  id: string;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  created?: number;
}

interface FeatherlessStreamChunk {
  id: string;
  model: string;
  choices: {
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }[];
}

/**
 * Featherless AI provider
 * 
 * Featherless AI provides serverless access to thousands of open-weight models
 * through an OpenAI-compatible API.
 * 
 * @example
 * ```typescript
 * const provider = new FeatherlessProvider({ apiKey: 'your-api-key' });
 * const response = await provider.chat('meta-llama/Llama-3.1-8B-Instruct', [
 *   { role: 'user', content: 'Hello!' }
 * ]);
 * ```
 */
export class FeatherlessProvider extends BaseProvider {
  readonly name: Provider = 'featherless';
  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  async chat(
    model: string,
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): Promise<ChatCompletionResponse> {
    const request: FeatherlessRequest = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
    };

    if (options.maxTokens !== undefined) request.max_tokens = options.maxTokens;
    if (options.temperature !== undefined) request.temperature = options.temperature;
    if (options.topP !== undefined) request.top_p = options.topP;
    if (options.stop !== undefined) request.stop = options.stop;

    const response = await this.fetchJson<FeatherlessResponse>(
      `${this.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(request),
      }
    );

    return {
      id: response.id,
      provider: this.name,
      model: response.model,
      choices: response.choices.map((choice) => ({
        index: choice.index,
        message: {
          role: choice.message.role as 'assistant',
          content: choice.message.content,
        },
        finishReason: choice.finish_reason,
      })),
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
      created: response.created || Date.now(),
    };
  }

  async *chatStream(
    model: string,
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): AsyncIterable<ChatCompletionChunk> {
    const request: FeatherlessRequest = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    };

    if (options.maxTokens !== undefined) request.max_tokens = options.maxTokens;
    if (options.temperature !== undefined) request.temperature = options.temperature;
    if (options.topP !== undefined) request.top_p = options.topP;
    if (options.stop !== undefined) request.stop = options.stop;

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text();
      }
      throw this.createError(
        `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        errorBody
      );
    }

    if (!response.body) {
      throw this.createError('No response body for streaming');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(trimmed.slice(6)) as FeatherlessStreamChunk;
            yield {
              id: data.id,
              provider: this.name,
              model: data.model,
              choices: data.choices.map((choice) => ({
                index: choice.index,
                delta: {
                  role: choice.delta.role as 'assistant' | undefined,
                  content: choice.delta.content,
                },
                finishReason: choice.finish_reason,
              })),
            };
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
