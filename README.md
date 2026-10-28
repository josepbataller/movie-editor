# Movie Editor

A local desktop video editor for Windows: multi-track timeline, titles & credits,
effects, transforms, audio mixing, and FFmpeg export — no cloud, no account.

Built with Electron + React + TypeScript; rendering/export by a bundled FFmpeg.

## Running

```bash
npm install          # first time only
npm start            # builds and launches the app
```

Or double-click `Movie Editor.bat`. A packaged, double-clickable build lives in
`release/win-unpacked/Movie Editor.exe` after `npm run package`
(`npm run dist` additionally creates an installer in `release/`).

For development with hot reload: `npm run dev`.

## Workflow

1. **Import** media (Ctrl+I, the *Import* button, or drop files on the Media panel):
   video (mp4, mov, mkv, avi, webm…), audio (mp3, wav, aac, flac…), images (jpg, png…).
2. **Drag** items onto the timeline, or double-click to append them.
   Higher video tracks render *on top* of lower ones; audio tracks are mixed together.
3. **Arrange**: drag clips to move them (also between tracks), drag clip edges to trim,
   `S` to split at the playhead, `Del` to delete, `Ctrl+D` to duplicate. Snapping is on by default.
4. **Compose on screen**: drag a clip directly in the preview to move it; mouse wheel scales,
   Alt+wheel rotates. The *Screen layout* presets (full / picture-in-picture / halves / quarters)
   let you build split-screens and PiP quickly.
5. **Adjust** in the inspector (right panel): position/scale/rotation/opacity/flip,
   colour (brightness, contrast, saturation, hue, blur, B&W, sepia, invert, presets),
   fade in/out, speed, volume, mute, audio fades.
6. **Titles & credits**: *Add text* (`T`) or *Add credits*, then click **Open Title Studio** in the
   inspector: a pop-up editor with a live, scrubbable preview, drag-to-position and **140+ templates**
   in categories with a search box. *Studio intros* recreate famous logo openings with **your own word**:
   Marvel-style flipping comic pages inside the letters that freeze to red/white, Marvel-Studios-style
   brushed-silver plate with your word cut out in red, Disney-style lit castle on a lake with a fairy-dust comet
   (load the free fan font Waltograph via *Font file…* for the lettering), Pixar-style desk lamp that hops in,
   flattens a letter, takes its place, looks at you and clicks off, DreamWorks-style moon, Universal-style chrome
   letters sweeping round a turning planet, 20th-Century-style gold monument on bronze tiers with searchlights,
   Netflix, HBO static, Paramount, Warner, MTV, Nickelodeon… Custom font files (.ttf/.otf) can be loaded per
   project from the Style tab.
   *Movies & TV* (Star Wars crawl with real perspective + the 3-shot opening, Pulp Fiction, Stranger
   Things, Matrix, Tron, Harry Potter, Blade Runner, Jurassic, Barbie, Spider-Verse, Frozen, Mario,
   Pokémon, Game of Thrones, Friends…), *Party* (disco, confetti, fireworks, wedding, Christmas,
   Halloween, pride…), *Creators*, *Retro*, *Modern*, *Nature*, *Basic*. Style: fills (gradient,
   rainbow, gold, silver, chrome, fire, ice), **3D extrusion**, outline width, neon glow, 40 animated
   **backdrops** (starfield, nebula, disco lights, confetti, fireworks, clouds, moon, searchlights,
   synthwave grid, TV static, rain, snow, fire, aurora, halftone, speed lines…), vertical position.
   ~40 entrances (bounce, stamp, swing, focus, flicker, tracking, letters/words, blinds, split,
   pixelate, shine, spotlight, sparkle comet, comic pages, rainbow cycle, pulse…) and ~20 exits
   (scatter, drop, pixelate, spin away…). The **Motion FX** tab stacks zoom/spin/shake/blur/colour
   changes over any time range on top. The assistant can apply any template by id ("a Marvel-style
   intro with the word BATALLER").
7. **Animations over time** (inspector → *Animations*): change blur, brightness, contrast, saturation,
   hue, opacity, zoom, rotation, position or volume between two moments of a clip, with a ramp up,
   a hold and a ramp down (e.g. blur 0→100% over 1 s, hold 3 s, back over 1 s). One-click presets:
   Turn 90°, Full spin, Zoom in/out, Punch zoom, Heartbeat, Shake, Wobble, Bounce in, Slide in/out,
   Dream blur, Flash, Disco colours, Fade to B&W, Spin away, Duck audio. Yellow markers on the clip
   show where animations are.
8. **Export** (Ctrl+E): choose resolution (project / 4K / 1080p / 720p / 480p), frame rate,
   quality, format (MP4 recommended, MKV, WebM) and engine. *Fast* lets FFmpeg do everything; *Precise*
   renders every frame exactly like the preview (needed for animations and text effects, chosen
   automatically; roughly 3–6× real time). Progress and ETA are shown; you can cancel.
9. **Save** the project (Ctrl+S) as a `.mvproj` file to continue later. Projects reference the
   original media files by path — keep them where they are (or re-import if moved).
   Closing with unsaved changes asks Save / Don't save / Cancel; an automatic recovery copy is written
   every 15 s and offered on the next start if the app did not close cleanly.
10. **Video + audio**: imported videos get their sound on a separate, *linked* audio clip (🔗) so you
   can edit picture and sound independently; linked clips move and get selected together. Use
   *Linked clips → Unlink* / *Separate audio* in the inspector, or turn the behaviour off in
   Project settings → Import options.

## Audio Studio (music & sound editing)

Switch with the **Video | Audio Studio** toggle in the top bar. It is a small DAW that shares the
project file and media library with the video editor:

- **Tracks**: audio tracks (your recordings / music files) and instrument tracks. Mixer per track:
  volume, pan, mute, solo, level meter, effects chain.
- **Clips**: drag from the *Audio files* browser; trim edges, split (`S`), move between tracks,
  drag the corner handles for fade in / fade out (linear, exponential or S-curve), gain, speed/pitch,
  reverse. Snap to a musical grid (bar, 1/4 … 1/32, triplets) at the project BPM.
- **Effects** (per track and on the master bus): parametric **Equalizer with live spectrum** — drag
  bands, wheel = width, double-click to add a band, notch to kill a frequency — plus Filter,
  Compressor, Reverb, Echo/Delay (tempo-synced, ping-pong), Chorus, Distortion, Bitcrusher.
- **Instruments** (all synthesized, no sample packs needed), organised by family: Drums (4 kits with a
  **step sequencer**), Keys (grand/bright/upright piano, e-piano, Wurli, clavinet, harpsichord, organs,
  accordion, celesta, music box), Strings (violin, viola, cello, double bass, ensemble, pizzicato, harp),
  Woodwinds (flute, piccolo, clarinet, oboe, bassoon, recorder, pan flute), Brass (trumpet, trombone,
  French horn, tuba, section, saxes), Guitars & Bass, Mallets & Percussion (marimba, vibraphone,
  xylophone, glockenspiel, tubular bells, steel drum, kalimba, timpani), Voices, and synth basses /
  leads / pads / FX — 60+ sounds with a **piano roll** and editable parameters. A **Sampler** turns any
  recording or audio file into an instrument (🎹 in *Audio files*).
- **Built-in manual**: **? Help** (or `F1`) opens a side panel organised by task (Spanish), with a search box.
- **Views**: **▤ Blocks** shows colour blocks only (Logic-style overview for many tracks); the slider next to it sets track height; click a track's colour dot to recolour it.
- **Musical typing**: with an instrument track selected, keys A W S E D F T G Y H U J K… play it
  (Z / X change octave, 1–9 velocity; an on-screen keyboard shows the mapping). In the piano roll,
  **Type notes** writes what you play at the step cursor — hold a key to lengthen the note, `[` / `]` set
  the base length, chords advance together; **Record notes** (arm the track, play) records live into the pattern. Grid down to 1/64 and
  triplets; hold **Alt** while dragging to place freely.
- **Recording**: arm an audio track (●), press ● / `R`. Optional one-bar count-in, input device choice,
  input monitoring. Takes are saved as WAV next to the project and appear in *Audio files*.
- **Clip editor** (double-click an audio clip): waveform + **spectrogram**; drag a time × frequency
  rectangle and **attenuate / remove / isolate** those frequencies (spectral repair); normalize,
  region gain, loudness, trim, **pitch shift keeping tempo**, **time stretch**, noise reduction;
  non-destructive playback settings (speed/pitch, gain, fade curves, reverse); a **clip-level effects
  chain**. Every process creates a new WAV version — *Revert to original* is one click.
- **Transport**: bars.beats display, BPM, loop region (Shift+drag on the ruler), metronome.
- **Export** the mix as WAV / FLAC / MP3 / M4A / OGG, or **Send to video** to render it and drop it on
  the video timeline. From the video editor, *Open in Audio Studio* takes any clip's sound to a studio
  track for detailed work.

## AI assistant (edit by prompting)

**🤖 Assistant** in the top bar (or Ctrl+/) opens a chat that *acts* on the project: it calls the same
actions the UI uses (add tracks/effects/EQ bands, write patterns, process a clip's frequencies
between two times, add titles, animate clips, change layouts, transport…). Every request is one
Ctrl+Z step; what it did is shown as cards. Chats are saved locally and associated with the open
project. Configure the model in ⚙: Anthropic (Messages API) or any OpenAI-compatible endpoint
(OpenAI, Gemini, Ollama, Groq, Mistral…) with base URL, model and API key — keys are stored only in
`%APPDATA%\Movie Editor\ai-settings.json`. Dictation (🎙) uses an OpenAI-compatible
`/audio/transcriptions` endpoint (Whisper); Anthropic alone has none, so dictation stays off.

Testing offline: `node scripts/mock-llm.js` runs a scripted OpenAI-compatible server; point the
settings at `http://127.0.0.1:8765/v1` and run
`npx electron . --open=<project> --assistant-prompt="…"` to exercise the whole pipeline.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → (Shift: ±1 s) | Step one frame |
| Home / End | Go to start / end |
| S | Split selected clips (or clips under playhead) at playhead |
| Delete / Backspace | Delete selected clips |
| M | Mute / unmute selected clips |
| R (studio) | Start / stop recording |
| Z / X (studio) | Keyboard octave down / up |
| T | Add a title at the playhead |
| Ctrl+D | Duplicate selected clips |
| Ctrl+A | Select all clips |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+I | Import media |
| Ctrl+S / Ctrl+Shift+S | Save / save as |
| Ctrl+O / Ctrl+N | Open / new project |
| Ctrl+E | Export |
| Ctrl+/ | AI assistant |
| Ctrl+/ | AI assistant |
| + / − , Ctrl+wheel | Zoom timeline |
| Esc | Deselect |

## Project layout

```
electron/
  main.ts           Electron main process: windows, dialogs, ffprobe/ffmpeg, export job
  preload.ts        Secure bridge exposed to the UI as window.api
  exportBuilder.ts  Project -> FFmpeg filter graph (the export engine)
src/
  shared/           Data models: types.ts (video project), audioTypes.ts (Audio Studio), api.d.ts
  store/            Zustand stores: useProject.ts (video editor), useStudio.ts (Audio Studio)
  engine/video/     Compositor, animation engine, text renderer, frame-by-frame exporter
  engine/audio/     Web Audio engine, effects, synth/drum instruments, presets, studio<->video bridge
  engine/project/   Project files (save/load/autosave), media import
  components/video/ TopBar, MediaBin, Preview, Timeline, Inspector, ExportDialog, TitleStudio
  components/studio/ Audio Studio UI (transport, tracks, sound browser, effects, pattern editor)
  styles/           base.css, video.css, studio.css
scripts/make-test-media.js  Generates sample clips in test-media/ (`npm run test:media`, run this first)
scripts/test-export.ts   Headless export smoke test (`npm run test:export`)
```

## Debug flags

`electron . --open=<file.mvproj> --seek=<seconds> --select=<clipId> [--studio] --screenshot=<out.png>`
opens a project, positions the playhead, selects a clip (optionally in the Title Studio) and saves a
screenshot. `--export=<out.mp4>` runs a precise-engine export headlessly and quits.
Use `--disable-gpu` for reliable screenshots (but note software rendering makes blur very slow).
The last FFmpeg command and filter graph are written to `%TEMP%\movie-editor\last-export-command.txt`.
