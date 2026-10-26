import {
  AnimationSegment, AnimatableProperty, Clip, VisualClip, Transform, Effects, DEFAULT_EFFECTS,
} from '@/shared/types';
import { uid } from '@/store/useProject';

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

export function ease(kind: AnimationSegment['easing'], p: number): number {
  p = Math.min(1, Math.max(0, p));
  switch (kind) {
    case 'ease': return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    case 'bounce': {
      const n1 = 7.5625, d1 = 2.75;
      if (p < 1 / d1) return n1 * p * p;
      if (p < 2 / d1) return n1 * (p -= 1.5 / d1) * p + 0.75;
      if (p < 2.5 / d1) return n1 * (p -= 2.25 / d1) * p + 0.9375;
      return n1 * (p -= 2.625 / d1) * p + 0.984375;
    }
    case 'elastic': {
      if (p === 0 || p === 1) return p;
      const c4 = (2 * Math.PI) / 3;
      return Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * c4) + 1;
    }
    default: return p;
  }
}

/** Envelope value 0..1 of a segment at local clip time t. */
export function envelope(seg: AnimationSegment, t: number): number {
  if (t < seg.start || t > seg.end) return 0;
  const len = seg.end - seg.start;
  if (len <= 0) return 0;
  if (seg.oscillate && seg.oscillate > 0) {
    // sine oscillation inside the segment, faded in/out by the ramps
    const local = t - seg.start;
    let gain = 1;
    if (seg.rampIn > 0 && local < seg.rampIn) gain = Math.min(gain, local / seg.rampIn);
    if (seg.rampOut > 0 && len - local < seg.rampOut) gain = Math.min(gain, (len - local) / seg.rampOut);
    return Math.sin(local * seg.oscillate * Math.PI * 2) * gain;
  }
  const local = t - seg.start;
  let v = 1;
  if (seg.rampIn > 0) v = Math.min(v, ease(seg.easing, local / seg.rampIn));
  if (seg.rampOut > 0) v = Math.min(v, ease(seg.easing, (len - local) / seg.rampOut));
  return v;
}

export function animatedOffset(segments: AnimationSegment[] | undefined, prop: AnimatableProperty, t: number): number {
  if (!segments?.length) return 0;
  let sum = 0;
  for (const s of segments) if (s.property === prop) sum += s.value * envelope(s, t);
  return sum;
}

/** Transform + effects of a visual clip with its animations applied at local time t. */
export function animatedState(clip: VisualClip, t: number): { transform: Transform; effects: Effects } {
  const base = clip.transform;
  const fx: Effects = clip.type === 'text' ? DEFAULT_EFFECTS : clip.effects;
  const segs = clip.animations;
  if (!segs?.length) return { transform: base, effects: fx };
  const o = (p: AnimatableProperty) => animatedOffset(segs, p, t);
  return {
    transform: {
      ...base,
      x: base.x + o('x'),
      y: base.y + o('y'),
      scale: Math.max(0.01, base.scale * (1 + o('scale'))),
      rotation: base.rotation + o('rotation'),
      opacity: Math.min(1, Math.max(0, base.opacity + o('opacity'))),
    },
    effects: {
      ...fx,
      blur: Math.max(0, fx.blur + o('blur')),
      brightness: Math.min(1, Math.max(-1, fx.brightness + o('brightness'))),
      contrast: Math.max(0, fx.contrast + o('contrast')),
      saturation: Math.max(0, fx.saturation + o('saturation')),
      hue: fx.hue + o('hue'),
    },
  };
}

export function animatedVolume(clip: Clip, baseVolume: number, t: number): number {
  return Math.max(0, baseVolume * (1 + animatedOffset(clip.animations, 'volume', t)));
}

export function hasAnimations(clip: Clip): boolean {
  return !!clip.animations && clip.animations.length > 0;
}

// ---------------------------------------------------------------------------
// Presets ("fun effects")
// ---------------------------------------------------------------------------

export interface AnimationPreset {
  id: string;
  label: string;
  icon: string;
  description: string;
  /** Build segments for a clip of `duration` seconds starting at local time `at`. */
  build: (duration: number, at: number) => AnimationSegment[];
}

const seg = (p: Partial<AnimationSegment> & Pick<AnimationSegment, 'property' | 'start' | 'end' | 'value'>): AnimationSegment => ({
  id: uid(), rampIn: 0, rampOut: 0, easing: 'ease', ...p,
});

export const ANIMATION_PRESETS: AnimationPreset[] = [
  {
    id: 'spin90', label: 'Turn 90°', icon: '↻', description: 'Rotates a quarter turn over 2 s and stays there',
    build: (d, at) => [seg({ property: 'rotation', start: at, end: d, rampIn: Math.min(2, d - at), value: 90 })],
  },
  {
    id: 'spin360', label: 'Full spin', icon: '🌀', description: 'One full rotation over 2 s',
    build: (d, at) => [seg({ property: 'rotation', start: at, end: Math.min(d, at + 2), rampIn: Math.min(2, d - at), value: 360, easing: 'ease' })],
  },
  {
    id: 'zoomin', label: 'Zoom in', icon: '🔍', description: 'Slowly zooms in (Ken Burns) across the whole clip',
    build: (d) => [seg({ property: 'scale', start: 0, end: d, rampIn: d, value: 0.3, easing: 'linear' })],
  },
  {
    id: 'zoomout', label: 'Zoom out', icon: '🔎', description: 'Starts zoomed in and settles to normal size',
    build: (d) => [seg({ property: 'scale', start: 0, end: d, rampOut: d, value: 0.3, easing: 'linear' })],
  },
  {
    id: 'punch', label: 'Punch zoom', icon: '💥', description: 'Quick zoom punch in and out (0.6 s)',
    build: (d, at) => [seg({ property: 'scale', start: at, end: Math.min(d, at + 0.6), rampIn: 0.2, rampOut: 0.4, value: 0.35, easing: 'ease' })],
  },
  {
    id: 'pulse', label: 'Heartbeat', icon: '💓', description: 'Pulses in size for 3 s',
    build: (d, at) => [seg({ property: 'scale', start: at, end: Math.min(d, at + 3), rampIn: 0.3, rampOut: 0.3, value: 0.08, oscillate: 1.5 })],
  },
  {
    id: 'shake', label: 'Shake', icon: '🫨', description: 'Earthquake shake for 1.5 s',
    build: (d, at) => [
      seg({ property: 'x', start: at, end: Math.min(d, at + 1.5), rampIn: 0.2, rampOut: 0.4, value: 25, oscillate: 11 }),
      seg({ property: 'y', start: at, end: Math.min(d, at + 1.5), rampIn: 0.2, rampOut: 0.4, value: 15, oscillate: 13 }),
    ],
  },
  {
    id: 'wobble', label: 'Wobble', icon: '🤪', description: 'Rocks left and right for 2 s',
    build: (d, at) => [seg({ property: 'rotation', start: at, end: Math.min(d, at + 2), rampIn: 0.3, rampOut: 0.5, value: 8, oscillate: 2 })],
  },
  {
    id: 'bounce', label: 'Bounce in', icon: '🏀', description: 'Drops in from above and bounces',
    build: (d) => [seg({ property: 'y', start: 0, end: Math.min(d, 1.2), rampOut: Math.min(d, 1.2), value: -1200, easing: 'bounce' })],
  },
  {
    id: 'slidein', label: 'Slide in', icon: '➡️', description: 'Slides in from the left over 1 s',
    build: (d) => [seg({ property: 'x', start: 0, end: Math.min(d, 1), rampOut: Math.min(d, 1), value: -2500, easing: 'ease' })],
  },
  {
    id: 'slideout', label: 'Slide out', icon: '⬅️', description: 'Slides out to the right during the last second',
    build: (d) => [seg({ property: 'x', start: Math.max(0, d - 1), end: d, rampIn: Math.min(d, 1), value: 2500, easing: 'ease' })],
  },
  {
    id: 'dreamblur', label: 'Dream blur', icon: '😶‍🌫️', description: 'Blurs in and out over 3 s (flashback style)',
    build: (d, at) => [seg({ property: 'blur', start: at, end: Math.min(d, at + 3), rampIn: 1, rampOut: 1, value: 14 })],
  },
  {
    id: 'flash', label: 'Flash', icon: '⚡', description: 'White flash (0.4 s)',
    build: (d, at) => [seg({ property: 'brightness', start: at, end: Math.min(d, at + 0.4), rampIn: 0.1, rampOut: 0.3, value: 1, easing: 'linear' })],
  },
  {
    id: 'colorcycle', label: 'Disco colours', icon: '🪩', description: 'Cycles hue through the rainbow for 3 s',
    build: (d, at) => [seg({ property: 'hue', start: at, end: Math.min(d, at + 3), rampIn: Math.min(3, d - at), value: 720, easing: 'linear' })],
  },
  {
    id: 'fadebw', label: 'Fade to B&W', icon: '🎞', description: 'Drains colour over the last 2 s',
    build: (d) => [seg({ property: 'saturation', start: Math.max(0, d - 2), end: d, rampIn: Math.min(d, 2), value: -1, easing: 'linear' })],
  },
  {
    id: 'spinaway', label: 'Spin away', icon: '🌪', description: 'Spins and shrinks to nothing during the last 1.5 s',
    build: (d) => [
      seg({ property: 'rotation', start: Math.max(0, d - 1.5), end: d, rampIn: Math.min(d, 1.5), value: 540, easing: 'ease' }),
      seg({ property: 'scale', start: Math.max(0, d - 1.5), end: d, rampIn: Math.min(d, 1.5), value: -0.95, easing: 'ease' }),
    ],
  },
  {
    id: 'duck', label: 'Duck audio', icon: '🔉', description: 'Lowers the volume to 30% for 4 s (for a voice-over)',
    build: (d, at) => [seg({ property: 'volume', start: at, end: Math.min(d, at + 4), rampIn: 0.5, rampOut: 0.5, value: -0.7, easing: 'linear' })],
  },
];

export function newSegment(property: AnimatableProperty, duration: number, at: number): AnimationSegment {
  const len = Math.min(3, Math.max(0.5, duration - at));
  const defaults: Partial<Record<AnimatableProperty, number>> = {
    blur: 12, opacity: -1, scale: 0.5, rotation: 90, x: 300, y: 200, brightness: 0.5, contrast: 0.5, saturation: -1, hue: 180, volume: -0.7,
  };
  return seg({ property, start: at, end: Math.min(duration, at + len), rampIn: Math.min(1, len / 3), rampOut: Math.min(1, len / 3), value: defaults[property] ?? 1, easing: property === 'volume' ? 'linear' : 'ease' });
}
