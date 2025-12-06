// Main exports
export { AIClient } from './client.js';

// Type exports
export type {
  Provider,
  MessageRole,
  ChatMessage,
  ChatCompletionOptions,
  Usage,
  ChatCompletionChoice,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderConfig,
  AIClientConfig,
  ChatCompletionRequest,
  AIError,
} from './types/index.js';

// Provider exports
export {
  BaseProvider,
  OpenRouterProvider,
  HuggingFaceProvider,
  FeatherlessProvider,
  VeniceProvider,
} from './providers/index.js';
export type { AIProvider } from './providers/index.js';
