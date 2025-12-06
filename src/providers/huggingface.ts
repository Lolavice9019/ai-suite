import type {
  ChatMessage,
  ChatCompletionOptions,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderConfig,
  Provider,
} from '../types/index.js';
import { BaseProvider } from './base.js';

const DEFAULT_BASE_URL = 'https://api-inference.huggingface.co';

interface HuggingFaceRequest {
  inputs: string;
  parameters?: {
    max_new_tokens?: number;
    temperature?: number;
    top_p?: number;
    stop_sequences?: string[];
    do_sample?: boolean;
    return_full_text?: boolean;
  };
  stream?: boolean;
}

interface HuggingFaceResponse {
  generated_text: string;
}

interface HuggingFaceChatRequest {
  model: string;
  messages: { role: string; content: string }[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  stream?: boolean;
}

interface HuggingFaceChatResponse {
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

interface HuggingFaceStreamChunk {
  id?: string;
  model?: string;
  choices?: {
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }[];
  token?: {
    id: number;
    text: string;
    special: boolean;
  };
  generated_text?: string | null;
}

/**
 * Hugging Face AI provider
 * 
 * Hugging Face provides access to thousands of models through their Inference API.
 * Supports both the legacy text-generation API and the newer chat completions API.
 * 
 * @example
 * ```typescript
 * const provider = new HuggingFaceProvider({ apiKey: 'your-hf-token' });
 * const response = await provider.chat('meta-llama/Llama-3.1-8B-Instruct', [
 *   { role: 'user', content: 'Hello!' }
 * ]);
 * ```
 */
export class HuggingFaceProvider extends BaseProvider {
  readonly name: Provider = 'huggingface';
  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  /**
   * Format messages into a prompt string for text-generation models
   */
  private formatMessagesAsPrompt(messages: ChatMessage[]): string {
    return messages
      .map((m) => {
        switch (m.role) {
          case 'system':
            return `System: ${m.content}`;
          case 'user':
            return `User: ${m.content}`;
          case 'assistant':
            return `Assistant: ${m.content}`;
          default:
            return m.content;
        }
      })
      .join('\n') + '\nAssistant:';
  }

  /**
   * Check if the model supports the chat completions endpoint
   * Most instruction-tuned models support this format
   */
  private usesChatEndpoint(model: string): boolean {
    const chatModelPatterns = [
      /instruct/i,
      /chat/i,
      /llama-3/i,
      /mistral.*instruct/i,
      /mixtral.*instruct/i,
      /zephyr/i,
      /openchat/i,
      /dolphin/i,
    ];
    return chatModelPatterns.some((pattern) => pattern.test(model));
  }

  async chat(
    model: string,
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): Promise<ChatCompletionResponse> {
    // Try chat completions endpoint for instruction-tuned models
    if (this.usesChatEndpoint(model)) {
      return this.chatCompletions(model, messages, options);
    }

    // Fall back to text-generation endpoint
    return this.textGeneration(model, messages, options);
  }

  private async chatCompletions(
    model: string,
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): Promise<ChatCompletionResponse> {
    const request: HuggingFaceChatRequest = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
    };

    if (options.maxTokens !== undefined) request.max_tokens = options.maxTokens;
    if (options.temperature !== undefined) request.temperature = options.temperature;
    if (options.topP !== undefined) request.top_p = options.topP;
    if (options.stop !== undefined) {
      request.stop = Array.isArray(options.stop) ? options.stop : [options.stop];
    }

    const response = await this.fetchJson<HuggingFaceChatResponse>(
      `${this.baseUrl}/models/${model}/v1/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(request),
      }
    );

    return {
      id: response.id || `hf-${Date.now()}`,
      provider: this.name,
      model: response.model || model,
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

  private async textGeneration(
    model: string,
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): Promise<ChatCompletionResponse> {
    const prompt = this.formatMessagesAsPrompt(messages);
    
    const request: HuggingFaceRequest = {
      inputs: prompt,
      parameters: {
        return_full_text: false,
        do_sample: true,
      },
    };

    if (options.maxTokens !== undefined) {
      request.parameters!.max_new_tokens = options.maxTokens;
    }
    if (options.temperature !== undefined) {
      request.parameters!.temperature = options.temperature;
    }
    if (options.topP !== undefined) {
      request.parameters!.top_p = options.topP;
    }
    if (options.stop !== undefined) {
      request.parameters!.stop_sequences = Array.isArray(options.stop)
        ? options.stop
        : [options.stop];
    }

    const response = await this.fetchJson<HuggingFaceResponse[] | HuggingFaceResponse>(
      `${this.baseUrl}/models/${model}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(request),
      }
    );

    const result = Array.isArray(response) ? response[0] : response;

    return {
      id: `hf-${Date.now()}`,
      provider: this.name,
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: result.generated_text.trim(),
          },
          finishReason: 'stop',
        },
      ],
      created: Date.now(),
    };
  }

  async *chatStream(
    model: string,
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): AsyncIterable<ChatCompletionChunk> {
    if (this.usesChatEndpoint(model)) {
      yield* this.chatCompletionsStream(model, messages, options);
    } else {
      yield* this.textGenerationStream(model, messages, options);
    }
  }

  private async *chatCompletionsStream(
    model: string,
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): AsyncIterable<ChatCompletionChunk> {
    const request: HuggingFaceChatRequest = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    };

    if (options.maxTokens !== undefined) request.max_tokens = options.maxTokens;
    if (options.temperature !== undefined) request.temperature = options.temperature;
    if (options.topP !== undefined) request.top_p = options.topP;
    if (options.stop !== undefined) {
      request.stop = Array.isArray(options.stop) ? options.stop : [options.stop];
    }

    const response = await fetch(
      `${this.baseUrl}/models/${model}/v1/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(request),
      }
    );

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

    yield* this.parseSSEStream(response.body, model);
  }

  private async *textGenerationStream(
    model: string,
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): AsyncIterable<ChatCompletionChunk> {
    const prompt = this.formatMessagesAsPrompt(messages);

    const request: HuggingFaceRequest = {
      inputs: prompt,
      parameters: {
        return_full_text: false,
        do_sample: true,
      },
      stream: true,
    };

    if (options.maxTokens !== undefined) {
      request.parameters!.max_new_tokens = options.maxTokens;
    }
    if (options.temperature !== undefined) {
      request.parameters!.temperature = options.temperature;
    }
    if (options.topP !== undefined) {
      request.parameters!.top_p = options.topP;
    }
    if (options.stop !== undefined) {
      request.parameters!.stop_sequences = Array.isArray(options.stop)
        ? options.stop
        : [options.stop];
    }

    const response = await fetch(`${this.baseUrl}/models/${model}`, {
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

    yield* this.parseTextGenStream(response.body, model);
  }

  private async *parseSSEStream(
    body: ReadableStream<Uint8Array>,
    model: string
  ): AsyncIterable<ChatCompletionChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const streamId = `hf-${Date.now()}`;

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
            const data = JSON.parse(trimmed.slice(6)) as HuggingFaceStreamChunk;
            if (data.choices) {
              yield {
                id: data.id || streamId,
                provider: this.name,
                model: data.model || model,
                choices: data.choices.map((choice) => ({
                  index: choice.index,
                  delta: {
                    role: choice.delta.role as 'assistant' | undefined,
                    content: choice.delta.content,
                  },
                  finishReason: choice.finish_reason,
                })),
              };
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async *parseTextGenStream(
    body: ReadableStream<Uint8Array>,
    model: string
  ): AsyncIterable<ChatCompletionChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const streamId = `hf-${Date.now()}`;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // Handle SSE format
          if (trimmed.startsWith('data:')) {
            const jsonStr = trimmed.slice(5).trim();
            if (jsonStr === '[DONE]') continue;

            try {
              const data = JSON.parse(jsonStr) as HuggingFaceStreamChunk;
              if (data.token && !data.token.special) {
                yield {
                  id: streamId,
                  provider: this.name,
                  model,
                  choices: [
                    {
                      index: 0,
                      delta: {
                        content: data.token.text,
                      },
                      finishReason: data.generated_text !== null ? 'stop' : null,
                    },
                  ],
                };
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
