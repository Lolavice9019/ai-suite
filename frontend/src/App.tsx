import { useState, useEffect, useRef, type FormEvent, type ChangeEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
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

interface ChatSession {
  id: string;
  name: string;
  messages: Message[];
  provider: Provider;
  model: string;
  timestamp: number;
}

interface ChatSettings {
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
}

const DEFAULT_SETTINGS: ChatSettings = {
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: '',
};

export default function App() {
  // Provider & Model state
  const [provider, setProvider] = useState<Provider>('openrouter');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const [modelSearch, setModelSearch] = useState('');
  const [providerInfo, setProviderInfo] = useState<Record<string, ProviderInfo['features']>>({});
  const [visionModels, setVisionModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenUsage, setTokenUsage] = useState<{ prompt: number; completion: number; total: number } | null>(null);

  // Settings state
  const [settings, setSettings] = useState<ChatSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);

  // Image state
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  // Sidebar state
  const [chatHistory, setChatHistory] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);

  // Venice web search
  const [veniceWebSearch, setVeniceWebSearch] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load chat history from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('ai-suite-history');
    if (saved) {
      try {
        setChatHistory(JSON.parse(saved));
      } catch { /* ignore */ }
    }
    const savedSettings = localStorage.getItem('ai-suite-settings');
    if (savedSettings) {
      try {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) });
      } catch { /* ignore */ }
    }
  }, []);

  // Save chat history to localStorage
  useEffect(() => {
    localStorage.setItem('ai-suite-history', JSON.stringify(chatHistory));
  }, [chatHistory]);

  // Save settings to localStorage
  useEffect(() => {
    localStorage.setItem('ai-suite-settings', JSON.stringify(settings));
  }, [settings]);

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
        setModels(modelList);
        if (modelList.length > 0) setModel(modelList[0].id);
        const vision = modelList.filter(m => isVisionModel(m)).map(m => m.id);
        setVisionModels(vision);
      })
      .catch((e) => setError(`Failed to load models: ${e.message}`))
      .finally(() => setModelsLoading(false));
  }, [provider, providerInfo]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Filter models by search
  const filteredModels = models.filter(m => {
    const search = modelSearch.toLowerCase();
    return (m.name?.toLowerCase().includes(search) || m.id.toLowerCase().includes(search));
  }).slice(0, 100);

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

  function stopGeneration() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if ((!input.trim() && !selectedImage) || !model || isLoading) return;

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
    setTokenUsage(null);

    const assistantMessage: Message = { role: 'assistant', content: '' };
    setMessages([...newMessages, assistantMessage]);

    abortControllerRef.current = new AbortController();

    try {
      const messagesToSend = settings.systemPrompt
        ? [{ role: 'system' as const, content: settings.systemPrompt }, ...newMessages]
        : newMessages;

      const requestBody: Parameters<typeof chatStream>[1] = {
        model,
        messages: messagesToSend,
        max_tokens: settings.maxTokens,
        temperature: settings.temperature,
      };

      if (provider === 'venice' && veniceWebSearch) {
        requestBody.venice_parameters = {
          enable_web_search: 'on',
          enable_web_citations: true,
        };
      }

      for await (const chunk of chatStream(provider, requestBody)) {
        if (abortControllerRef.current?.signal.aborted) break;
        assistantMessage.content += chunk;
        setMessages([...newMessages, { ...assistantMessage }]);
      }

      // Save to history
      saveCurrentSession([...newMessages, assistantMessage]);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled
      } else {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        assistantMessage.content = `Error: ${errorMsg}`;
        setMessages([...newMessages, assistantMessage]);
        setError(errorMsg);
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }

  function saveCurrentSession(msgs: Message[]) {
    if (msgs.length === 0) return;

    const sessionId = currentSessionId || crypto.randomUUID();
    const firstUserMsg = msgs.find(m => m.role === 'user');
    const name = typeof firstUserMsg?.content === 'string'
      ? firstUserMsg.content.slice(0, 40) + (firstUserMsg.content.length > 40 ? '...' : '')
      : 'New Chat';

    const session: ChatSession = {
      id: sessionId,
      name,
      messages: msgs,
      provider,
      model,
      timestamp: Date.now(),
    };

    setChatHistory(prev => {
      const filtered = prev.filter(s => s.id !== sessionId);
      return [session, ...filtered].slice(0, 50);
    });
    setCurrentSessionId(sessionId);
  }

  function loadSession(session: ChatSession) {
    setMessages(session.messages);
    setProvider(session.provider);
    setModel(session.model);
    setCurrentSessionId(session.id);
  }

  function newChat() {
    setMessages([]);
    setCurrentSessionId(null);
    setError(null);
    setTokenUsage(null);
    setSelectedImage(null);
  }

  function deleteSession(id: string) {
    setChatHistory(prev => prev.filter(s => s.id !== id));
    if (currentSessionId === id) newChat();
  }

  function regenerateLastResponse() {
    if (messages.length < 2) return;
    const withoutLast = messages.slice(0, -1);
    const lastUserIdx = withoutLast.map((m, i) => m.role === 'user' ? i : -1).filter(i => i !== -1).pop();
    if (lastUserIdx === undefined) return;

    const userMsg = withoutLast[lastUserIdx];
    setMessages(withoutLast.slice(0, lastUserIdx));
    setTimeout(() => {
      setInput(typeof userMsg.content === 'string' ? userMsg.content : '');
      // Auto-submit would need to be handled differently
    }, 0);
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }

  const currentFeatures = providerInfo[provider];
  const canUseVision = currentFeatures?.vision && isVisionModel({ id: model }, visionModels);

  return (
    <div style={styles.container}>
      {/* Sidebar */}
      {showSidebar && (
        <aside style={styles.sidebar}>
          <div style={styles.sidebarHeader}>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Chat History</h2>
            <button onClick={newChat} style={styles.newChatBtn}>+ New</button>
          </div>
          <div style={styles.chatList}>
            {chatHistory.length === 0 && (
              <p style={{ color: '#6b7280', fontSize: '0.85rem', padding: '1rem' }}>No saved chats</p>
            )}
            {chatHistory.map(session => (
              <div
                key={session.id}
                style={{
                  ...styles.chatItem,
                  background: session.id === currentSessionId ? '#374151' : 'transparent',
                }}
              >
                <div
                  onClick={() => loadSession(session)}
                  style={{ flex: 1, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  <div style={{ fontWeight: 500 }}>{session.name}</div>
                  <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                    {session.provider} • {new Date(session.timestamp).toLocaleDateString()}
                  </div>
                </div>
                <button onClick={() => deleteSession(session.id)} style={styles.deleteBtn}>×</button>
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* Main Area */}
      <main style={styles.main}>
        {/* Header */}
        <header style={styles.header}>
          <div style={styles.headerRow}>
            <button onClick={() => setShowSidebar(!showSidebar)} style={styles.iconBtn} title="Toggle sidebar">
              ☰
            </button>

            <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)} style={styles.select}>
              {PROVIDER_LIST.map((p) => (
                <option key={p} value={p} disabled={!providerInfo[p]}>
                  {p} {providerInfo[p] ? '✓' : '✗'}
                </option>
              ))}
            </select>

            <div style={styles.modelSelectWrapper}>
              <input
                type="text"
                placeholder="Search models..."
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                style={styles.modelSearch}
              />
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                style={styles.modelSelect}
                disabled={modelsLoading}
              >
                {modelsLoading && <option>Loading...</option>}
                {!modelsLoading && filteredModels.length === 0 && <option>No models found</option>}
                {filteredModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.id} {isVisionModel(m, visionModels) ? '👁️' : ''}
                  </option>
                ))}
              </select>
            </div>

            <button onClick={() => setShowSettings(!showSettings)} style={styles.iconBtn} title="Settings">
              ⚙️
            </button>

            <button onClick={newChat} style={{ ...styles.btn, background: '#374151' }}>Clear</button>
          </div>

          {/* Feature indicators */}
          <div style={styles.features}>
            {currentFeatures?.vision && <span>👁️ Vision</span>}
            {currentFeatures?.functionCalling && <span>🔧 Functions</span>}
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
            {currentFeatures?.coldStarts && <span>❄️ Serverless</span>}
            {tokenUsage && (
              <span style={{ marginLeft: 'auto' }}>
                Tokens: {tokenUsage.prompt} + {tokenUsage.completion} = {tokenUsage.total}
              </span>
            )}
          </div>
        </header>

        {/* Settings Panel */}
        {showSettings && (
          <div style={styles.settingsPanel}>
            <div style={styles.settingRow}>
              <label>Temperature: {settings.temperature.toFixed(2)}</label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={settings.temperature}
                onChange={(e) => setSettings(s => ({ ...s, temperature: parseFloat(e.target.value) }))}
                style={styles.slider}
              />
            </div>
            <div style={styles.settingRow}>
              <label>Max Tokens: {settings.maxTokens}</label>
              <input
                type="range"
                min="256"
                max="32000"
                step="256"
                value={settings.maxTokens}
                onChange={(e) => setSettings(s => ({ ...s, maxTokens: parseInt(e.target.value) }))}
                style={styles.slider}
              />
            </div>
            <div style={styles.settingRow}>
              <label>System Prompt:</label>
              <textarea
                value={settings.systemPrompt}
                onChange={(e) => setSettings(s => ({ ...s, systemPrompt: e.target.value }))}
                placeholder="You are a helpful assistant..."
                style={styles.systemPrompt}
                rows={3}
              />
            </div>
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div style={styles.errorBanner}>
            {error}
            <button onClick={() => setError(null)} style={styles.errorClose}>✕</button>
          </div>
        )}

        {/* Messages */}
        <div style={styles.messages}>
          {messages.length === 0 && (
            <div style={styles.emptyState}>
              <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem', background: 'linear-gradient(135deg, #00d4ff 0%, #0099ff 50%, #fff 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: 700 }}>AI Suite v3.0</h1>
              <p style={{ color: '#555', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                {Object.keys(providerInfo).length} providers connected • {models.length} models available
              </p>
              <div style={styles.quickActions}>
                <button onClick={() => setInput('Explain quantum computing in simple terms')} style={styles.quickBtn}>
                  💡 Explain a concept
                </button>
                <button onClick={() => setInput('Write a Python function to sort a list')} style={styles.quickBtn}>
                  💻 Write code
                </button>
                <button onClick={() => setInput('Help me brainstorm ideas for')} style={styles.quickBtn}>
                  🧠 Brainstorm
                </button>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} style={{ ...styles.message, background: msg.role === 'user' ? '#0d1829' : '#111', borderColor: msg.role === 'user' ? '#0066aa22' : '#1a1a1a' }}>
              <div style={styles.messageHeader}>
                <strong style={{ color: msg.role === 'user' ? '#00d4ff' : '#fff', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {msg.role === 'user' ? 'You' : 'AI'}
                </strong>
                {msg.role === 'assistant' && typeof msg.content === 'string' && msg.content && (
                  <div style={styles.messageActions}>
                    <button onClick={() => copyToClipboard(msg.content as string)} style={styles.actionBtn} title="Copy">
                      📋
                    </button>
                    {i === messages.length - 1 && !isLoading && (
                      <button onClick={regenerateLastResponse} style={styles.actionBtn} title="Regenerate">
                        🔄
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div style={styles.messageContent}>
                {typeof msg.content === 'string' ? (
                  msg.role === 'assistant' ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code({ node, className, children, ...props }: any) {
                          const match = /language-(\w+)/.exec(className || '');
                          const inline = !match;
                          return !inline ? (
                            <SyntaxHighlighter
                              style={oneDark}
                              language={match[1]}
                              PreTag="div"
                              customStyle={{ borderRadius: '0.5rem', margin: '0.5rem 0' }}
                            >
                              {String(children).replace(/\n$/, '')}
                            </SyntaxHighlighter>
                          ) : (
                            <code className={className} style={styles.inlineCode} {...props}>
                              {children}
                            </code>
                          );
                        },
                      }}
                    >
                      {msg.content || (isLoading ? '▊' : '')}
                    </ReactMarkdown>
                  ) : (
                    <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                  )
                ) : (
                  <div>
                    {msg.content.map((part, j) =>
                      part.type === 'text' ? (
                        <span key={j}>{part.text}</span>
                      ) : (
                        <img key={j} src={part.image_url.url} alt="uploaded" style={styles.uploadedImage} />
                      )
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Image Preview */}
        {selectedImage && (
          <div style={styles.imagePreview}>
            <img src={selectedImage} alt="preview" style={{ maxHeight: '80px', borderRadius: '0.5rem' }} />
            <button onClick={clearImage} style={styles.imageClose}>✕</button>
          </div>
        )}

        {/* Input Area */}
        <form onSubmit={handleSubmit} style={styles.inputForm}>
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
                style={styles.attachBtn}
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
            style={styles.textInput}
          />
          {isLoading ? (
            <button type="button" onClick={stopGeneration} style={{ ...styles.btn, background: '#dc2626' }}>
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!model} style={styles.btn}>
              Send
            </button>
          )}
        </form>
      </main>
    </div>
  );
}

// ============================================
// Styles - Grafana/xAI Dark Theme
// ============================================
const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    height: '100vh',
    background: '#0a0a0a',
    color: '#ffffff',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  },
  sidebar: {
    width: '260px',
    background: '#111111',
    borderRight: '1px solid #1a1a1a',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
  },
  sidebarHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1rem',
    borderBottom: '1px solid #1a1a1a',
  },
  newChatBtn: {
    padding: '0.5rem 1rem',
    background: 'linear-gradient(135deg, #00d4ff 0%, #0099ff 100%)',
    color: '#000',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.8rem',
    fontWeight: 600,
    boxShadow: '0 0 20px rgba(0, 212, 255, 0.3)',
  },
  chatList: {
    flex: 1,
    overflow: 'auto',
  },
  chatItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '0.75rem 1rem',
    borderBottom: '1px solid #1a1a1a',
    gap: '0.5rem',
    transition: 'background 0.15s',
  },
  deleteBtn: {
    background: 'none',
    border: 'none',
    color: '#555',
    cursor: 'pointer',
    fontSize: '1.25rem',
    padding: '0.25rem',
    transition: 'color 0.15s',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    background: '#0a0a0a',
  },
  header: {
    padding: '0.75rem 1rem',
    borderBottom: '1px solid #1a1a1a',
    background: '#0d0d0d',
  },
  headerRow: {
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  select: {
    padding: '0.5rem 1rem',
    borderRadius: '6px',
    border: '1px solid #222',
    background: '#111',
    color: '#fff',
    fontSize: '0.85rem',
    cursor: 'pointer',
    outline: 'none',
  },
  modelSelectWrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    flex: 1,
    minWidth: '200px',
  },
  modelSearch: {
    padding: '0.4rem 0.75rem',
    borderRadius: '6px',
    border: '1px solid #222',
    background: '#0a0a0a',
    color: '#fff',
    fontSize: '0.8rem',
    outline: 'none',
  },
  modelSelect: {
    padding: '0.5rem 1rem',
    borderRadius: '6px',
    border: '1px solid #222',
    background: '#111',
    color: '#fff',
    fontSize: '0.85rem',
    cursor: 'pointer',
    outline: 'none',
  },
  iconBtn: {
    padding: '0.5rem 0.75rem',
    background: '#111',
    border: '1px solid #222',
    borderRadius: '6px',
    color: '#888',
    cursor: 'pointer',
    fontSize: '1rem',
    transition: 'all 0.15s',
  },
  btn: {
    padding: '0.75rem 1.5rem',
    borderRadius: '6px',
    border: 'none',
    background: 'linear-gradient(135deg, #00d4ff 0%, #0099ff 100%)',
    color: '#000',
    fontSize: '0.85rem',
    cursor: 'pointer',
    fontWeight: 600,
    boxShadow: '0 0 20px rgba(0, 212, 255, 0.2)',
    transition: 'all 0.15s',
  },
  features: {
    display: 'flex',
    gap: '1rem',
    marginTop: '0.5rem',
    fontSize: '0.75rem',
    color: '#666',
    flexWrap: 'wrap',
  },
  settingsPanel: {
    padding: '1rem',
    background: '#0d0d0d',
    borderBottom: '1px solid #1a1a1a',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  settingRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
  },
  slider: {
    width: '100%',
    accentColor: '#00d4ff',
    background: '#222',
    borderRadius: '4px',
  },
  systemPrompt: {
    padding: '0.75rem',
    borderRadius: '6px',
    border: '1px solid #222',
    background: '#0a0a0a',
    color: '#fff',
    fontSize: '0.85rem',
    resize: 'vertical',
    minHeight: '80px',
    outline: 'none',
    fontFamily: 'inherit',
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    padding: '0.75rem 1rem',
    background: 'linear-gradient(90deg, #ff0040 0%, #ff0080 100%)',
    color: '#fff',
    fontSize: '0.85rem',
    fontWeight: 500,
  },
  errorClose: {
    marginLeft: 'auto',
    background: 'none',
    border: 'none',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '1rem',
  },
  messages: {
    flex: 1,
    overflow: 'auto',
    padding: '1.5rem',
  },
  emptyState: {
    textAlign: 'center',
    marginTop: '15vh',
  },
  quickActions: {
    display: 'flex',
    gap: '0.75rem',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: '1rem',
  },
  quickBtn: {
    padding: '0.75rem 1.25rem',
    background: '#111',
    border: '1px solid #222',
    borderRadius: '8px',
    color: '#888',
    cursor: 'pointer',
    fontSize: '0.85rem',
    transition: 'all 0.15s',
  },
  message: {
    padding: '1.25rem',
    marginBottom: '1rem',
    borderRadius: '8px',
    border: '1px solid #1a1a1a',
  },
  messageHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.75rem',
  },
  messageActions: {
    display: 'flex',
    gap: '0.5rem',
  },
  actionBtn: {
    background: '#1a1a1a',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.8rem',
    padding: '0.25rem 0.5rem',
    opacity: 0.7,
    transition: 'opacity 0.15s',
  },
  messageContent: {
    lineHeight: 1.7,
    color: '#e0e0e0',
  },
  inlineCode: {
    background: '#1a1a1a',
    padding: '0.2rem 0.5rem',
    borderRadius: '4px',
    fontFamily: '"SF Mono", "Fira Code", monospace',
    fontSize: '0.85em',
    color: '#00d4ff',
  },
  uploadedImage: {
    maxWidth: '400px',
    maxHeight: '300px',
    borderRadius: '8px',
    marginTop: '0.75rem',
    border: '1px solid #222',
  },
  imagePreview: {
    position: 'relative',
    display: 'inline-block',
    margin: '0.5rem 1rem',
  },
  imageClose: {
    position: 'absolute',
    top: '-10px',
    right: '-10px',
    background: '#ff0040',
    border: 'none',
    borderRadius: '50%',
    width: '24px',
    height: '24px',
    cursor: 'pointer',
    color: '#fff',
    fontSize: '0.8rem',
    fontWeight: 'bold',
    boxShadow: '0 2px 8px rgba(255, 0, 64, 0.4)',
  },
  inputForm: {
    display: 'flex',
    gap: '0.5rem',
    padding: '1rem',
    borderTop: '1px solid #1a1a1a',
    background: '#0d0d0d',
  },
  attachBtn: {
    padding: '0.75rem 1rem',
    background: '#1a1a1a',
    border: '1px solid #222',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '1rem',
    transition: 'all 0.15s',
  },
  textInput: {
    flex: 1,
    padding: '0.75rem 1rem',
    borderRadius: '6px',
    border: '1px solid #222',
    background: '#0a0a0a',
    color: '#fff',
    fontSize: '1rem',
    outline: 'none',
    fontFamily: 'inherit',
  },
};
