import { useEffect, useRef, useState } from 'react';
import { useAssistant, AiSettings, ChatMessage } from '@/store/useAssistant';
import { useProject } from '@/store/useProject';
import { sendMessage, newChat, loadChats, openChat, deleteChat } from '@/engine/ai/agent';
import { getEngine, audioBufferToWav } from '@/engine/audio/engine';
import { Recorder } from '@/engine/audio/recorder';

// Assistant side panel: chat with a configurable model that edits the project through tools.
// Shows what each turn did (tool cards), keeps a history per project, and supports dictation.

export default function AssistantPanel({ onClose }: { onClose: () => void }) {
  const chat = useAssistant((s) => s.chat);
  const chats = useAssistant((s) => s.chats);
  const busy = useAssistant((s) => s.busy);
  const status = useAssistant((s) => s.status);
  const error = useAssistant((s) => s.error);
  const settings = useAssistant((s) => s.settings);
  const settingsOpen = useAssistant((s) => s.settingsOpen);
  const recording = useAssistant((s) => s.recording);
  const projectPath = useProject((s) => s.projectPath);
  const [input, setInput] = useState('');
  const [showAll, setShowAll] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<Recorder | null>(null);
  const A = useAssistant.getState;

  useEffect(() => {
    void loadChats();
    if (!settings) void window.api.aiGetSettings().then((s) => A().setSettings(s as AiSettings));
    if (!chat) newChat();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [chat?.messages.length, busy, status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || settingsOpen) return;
      const tgt = e.target as HTMLElement;
      if (tgt && tgt.tagName === 'TEXTAREA') { (tgt as HTMLTextAreaElement).blur(); e.stopImmediatePropagation(); return; } // Esc while typing: just leave the box
      if (useAssistant.getState().recording) return;
      e.stopImmediatePropagation(); onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, settingsOpen]);

  // never leave the microphone open when the panel goes away
  useEffect(() => () => { recRef.current?.stop(); recRef.current?.stopInput(); recRef.current = null; useAssistant.getState().setRecording(false); }, []);

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    void sendMessage(text);
  };

  // dictation: record the mic with the studio recorder, save a WAV, transcribe through the provider
  const toggleDictation = async () => {
    const engine = getEngine();
    if (recording) {
      const res = recRef.current?.stop();
      recRef.current?.stopInput();
      A().setRecording(false);
      if (!res) return;
      try {
        A().setBusy(true, 'Transcribing…');
        const tmp = await window.api.tempPath(`dictation-${Date.now()}.wav`);
        await window.api.writeBinary(tmp, audioBufferToWav(res.buffer));
        const text = await window.api.aiTranscribe(tmp);
        setInput((v) => (v ? `${v} ${text}` : text));
      } catch (e: any) {
        A().setError(String(e?.message ?? e));
      } finally { A().setBusy(false); }
      return;
    }
    try {
      const rec = new Recorder(engine.ctx);
      await rec.openInput(undefined, engine.masterAnalyser);
      rec.start();
      recRef.current = rec;
      A().setRecording(true);
    } catch (e: any) { A().setError(`Microphone: ${e?.message ?? e}`); }
  };

  const visibleChats = showAll ? chats : chats.filter((c) => !c.projectPath || c.projectPath === projectPath);
  const providerLabel = settings ? `${settings.provider === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible'} · ${settings.model}` : '';

  return (
    <div className="help-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="assistant-panel">
        <div className="help-head">
          <strong>🤖 Assistant</strong>
          <span className="dim small" title={providerLabel}>{settings?.apiKey || settings?.provider === 'openai' ? providerLabel : 'not configured'}</span>
          <span style={{ marginLeft: 'auto' }} />
          <button className="small" disabled={busy} onClick={() => { newChat(); }} title="New chat">+ New</button>
          <button className="small" onClick={() => A().setSettingsOpen(true)} title="Model settings">⚙</button>
          <button className="small" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div className="assistant-body">
          <nav className="chat-list">
            <div className="chat-list-head">
              <span className="dim small">{showAll ? 'All chats' : 'This project'}</span>
              <button className="tiny" onClick={() => setShowAll(!showAll)}>{showAll ? 'project' : 'all'}</button>
            </div>
            {visibleChats.map((c) => (
              <div key={c.id} className={`chat-item ${chat?.id === c.id ? 'on' : ''} ${busy ? 'locked' : ''}`} onClick={() => { if (!busy) void openChat(c.id); }} title={busy ? 'Wait for the current request to finish' : c.projectPath ?? 'no project'}>
                <span className="chat-title">{c.title}</span>
                <span className="dim small">{new Date(c.updatedAt).toLocaleDateString()} · {c.messageCount}</span>
                <button className="tiny" disabled={busy} onClick={(e) => { e.stopPropagation(); if (confirm('Delete this chat?')) void deleteChat(c.id); }}>✕</button>
              </div>
            ))}
            {visibleChats.length === 0 && <div className="dim small" style={{ padding: 8 }}>No chats yet.</div>}
          </nav>
          <section className="chat-main">
            <div className="chat-messages" ref={listRef}>
              {(!chat || chat.messages.length === 0) && (
                <div className="chat-empty">
                  <h3>Tell me what to do</h3>
                  <p className="dim">I can edit both workspaces for you. Examples:</p>
                  <ul>
                    <li>“En la pista de voz, de 0:10 a 0:14 quita las frecuencias por encima de 5 kHz”</li>
                    <li>“Añade una batería 808 con un ritmo básico de 4 compases a 95 BPM y un bajo saw que siga Do–Sol”</li>
                    <li>“Pon un título estilo Star Wars con mi texto y un fondo de estrellas”</li>
                    <li>“Haz que el clip B sea picture-in-picture arriba a la derecha y gire 360° en 2 s”</li>
                    <li>“Sube 3 dB los graves del máster y ponle un compresor suave”</li>
                  </ul>
                  <p className="dim small">Everything I change is one Ctrl+Z step. Chats are saved per project.</p>
                </div>
              )}
              {chat?.messages.map((m, i) => <Message key={i} m={m} />)}
              {busy && <div className="msg assistant"><div className="bubble status"><span className="spinner" /> {status || 'Thinking…'}</div></div>}
              {error && <div className="msg assistant"><div className="bubble error">⚠ {error}</div></div>}
            </div>
            <div className="chat-input">
              <textarea rows={2} value={input} placeholder={recording ? 'Listening… click the mic again to stop' : 'Describe what you want (Enter to send, Shift+Enter for a new line)'}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } e.stopPropagation(); }}
                onKeyUp={(e) => e.stopPropagation()} />
              <button className={`mic ${recording ? 'on' : ''}`} onClick={() => void toggleDictation()} title="Dictate (needs a speech-to-text endpoint in Settings)">{recording ? '■' : '🎙'}</button>
              <button className="primary" onClick={send} disabled={busy || !input.trim()}>Send</button>
            </div>
          </section>
        </div>
        {settingsOpen && <SettingsModal />}
      </aside>
    </div>
  );
}

function Message({ m }: { m: ChatMessage }) {
  if (m.role === 'tool') return null; // results are shown inside the assistant's activity cards
  if (m.role === 'user') return <div className="msg user"><div className="bubble">{m.text}</div></div>;
  return (
    <div className="msg assistant">
      {m.activity?.map((a) => (
        <div key={a.id} className={`tool-card ${a.isError ? 'error' : ''}`} title={JSON.stringify(a.args, null, 1)}>
          <span className="tool-name">{a.isError ? '✖' : '✔'} {a.name.replace(/_/g, ' ')}</span>
          <span className="tool-result">{(a.result ?? '').replace(/^OK: /, '')}</span>
        </div>
      ))}
      {m.text && <div className="bubble">{m.text}</div>}
    </div>
  );
}

const PRESETS: { label: string; s: Partial<AiSettings> }[] = [
  { label: 'Anthropic (Claude)', s: { provider: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5-5' } },
  { label: 'OpenAI', s: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', sttBaseUrl: 'https://api.openai.com/v1', sttModel: 'whisper-1' } },
  { label: 'Google Gemini (OpenAI-compatible)', s: { provider: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' } },
  { label: 'Ollama (local)', s: { provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', apiKey: 'ollama' } },
  { label: 'Groq', s: { provider: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', sttBaseUrl: 'https://api.groq.com/openai/v1', sttModel: 'whisper-large-v3' } },
];

function SettingsModal() {
  const A = useAssistant.getState;
  const current = useAssistant((s) => s.settings);
  const [s, setS] = useState<AiSettings>(current ?? { provider: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: '', model: 'claude-sonnet-5-5', maxTokens: 4096, sttBaseUrl: '', sttApiKey: '', sttModel: 'whisper-1' });
  const [test, setTest] = useState<string>('');
  const up = (p: Partial<AiSettings>) => setS({ ...s, ...p });
  const save = async () => { await window.api.aiSaveSettings(s); A().setSettings(s); A().setSettingsOpen(false); };
  const runTest = async () => {
    setTest('Testing…');
    try { await window.api.aiSaveSettings(s); A().setSettings(s); const r = await window.api.aiTest(); setTest(`✅ Connected — model replied: ${r.text.slice(0, 60)}`); }
    catch (e: any) { setTest(`❌ ${e?.message ?? e}`); }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) A().setSettingsOpen(false); }}>
      <div className="modal" style={{ width: 560 }}>
        <div className="modal-title">Assistant model</div>
        <div className="field"><label>Preset</label>
          <select defaultValue="" onChange={(e) => { const p = PRESETS.find((x) => x.label === e.target.value); if (p) up(p.s); }}>
            <option value="" disabled>Choose a provider…</option>
            {PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
          </select>
        </div>
        <div className="field"><label>API style</label>
          <select value={s.provider} onChange={(e) => up({ provider: e.target.value as AiSettings['provider'] })}>
            <option value="anthropic">Anthropic Messages API</option>
            <option value="openai">OpenAI-compatible (OpenAI, Gemini, Ollama, Groq, Mistral…)</option>
          </select>
        </div>
        <div className="field"><label>Base URL</label><input value={s.baseUrl} onChange={(e) => up({ baseUrl: e.target.value })} /></div>
        <div className="field"><label>API key</label><input type="password" value={s.apiKey} onChange={(e) => up({ apiKey: e.target.value })} placeholder="sk-… (stored only on this computer)" /></div>
        <div className="field"><label>Model</label><input value={s.model} onChange={(e) => up({ model: e.target.value })} /></div>
        <div className="field"><label>Max tokens</label><input type="number" className="num" value={s.maxTokens} onChange={(e) => up({ maxTokens: Number(e.target.value) || 4096 })} /></div>
        <div className="dim small" style={{ margin: '10px 0 4px' }}><b>Dictation</b> (speech-to-text, OpenAI-compatible <code>/audio/transcriptions</code>). Leave empty to reuse the OpenAI endpoint above; Anthropic has no transcription API.</div>
        <div className="field"><label>STT URL</label><input value={s.sttBaseUrl} onChange={(e) => up({ sttBaseUrl: e.target.value })} placeholder="https://api.openai.com/v1" /></div>
        <div className="field"><label>STT key</label><input type="password" value={s.sttApiKey} onChange={(e) => up({ sttApiKey: e.target.value })} placeholder="(same as above if empty)" /></div>
        <div className="field"><label>STT model</label><input value={s.sttModel} onChange={(e) => up({ sttModel: e.target.value })} /></div>
        {test && <div className="dim small" style={{ marginTop: 6 }}>{test}</div>}
        <div className="modal-actions">
          <button onClick={() => A().setSettingsOpen(false)}>Cancel</button>
          <button onClick={() => void runTest()}>Test connection</button>
          <button className="primary" onClick={() => void save()}>Save</button>
        </div>
      </div>
    </div>
  );
}
