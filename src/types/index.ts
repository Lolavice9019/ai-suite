/**
 * Supported AI providers
 */
export type Provider = 'openrouter' | 'huggingface' | 'featherless' | 'venice';

/**
 * Message role for chat completions
 */
export type MessageRole = 'system' | 'user' | 'assistant';

/**
 * Chat message structure
 */
export interface ChatMessage {
  role: MessageRole;
  content: string;
}

/**
 * Common options for chat completion requests
 */
export interface ChatCompletionOptions {
  /** Maximum number of tokens to generate */
  maxTokens?: number;
  /** Sampling temperature (0-2, higher = more random) */
  temperature?: number;
  /** Top-p (nucleus) sampling */
  topP?: number;
  /** Stop sequences */
  stop?: string | string[];
  /** Enable streaming response */
  stream?: boolean;
}

/**
 * Token usage statistics
 */
export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * A single choice in the completion response
 */
export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finishReason: string | null;
}

/**
 * Unified chat completion response
 */
export interface ChatCompletionResponse {
  id: string;
  provider: Provider;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: Usage;
  created: number;
}

/**
 * Streaming chunk for chat completion
 */
export interface ChatCompletionChunk {
  id: string;
  provider: Provider;
  model: string;
  choices: {
    index: number;
    delta: {
      role?: MessageRole;
      content?: string;
    };
    finishReason: string | null;
  }[];
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

/**
 * Configuration for AIClient
 */
export interface AIClientConfig {
  openrouter?: ProviderConfig;
  huggingface?: ProviderConfig;
  featherless?: ProviderConfig;
  venice?: ProviderConfig;
}

/**
 * Request parameters for chat completion
 */
export interface ChatCompletionRequest {
  provider: Provider;
  model: string;
  messages: ChatMessage[];
  options?: ChatCompletionOptions;
}

/**
 * Error response from AI providers
 */
export interface AIError extends Error {
  provider: Provider;
  statusCode?: number;
  response?: unknown;
}
