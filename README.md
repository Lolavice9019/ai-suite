# ai-suite

A unified, production-ready interface for accessing AI models across **OpenRouter**, **Hugging Face**, **Featherless AI**, and **Venice AI**.

## Features

- 🔄 **Unified API** - Single interface for multiple AI providers
- 🌊 **Streaming Support** - Real-time streaming responses from all providers
- 📦 **TypeScript First** - Full type definitions included
- ⚡ **Zero Dependencies** - Uses native `fetch` API
- 🔧 **Easy Configuration** - Simple API key configuration or environment variables
- 🎯 **Provider Flexibility** - Use any combination of providers

## Installation

```bash
npm install ai-suite
```

## Quick Start

```typescript
import { AIClient } from 'ai-suite';

// Create client with API keys
const client = new AIClient({
  openrouter: { apiKey: 'your-openrouter-key' },
  huggingface: { apiKey: 'your-huggingface-key' },
  featherless: { apiKey: 'your-featherless-key' },
  venice: { apiKey: 'your-venice-key' },
});

// Or create from environment variables
// const client = AIClient.fromEnv();

// Chat completion
const response = await client.chat({
  provider: 'openrouter',
  model: 'openai/gpt-4o',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'What is the capital of France?' },
  ],
});

console.log(response.choices[0].message.content);
// Output: "The capital of France is Paris."
```

## Environment Variables

Set API keys using environment variables:

```bash
export OPENROUTER_API_KEY=your-openrouter-key
export HUGGINGFACE_API_KEY=your-huggingface-key  # or HF_TOKEN
export FEATHERLESS_API_KEY=your-featherless-key
export VENICE_API_KEY=your-venice-key
```

Then create a client from environment:

```typescript
import { AIClient } from 'ai-suite';

const client = AIClient.fromEnv();
```

## Providers

### OpenRouter

Access hundreds of AI models through a single API.

```typescript
const response = await client.chat({
  provider: 'openrouter',
  model: 'openai/gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

Popular models:
- `openai/gpt-4o`
- `anthropic/claude-3.5-sonnet`
- `google/gemini-pro`
- `meta-llama/llama-3.1-70b-instruct`

### Hugging Face

Access thousands of open-source models.

```typescript
const response = await client.chat({
  provider: 'huggingface',
  model: 'meta-llama/Llama-3.1-8B-Instruct',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

Popular models:
- `meta-llama/Llama-3.1-8B-Instruct`
- `mistralai/Mistral-7B-Instruct-v0.3`
- `microsoft/Phi-3-mini-4k-instruct`

### Featherless AI

Serverless access to open-weight models.

```typescript
const response = await client.chat({
  provider: 'featherless',
  model: 'meta-llama/Llama-3.1-8B-Instruct',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

### Venice AI

Privacy-first AI platform.

```typescript
const response = await client.chat({
  provider: 'venice',
  model: 'llama-3.3-70b',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

## Streaming

All providers support streaming responses:

```typescript
const stream = client.chatStream({
  provider: 'openrouter',
  model: 'openai/gpt-4o',
  messages: [{ role: 'user', content: 'Tell me a story' }],
});

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content;
  if (content) {
    process.stdout.write(content);
  }
}
```

## Chat Options

Customize generation with options:

```typescript
const response = await client.chat({
  provider: 'openrouter',
  model: 'openai/gpt-4o',
  messages: [{ role: 'user', content: 'Write a poem' }],
  options: {
    maxTokens: 500,      // Maximum tokens to generate
    temperature: 0.7,    // Randomness (0-2)
    topP: 0.9,           // Nucleus sampling
    stop: ['END'],       // Stop sequences
  },
});
```

## Direct Provider Access

Access provider instances directly for advanced use:

```typescript
import { OpenRouterProvider } from 'ai-suite';

const provider = new OpenRouterProvider({
  apiKey: 'your-api-key',
  baseUrl: 'https://openrouter.ai/api/v1', // Optional custom URL
});

const response = await provider.chat(
  'openai/gpt-4o',
  [{ role: 'user', content: 'Hello!' }],
  { maxTokens: 100 }
);
```

## API Reference

### AIClient

```typescript
class AIClient {
  constructor(config?: AIClientConfig);
  
  // Create from environment variables
  static fromEnv(): AIClient;
  
  // Check if provider is configured
  hasProvider(provider: Provider): boolean;
  
  // Get configured providers
  getConfiguredProviders(): Provider[];
  
  // Get provider instance
  getProvider(provider: Provider): AIProvider;
  
  // Chat completion
  chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  
  // Streaming chat completion
  chatStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk>;
  
  // Quick chat helper
  quickChat(
    provider: Provider,
    model: string,
    messages: ChatMessage[],
    options?: ChatCompletionOptions
  ): Promise<ChatCompletionResponse>;
}
```

### Types

```typescript
type Provider = 'openrouter' | 'huggingface' | 'featherless' | 'venice';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stop?: string | string[];
  stream?: boolean;
}

interface ChatCompletionResponse {
  id: string;
  provider: Provider;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: Usage;
  created: number;
}
```

## Error Handling

```typescript
try {
  const response = await client.chat({
    provider: 'openrouter',
    model: 'openai/gpt-4o',
    messages: [{ role: 'user', content: 'Hello!' }],
  });
} catch (error) {
  if (error.provider) {
    console.error(`Error from ${error.provider}:`, error.message);
    console.error('Status code:', error.statusCode);
    console.error('Response:', error.response);
  }
}
```

## License

MIT
