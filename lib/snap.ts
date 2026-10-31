import { clipTimelineDuration } from "@/lib/timeline";
import type { Clip, Marker } from "@/lib/types";

export function snapTime(time: number, points: number[], threshold: number): number {
  let best = time;
  let distance = threshold;
  for (const point of points) {
    const delta = Math.abs(point - time);
    if (delta <= distance) {
      distance = delta;
      best = point;
    }
  }
  return best;
}

export function edgePoints(clips: Pick<Clip, "inPoint" | "outPoint" | "speed">[], markers: Marker[]): number[] {
  const points = [0];
  let cursor = 0;
  for (const clip of clips) {
    points.push(cursor);
    cursor += clipTimelineDuration(clip);
    points.push(cursor);
  }
  for (const marker of markers) points.push(marker.time);
  return points;
}
