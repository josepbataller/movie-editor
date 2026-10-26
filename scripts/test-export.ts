// Headless export smoke test: builds a project exercising every feature of the
// FFmpeg graph builder (layers, PiP, rotation, effects, fades, speed, text,
// scrolling credits, audio mixing) and renders it. Run via `npm run test:export`.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { buildFfmpegCommand } from '../electron/exportBuilder';
import { Project, DEFAULT_TRANSFORM, DEFAULT_EFFECTS, DEFAULT_AUDIO, DEFAULT_TEXT } from '../src/shared/types';

const root = path.resolve(__dirname, '..', '..');
const ffmpeg = require('ffmpeg-static') as string;
const media = (f: string) => path.join(root, 'test-media', f);

const project: Project = {
  name: 'smoke', width: 1280, height: 720, fps: 30, backgroundColor: '#102030',
  assets: [
    { id: 'A', path: media('clipA.mp4'), name: 'clipA', kind: 'video', duration: 8, width: 1280, height: 720, hasVideo: true, hasAudio: true },
    { id: 'B', path: media('clipB.mp4'), name: 'clipB', kind: 'video', duration: 6, width: 1920, height: 1080, hasVideo: true, hasAudio: true },
    { id: 'M', path: media('music.mp3'), name: 'music', kind: 'audio', duration: 12, hasVideo: false, hasAudio: true },
    { id: 'P', path: media('photo.png'), name: 'photo', kind: 'image', duration: 0, width: 800, height: 600, hasVideo: true, hasAudio: false },
  ],
  tracks: [
    { id: 'v1', kind: 'video', name: 'Video 1', muted: false, hidden: false, locked: false },
    { id: 'v2', kind: 'video', name: 'Video 2', muted: false, hidden: false, locked: false },
    { id: 'a1', kind: 'audio', name: 'Audio 1', muted: false, hidden: false, locked: false },
  ],
  clips: [
    // Title card at start with fade
    { id: 't1', type: 'text', trackId: 'v2', name: 'Title', start: 0, duration: 2, inPoint: 0, speed: 1,
      text: { ...DEFAULT_TEXT, content: 'My Holiday\nMovie' }, transform: { ...DEFAULT_TRANSFORM }, fadeIn: 0.5, fadeOut: 0.5 },
    // Main video, trimmed from 1s, slight colour grade, fades
    { id: 'c1', type: 'video', assetId: 'A', trackId: 'v1', name: 'A', start: 1, duration: 4, inPoint: 1, speed: 1,
      transform: { ...DEFAULT_TRANSFORM }, effects: { ...DEFAULT_EFFECTS, saturation: 1.4, contrast: 1.1 }, audio: { ...DEFAULT_AUDIO, fadeIn: 0.5, fadeOut: 0.5 }, fadeIn: 0.5, fadeOut: 0.5 },
    // PiP of B, rotated, half opacity, 2x speed, muted
    { id: 'c2', type: 'video', assetId: 'B', trackId: 'v2', name: 'B', start: 2, duration: 2, inPoint: 0, speed: 2,
      transform: { ...DEFAULT_TRANSFORM, scale: 0.33, x: 380, y: -200, rotation: 15, opacity: 0.85 }, effects: { ...DEFAULT_EFFECTS, sepia: true }, audio: { ...DEFAULT_AUDIO, muted: true }, fadeIn: 0, fadeOut: 0 },
    // Image, B&W, blurred, flipped
    { id: 'c3', type: 'image', assetId: 'P', trackId: 'v1', name: 'P', start: 5, duration: 2, inPoint: 0, speed: 1,
      transform: { ...DEFAULT_TRANSFORM, fit: 'cover', flipH: true }, effects: { ...DEFAULT_EFFECTS, grayscale: true, blur: 4 }, fadeIn: 0.3, fadeOut: 0.3 },
    // Scrolling credits
    { id: 't2', type: 'text', trackId: 'v2', name: 'Credits', start: 5, duration: 3, inPoint: 0, speed: 1,
      text: { ...DEFAULT_TEXT, content: 'Directed by\nMe\n\nThanks for watching', animation: 'scroll-up', fontSize: 48, bold: false }, transform: { ...DEFAULT_TRANSFORM }, fadeIn: 0, fadeOut: 0 },
    // Background music, lower volume, 0.8x speed
    { id: 'm1', type: 'audio', assetId: 'M', trackId: 'a1', name: 'music', start: 0, duration: 8, inPoint: 0, speed: 0.8, audio: { ...DEFAULT_AUDIO, volume: 0.4, fadeOut: 1 } },
  ],
};

// Fake "rendered" text PNGs: the real app renders them with canvas; here we make
// placeholders with ffmpeg so the graph can be exercised end to end.
const tmp = path.join(root, 'test-media', 'tmp');
fs.mkdirSync(tmp, { recursive: true });
const textImages: Record<string, string> = {};
const textImageSizes: Record<string, { w: number; h: number }> = {};
for (const [id, w, h] of [['t1', 1280, 720], ['t2', 1280, 300]] as const) {
  const p = path.join(tmp, `${id}.png`);
  spawnSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=white@0.6:size=${w}x${h},format=rgba`, '-frames:v', '1', p]);
  textImages[id] = p;
  textImageSizes[id] = { w, h };
}

const out = path.join(tmp, 'smoke-out.mp4');
const built = buildFfmpegCommand(project, {
  outputPath: out, width: 1280, height: 720, fps: 30, quality: 'medium', format: 'mp4', textImages, textImageSizes, engine: 'graph',
});
const script = path.join(tmp, 'graph.txt');
fs.writeFileSync(script, built.filterGraph);
console.log('--- filter graph ---\n' + built.filterGraph + '\n--------------------');
const args = ['-hide_banner', '-v', 'error', '-stats', ...built.inputArgs, '-filter_complex_script', script, ...built.outputArgs];
const t0 = Date.now();
const res = spawnSync(ffmpeg, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
console.log(res.stderr.split('\n').filter((l) => !l.startsWith('frame=') && l.trim()).join('\n'));
console.log(`exit ${res.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${out} (${fs.existsSync(out) ? fs.statSync(out).size : 0} bytes)`);
if (res.status === 0) {
  const probe = spawnSync(require('ffprobe-static').path, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate', '-of', 'compact', out], { encoding: 'utf8' });
  console.log(probe.stdout);
}
process.exit(res.status ?? 1);
