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

- `src/shared/types.ts` — project data model shared by UI and export. Change it first; keep it
  dependency-free (the Electron main process imports it).
- `src/store/useProject.ts` — Zustand store. Every mutation goes through `mutate()`; pass
  `{ commit: false }` while dragging/sliding and call `commit()` once at the start of the gesture
  so undo has one entry per gesture. Selectors must return stable references (no fresh arrays).
- `src/engine/` — `compositor.ts` (draws a frame; used by preview AND the frame exporter),
  `animation.ts` (segment envelopes + presets), `textRender.ts` (titles, per-frame text
  animations), `frameExporter.ts` (precise export), `projectFile.ts` (save/load/autosave).
- `electron/exportBuilder.ts` — Project → FFmpeg command for the fast "graph" engine and the
  audio graph of the "frames" engine. `needsFrameEngine()` decides which engine a project needs.
- `electron/main.ts` — windows, dialogs, ffprobe, thumbnails, export processes, frame decoders.
  `electron/preload.ts` is the only bridge (`window.api`).

## Conventions

- UI text in English. Comments explain *why*, briefly; match the surrounding style.
- Preview and export must produce the same picture: anything drawn in `compositor.ts` must either
  be expressible in `exportBuilder.ts` or flagged in `needsFrameEngine()`.
- Verify changes with `npm run typecheck`, `npm run build`, `npm run test:export`, and a
  screenshot/export via the debug flags. Never seek `<video>` elements frame by frame for export.
- Do not commit `test-media/` (generated, contains absolute local paths) or `.claude/settings.local.json`.
