// Shared project model. Used by the renderer (UI + preview) and by the
// Electron main process (FFmpeg export), so keep this file dependency-free.

export type AssetKind = 'video' | 'audio' | 'image';

export interface MediaAsset {
  id: string;
  path: string;        // absolute path on disk
  name: string;
  kind: AssetKind;
  duration: number;    // seconds (images: 0)
  width?: number;
  height?: number;
  fps?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  thumbnail?: string;  // file path of a generated thumbnail (jpg)
  waveform?: string;   // file path of a generated waveform (png)
}

export type TrackKind = 'video' | 'audio';

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;   // audio tracks: silence; video tracks: silence audio of its clips
  hidden: boolean;  // video tracks only
  locked: boolean;
}

/** Placement of a visual clip inside the project frame.
 *  x / y are offsets (in project pixels) of the clip centre from the frame centre.
 *  scale 1 == the clip "fitted" inside the frame (contain). */
export interface Transform {
  x: number;
  y: number;
  scale: number;
  rotation: number;  // degrees, clockwise
  opacity: number;   // 0..1
  flipH: boolean;
  flipV: boolean;
  fit: 'contain' | 'cover' | 'stretch';
}

export interface Effects {
  brightness: number;  // -1..1   (0 = neutral)
  contrast: number;    // 0..3    (1 = neutral)
  saturation: number;  // 0..3    (1 = neutral)
  hue: number;         // degrees -180..180
  blur: number;        // px (0 = none)
  grayscale: boolean;
  sepia: boolean;
  invert: boolean;
}

export interface AudioProps {
  volume: number;   // 0..3 (1 = neutral)
  muted: boolean;
  fadeIn: number;   // seconds
  fadeOut: number;  // seconds
}

/** Entrance / main animation of a text clip. 'scroll-up' and 'crawl' span the whole clip. */
export type TextAnimation =
  | 'none' | 'fade' | 'scroll-up' | 'crawl' | 'typewriter'
  | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down'
  | 'zoom-in' | 'zoom-out' | 'pop' | 'blur-in' | 'letters' | 'wipe'
  | 'glitch' | 'wave' | 'spin-in' | 'flip-in' | 'rise'
  // per-letter / per-word staggers
  | 'words' | 'elastic-letters' | 'scatter-in' | 'flip-letters'
  // whole-block moves
  | 'tracking-in' | 'bounce-in' | 'stamp' | 'swing' | 'focus' | 'flicker' | 'blinds' | 'split' | 'pixelate'
  // light / masks (studio-logo style)
  | 'shine' | 'spotlight' | 'sparkle' | 'marvel' | 'lamp'
  // studio logo recreations (whole-clip renderers in logoRenderers.ts)
  | 'studios' | 'globe' | 'monument'
  // whole-clip loops
  | 'rainbow' | 'pulse';
export type TextExitAnimation =
  | 'none' | 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'zoom-out' | 'zoom-in' | 'blur-out' | 'wipe' | 'glitch' | 'flip-out'
  | 'scatter' | 'letters-out' | 'tracking-out' | 'pixelate-out' | 'blinds-out' | 'split-out' | 'spin-out' | 'drop-out' | 'flicker-out';

/** Animated full-frame backgrounds drawn behind a text clip (rendered per frame). */
export type TextBackdrop =
  | 'none' | 'solid' | 'starfield' | 'nebula' | 'gradient' | 'film' | 'matrix' | 'bokeh' | 'scanlines'
  | 'disco' | 'confetti' | 'fireworks' | 'clouds' | 'sunburst' | 'moon' | 'halftone' | 'speedlines' | 'rain' | 'snow'
  | 'fire' | 'aurora' | 'grid' | 'plasma' | 'hearts' | 'bubbles' | 'static' | 'searchlights' | 'stripes' | 'checker'
  | 'paper' | 'chalkboard' | 'leaves' | 'petals' | 'glitter' | 'lightning' | 'rays' | 'memphis' | 'ocean' | 'sunset' | 'hud' | 'blueprint' | 'comicflip'
  | 'castle' | 'premiere';

/** Text animations that are rendered per-frame (need the frame-by-frame export engine). */
export const PER_FRAME_TEXT_ANIMATIONS: TextAnimation[] = [
  'crawl', 'typewriter', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'zoom-in', 'zoom-out', 'pop', 'blur-in', 'letters', 'wipe', 'glitch', 'wave', 'spin-in', 'flip-in', 'rise',
  'words', 'elastic-letters', 'scatter-in', 'flip-letters', 'tracking-in', 'bounce-in', 'stamp', 'swing', 'focus', 'flicker', 'blinds', 'split', 'pixelate',
  'shine', 'spotlight', 'sparkle', 'marvel', 'lamp', 'studios', 'globe', 'monument', 'rainbow', 'pulse',
];

/** Letter fill styles. 'solid' uses `color`; the others are gradients built from `color` / `fillColor2` or fixed metal palettes. */
export type TextFill = 'solid' | 'gradient' | 'rainbow' | 'gold' | 'silver' | 'chrome' | 'fire' | 'ice';

/** Properties that can be animated over a time range inside a clip. */
export type AnimatableProperty =
  | 'opacity' | 'scale' | 'rotation' | 'x' | 'y'
  | 'blur' | 'brightness' | 'contrast' | 'saturation' | 'hue'
  | 'volume';

/**
 * An animation envelope: between `start` and `end` (seconds, local to the clip) the
 * property is offset by `value` (added to the base value), ramping up over `rampIn`,
 * holding, then ramping down over `rampOut`.
 * rampOut = 0 means the change holds until `end` and then snaps back.
 */
export interface AnimationSegment {
  id: string;
  property: AnimatableProperty;
  start: number;
  end: number;
  rampIn: number;
  rampOut: number;
  value: number;
  easing: 'linear' | 'ease' | 'bounce' | 'elastic';
  /** Optional oscillation: repeat the ramp up/down this many times per second (shake, pulse). */
  oscillate?: number;
}

export const ANIMATABLE: Record<AnimatableProperty, { label: string; min: number; max: number; step: number; unit: string; mode: 'add' | 'mul' }> = {
  opacity:    { label: 'Opacity',     min: -1,    max: 1,    step: 0.01, unit: '',   mode: 'add' },
  scale:      { label: 'Zoom',        min: -0.95, max: 4,    step: 0.01, unit: '×',  mode: 'add' },
  rotation:   { label: 'Rotation',    min: -720,  max: 720,  step: 1,    unit: '°',  mode: 'add' },
  x:          { label: 'Move X',      min: -4000, max: 4000, step: 1,    unit: 'px', mode: 'add' },
  y:          { label: 'Move Y',      min: -4000, max: 4000, step: 1,    unit: 'px', mode: 'add' },
  blur:       { label: 'Blur',        min: 0,     max: 60,   step: 0.5,  unit: 'px', mode: 'add' },
  brightness: { label: 'Brightness',  min: -1,    max: 1,    step: 0.01, unit: '',   mode: 'add' },
  contrast:   { label: 'Contrast',    min: -1,    max: 2,    step: 0.01, unit: '',   mode: 'add' },
  saturation: { label: 'Saturation',  min: -1,    max: 2,    step: 0.01, unit: '',   mode: 'add' },
  hue:        { label: 'Hue shift',   min: -360,  max: 360,  step: 1,    unit: '°',  mode: 'add' },
  volume:     { label: 'Volume',      min: -1,    max: 2,    step: 0.01, unit: '×',  mode: 'add' },
};

export interface TextProps {
  content: string;
  fontFamily: string;
  fontSize: number;         // px in project space
  color: string;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  lineHeight: number;       // multiplier
  background: string;       // css colour or '' for none
  backgroundPadding: number;
  shadow: boolean;
  outline: string;          // css colour or '' for none
  animation: TextAnimation;
  animationDuration: number;   // seconds for entrance animations (ignored by scroll-up / crawl)
  exitAnimation: TextExitAnimation;
  exitDuration: number;
  letterSpacing: number;       // px
  boxWidth: number;         // fraction of frame width used for wrapping (0.1..1)
  /** Neon-style glow: 0 = off, 1 = strong. */
  glow?: number;
  glowColor?: string;
  /** Animated background behind the text (full frame). */
  backdrop?: TextBackdrop;
  backdropColor?: string;
  backdropColor2?: string;
  /** 'two-column' splits lines on '|' (or ' - ') into role | name, like film credits. */
  layout?: 'block' | 'two-column';
  /** Crawl tilt (0.2 = flat/slow recede, 0.9 = steep). */
  perspective?: number;
  /** Letter fill (default 'solid'). Gradients run from `color` to `fillColor2`. */
  fill?: TextFill;
  fillColor2?: string;
  /** 3D extrusion depth in px (0 = flat) and its colour. */
  extrude?: number;
  extrudeColor?: string;
  /** Outline thickness as a fraction of the font size (default 0.06). */
  outlineWidth?: number;
  /** Vertical position of the text block as a fraction of the frame height (0 = centre, 0.3 = lower). Unlike the clip transform it leaves the backdrop in place. */
  offsetY?: number;
}

interface ClipBase {
  id: string;
  trackId: string;
  name: string;
  start: number;     // timeline position (s)
  duration: number;  // on timeline (s)
  inPoint: number;   // offset into source (s); for video/audio
  speed: number;     // playback rate (video/audio), 1 = normal
  /** Clips sharing a linkId move together (e.g. a video and its separated audio). */
  linkId?: string;
  animations?: AnimationSegment[];
}

export interface VideoClip extends ClipBase {
  type: 'video';
  assetId: string;
  transform: Transform;
  effects: Effects;
  audio: AudioProps;
  fadeIn: number;    // visual fade (s)
  fadeOut: number;
}

export interface ImageClip extends ClipBase {
  type: 'image';
  assetId: string;
  transform: Transform;
  effects: Effects;
  fadeIn: number;
  fadeOut: number;
}

export interface AudioClip extends ClipBase {
  type: 'audio';
  assetId: string;
  audio: AudioProps;
}

export interface TextClip extends ClipBase {
  type: 'text';
  text: TextProps;
  transform: Transform;
  fadeIn: number;
  fadeOut: number;
}

export type Clip = VideoClip | ImageClip | AudioClip | TextClip;
export type VisualClip = VideoClip | ImageClip | TextClip;

export function isVisual(c: Clip): c is VisualClip {
  return c.type !== 'audio';
}
export function hasAudio(c: Clip): c is VideoClip | AudioClip {
  return c.type === 'video' || c.type === 'audio';
}

export interface Project {
  name: string;
  width: number;
  height: number;
  fps: number;
  backgroundColor: string;
  assets: MediaAsset[];
  tracks: Track[];      // ordered: index 0 is the bottom-most video layer
  clips: Clip[];
  /** Audio Studio session (DAW module); see audioTypes.ts. Optional for older files. */
  audio?: import('./audioTypes').AudioSession;
  /** Font files loaded for this project (Title Studio → Font file…); loaded with FontFace on open. */
  fonts?: { family: string; path: string }[];
}

export interface ExportSettings {
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  quality: 'high' | 'medium' | 'low';  // maps to CRF
  format: 'mp4' | 'mkv' | 'webm';
  /** PNG renders of text clips, keyed by clip id (written by the renderer). */
  textImages: Record<string, string>;
  /** Pixel size of each rendered text PNG, keyed by clip id. */
  textImageSizes: Record<string, { w: number; h: number }>;
  /** 'graph' = FFmpeg filter graph (fast); 'frames' = renderer draws every frame (supports animations). */
  engine: 'graph' | 'frames';
}

export interface ExportProgress {
  percent: number;
  timeSeconds: number;
  message?: string;
  done?: boolean;
  error?: string;
  cancelled?: boolean;
}

export const DEFAULT_TRANSFORM: Transform = {
  x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flipH: false, flipV: false, fit: 'contain',
};
export const DEFAULT_EFFECTS: Effects = {
  brightness: 0, contrast: 1, saturation: 1, hue: 0, blur: 0, grayscale: false, sepia: false, invert: false,
};
export const DEFAULT_AUDIO: AudioProps = { volume: 1, muted: false, fadeIn: 0, fadeOut: 0 };
export const DEFAULT_TEXT: TextProps = {
  content: 'Title',
  fontFamily: 'Segoe UI',
  fontSize: 96,
  color: '#ffffff',
  bold: true,
  italic: false,
  align: 'center',
  lineHeight: 1.25,
  background: '',
  backgroundPadding: 24,
  shadow: true,
  outline: '',
  animation: 'fade',
  animationDuration: 0.8,
  exitAnimation: 'fade',
  exitDuration: 0.6,
  letterSpacing: 0,
  boxWidth: 0.8,
  glow: 0,
  glowColor: '#4f8cff',
  backdrop: 'none',
  backdropColor: '#000000',
  backdropColor2: '#1a237e',
  layout: 'block',
  perspective: 0.6,
};

/** Size (in project pixels) a source of w×h occupies at scale 1 inside a W×H frame. */
export function fittedSize(
  srcW: number, srcH: number, frameW: number, frameH: number, fit: Transform['fit'],
): { w: number; h: number } {
  if (!srcW || !srcH) return { w: frameW, h: frameH };
  if (fit === 'stretch') return { w: frameW, h: frameH };
  const s = fit === 'cover'
    ? Math.max(frameW / srcW, frameH / srcH)
    : Math.min(frameW / srcW, frameH / srcH);
  return { w: srcW * s, h: srcH * s };
}

/** Visual opacity multiplier from fade in/out at local time t (seconds into clip). */
export function fadeFactor(t: number, duration: number, fadeIn: number, fadeOut: number): number {
  let f = 1;
  if (fadeIn > 0 && t < fadeIn) f = Math.min(f, Math.max(0, t / fadeIn));
  if (fadeOut > 0 && t > duration - fadeOut) f = Math.min(f, Math.max(0, (duration - t) / fadeOut));
  return f;
}
