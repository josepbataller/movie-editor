import { useEffect, useRef, useState } from 'react';
import { useProject, projectDuration } from '@/store/useProject';
import { drawFrame, hitTest, textSource, clipBounds, SourceLookup, previewSource } from '@/engine/compositor';
import { Clip, VisualClip, fadeFactor } from '@/shared/types';
import { formatTime } from '@/engine/importMedia';
import { animatedVolume } from '@/engine/animation';

type MediaEl = HTMLVideoElement | HTMLAudioElement | HTMLImageElement;

/**
 * Live preview: owns a pool of <video>/<audio>/<img> elements (one per clip),
 * keeps them in sync with the master clock, and composites them on a canvas.
 */
export default function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pool = useRef(new Map<string, MediaEl>());
  const [displayScale, setDisplayScale] = useState(1);
  const dragRef = useRef<{ id: string; startX: number; startY: number; ox: number; oy: number; committed: boolean } | null>(null);
  const wheelCommit = useRef<{ timer: number; done: boolean }>({ timer: 0, done: false });

  const project = useProject((s) => s.project);
  const playing = useProject((s) => s.playing);
  const currentTime = useProject((s) => s.currentTime);
  const selected = useProject((s) => s.selectedClipIds);

  // ---- keep the element pool in sync with the clips ----
  useEffect(() => {
    const clips = project.clips;
    const ids = new Set(clips.map((c) => c.id));
    for (const [id, el] of pool.current) {
      if (!ids.has(id)) {
        if (el instanceof HTMLMediaElement) { el.pause(); el.removeAttribute('src'); el.load(); }
        pool.current.delete(id);
      }
    }
    for (const c of clips) {
      if (c.type === 'text') continue;
      const asset = project.assets.find((a) => a.id === c.assetId);
      if (!asset) continue;
      const url = window.api.fileUrl(asset.path);
      let el = pool.current.get(c.id);
      if (!el) {
        if (c.type === 'image') el = new Image();
        else if (c.type === 'audio') el = document.createElement('audio');
        else el = document.createElement('video');
        if (el instanceof HTMLMediaElement) { el.preload = 'auto'; el.crossOrigin = 'anonymous'; }
        el.src = url;
        pool.current.set(c.id, el);
      } else if (el.src !== url) {
        el.src = url;
      }
    }
  }, [project.clips, project.assets]);

  // ---- fit canvas to the available space ----
  useEffect(() => {
    const wrap = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      const { width, height } = wrap.getBoundingClientRect();
      const s = Math.min((width - 24) / project.width, (height - 24) / project.height);
      setDisplayScale(Math.max(0.05, s));
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [project.width, project.height]);

  // ---- render loop ----
  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const lookup: SourceLookup = (clip: VisualClip, time: number) => {
      const p = useProject.getState().project;
      if (clip.type === 'text') return textSource(clip, p, time);
      const el = pool.current.get(clip.id);
      const asset = p.assets.find((a) => a.id === clip.assetId);
      if (!el || el instanceof HTMLAudioElement) return null;
      if (el instanceof HTMLVideoElement) {
        if (el.readyState < 2) return null;
        return { source: el, w: el.videoWidth || asset?.width || p.width, h: el.videoHeight || asset?.height || p.height };
      }
      if (!(el as HTMLImageElement).complete || !(el as HTMLImageElement).naturalWidth) return null;
      return { source: el, w: (el as HTMLImageElement).naturalWidth, h: (el as HTMLImageElement).naturalHeight };
    };

    const syncMedia = (clip: Clip, time: number, isPlaying: boolean) => {
      const el = pool.current.get(clip.id);
      if (!el || !(el instanceof HTMLMediaElement)) return;
      const p = useProject.getState().project;
      const track = p.tracks.find((t) => t.id === clip.trackId);
      const active = clip.start <= time && time < clip.start + clip.duration && !(clip.type === 'video' && track?.hidden);
      if (!active) {
        if (!el.paused) el.pause();
        return;
      }
      const local = time - clip.start;
      const desired = clip.inPoint + local * clip.speed;
      const audio = clip.type === 'video' || clip.type === 'audio' ? clip.audio : null;
      if (audio) {
        const vol = animatedVolume(clip, audio.volume, local) * fadeFactor(local, clip.duration, audio.fadeIn, audio.fadeOut);
        el.volume = Math.min(1, Math.max(0, vol));
        el.muted = audio.muted || !!track?.muted || audio.volume <= 0;
      }
      if (isPlaying) {
        if (el.playbackRate !== clip.speed) el.playbackRate = Math.min(16, Math.max(0.0625, clip.speed));
        if (Math.abs(el.currentTime - desired) > 0.25 && !el.seeking) el.currentTime = desired;
        if (el.paused) el.play().catch(() => {});
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - desired) > 0.04 && !el.seeking) el.currentTime = desired;
      }
    };

    previewSource.lookup = lookup;

    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const st = useProject.getState();
      let time = st.currentTime;
      if (st.playing) {
        time += dt;
        const end = projectDuration(st.project);
        if (time >= end) {
          time = end;
          st.setPlaying(false);
        }
        st.setCurrentTime(time);
      }
      for (const c of st.project.clips) syncMedia(c, time, st.playing);

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d')!;
        drawFrame(ctx, st.project, time, lookup);
        // selection outline
        for (const id of st.selectedClipIds) {
          const clip = st.project.clips.find((c) => c.id === id);
          if (!clip || clip.type === 'audio') continue;
          if (!(clip.start <= time && time < clip.start + clip.duration)) continue;
          const src = lookup(clip, time);
          if (!src) continue;
          const b = clipBounds(st.project, clip, src.w, src.h, time);
          ctx.save();
          ctx.translate(b.cx, b.cy);
          ctx.rotate((b.rotation * Math.PI) / 180);
          ctx.strokeStyle = '#4f8cff';
          ctx.lineWidth = Math.max(2, 3 / displayScale);
          ctx.setLineDash([12 / displayScale, 8 / displayScale]);
          ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
          ctx.restore();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); if (previewSource.lookup === lookup) previewSource.lookup = null; };
  }, [displayScale]);

  // ---- direct manipulation on the canvas ----
  const toProject = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * project.width, y: ((e.clientY - rect.top) / rect.height) * project.height };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const st = useProject.getState();
    const { x, y } = toProject(e);
    const lookup: SourceLookup = (clip, t) => {
      if (clip.type === 'text') return textSource(clip, st.project, t);
      const el = pool.current.get(clip.id);
      const asset = st.project.assets.find((a) => a.id === clip.assetId);
      return { source: el as CanvasImageSource, w: asset?.width || st.project.width, h: asset?.height || st.project.height };
    };
    const hit = hitTest(st.project, st.currentTime, x, y, lookup);
    if (!hit) { st.select([]); return; }
    st.select([hit.id]);
    dragRef.current = { id: hit.id, startX: x, startY: y, ox: hit.transform.x, oy: hit.transform.y, committed: false };
    const move = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const rect = canvasRef.current!.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * project.width;
      const py = ((ev.clientY - rect.top) / rect.height) * project.height;
      if (!d.committed) { useProject.getState().commit(); d.committed = true; } // one undo step per drag
      useProject.getState().updateTransform(d.id, { x: Math.round(d.ox + px - d.startX), y: Math.round(d.oy + py - d.startY) }, { commit: false });
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const onWheel = (e: React.WheelEvent) => {
    const st = useProject.getState();
    const id = st.selectedClipIds[0];
    const clip = st.project.clips.find((c) => c.id === id);
    if (!clip || clip.type === 'audio') return;
    // One undo step per burst of wheel events
    const wc = wheelCommit.current;
    if (!wc.done) { st.commit(); wc.done = true; }
    window.clearTimeout(wc.timer);
    wc.timer = window.setTimeout(() => { wc.done = false; }, 400);
    const factor = e.deltaY < 0 ? 1.05 : 1 / 1.05;
    if (e.altKey) {
      st.updateTransform(id, { rotation: Math.round((clip.transform.rotation + (e.deltaY < 0 ? -2 : 2)) * 10) / 10 }, { commit: false });
    } else {
      st.updateTransform(id, { scale: Math.round(Math.min(10, Math.max(0.05, clip.transform.scale * factor)) * 1000) / 1000 }, { commit: false });
    }
  };

  const duration = projectDuration(project);
  const st = useProject.getState();

  return (
    <div className="preview">
      <div className="preview-canvas-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          width={project.width}
          height={project.height}
          style={{ width: project.width * displayScale, height: project.height * displayScale }}
          onMouseDown={onMouseDown}
          onWheel={onWheel}
          title="Drag a clip to move it. Mouse wheel: scale selected clip. Alt+wheel: rotate."
        />
      </div>
      <div className="transport">
        <button onClick={() => st.setCurrentTime(0)} title="Go to start (Home)">⏮</button>
        <button onClick={() => st.setCurrentTime(Math.max(0, useProject.getState().currentTime - 1 / project.fps))} title="Previous frame (←)">◀︎</button>
        <button className="play" onClick={() => st.togglePlay()} title="Play / Pause (Space)">{playing ? '❚❚' : '▶'}</button>
        <button onClick={() => st.setCurrentTime(useProject.getState().currentTime + 1 / project.fps)} title="Next frame (→)">▶︎</button>
        <button onClick={() => st.setCurrentTime(duration)} title="Go to end (End)">⏭</button>
        <span className="timecode">{formatTime(currentTime, true, project.fps)} <span className="dim">/ {formatTime(duration, true, project.fps)}</span></span>
        <span className="dim small" style={{ marginLeft: 'auto' }}>{project.width}×{project.height} · {project.fps} fps</span>
      </div>
    </div>
  );
}
