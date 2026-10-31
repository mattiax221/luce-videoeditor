import { cloneGrade, NEUTRAL_GRADE } from "@/lib/grade";
import type { Clip } from "@/lib/types";

export function createClip(input: {
  id: string;
  name: string;
  url: string;
  duration: number;
  width: number;
  height: number;
}): Clip {
  return {
    id: input.id,
    name: input.name,
    url: input.url,
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
    grade: cloneGrade(NEUTRAL_GRADE),
    thumbs: [],
  };
}
