import type {
  Provider,
  AIClientConfig,
  ChatMessage,
  ChatCompletionOptions,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatCompletionRequest,
} from './types/index.js';
import type { AIProvider } from './providers/base.js';
import { OpenRouterProvider } from './providers/openrouter.js';
import { HuggingFaceProvider } from './providers/huggingface.js';
import { FeatherlessProvider } from './providers/featherless.js';
import { VeniceProvider } from './providers/venice.js';

/**
 * AIClient - Unified interface for accessing AI models across multiple providers
 * 
 * Provides a single API to interact with OpenRouter, Hugging Face, Featherless AI,
 * and Venice AI, with support for chat completions and streaming.
 * 
 * @example
 * ```typescript
 * import { AIClient } from 'ai-suite';
 * 
 * const client = new AIClient({
 *   openrouter: { apiKey: process.env.OPENROUTER_API_KEY },
 *   huggingface: { apiKey: process.env.HUGGINGFACE_API_KEY },
 *   featherless: { apiKey: process.env.FEATHERLESS_API_KEY },
 *   venice: { apiKey: process.env.VENICE_API_KEY },
 * });
 * 
 * // Simple chat completion
 * const response = await client.chat({
 *   provider: 'openrouter',
 *   model: 'openai/gpt-4o',
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * });
 * 
 * // Streaming chat completion
 * for await (const chunk of client.chatStream({
 *   provider: 'venice',
 *   model: 'llama-3.3-70b',
 *   messages: [{ role: 'user', content: 'Tell me a story' }],
 * })) {
 *   process.stdout.write(chunk.choices[0]?.delta?.content || '');
 * }
 * ```
 */
export class AIClient {
  private providers: Map<Provider, AIProvider> = new Map();

  /**
   * Create a new AIClient instance
   * @param config - Configuration for AI providers
   */
  constructor(config: AIClientConfig = {}) {
    if (config.openrouter) {
      this.providers.set('openrouter', new OpenRouterProvider(config.openrouter));
    }
    if (config.huggingface) {
      this.providers.set('huggingface', new HuggingFaceProvider(config.huggingface));
    }
    if (config.featherless) {
      this.providers.set('featherless', new FeatherlessProvider(config.featherless));
    }
    if (config.venice) {
      this.providers.set('venice', new VeniceProvider(config.venice));
    }
  }

  /**
   * Get a specific provider instance
   * @param provider - The provider name
   * @returns The provider instance
   * @throws Error if the provider is not configured
   */
  getProvider(provider: Provider): AIProvider {
    const providerInstance = this.providers.get(provider);
    if (!providerInstance) {
      throw new Error(
        `Provider "${provider}" is not configured. Please provide API credentials for this provider.`
      );
    }
    return providerInstance;
  }

  /**
   * Check if a provider is configured
   * @param provider - The provider name
   * @returns true if the provider is configured
   */
  hasProvider(provider: Provider): boolean {
    return this.providers.has(provider);
  }

  /**
   * Get list of configured providers
   * @returns Array of configured provider names
   */
  getConfiguredProviders(): Provider[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Create a chat completion
   * @param request - The chat completion request
   * @returns The chat completion response
   */
  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const provider = this.getProvider(request.provider);
    return provider.chat(request.model, request.messages, request.options);
  }

  /**
   * Create a streaming chat completion
   * @param request - The chat completion request
   * @returns An async iterable of chat completion chunks
   */
  chatStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    const provider = this.getProvider(request.provider);
    return provider.chatStream(request.model, request.messages, request.options);
  }

  /**
   * Convenience method for quick chat with a provider
   * @param provider - The provider to use
   * @param model - The model to use
   * @param messages - The messages to send
   * @param options - Additional options
   * @returns The chat completion response
   */
  async quickChat(
    provider: Provider,
    model: string,
    messages: ChatMessage[],
    options?: ChatCompletionOptions
  ): Promise<ChatCompletionResponse> {
    return this.chat({ provider, model, messages, options });
  }

  /**
   * Create an AIClient from environment variables
   * 
   * Looks for the following environment variables:
   * - OPENROUTER_API_KEY
   * - HUGGINGFACE_API_KEY (or HF_TOKEN)
   * - FEATHERLESS_API_KEY
   * - VENICE_API_KEY
   * 
   * @returns A new AIClient instance configured from environment variables
   */
  static fromEnv(): AIClient {
    const config: AIClientConfig = {};

    const openrouterKey = process.env.OPENROUTER_API_KEY;
    if (openrouterKey) {
      config.openrouter = { apiKey: openrouterKey };
    }

    const huggingfaceKey = process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN;
    if (huggingfaceKey) {
      config.huggingface = { apiKey: huggingfaceKey };
    }

    const featherlessKey = process.env.FEATHERLESS_API_KEY;
    if (featherlessKey) {
      config.featherless = { apiKey: featherlessKey };
    }

    const veniceKey = process.env.VENICE_API_KEY;
    if (veniceKey) {
      config.venice = { apiKey: veniceKey };
    }

    return new AIClient(config);
  }
}
