import { create } from 'zustand';

// AI assistant UI state: settings, the open chat, and the saved chat list.
// Messages use the neutral shapes understood by electron/ai.ts; tool activity is kept
// alongside so the panel can show "what it did" cards.

export interface AiSettings {
  provider: 'anthropic' | 'openai';
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  sttBaseUrl: string;
  sttApiKey: string;
  sttModel: string;
}

export interface ToolActivity { id: string; name: string; args: Record<string, unknown>; result?: string; isError?: boolean }

export type ChatMessage =
  | { role: 'user'; text: string; at: number }
  | { role: 'assistant'; text: string; toolCalls?: { id: string; name: string; args: Record<string, unknown> }[]; activity?: ToolActivity[]; at: number }
  | { role: 'tool'; results: { id: string; name: string; content: string; isError?: boolean }[]; at: number };

export interface Chat { id: string; title: string; projectPath: string | null; createdAt: number; updatedAt: number; messages: ChatMessage[] }
export interface ChatSummary { id: string; title: string; projectPath: string | null; updatedAt: number; messageCount: number }

interface AssistantState {
  open: boolean;
  settings: AiSettings | null;
  settingsOpen: boolean;
  chats: ChatSummary[];
  chat: Chat | null;
  busy: boolean;
  status: string;          // "Thinking…", "Running studio_add_effect…"
  error: string | null;
  recording: boolean;      // dictation in progress

  setOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setSettings: (s: AiSettings) => void;
  setChats: (c: ChatSummary[]) => void;
  setChat: (c: Chat | null) => void;
  appendMessage: (m: ChatMessage, chatId?: string) => void;
  updateLastAssistant: (fn: (m: Extract<ChatMessage, { role: 'assistant' }>) => Extract<ChatMessage, { role: 'assistant' }>) => void;
  setBusy: (busy: boolean, status?: string) => void;
  setError: (e: string | null) => void;
  setRecording: (r: boolean) => void;
}

export const newChatId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const useAssistant = create<AssistantState>((set) => ({
  open: false,
  settings: null,
  settingsOpen: false,
  chats: [],
  chat: null,
  busy: false,
  status: '',
  error: null,
  recording: false,

  setOpen: (open) => set({ open }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setSettings: (settings) => set({ settings }),
  setChats: (chats) => set({ chats }),
  setChat: (chat) => set({ chat, error: null }),
  // chatId pins the write to the chat a request started in (ignored if the user switched chats)
  appendMessage: (m, chatId) => set((s) => (s.chat && (!chatId || s.chat.id === chatId) ? { chat: { ...s.chat, messages: [...s.chat.messages, m], updatedAt: Date.now() } } : {})),
  updateLastAssistant: (fn) => set((s) => {
    if (!s.chat) return {};
    const msgs = [...s.chat.messages];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === 'assistant') { msgs[i] = fn(m); break; }
    }
    return { chat: { ...s.chat, messages: msgs } };
  }),
  setBusy: (busy, status = '') => set({ busy, status }),
  setError: (error) => set({ error }),
  setRecording: (recording) => set({ recording }),
}));
