import { clamp } from "@/lib/time";
import type { Clip } from "@/lib/types";

export const MIN_CLIP_SECONDS = 0.12;
export const SPLIT_MARGIN = 0.08;

export type Located = {
  index: number;
  clip: Clip;
  start: number;
  local: number;
};

export function clipTimelineDuration(clip: Pick<Clip, "inPoint" | "outPoint" | "speed">): number {
  const speed = clip.speed > 0 ? clip.speed : 1;
  return Math.max(0, (clip.outPoint - clip.inPoint) / speed);
}

export function totalDuration(clips: Pick<Clip, "inPoint" | "outPoint" | "speed">[]): number {
  let total = 0;
  for (const clip of clips) total += clipTimelineDuration(clip);
  return total;
}

export function clipStart(clips: Pick<Clip, "inPoint" | "outPoint" | "speed">[], index: number): number {
  let total = 0;
  for (let i = 0; i < index && i < clips.length; i += 1) {
    total += clipTimelineDuration(clips[i]);
  }
  return total;
}

export function locate(clips: Clip[], time: number): Located | null {
  if (clips.length === 0) return null;
  const total = totalDuration(clips);
  if (time >= total) {
    const index = clips.length - 1;
    const start = clipStart(clips, index);
    return { index, clip: clips[index], start, local: clipTimelineDuration(clips[index]) };
  }
  const t = Math.max(0, time);
  let cursor = 0;
  for (let index = 0; index < clips.length; index += 1) {
    const dur = clipTimelineDuration(clips[index]);
    if (t < cursor + dur || index === clips.length - 1) {
      return { index, clip: clips[index], start: cursor, local: clamp(t - cursor, 0, dur) };
    }
    cursor += dur;
  }
  return null;
}

export function sourceTime(hit: Located): number {
  return hit.clip.inPoint + hit.local * (hit.clip.speed > 0 ? hit.clip.speed : 1);
}

export function fadeAt(clips: Clip[], time: number): number {
  const hit = locate(clips, time);
  if (!hit) return 1;
  const dur = clipTimelineDuration(hit.clip);
  if (dur <= 0) return 1;
  let fade = 1;
  if (hit.clip.transition === "dissolve" && hit.clip.dissolve > 0) {
    fade = Math.min(fade, hit.local / hit.clip.dissolve);
  }
  const next = clips[hit.index + 1];
  if (next && next.transition === "dissolve" && next.dissolve > 0) {
    fade = Math.min(fade, (dur - hit.local) / next.dissolve);
  }
  return clamp(fade, 0, 1);
}

export function canSplit(clips: Clip[], time: number): boolean {
  const hit = locate(clips, time);
  if (!hit) return false;
  const dur = clipTimelineDuration(hit.clip);
  return hit.local > SPLIT_MARGIN && dur - hit.local > SPLIT_MARGIN;
}

export function splitClips(
  clips: Clip[],
  time: number,
  newId: string,
): { clips: Clip[]; selectedId: string } | null {
  if (!canSplit(clips, time)) return null;
  const hit = locate(clips, time);
  if (!hit) return null;
  const at = hit.clip.inPoint + hit.local * (hit.clip.speed > 0 ? hit.clip.speed : 1);
  const left: Clip = { ...hit.clip, outPoint: at };
  const right: Clip = {
    ...hit.clip,
    id: newId,
    inPoint: at,
    transition: "cut",
    fadeIn: 0,
    grade: {
      ...hit.clip.grade,
      lift: { ...hit.clip.grade.lift },
      gamma: { ...hit.clip.grade.gamma },
      gain: { ...hit.clip.grade.gain },
    },
  };
  return {
    clips: [...clips.slice(0, hit.index), left, right, ...clips.slice(hit.index + 1)],
    selectedId: right.id,
  };
}

export function minGap(clip: Pick<Clip, "duration">): number {
  return Math.min(MIN_CLIP_SECONDS, Math.max(0.04, clip.duration / 2));
}

export function clampEdge(clip: Clip, edge: "in" | "out", value: number): Clip {
  const gap = minGap(clip);
  if (edge === "in") {
    const inPoint = clamp(value, 0, Math.max(0, clip.outPoint - gap));
    if (inPoint === clip.inPoint) return clip;
    return { ...clip, inPoint };
  }
  const outPoint = clamp(value, Math.min(clip.duration, clip.inPoint + gap), clip.duration);
  if (outPoint === clip.outPoint) return clip;
  return { ...clip, outPoint };
}

export function trimClipToTime(clips: Clip[], id: string, edge: "in" | "out", time: number): Clip[] {
  const index = clips.findIndex((clip) => clip.id === id);
  if (index < 0) return clips;
  const clip = clips[index];
  const start = clipStart(clips, index);
  const local = time - start;
  const dur = clipTimelineDuration(clip);
  if (local <= SPLIT_MARGIN || local >= dur - SPLIT_MARGIN) return clips;
  const at = clip.inPoint + local * (clip.speed > 0 ? clip.speed : 1);
  const next = clampEdge(clip, edge, at);
  if (next === clip) return clips;
  return clips.map((item, itemIndex) => (itemIndex === index ? next : item));
}

export function moveClip(clips: Clip[], id: string, dir: -1 | 1): Clip[] {
  const index = clips.findIndex((clip) => clip.id === id);
  const target = index + dir;
  if (index < 0 || target < 0 || target >= clips.length) return clips;
  const next = clips.slice();
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

export function playheadInside(clips: Clip[], id: string, time: number): boolean {
  const index = clips.findIndex((clip) => clip.id === id);
  if (index < 0) return false;
  const start = clipStart(clips, index);
  const dur = clipTimelineDuration(clips[index]);
  return time >= start + 0.001 && time <= start + dur - 0.001;
}
