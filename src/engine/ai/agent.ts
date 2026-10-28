import { useAssistant, Chat, ChatMessage, newChatId } from '@/store/useAssistant';
import { useProject } from '@/store/useProject';
import { useStudio } from '@/store/useStudio';
import { TOOL_SPECS, runTool, stateSummary } from './tools';

// The agent loop: send the conversation + tool specs to the configured model, execute the
// tool calls it returns through the store actions, feed results back, repeat until the
// model answers in plain text. Everything a turn changes is squashed into one undo step
// per workspace so Ctrl+Z reverts the whole request.

const MAX_STEPS = 16;

const SYSTEM = `You are the built-in assistant of "Movie Editor", a desktop app with two workspaces that share one project:
- the VIDEO editor (tracks, clips, titles/text, effects, per-clip animations, export), and
- the AUDIO STUDIO, a small DAW (audio tracks, instrument tracks with patterns of notes, per-track/clip/master effect chains, spectral clip processing, recording).
You act by calling tools. Rules:
1. If you need ids, what exists, times or settings, call get_state first (it is cheap). Never invent ids.
2. Resolve the user's words to concrete actions and do them; do not ask for confirmation except for destructive bulk deletes. Prefer one precise tool call over several vague ones.
3. Units: times in seconds (timeline, or within a clip when the tool says so), frequencies in Hz, tempo in BPM, note positions in beats. "Above 5 kHz" → lowpass at 5000; "below 100 Hz" → highpass at 100; "kill a hum at 50 Hz" → notch 50 Hz (q 8+).
4. For frequency work on a whole track use studio_eq; for a time range inside a recording use studio_process_clip with a spectral op (t0/t1 relative to the clip start).
5. When composing, use musical sense: choose fitting instruments, velocities 0.6–1, keep patterns on the grid, chords as several notes with the same start.
6. After acting, reply briefly in the user's language with what you did and anything they should check (e.g. "listen from 12 s"). Mention that Ctrl+Z undoes it if the change was big.
7. If something fails, say what and propose an alternative.`;

async function persist() {
  const chat = useAssistant.getState().chat;
  if (!chat) return;
  await window.api.aiSaveChat(chat);
  const list = (await window.api.aiListChats()) as import('@/store/useAssistant').ChatSummary[];
  useAssistant.getState().setChats(list);
}

export function newChat(): Chat {
  const projectPath = useProject.getState().projectPath;
  const chat: Chat = { id: newChatId(), title: 'New chat', projectPath, createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
  useAssistant.getState().setChat(chat);
  return chat;
}

/** Messages in the neutral wire format (drop UI-only fields). */
function wireMessages(msgs: ChatMessage[]) {
  return msgs.map((m) => {
    if (m.role === 'user') return { role: 'user' as const, text: m.text };
    if (m.role === 'assistant') return { role: 'assistant' as const, text: m.text, toolCalls: m.toolCalls };
    return { role: 'tool' as const, results: m.results };
  });
}

export async function sendMessage(text: string): Promise<void> {
  const A = useAssistant.getState();
  if (A.busy) return;
  if (!A.chat) newChat();
  const chat = useAssistant.getState().chat!;
  const settings = A.settings ?? (await window.api.aiGetSettings()) as import('@/store/useAssistant').AiSettings;
  useAssistant.getState().setSettings(settings);
  if (!settings.apiKey && settings.provider === 'anthropic') {
    useAssistant.getState().setError('Configure the model first (⚙ Settings): provider, API key and model.');
    useAssistant.getState().setSettingsOpen(true);
    return;
  }

  useAssistant.getState().setError(null);
  const chatId = chat.id;
  const append = (m: ChatMessage) => useAssistant.getState().appendMessage(m, chatId);
  append({ role: 'user', text, at: Date.now() });
  if (chat.messages.length === 0) {
    useAssistant.getState().setChat({ ...useAssistant.getState().chat!, title: text.slice(0, 48).replace(/\n/g, ' ') });
  }

  // one undo step per request, per workspace
  const vPast = useProject.getState().past.length, sPast = useStudio.getState().past.length;
  const vSnap = { tracks: useProject.getState().project.tracks, clips: useProject.getState().project.clips, assets: useProject.getState().project.assets };
  const sSnap = useStudio.getState().session;

  useAssistant.getState().setBusy(true, 'Thinking…');
  try {
    // give the model the current state up front so simple requests need no round trip
    const system = `${SYSTEM}\n\nCURRENT STATE:\n${stateSummary()}`;
    for (let step = 0; step < MAX_STEPS; step++) {
      const cur = useAssistant.getState().chat;
      if (!cur || cur.id !== chatId) break; // user switched chats: stop quietly
      const res = (await window.api.aiChat({ system, messages: wireMessages(cur.messages), tools: TOOL_SPECS })) as { text: string; toolCalls: { id: string; name: string; args: Record<string, unknown> }[] };
      append({ role: 'assistant', text: res.text ?? '', toolCalls: res.toolCalls?.length ? res.toolCalls : undefined, activity: [], at: Date.now() });
      if (!res.toolCalls?.length) break;

      const results: { id: string; name: string; content: string; isError?: boolean }[] = [];
      for (const call of res.toolCalls) {
        useAssistant.getState().setBusy(true, `Running ${call.name}…`);
        let content: string, isError = false;
        try { content = await runTool(call.name, call.args); } catch (e: any) { content = `ERROR: ${e?.message ?? e}`; isError = true; }
        results.push({ id: call.id, name: call.name, content, isError });
        useAssistant.getState().updateLastAssistant((m) => ({ ...m, activity: [...(m.activity ?? []), { id: call.id, name: call.name, args: call.args, result: content, isError }] }));
      }
      append({ role: 'tool', results, at: Date.now() });
      useAssistant.getState().setBusy(true, 'Thinking…');
    }
  } catch (e: any) {
    useAssistant.getState().setError(String(e?.message ?? e));
  } finally {
    // squash everything this request changed into a single undo entry (also when the
    // actions used were ones that don't record history themselves)
    const v = useProject.getState();
    const vChanged = v.project.tracks !== vSnap.tracks || v.project.clips !== vSnap.clips || v.project.assets !== vSnap.assets;
    if (vChanged) useProject.setState({ past: [...v.past.slice(0, vPast), vSnap], future: [] });
    const s = useStudio.getState();
    if (s.session !== sSnap) useStudio.setState({ past: [...s.past.slice(0, sPast), sSnap], future: [] });
    useAssistant.getState().setBusy(false);
    await persist();
  }
}

export async function loadChats() {
  const list = (await window.api.aiListChats()) as import('@/store/useAssistant').ChatSummary[];
  useAssistant.getState().setChats(list);
  return list;
}

export async function openChat(id: string) {
  const chat = (await window.api.aiLoadChat(id)) as Chat;
  useAssistant.getState().setChat(chat);
}

export async function deleteChat(id: string) {
  await window.api.aiDeleteChat(id);
  if (useAssistant.getState().chat?.id === id) useAssistant.getState().setChat(null);
  await loadChats();
}
