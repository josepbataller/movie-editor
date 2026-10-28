// Builds test-media/titles.mvproj: one text clip per Title Studio template, back to back,
// plus a titles-index.json with each clip's start/duration (for screenshot runs).
// Run: tsc --ignoreConfig scripts/make-title-demo.ts --outDir tmp-test --module commonjs --target es2022 --esModuleInterop --skipLibCheck --types node && node tmp-test/scripts/make-title-demo.js
import path from 'node:path';
import fs from 'node:fs';
import { TITLE_TEMPLATES, templateStyle } from '../src/engine/video/titleTemplates';
import { DEFAULT_TEXT, DEFAULT_TRANSFORM, Project, TextProps } from '../src/shared/types';

const root = path.resolve(__dirname, '..', '..');
const out = path.join(root, 'test-media', 'titles.mvproj');
const only = process.argv.slice(2); // optional template ids

const project: Project = {
  name: 'titles', width: 1280, height: 720, fps: 30, backgroundColor: '#000000', assets: [],
  tracks: [{ id: 'v1', kind: 'video', name: 'Titles', muted: false, hidden: false, locked: false }],
  clips: [],
};
const index: { id: string; start: number; duration: number }[] = [];
let start = 0;
for (const tpl of TITLE_TEMPLATES) {
  if (only.length && !only.includes(tpl.id)) continue;
  const style = templateStyle(tpl);
  const duration = tpl.duration ?? Math.max(5, Math.ceil((style.animationDuration ?? 0) + (style.exitDuration ?? 0) + 1.5));
  const text: TextProps = { ...DEFAULT_TEXT, ...style, content: tpl.content ?? (tpl.category === 'studio' ? 'BATALLER' : tpl.label.toUpperCase()) };
  project.clips.push({
    id: tpl.id, type: 'text', trackId: 'v1', name: tpl.label, start, duration, inPoint: 0, speed: 1, text,
    transform: { ...DEFAULT_TRANSFORM, y: tpl.y ? Math.round(project.height * tpl.y) : 0 }, fadeIn: 0, fadeOut: 0,
  });
  index.push({ id: tpl.id, start, duration });
  start += duration;
}
fs.writeFileSync(out, JSON.stringify({ version: 1, project }, null, 2));
fs.writeFileSync(path.join(root, 'test-media', 'titles-index.json'), JSON.stringify(index, null, 2));
console.log(`${project.clips.length} title clips, ${start}s total -> ${out}`);
