import { useState, useEffect, useRef, type FormEvent, type ChangeEvent } from 'react';
import {
  getHealth,
  getModels,
  chatStream,
  createImageMessage,
  fileToBase64DataUrl,
  isVisionModel,
  type Provider,
  type Message,
  type Model,
  type ProviderInfo,
  type HealthResponse,
} from './lib/api';

const PROVIDER_LIST: Provider[] = ['openrouter', 'huggingface', 'featherless', 'venice', 'together'];

export default function App() {
  const [provider, setProvider] = useState<Provider>('openrouter');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [providerInfo, setProviderInfo] = useState<Record<string, ProviderInfo['features']>>({});
  const [visionModels, setVisionModels] = useState<string[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [veniceWebSearch, setVeniceWebSearch] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check health on mount
  useEffect(() => {
    getHealth().then((data: HealthResponse) => {
      const info: Record<string, ProviderInfo['features']> = {};
      Object.entries(data.providers).forEach(([name, p]) => {
        if (p.configured) {
          info[name] = p.features;
        }
      });
      setProviderInfo(info);

      // Set default provider to first configured one
      const configured = Object.keys(info);
      if (configured.length > 0 && !info[provider]) {
        setProvider(configured[0] as Provider);
      }
    }).catch(console.error);
  }, []);

  // Fetch models when provider changes
  useEffect(() => {
    if (!providerInfo[provider]) return;

    setModelsLoading(true);
    setModels([]);
    setModel('');
    setError(null);

    getModels(provider)
      .then((data) => {
        const modelList = data.data || [];
        setModels(modelList.slice(0, 100)); // Limit for UI
        if (modelList.length > 0) setModel(modelList[0].id);

        // Extract vision models for this provider
        const vision = modelList.filter(m => isVisionModel(m)).map(m => m.id);
        setVisionModels(vision);
      })
      .catch((e) => {
        setError(`Failed to load models: ${e.message}`);
      })
      .finally(() => setModelsLoading(false));
  }, [provider, providerInfo]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle image selection
  async function handleImageSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      setError('Image must be under 20MB');
      return;
    }

    try {
      const dataUrl = await fileToBase64DataUrl(file);
      setSelectedImage(dataUrl);
      setError(null);
    } catch {
      setError('Failed to read image');
    }
  }

  function clearImage() {
    setSelectedImage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if ((!input.trim() && !selectedImage) || !model || isLoading) return;

    // Build message (with or without image)
    let userMessage: Message;
    if (selectedImage && isVisionModel({ id: model }, visionModels)) {
      userMessage = createImageMessage(input || 'What is in this image?', selectedImage);
    } else {
      userMessage = { role: 'user', content: input };
    }

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    clearImage();
    setIsLoading(true);
    setError(null);

    const assistantMessage: Message = { role: 'assistant', content: '' };
    setMessages([...newMessages, assistantMessage]);

    try {
      const requestBody: Parameters<typeof chatStream>[1] = {
        model,
        messages: newMessages,
        max_tokens: 4096,
      };

      // Add Venice web search if enabled
      if (provider === 'venice' && veniceWebSearch) {
        requestBody.venice_parameters = {
          enable_web_search: 'on',
          enable_web_citations: true,
        };
      }

      for await (const chunk of chatStream(provider, requestBody)) {
        assistantMessage.content += chunk;
        setMessages([...newMessages, { ...assistantMessage }]);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      assistantMessage.content = `Error: ${errorMsg}`;
      setMessages([...newMessages, assistantMessage]);
      setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  }

  const currentFeatures = providerInfo[provider];
  const canUseVision = currentFeatures?.vision && isVisionModel({ id: model }, visionModels);

  return (
    <div style={containerStyle}>
      {/* Header */}
      <header style={headerStyle}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)} style={selectStyle}>
            {PROVIDER_LIST.map((p) => (
              <option key={p} value={p} disabled={!providerInfo[p]}>
                {p} {providerInfo[p] ? '✓' : '✗'}
              </option>
            ))}
          </select>

          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            style={{ ...selectStyle, flex: 1, minWidth: '250px' }}
            disabled={modelsLoading}
          >
            {modelsLoading && <option>Loading models...</option>}
            {!modelsLoading && models.length === 0 && <option>No models available</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name || m.id} {isVisionModel(m, visionModels) ? '👁️' : ''}
              </option>
            ))}
          </select>

          <button onClick={() => setMessages([])} style={{ ...buttonStyle, background: '#374151' }}>
            Clear
          </button>
        </div>

        {/* Feature toggles */}
        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', fontSize: '0.8rem', color: '#9ca3af' }}>
          {currentFeatures?.vision && <span title="Vision supported">👁️ Vision</span>}
          {currentFeatures?.functionCalling && <span title="Function calling">🔧 Functions</span>}
          {currentFeatures?.webSearch && (
            <label style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={veniceWebSearch}
                onChange={(e) => setVeniceWebSearch(e.target.checked)}
                style={{ marginRight: '0.25rem' }}
              />
              🔍 Web Search
            </label>
          )}
          {currentFeatures?.coldStarts && <span title="May have cold starts">❄️ Serverless</span>}
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div style={errorBannerStyle}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* Messages */}
      <div style={messagesContainerStyle}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: '#6b7280', marginTop: '4rem' }}>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>AI Suite v3.0</h2>
            <p>Select a provider and model, then start chatting.</p>
            <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
              {canUseVision ? '📷 This model supports image input!' : ''}
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{ ...messageStyle, background: msg.role === 'user' ? '#1e3a5f' : '#1f2937' }}>
            <strong style={{ color: msg.role === 'user' ? '#60a5fa' : '#34d399' }}>
              {msg.role === 'user' ? 'You' : 'AI'}:
            </strong>{' '}
            {typeof msg.content === 'string' ? (
              <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content || (isLoading && msg.role === 'assistant' ? '...' : '')}</span>
            ) : (
              <div>
                {msg.content.map((part, j) =>
                  part.type === 'text' ? (
                    <span key={j}>{part.text}</span>
                  ) : (
                    <img key={j} src={part.image_url.url} alt="uploaded" style={{ maxWidth: '300px', maxHeight: '200px', borderRadius: '0.5rem', marginTop: '0.5rem' }} />
                  )
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Image preview */}
      {selectedImage && (
        <div style={imagePreviewStyle}>
          <img src={selectedImage} alt="preview" style={{ maxHeight: '100px', borderRadius: '0.5rem' }} />
          <button onClick={clearImage} style={{ position: 'absolute', top: '-8px', right: '-8px', background: '#ef4444', border: 'none', borderRadius: '50%', width: '24px', height: '24px', cursor: 'pointer', color: '#fff' }}>✕</button>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} style={inputFormStyle}>
        {canUseVision && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageSelect}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={{ ...buttonStyle, background: '#4b5563', padding: '0.75rem' }}
              title="Attach image"
            >
              📷
            </button>
          </>
        )}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={selectedImage ? 'Ask about this image...' : 'Type a message...'}
          disabled={isLoading}
          style={textInputStyle}
        />
        <button type="submit" disabled={isLoading || !model} style={buttonStyle}>
          {isLoading ? '...' : 'Send'}
        </button>
      </form>
    </div>
  );
}

// ============================================
// Styles
// ============================================
const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  maxWidth: '950px',
  margin: '0 auto',
  padding: '1rem',
};

const headerStyle: React.CSSProperties = {
  marginBottom: '1rem',
  paddingBottom: '1rem',
  borderBottom: '1px solid #374151',
};

const selectStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  borderRadius: '0.5rem',
  border: '1px solid #374151',
  background: '#111827',
  color: '#f8fafc',
  fontSize: '0.875rem',
};

const buttonStyle: React.CSSProperties = {
  padding: '0.75rem 1.5rem',
  borderRadius: '0.5rem',
  border: 'none',
  background: '#2563eb',
  color: '#fff',
  fontSize: '1rem',
  cursor: 'pointer',
};

const errorBannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '0.75rem 1rem',
  marginBottom: '1rem',
  borderRadius: '0.5rem',
  background: '#7f1d1d',
  color: '#fca5a5',
  fontSize: '0.9rem',
};

const messagesContainerStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  marginBottom: '1rem',
};

const messageStyle: React.CSSProperties = {
  padding: '1rem',
  marginBottom: '0.5rem',
  borderRadius: '0.5rem',
};

const imagePreviewStyle: React.CSSProperties = {
  position: 'relative',
  display: 'inline-block',
  marginBottom: '0.5rem',
};

const inputFormStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
};

const textInputStyle: React.CSSProperties = {
  flex: 1,
  padding: '0.75rem 1rem',
  borderRadius: '0.5rem',
  border: '1px solid #374151',
  background: '#111827',
  color: '#f8fafc',
  fontSize: '1rem',
};
