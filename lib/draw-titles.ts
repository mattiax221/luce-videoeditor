import type { TitleCard, TitleFont } from "@/lib/types";

export type FontSet = {
  sans: string;
  serif: string;
  condensed: string;
};

const DEFAULT_FONTS: FontSet = {
  sans: "sans-serif",
  serif: "serif",
  condensed: "sans-serif",
};

export function readFonts(): FontSet {
  if (typeof document === "undefined") return DEFAULT_FONTS;
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    sans: read("--font-dm", DEFAULT_FONTS.sans),
    serif: read("--font-fraunces", DEFAULT_FONTS.serif),
    condensed: read("--font-oswald", DEFAULT_FONTS.condensed),
  };
}

function familyFor(font: TitleFont, fonts: FontSet): string {
  if (font === "serif") return fonts.serif;
  if (font === "condensed") return fonts.condensed;
  return fonts.sans;
}

function wrapLines(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && context.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

export function drawTitles(
  context: CanvasRenderingContext2D,
  titles: TitleCard[],
  time: number,
  fonts: FontSet,
  selectedId: string | null,
  showChrome: boolean,
  fade: boolean,
) {
  const width = context.canvas.width;
  const height = context.canvas.height;
  context.clearRect(0, 0, width, height);
  const visible = titles.filter((title) => time >= title.start && time <= title.start + title.duration);
  for (const title of visible) {
    const local = time - title.start;
    const remain = title.start + title.duration - time;
    let alpha = 1;
    const size = Math.max(12, title.size * (height / 720));
    context.save();
    context.fillStyle = title.color;
    context.textBaseline = "middle";
    context.font = `600 ${size}px ${familyFor(title.font, fonts)}`;
    context.textAlign = title.align;
    if ("letterSpacing" in context) {
      context.letterSpacing = title.font === "condensed" ? "0.06em" : "0em";
    }
    const lines = wrapLines(context, title.text, width * 0.86);
    const lineHeight = size * 1.16;
    const blockHeight = Math.max(lineHeight, lines.length * lineHeight);
    const x = title.x * width;
    let centerY = title.y * height;
    let motion = 1;
    if (fade) {
      const enter = title.enter === "none" ? 1 : Math.min(1, local / 0.28);
      const exit = title.exit === "none" ? 1 : Math.min(1, remain / 0.28);
      motion = Math.min(enter, exit);
      alpha *= motion;
      if (title.enter === "rise" && local < 0.28) centerY += (1 - enter) * size * 0.45;
      if (title.exit === "rise" && remain < 0.28) centerY += (1 - exit) * size * 0.35;
    }
    context.globalAlpha = Math.max(0, Math.min(1, alpha));
    if (title.background && lines.length > 0) {
      const widest = Math.max(...lines.map((line) => context.measureText(line).width));
      const padX = size * 0.38;
      const padY = size * 0.22;
      const left =
        title.align === "left" ? x - padX * 0.2 : title.align === "right" ? x - widest - padX * 0.8 : x - widest / 2 - padX;
      context.fillStyle = title.background;
      context.shadowColor = "transparent";
      context.beginPath();
      context.roundRect(left, centerY - blockHeight / 2 - padY, widest + padX * 1.4, blockHeight + padY * 2, size * 0.2);
      context.fill();
    }
    context.fillStyle = title.color;
    context.shadowColor = title.background ? "transparent" : "rgba(0,0,0,0.7)";
    context.shadowBlur = title.background ? 0 : Math.max(8, size * 0.18);
    context.shadowOffsetY = title.background ? 0 : 2;
    lines.forEach((line, index) => {
      const y = centerY - blockHeight / 2 + lineHeight / 2 + index * lineHeight;
      if (title.stroke) {
        context.shadowColor = "transparent";
        context.lineWidth = Math.max(2, size * 0.08);
        context.strokeStyle = "rgba(0,0,0,0.85)";
        context.strokeText(line, x, y);
      }
      context.fillText(line, x, y);
    });
    if (showChrome && title.id === selectedId && lines.length > 0) {
      context.shadowColor = "transparent";
      context.strokeStyle = "rgba(228,160,74,0.95)";
      context.lineWidth = Math.max(2, height / 420);
      const widest = Math.max(...lines.map((line) => context.measureText(line).width));
      context.strokeRect(
        x - widest / 2 - 18,
        centerY - blockHeight / 2 - 14,
        widest + 36,
        blockHeight + 28,
      );
    }
    context.restore();
  }
}

export function titleAtPoint(
  titles: TitleCard[],
  time: number,
  x: number,
  y: number,
  width: number,
  height: number,
): TitleCard | null {
  const hits = titles.filter((title) => {
    if (time < title.start || time > title.start + title.duration) return false;
    const size = Math.max(12, title.size * (height / 720));
    const halfH = (size * 1.3) / height / 2;
    const halfW = Math.max(0.08, (title.text.length * size * 0.34) / width / 2);
    return Math.abs(x - title.x) <= halfW && Math.abs(y - title.y) <= halfH;
  });
  return hits[hits.length - 1] ?? null;
}
