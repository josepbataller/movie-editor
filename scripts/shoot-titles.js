// Screenshots of title templates from test-media/titles.mvproj (made by make-title-demo).
// Usage: node scripts/shoot-titles.js marvel:1.5 marvel:3.2 disney:2 [--gpu-off]
// Writes test-media/tmp/shots/<id>-<offset>.png, one Electron run per shot.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'test-media', 'titles-index.json'), 'utf8'));
const outDir = path.join(root, 'test-media', 'tmp', 'shots');
fs.mkdirSync(outDir, { recursive: true });
const gpuOff = process.argv.includes('--gpu-off');
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--')) continue;
  const [id, off] = arg.split(':');
  const entry = index.find((e) => e.id === id);
  if (!entry) { console.error(`unknown template ${id}`); continue; }
  const seek = entry.start + Number(off ?? 1);
  const out = path.join(outDir, `${id}-${off}.png`);
  const args = ['.', `--open=${path.join(root, 'test-media', 'titles.mvproj')}`, `--seek=${seek}`, `--screenshot=${out}`];
  if (gpuOff) args.push('--disable-gpu');
  const t0 = Date.now();
  const r = spawnSync(electron, args, { cwd: root, timeout: 90000, encoding: 'utf8' });
  const ok = fs.existsSync(out);
  console.log(`${id}@${off}s -> ${ok ? 'ok' : 'MISSING'} (${((Date.now() - t0) / 1000).toFixed(1)}s)${r.status ? ` exit ${r.status}` : ''}`);
  if (!ok && r.stderr) console.log(r.stderr.split('\n').filter((l) => /error|Error/.test(l)).slice(0, 5).join('\n'));
}
