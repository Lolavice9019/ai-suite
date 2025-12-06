import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AIClient,
  OpenRouterProvider,
  HuggingFaceProvider,
  FeatherlessProvider,
  VeniceProvider,
} from '../src/index.js';
import type { ChatCompletionResponse, ChatMessage } from '../src/index.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('AIClient', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create client with no providers', () => {
      const client = new AIClient();
      expect(client.getConfiguredProviders()).toEqual([]);
    });

    it('should create client with multiple providers', () => {
      const client = new AIClient({
        openrouter: { apiKey: 'test-key' },
        huggingface: { apiKey: 'test-key' },
        featherless: { apiKey: 'test-key' },
        venice: { apiKey: 'test-key' },
      });
      expect(client.getConfiguredProviders()).toHaveLength(4);
      expect(client.hasProvider('openrouter')).toBe(true);
      expect(client.hasProvider('huggingface')).toBe(true);
      expect(client.hasProvider('featherless')).toBe(true);
      expect(client.hasProvider('venice')).toBe(true);
    });
  });

  describe('getProvider', () => {
    it('should return provider when configured', () => {
      const client = new AIClient({
        openrouter: { apiKey: 'test-key' },
      });
      expect(client.getProvider('openrouter')).toBeDefined();
    });

    it('should throw when provider not configured', () => {
      const client = new AIClient();
      expect(() => client.getProvider('openrouter')).toThrow(
        'Provider "openrouter" is not configured'
      );
    });
  });

  describe('fromEnv', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should create client from environment variables', () => {
      process.env.OPENROUTER_API_KEY = 'openrouter-key';
      process.env.HUGGINGFACE_API_KEY = 'huggingface-key';
      process.env.FEATHERLESS_API_KEY = 'featherless-key';
      process.env.VENICE_API_KEY = 'venice-key';

      const client = AIClient.fromEnv();
      expect(client.hasProvider('openrouter')).toBe(true);
      expect(client.hasProvider('huggingface')).toBe(true);
      expect(client.hasProvider('featherless')).toBe(true);
      expect(client.hasProvider('venice')).toBe(true);
    });

    it('should support HF_TOKEN as alternative for huggingface', () => {
      process.env.HF_TOKEN = 'hf-token';

      const client = AIClient.fromEnv();
      expect(client.hasProvider('huggingface')).toBe(true);
    });
  });
});

describe('OpenRouterProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should throw error if API key is missing', () => {
    expect(() => new OpenRouterProvider({ apiKey: '' })).toThrow('API key is required');
  });

  it('should make chat completion request', async () => {
    const mockResponse: ChatCompletionResponse = {
      id: 'test-id',
      provider: 'openrouter',
      model: 'openai/gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello!' },
          finishReason: 'stop',
        },
      ],
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
      created: Date.now(),
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'test-id',
        model: 'openai/gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      }),
    });

    const provider = new OpenRouterProvider({ apiKey: 'test-key' });
    const messages: ChatMessage[] = [{ role: 'user', content: 'Hi' }];
    const response = await provider.chat('openai/gpt-4o', messages);

    expect(response.provider).toBe('openrouter');
    expect(response.choices[0].message.content).toBe('Hello!');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('should handle API errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ error: 'Invalid API key' }),
    });

    const provider = new OpenRouterProvider({ apiKey: 'invalid-key' });
    const messages: ChatMessage[] = [{ role: 'user', content: 'Hi' }];

    await expect(provider.chat('openai/gpt-4o', messages)).rejects.toThrow(
      'HTTP 401: Unauthorized'
    );
  });
});

describe('HuggingFaceProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should throw error if API key is missing', () => {
    expect(() => new HuggingFaceProvider({ apiKey: '' })).toThrow('API key is required');
  });

  it('should use chat completions endpoint for instruction models', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'test-id',
        model: 'meta-llama/Llama-3.1-8B-Instruct',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
      }),
    });

    const provider = new HuggingFaceProvider({ apiKey: 'test-key' });
    const messages: ChatMessage[] = [{ role: 'user', content: 'Hi' }];
    const response = await provider.chat('meta-llama/Llama-3.1-8B-Instruct', messages);

    expect(response.provider).toBe('huggingface');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/chat/completions'),
      expect.any(Object)
    );
  });

  it('should use text-generation endpoint for base models', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ generated_text: 'Hello world!' }],
    });

    const provider = new HuggingFaceProvider({ apiKey: 'test-key' });
    const messages: ChatMessage[] = [{ role: 'user', content: 'Hi' }];
    const response = await provider.chat('gpt2', messages);

    expect(response.provider).toBe('huggingface');
    expect(response.choices[0].message.content).toBe('Hello world!');
  });
});

describe('FeatherlessProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should throw error if API key is missing', () => {
    expect(() => new FeatherlessProvider({ apiKey: '' })).toThrow('API key is required');
  });

  it('should make chat completion request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'test-id',
        model: 'meta-llama/Llama-3.1-8B-Instruct',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
      }),
    });

    const provider = new FeatherlessProvider({ apiKey: 'test-key' });
    const messages: ChatMessage[] = [{ role: 'user', content: 'Hi' }];
    const response = await provider.chat('meta-llama/Llama-3.1-8B-Instruct', messages);

    expect(response.provider).toBe('featherless');
    expect(response.choices[0].message.content).toBe('Hello!');
  });
});

describe('VeniceProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should throw error if API key is missing', () => {
    expect(() => new VeniceProvider({ apiKey: '' })).toThrow('API key is required');
  });

  it('should make chat completion request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'test-id',
        model: 'llama-3.3-70b',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
      }),
    });

    const provider = new VeniceProvider({ apiKey: 'test-key' });
    const messages: ChatMessage[] = [{ role: 'user', content: 'Hi' }];
    const response = await provider.chat('llama-3.3-70b', messages);

    expect(response.provider).toBe('venice');
    expect(response.choices[0].message.content).toBe('Hello!');
  });
});

describe('Chat options', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should pass options to provider', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'test-id',
        model: 'openai/gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Response' },
            finish_reason: 'stop',
          },
        ],
      }),
    });

    const client = new AIClient({
      openrouter: { apiKey: 'test-key' },
    });

    await client.chat({
      provider: 'openrouter',
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
      options: {
        maxTokens: 100,
        temperature: 0.7,
        topP: 0.9,
        stop: ['END'],
      },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"max_tokens":100'),
      })
    );
  });
});
