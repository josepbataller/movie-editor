import { app, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

// AI assistant backend (main process): provider settings, chat completion with tool
// calling (Anthropic Messages API or any OpenAI-compatible API), speech-to-text, and
// chat history files. The renderer owns the tools and the agent loop; this file only
// talks HTTP so API keys never reach the page and CORS is not an issue.

export interface AiSettings {
  provider: 'anthropic' | 'openai';
  baseUrl: string;        // e.g. https://api.anthropic.com | https://api.openai.com/v1 | http://localhost:11434/v1
  apiKey: string;
  model: string;
  maxTokens: number;
  /** Speech-to-text (OpenAI-compatible /audio/transcriptions). Falls back to the chat endpoint/key when empty. */
  sttBaseUrl: string;
  sttApiKey: string;
  sttModel: string;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: '', model: 'claude-sonnet-5-5', maxTokens: 4096,
  sttBaseUrl: '', sttApiKey: '', sttModel: 'whisper-1',
};

/** Neutral message shapes shared with the renderer. */
export type AiMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls?: AiToolCall[] }
  | { role: 'tool'; results: { id: string; name: string; content: string; isError?: boolean }[] };
export interface AiToolCall { id: string; name: string; args: Record<string, unknown> }
export interface AiTool { name: string; description: string; parameters: Record<string, unknown> }
export interface AiChatRequest { system: string; messages: AiMessage[]; tools: AiTool[] }
export interface AiChatResponse { text: string; toolCalls: AiToolCall[]; usage?: { input: number; output: number }; raw?: unknown }

const settingsPath = () => path.join(app.getPath('userData'), 'ai-settings.json');
const chatsDir = () => path.join(app.getPath('userData'), 'chats');

export function loadSettings(): AiSettings {
  try { return { ...DEFAULT_AI_SETTINGS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }; } catch { return { ...DEFAULT_AI_SETTINGS }; }
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  if (!res.ok) {
    const msg = json?.error?.message ?? json?.message ?? text.slice(0, 400);
    throw new Error(`${res.status} ${res.statusText}: ${msg}`);
  }
  return json;
}

// ---------------------------------------------------------------------------
// Anthropic Messages API
// ---------------------------------------------------------------------------

async function chatAnthropic(s: AiSettings, req: AiChatRequest): Promise<AiChatResponse> {
  const messages: any[] = [];
  for (const m of req.messages) {
    if (m.role === 'user') messages.push({ role: 'user', content: m.text });
    else if (m.role === 'assistant') {
      const content: any[] = [];
      if (m.text) content.push({ type: 'text', text: m.text });
      for (const c of m.toolCalls ?? []) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
      if (content.length) messages.push({ role: 'assistant', content });
    } else {
      messages.push({ role: 'user', content: m.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, is_error: r.isError || undefined })) });
    }
  }
  const body = {
    model: s.model, max_tokens: s.maxTokens || 4096, system: req.system, messages,
    tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
  };
  const json = await postJson(`${s.baseUrl.replace(/\/+$/, '')}/v1/messages`, { 'x-api-key': s.apiKey, 'anthropic-version': '2023-06-01' }, body);
  const text = (json.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
  const toolCalls = (json.content ?? []).filter((b: any) => b.type === 'tool_use').map((b: any) => ({ id: b.id, name: b.name, args: b.input ?? {} }));
  return { text, toolCalls, usage: json.usage ? { input: json.usage.input_tokens, output: json.usage.output_tokens } : undefined };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible chat completions (OpenAI, Gemini compat, Ollama, Groq, Mistral…)
// ---------------------------------------------------------------------------

async function chatOpenAI(s: AiSettings, req: AiChatRequest): Promise<AiChatResponse> {
  const messages: any[] = [{ role: 'system', content: req.system }];
  for (const m of req.messages) {
    if (m.role === 'user') messages.push({ role: 'user', content: m.text });
    else if (m.role === 'assistant') {
      // an empty assistant turn without tool calls is rejected by the API: replay it as an empty string
      if (!m.text && !m.toolCalls?.length) { messages.push({ role: 'assistant', content: '' }); continue; }
      messages.push({
        role: 'assistant', content: m.text || null,
        tool_calls: m.toolCalls?.length ? m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) : undefined,
      });
    } else {
      for (const r of m.results) messages.push({ role: 'tool', tool_call_id: r.id, content: r.content });
    }
  }
  const body: any = { model: s.model, messages };
  // OpenAI reasoning models (o1/o3/o4, gpt-5) only accept max_completion_tokens
  if (/^(o\d|gpt-5)/i.test(s.model)) body.max_completion_tokens = s.maxTokens || 4096; else body.max_tokens = s.maxTokens || 4096;
  if (req.tools.length) body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const url = `${s.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const headers: Record<string, string> = s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {};
  let json: any;
  try {
    json = await postJson(url, headers, body);
  } catch (e: any) {
    // some gateways want the other token field name: retry once with it swapped
    if (/max_completion_tokens|max_tokens/i.test(String(e?.message))) {
      if (body.max_tokens) { body.max_completion_tokens = body.max_tokens; delete body.max_tokens; } else { body.max_tokens = body.max_completion_tokens; delete body.max_completion_tokens; }
      json = await postJson(url, headers, body);
    } else throw e;
  }
  const msg = json.choices?.[0]?.message ?? {};
  const toolCalls = (msg.tool_calls ?? []).map((c: any, i: number) => {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(c.function?.arguments || '{}'); } catch { /* keep empty */ }
    return { id: c.id ?? `call_${i}`, name: c.function?.name ?? '', args };
  });
  return { text: msg.content ?? '', toolCalls, usage: json.usage ? { input: json.usage.prompt_tokens, output: json.usage.completion_tokens } : undefined };
}

export async function chat(req: AiChatRequest, settings = loadSettings()): Promise<AiChatResponse> {
  if (!settings.apiKey && settings.provider === 'anthropic') throw new Error('No API key configured (Assistant → Settings).');
  return settings.provider === 'anthropic' ? chatAnthropic(settings, req) : chatOpenAI(settings, req);
}

/** Speech to text via an OpenAI-compatible /audio/transcriptions endpoint (Whisper). */
export async function transcribe(wavPath: string, language?: string, settings = loadSettings()): Promise<string> {
  const base = (settings.sttBaseUrl || (settings.provider === 'openai' ? settings.baseUrl : '')).replace(/\/+$/, '');
  const key = settings.sttApiKey || (settings.provider === 'openai' ? settings.apiKey : '');
  if (!base) throw new Error('Dictation needs a speech-to-text endpoint (OpenAI-compatible). Set it in Assistant → Settings.');
  const form = new FormData();
  const data = await fs.promises.readFile(wavPath);
  form.append('file', new Blob([new Uint8Array(data)], { type: 'audio/wav' }), 'speech.wav');
  form.append('model', settings.sttModel || 'whisper-1');
  if (language) form.append('language', language);
  const res = await fetch(`${base}/audio/transcriptions`, { method: 'POST', headers: key ? { Authorization: `Bearer ${key}` } : {}, body: form });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text).text ?? ''; } catch { return text; }
}

// ---------------------------------------------------------------------------
// Chat history files
// ---------------------------------------------------------------------------

export interface ChatSummary { id: string; title: string; projectPath: string | null; updatedAt: number; messageCount: number }

export function registerAiIpc() {
  ipcMain.handle('ai:getSettings', () => loadSettings());
  ipcMain.handle('ai:saveSettings', async (_e, s: AiSettings) => { await fs.promises.writeFile(settingsPath(), JSON.stringify(s, null, 2)); });
  ipcMain.handle('ai:chat', async (_e, req: AiChatRequest) => chat(req));
  ipcMain.handle('ai:test', async () => {
    const r = await chat({ system: 'Reply with the single word OK.', messages: [{ role: 'user', text: 'ping' }], tools: [] });
    return { ok: true, text: r.text };
  });
  ipcMain.handle('ai:transcribe', async (_e, wavPath: string, language?: string) => transcribe(wavPath, language));
  ipcMain.handle('ai:listChats', async () => {
    await fs.promises.mkdir(chatsDir(), { recursive: true });
    const files = (await fs.promises.readdir(chatsDir())).filter((f) => f.endsWith('.json'));
    const out: ChatSummary[] = [];
    for (const f of files) {
      try {
        const j = JSON.parse(await fs.promises.readFile(path.join(chatsDir(), f), 'utf8'));
        out.push({ id: j.id, title: j.title ?? 'Chat', projectPath: j.projectPath ?? null, updatedAt: j.updatedAt ?? 0, messageCount: (j.messages ?? []).length });
      } catch { /* skip corrupt */ }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  });
  ipcMain.handle('ai:loadChat', async (_e, id: string) => JSON.parse(await fs.promises.readFile(path.join(chatsDir(), `${id}.json`), 'utf8')));
  ipcMain.handle('ai:saveChat', async (_e, chatData: { id: string }) => {
    await fs.promises.mkdir(chatsDir(), { recursive: true });
    await fs.promises.writeFile(path.join(chatsDir(), `${chatData.id}.json`), JSON.stringify(chatData));
  });
  ipcMain.handle('ai:deleteChat', async (_e, id: string) => { await fs.promises.unlink(path.join(chatsDir(), `${id}.json`)).catch(() => {}); });
}
