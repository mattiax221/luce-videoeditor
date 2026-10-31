import { cloneGrade, NEUTRAL_GRADE } from "@/lib/grade";
import { NEUTRAL_CHROMA, NEUTRAL_MASK, NEUTRAL_TRANSFORM, type Clip, type Keyframe, type StabSample } from "@/lib/types";

export function createClip(input: {
  id: string;
  name: string;
  url: string;
  duration: number;
  width: number;
  height: number;
  mediaId?: string;
  kind?: Clip["kind"];
}): Clip {
  return {
    id: input.id,
    mediaId: input.mediaId ?? input.id,
    name: input.name,
    url: input.url,
    kind: input.kind ?? "video",
    duration: input.duration,
    width: input.width,
    height: input.height,
    inPoint: 0,
    outPoint: input.duration,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    fit: "contain",
    transition: "cut",
    dissolve: 0.6,
    reverse: false,
    opacity: 1,
    grade: cloneGrade(NEUTRAL_GRADE),
    transform: { ...NEUTRAL_TRANSFORM },
    mask: { ...NEUTRAL_MASK },
    chroma: { ...NEUTRAL_CHROMA },
    lutId: null,
    keyframes: [],
    stab: [],
    thumbs: [],
  };
}

export function cloneClipFields(clip: Clip): Pick<Clip, "grade" | "transform" | "mask" | "chroma" | "keyframes" | "stab"> {
  return {
    grade: cloneGrade(clip.grade),
    transform: { ...clip.transform },
    mask: { ...clip.mask },
    chroma: { ...clip.chroma },
    keyframes: clip.keyframes.map((key) => ({ ...key })),
    stab: clip.stab.map((sample) => ({ ...sample })),
  };
}

export function followKeyframe(clip: Clip, local: number, patch: Partial<Clip>): Partial<Clip> {
  const near = clip.keyframes.some((key) => Math.abs(key.time - local) < 0.08);
  if (!near) return patch;
  const keyframes = clip.keyframes.map((key) => {
    if (Math.abs(key.time - local) >= 0.08) return key;
    return {
      ...key,
      ...(patch.opacity !== undefined ? { opacity: patch.opacity } : {}),
      ...(patch.transform ? { scale: patch.transform.scale } : {}),
      ...(patch.grade ? { exposure: patch.grade.exposure } : {}),
    };
  });
  return { ...patch, keyframes };
}

export function touchKeyframe(keys: Keyframe[], time: number, patch: Partial<Keyframe>, id: string): Keyframe[] {
  const near = keys.find((key) => Math.abs(key.time - time) < 0.08);
  if (!near) {
    return [...keys, { id, time, ...patch }];
  }
  return keys.map((key) => (key.id === near.id ? { ...key, ...patch } : key));
}

export function stabAt(samples: StabSample[], sourceTime: number): { x: number; y: number } {
  if (samples.length === 0) return { x: 0, y: 0 };
  if (sourceTime <= samples[0].t) return { x: samples[0].x, y: samples[0].y };
  const last = samples[samples.length - 1];
  if (sourceTime >= last.t) return { x: last.x, y: last.y };
  for (let index = 0; index < samples.length - 1; index += 1) {
    const a = samples[index];
    const b = samples[index + 1];
    if (sourceTime >= a.t && sourceTime <= b.t) {
      const span = b.t - a.t || 1;
      const mix = (sourceTime - a.t) / span;
      return { x: a.x + (b.x - a.x) * mix, y: a.y + (b.y - a.y) * mix };
    }
  }
  return { x: 0, y: 0 };
}
