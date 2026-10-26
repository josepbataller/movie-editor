// Generates the sample media used by the tests (test-media/ is git-ignored).
// Usage: npm run test:media
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ffmpeg = require('ffmpeg-static');
const out = path.resolve(__dirname, '..', 'test-media');
fs.mkdirSync(out, { recursive: true });

const run = (args) => {
  const r = spawnSync(ffmpeg, ['-y', '-v', 'error', ...args], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('ffmpeg failed:', args.join(' ')); process.exit(1); }
};

run(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '8',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(out, 'clipA.mp4')]);
run(['-f', 'lavfi', '-i', 'smptebars=size=1920x1080:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=44100', '-t', '6',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(out, 'clipB.mp4')]);
run(['-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000', '-t', '12', '-c:a', 'libmp3lame', path.join(out, 'music.mp3')]);
run(['-f', 'lavfi', '-i', 'color=c=orange:size=800x600', '-frames:v', '1', path.join(out, 'photo.png')]);
console.log('Sample media written to', out);
