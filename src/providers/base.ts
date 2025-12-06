import type {
  ChatMessage,
  ChatCompletionOptions,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderConfig,
  Provider,
} from '../types/index.js';

/**
 * Base interface for AI providers
 */
export interface AIProvider {
  readonly name: Provider;
  
  /**
   * Create a chat completion
   */
  chat(
    model: string,
    messages: ChatMessage[],
    options?: ChatCompletionOptions
  ): Promise<ChatCompletionResponse>;

  /**
   * Create a streaming chat completion
   */
  chatStream(
    model: string,
    messages: ChatMessage[],
    options?: ChatCompletionOptions
  ): AsyncIterable<ChatCompletionChunk>;
}

/**
 * Base class for AI providers with common functionality
 */
export abstract class BaseProvider implements AIProvider {
  abstract readonly name: Provider;
  protected readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.config = config;
  }

  abstract chat(
    model: string,
    messages: ChatMessage[],
    options?: ChatCompletionOptions
  ): Promise<ChatCompletionResponse>;

  abstract chatStream(
    model: string,
    messages: ChatMessage[],
    options?: ChatCompletionOptions
  ): AsyncIterable<ChatCompletionChunk>;

  /**
   * Create an AIError with provider context
   */
  protected createError(
    message: string,
    statusCode?: number,
    response?: unknown
  ): Error {
    const error = new Error(message) as Error & {
      provider: Provider;
      statusCode?: number;
      response?: unknown;
    };
    error.provider = this.name;
    error.statusCode = statusCode;
    error.response = response;
    return error;
  }

  /**
   * Make an HTTP request with common error handling
   */
  protected async fetchJson<T>(
    url: string,
    options: RequestInit
  ): Promise<T> {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
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

    return response.json() as Promise<T>;
  }
}
