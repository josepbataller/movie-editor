# Movie Editor — notes for Claude

Local Windows desktop video editor: Electron 45 + React 19 + TypeScript 7 + Zustand, built with
Vite 8 (`vite-plugin-electron`). FFmpeg/FFprobe come from `ffmpeg-static` / `ffprobe-static`.
No backend, no network calls, no credentials.

## Commands

```bash
npm install            # first time (if ffmpeg/electron binaries are missing: npm install-scripts approve ffmpeg-static; node node_modules/electron/install.js)
npm run dev            # Vite dev server + Electron with hot reload
npm run build          # type-check + build renderer (dist/) and main/preload (dist-electron/)
npm run typecheck      # tsc --noEmit
npm run test:media     # generate sample media in test-media/ (needed by the tests below)
npm run test:export    # headless FFmpeg "graph" export smoke test
npm run package        # standalone folder build in release/win-unpacked/
npm run dist           # installer in release/
```

Debug flags (after `npm run build`):
`npx electron . --open=<file.mvproj> --seek=<s> --select=<clipId> [--studio] --screenshot=<out.png>`
and `--export=<out.mp4>` (headless frame-engine export). Add `--disable-gpu` for reliable
screenshots (software rendering is slow with blur). Kill leftover `electron.exe` test processes
with `taskkill //F //IM electron.exe` (Git Bash) when captures start failing with `UnknownVizError`.

## Layout

Two workspaces share one project file: the **video editor** and the **Audio Studio** (DAW).
Folders are split the same way everywhere (`video/`, `audio/`/`studio/`, shared/`project/`).

- `src/shared/` — data models, dependency-free (the Electron main process imports them):
  `types.ts` (video project, clips, export settings), `audioTypes.ts` (studio session, tracks,
  effects, instruments), `api.d.ts` (typing of `window.api`). Change models first.
- `src/store/` — Zustand stores: `useProject.ts` (video project + UI, `workspace` switch),
  `useStudio.ts` (audio session + UI). Every mutation goes through `mutate()`; pass
  `{ commit: false }` while dragging/sliding and call `commit()` once at the start of the gesture
  so undo has one entry per gesture. Selectors must return stable references (no fresh arrays).
- `src/engine/video/` — `compositor.ts` (draws a frame; used by preview AND the frame exporter),
  `animation.ts` (segment envelopes + presets), `textRender.ts` (titles, per-frame text
  animations), `frameExporter.ts` (precise export).
- `src/engine/audio/` — `engine.ts` (Web Audio graph, transport, scheduling, offline render,
  WAV encoder), `effects.ts` (effect sub-graphs, EQ response), `instruments.ts` (synth + drum
  synthesis), `presets.ts` (factory sounds), `bridge.ts` (studio ↔ video hand-over).
- `src/engine/project/` — `projectFile.ts` (save/load/migrate/autosave/close handshake),
  `importMedia.ts` (probe, thumbnails, waveforms).
- `src/components/video/` — editor UI; `src/components/studio/` — DAW UI (`useEngineSync.ts`
  binds the store to the audio engine). `src/styles/{base,video,studio}.css`.
- `electron/exportBuilder.ts` — Project → FFmpeg command for the fast "graph" engine and the
  audio graph of the "frames" engine. `needsFrameEngine()` decides which engine a project needs.
- `electron/main.ts` — windows, dialogs, ffprobe, thumbnails, export processes, frame decoders,
  audio extraction/encoding. `electron/preload.ts` is the only bridge (`window.api`).
- `electron/ai.ts` — AI assistant backend (provider adapters, STT, chat files, IPC); keys never reach
  the renderer. `src/engine/ai/tools.ts` = tool schemas + executors over the stores (add a tool there
  when a new UI capability appears), `src/engine/ai/agent.ts` = loop + undo squashing,
  `src/components/assistant/` = chat panel. Test offline with `scripts/mock-llm.js` + `--assistant-prompt`.
- `src/engine/video/backdrops.ts` animated title backgrounds (deterministic in t); `src/engine/video/titleTemplates.ts`
  the Title Studio catalogue (TEMPLATE_BASE + overrides, categories; also used by the assistant's `video_add_text`).
  `src/engine/video/lamp.ts` = the hopping desk lamp (choreography + vector drawing) used by the 'lamp' animation.
  `scripts/make-title-demo.ts` + `scripts/shoot-titles.js` render template frames headlessly for checking.
  Canvas gotcha: never mask with an opaque full-canvas fillRect under source-in (Chromium treats it as a clear);
  draw the pattern first and cut it with destination-in + drawImage.
- `src/engine/audio/clipOps.ts` render-in-place ops shared by the clip editor and the assistant.
## Conventions

- UI text in English. Comments explain *why*, briefly; match the surrounding style.
- Preview and export must produce the same picture: anything drawn in `compositor.ts` must either
  be expressible in `exportBuilder.ts` or flagged in `needsFrameEngine()`.
- Verify changes with `npm run typecheck`, `npm run build`, `npm run test:export`, and a
  screenshot/export via the debug flags. Never seek `<video>` elements frame by frame for export.
- Do not commit `test-media/` (generated, contains absolute local paths) or `.claude/settings.local.json`.
