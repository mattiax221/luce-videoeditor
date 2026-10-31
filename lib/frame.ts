import type { Aspect, Quality } from "@/lib/types";

export type Rect = { x: number; y: number; w: number; h: number };

export function projectSize(aspect: Aspect, quality: Quality): { width: number; height: number } {
  const long = quality === "1080" ? 1920 : 1280;
  const short = quality === "1080" ? 1080 : 720;
  if (aspect === "16:9") return { width: long, height: short };
  if (aspect === "9:16") return { width: short, height: long };
  const side = quality === "1080" ? 1080 : 720;
  return { width: side, height: side };
}

export function fitRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  fit: "contain" | "cover",
): Rect {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
    return { x: 0, y: 0, w: dstW, h: dstH };
  }
  const scale =
    fit === "cover" ? Math.max(dstW / srcW, dstH / srcH) : Math.min(dstW / srcW, dstH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}

export function aspectLabel(aspect: Aspect): string {
  if (aspect === "16:9") return "Orizzontale";
  if (aspect === "9:16") return "Verticale";
  return "Quadrato";
}
