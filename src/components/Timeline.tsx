import { useEffect, useRef, useState, memo } from 'react';
import { useProject, projectDuration } from '@/store/useProject';
import type { Clip, Track } from '@/shared/types';
import { formatTime } from '@/engine/importMedia';

const HEADER_W = 170;
const RULER_H = 28;
const TRACK_H: Record<Track['kind'], number> = { video: 64, audio: 48 };
const SNAP_PX = 8;

/** Tracks are stored bottom-layer-first; show video layers top-most first (like other editors), then audio tracks. */
function displayOrder(tracks: Track[]): Track[] {
  return [...tracks.filter((t) => t.kind === 'video').reverse(), ...tracks.filter((t) => t.kind === 'audio')];
}

function useProjectRect() {
  const pps = useProject((s) => s.pixelsPerSecond);
  return { pps, toX: (t: number) => t * pps, toT: (x: number) => x / pps };
}

export default function Timeline() {
  const project = useProject((s) => s.project);
  const { pps, toX, toT } = useProjectRect();
  const snapping = useProject((s) => s.snapping);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const duration = projectDuration(project);
  const contentW = Math.max(toX(duration) + 600, 1200);

  // Zoom with ctrl+wheel, keeping the time under the cursor stable.
  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const st = useProject.getState();
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - HEADER_W + el.scrollLeft;
      const tAtMouse = mouseX / st.pixelsPerSecond;
      const next = st.pixelsPerSecond * (e.deltaY < 0 ? 1.2 : 1 / 1.2);
      st.setPixelsPerSecond(next);
      requestAnimationFrame(() => {
        el.scrollLeft = tAtMouse * useProject.getState().pixelsPerSecond - (e.clientX - rect.left - HEADER_W);
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Snap a candidate time to nearby clip edges / playhead.
  const snap = (t: number, ignoreIds: string[]): number => {
    if (!snapping) return t;
    const st = useProject.getState();
    const points = [0, st.currentTime];
    for (const c of st.project.clips) {
      if (ignoreIds.includes(c.id)) continue;
      points.push(c.start, c.start + c.duration);
    }
    let best = t;
    let bestD = SNAP_PX / pps;
    for (const p of points) {
      const d = Math.abs(p - t);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  };

  const seekFromEvent = (clientX: number) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left - HEADER_W + el.scrollLeft;
    useProject.getState().setCurrentTime(Math.max(0, toT(x)));
  };

  const onRulerDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    useProject.getState().setPlaying(false);
    seekFromEvent(e.clientX);
    const move = (ev: MouseEvent) => seekFromEvent(ev.clientX);
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const trackAtY = (clientY: number): Track | null => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    let y = clientY - rect.top - RULER_H + el.scrollTop;
    for (const t of displayOrder(project.tracks)) {
      const h = TRACK_H[t.kind];
      if (y >= 0 && y < h) return t;
      y -= h;
    }
    return null;
  };

  // ---- Clip dragging / trimming ----
  const onClipDown = (e: React.MouseEvent, clip: Clip, mode: 'move' | 'start' | 'end') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const st = useProject.getState();
    const track = st.project.tracks.find((t) => t.id === clip.trackId);
    if (!st.selectedClipIds.includes(clip.id)) st.select([clip.id], e.shiftKey);
    else if (e.shiftKey) { st.select([clip.id], true); return; }
    if (track?.locked) return;

    const startX = e.clientX;
    const orig = { ...clip };
    // never snap to our own linked partners (they move with us)
    const ignore = clip.linkId ? st.project.clips.filter((c) => c.linkId === clip.linkId).map((c) => c.id) : [clip.id];
    let committed = false;
    let moved = false;
    const ensureCommit = () => { if (!committed) { useProject.getState().commit(); committed = true; } };

    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 3 && mode === 'move') return;
      moved = true;
      ensureCommit();
      const s = useProject.getState();
      if (mode === 'move') {
        let start = Math.max(0, orig.start + toT(dx));
        // snap either edge
        const s1 = snap(start, ignore);
        const s2 = snap(start + orig.duration, ignore) - orig.duration;
        if (s1 !== start) start = s1; else if (s2 !== start) start = s2;
        const t = trackAtY(ev.clientY);
        s.moveClip(clip.id, start, t?.id ?? orig.trackId, { commit: false });
      } else {
        // reset to original then apply cumulative delta (trimClip clamps for us)
        s.updateClip(clip.id, { start: orig.start, duration: orig.duration, inPoint: orig.inPoint }, { commit: false });
        let delta = toT(dx);
        if (mode === 'start') delta = snap(orig.start + delta, ignore) - orig.start;
        else delta = snap(orig.start + orig.duration + delta, ignore) - (orig.start + orig.duration);
        s.trimClip(clip.id, mode, delta, { commit: false });
      }
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // ---- Drop from media bin ----
  const onDragOver = (e: React.DragEvent, track: Track) => {
    if (!e.dataTransfer.types.includes('application/x-asset-id')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropTarget(track.id);
  };
  const onDrop = (e: React.DragEvent, track: Track) => {
    e.preventDefault();
    setDropTarget(null);
    const assetId = e.dataTransfer.getData('application/x-asset-id');
    if (!assetId) return;
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left - HEADER_W + el.scrollLeft;
    const asset = project.assets.find((a) => a.id === assetId);
    const st = useProject.getState();
    if (asset && asset.kind === 'audio' && track.kind !== 'audio') {
      st.addClipFromAsset(assetId, { start: snap(toT(x), []) });
    } else if (asset && asset.kind !== 'audio' && track.kind !== 'video') {
      st.addClipFromAsset(assetId, { start: snap(toT(x), []) });
    } else {
      st.addClipFromAsset(assetId, { trackId: track.id, start: snap(toT(x), []) });
    }
  };

  const onBackgroundDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    useProject.getState().select([]);
    onRulerDown(e);
  };

  return (
    <div className="timeline">
      <TimelineToolbar />
      <div className="timeline-scroll" ref={scrollRef}>
        <div className="timeline-inner" style={{ width: HEADER_W + contentW }}>
          {/* Ruler */}
          <div className="ruler-row" style={{ height: RULER_H }}>
            <div className="track-header ruler-corner" style={{ width: HEADER_W }} />
            <div className="ruler" style={{ width: contentW }} onMouseDown={onRulerDown}>
              <Ruler pps={pps} width={contentW} />
            </div>
          </div>

          {/* Tracks */}
          {displayOrder(project.tracks).map((track) => (
            <div key={track.id} className={`track-row ${track.kind}`} style={{ height: TRACK_H[track.kind] }}>
              <TrackHeader track={track} width={HEADER_W} />
              <div
                className={`track-lane ${dropTarget === track.id ? 'drop' : ''} ${track.locked ? 'locked' : ''}`}
                style={{ width: contentW }}
                onMouseDown={onBackgroundDown}
                onDragOver={(e) => onDragOver(e, track)}
                onDragLeave={() => setDropTarget((d) => (d === track.id ? null : d))}
                onDrop={(e) => onDrop(e, track)}
              >
                {project.clips.filter((c) => c.trackId === track.id).map((clip) => (
                  <ClipView key={clip.id} clip={clip} toX={toX} onDown={onClipDown} />
                ))}
              </div>
            </div>
          ))}
          <Playhead headerW={HEADER_W} toX={toX} scrollRef={scrollRef} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TimelineToolbar() {
  const st = useProject;
  const pps = useProject((s) => s.pixelsPerSecond);
  const snapping = useProject((s) => s.snapping);
  const selected = useProject((s) => s.selectedClipIds);
  const canUndo = useProject((s) => s.past.length > 0);
  const canRedo = useProject((s) => s.future.length > 0);
  return (
    <div className="timeline-toolbar">
      <button onClick={() => st.getState().addTrack('video')} title="Add a video layer (top)">+ Video track</button>
      <button onClick={() => st.getState().addTrack('audio')} title="Add an audio track">+ Audio track</button>
      <span className="sep" />
      <button onClick={() => st.getState().splitSelectedAtPlayhead()} title="Split at playhead (S)">✂ Split</button>
      <button disabled={!selected.length} onClick={() => st.getState().duplicateClips(selected)} title="Duplicate (Ctrl+D)">⧉ Duplicate</button>
      <button disabled={!selected.length} onClick={() => st.getState().removeClips(selected)} title="Delete (Del)">🗑 Delete</button>
      <span className="sep" />
      <button disabled={!canUndo} onClick={() => st.getState().undo()} title="Undo (Ctrl+Z)">↶</button>
      <button disabled={!canRedo} onClick={() => st.getState().redo()} title="Redo (Ctrl+Y)">↷</button>
      <span className="sep" />
      <label className="check"><input type="checkbox" checked={snapping} onChange={() => st.getState().toggleSnapping()} /> Snap</label>
      <span style={{ marginLeft: 'auto' }} className="dim small">Zoom</span>
      <input type="range" min={5} max={600} step={1} value={pps} onChange={(e) => st.getState().setPixelsPerSecond(Number(e.target.value))} style={{ width: 140 }} title="Zoom (Ctrl + mouse wheel)" />
    </div>
  );
}

const Ruler = memo(function Ruler({ pps, width }: { pps: number; width: number }) {
  // choose a tick interval giving ~80px spacing
  const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const major = candidates.find((c) => c * pps >= 80) ?? 600;
  const minor = major / (major >= 1 ? (major === 1 || major === 5 || major === 10 ? 5 : 4) : 5);
  const ticks: React.ReactNode[] = [];
  const total = width / pps;
  for (let t = 0; t <= total; t += minor) {
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    ticks.push(
      <div key={t.toFixed(3)} className={`tick ${isMajor ? 'major' : ''}`} style={{ left: t * pps }}>
        {isMajor && <span>{formatTime(t)}</span>}
      </div>,
    );
  }
  return <>{ticks}</>;
});

function TrackHeader({ track, width }: { track: Track; width: number }) {
  const st = useProject.getState;
  const tracks = useProject((s) => s.project.tracks);
  const idx = tracks.findIndex((t) => t.id === track.id);
  const sameKind = tracks.filter((t) => t.kind === track.kind);
  const canUp = track.kind === 'video' ? idx < tracks.length - 1 && tracks[idx + 1]?.kind === 'video' : false;
  const canDown = track.kind === 'video' ? idx > 0 && tracks[idx - 1]?.kind === 'video' : false;
  return (
    <div className="track-header" style={{ width }}>
      <input
        className="track-name"
        value={track.name}
        onChange={(e) => st().updateTrack(track.id, { name: e.target.value })}
      />
      <div className="track-buttons">
        <button className={track.muted ? 'on' : ''} onClick={() => st().updateTrack(track.id, { muted: !track.muted })} title="Mute">{track.muted ? '🔇' : '🔊'}</button>
        {track.kind === 'video' && (
          <button className={track.hidden ? 'on' : ''} onClick={() => st().updateTrack(track.id, { hidden: !track.hidden })} title="Hide layer">{track.hidden ? '🙈' : '👁'}</button>
        )}
        <button className={track.locked ? 'on' : ''} onClick={() => st().updateTrack(track.id, { locked: !track.locked })} title="Lock">{track.locked ? '🔒' : '🔓'}</button>
        {track.kind === 'video' && (
          <>
            <button disabled={!canUp} onClick={() => st().moveTrack(track.id, 1)} title="Bring layer forward">▲</button>
            <button disabled={!canDown} onClick={() => st().moveTrack(track.id, -1)} title="Send layer backward">▼</button>
          </>
        )}
        <button disabled={sameKind.length <= 1} onClick={() => { if (confirm(`Remove track "${track.name}" and its clips?`)) st().removeTrack(track.id); }} title="Remove track">✕</button>
      </div>
    </div>
  );
}

const ClipView = memo(function ClipView({ clip, toX, onDown }: {
  clip: Clip; toX: (t: number) => number;
  onDown: (e: React.MouseEvent, clip: Clip, mode: 'move' | 'start' | 'end') => void;
}) {
  const selected = useProject((s) => s.selectedClipIds.includes(clip.id));
  const asset = useProject((s) => ('assetId' in clip ? s.project.assets.find((a) => a.id === clip.assetId) : undefined));
  const left = toX(clip.start);
  const width = Math.max(2, toX(clip.duration));

  let bg: React.CSSProperties = {};
  if (clip.type === 'audio' && asset?.waveform) {
    // show the portion of the waveform that this clip covers
    const total = asset.duration || 1;
    const scaleX = (total / (clip.duration * clip.speed)) * 100;
    const offset = (clip.inPoint / total) * 100 * (scaleX / 100);
    bg = {
      backgroundImage: `url("${window.api.fileUrl(asset.waveform)}")`,
      backgroundSize: `${scaleX}% 100%`,
      backgroundPosition: `-${offset}% 0`,
      backgroundRepeat: 'no-repeat',
    };
  } else if ((clip.type === 'video' || clip.type === 'image') && asset?.thumbnail) {
    bg = {
      backgroundImage: `url("${window.api.fileUrl(asset.thumbnail)}")`,
      backgroundSize: 'auto 100%',
      backgroundRepeat: 'repeat-x',
    };
  }

  const icon = clip.type === 'video' ? '🎬' : clip.type === 'audio' ? '🎵' : clip.type === 'image' ? '🖼' : 'T';
  const muted = (clip.type === 'video' || clip.type === 'audio') && clip.audio.muted;

  return (
    <div
      className={`clip ${clip.type} ${selected ? 'selected' : ''}`}
      style={{ left, width, ...bg }}
      onMouseDown={(e) => onDown(e, clip, 'move')}
      onDoubleClick={(e) => { e.stopPropagation(); useProject.getState().setCurrentTime(clip.start); }}
      title={`${clip.name}\n${formatTime(clip.start, true)} → ${formatTime(clip.start + clip.duration, true)}  (${clip.duration.toFixed(2)}s)`}
    >
      <div className="clip-label">
        <span className="clip-icon">{icon}</span>
        <span className="clip-name">{clip.name}</span>
        {muted && <span title="Muted">🔇</span>}
        {clip.speed !== 1 && <span className="badge">{clip.speed}×</span>}
        {clip.linkId && <span title="Linked: moves together with its video/audio" className="badge">🔗</span>}
        {clip.type === 'text' && clip.text.animation !== 'none' && <span className="badge" title={`Text animation: ${clip.text.animation}`}>✨</span>}
      </div>
      {!!clip.animations?.length && (
        <div className="anim-markers" title={`${clip.animations.length} animation(s)`}>
          {clip.animations.map((a) => (
            <div key={a.id} className="anim-marker" style={{ left: `${(a.start / clip.duration) * 100}%`, width: `${Math.max(1, ((a.end - a.start) / clip.duration) * 100)}%` }} />
          ))}
        </div>
      )}
      {clip.type !== 'audio' && (clip.fadeIn > 0 || clip.fadeOut > 0) && (
        <>
          {clip.fadeIn > 0 && <div className="fade in" style={{ width: toX(clip.fadeIn) }} />}
          {clip.fadeOut > 0 && <div className="fade out" style={{ width: toX(clip.fadeOut) }} />}
        </>
      )}
      <div className="trim-handle left" onMouseDown={(e) => onDown(e, clip, 'start')} />
      <div className="trim-handle right" onMouseDown={(e) => onDown(e, clip, 'end')} />
    </div>
  );
});

function Playhead({ headerW, toX, scrollRef }: { headerW: number; toX: (t: number) => number; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const t = useProject((s) => s.currentTime);
  const playing = useProject((s) => s.playing);
  const x = headerW + toX(t);
  // Follow the playhead while playing
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const viewL = el.scrollLeft + headerW;
    const viewR = el.scrollLeft + el.clientWidth;
    if (x < viewL || x > viewR - 40) el.scrollLeft = Math.max(0, x - headerW - 100);
  }, [x, playing, headerW, scrollRef]);
  return (
    <div className="playhead" style={{ left: x }}>
      <div className="playhead-head" />
    </div>
  );
}
