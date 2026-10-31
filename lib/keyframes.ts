import type { Keyframe } from "@/lib/types";

export function sampleTrack(
  keys: Keyframe[],
  local: number,
  field: "opacity" | "scale" | "exposure",
  fallback: number,
): number {
  const points = keys.filter((key) => typeof key[field] === "number").sort((a, b) => a.time - b.time);
  if (points.length === 0) return fallback;
  const first = points[0][field];
  if (typeof first !== "number") return fallback;
  if (local <= points[0].time) return first;
  const lastPoint = points[points.length - 1];
  const last = lastPoint[field];
  if (typeof last !== "number") return fallback;
  if (local >= lastPoint.time) return last;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const av = a[field];
    const bv = b[field];
    if (typeof av !== "number" || typeof bv !== "number") continue;
    if (local >= a.time && local <= b.time) {
      const span = b.time - a.time || 1;
      const mix = (local - a.time) / span;
      return av + (bv - av) * mix;
    }
  }
  return fallback;
}
