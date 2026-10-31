import type { TitleCard } from "@/lib/types";

function clockToSeconds(value: string): number | null {
  const match = value.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = match[4].padEnd(3, "0").slice(0, 3);
  return hours * 3600 + minutes * 60 + seconds + Number(fraction) / 1000;
}

export function parseSubtitles(source: string, makeId: () => string): TitleCard[] {
  const body = source.replace(/^\uFEFF/, "").replace(/\r/g, "").replace(/^WEBVTT[^\n]*\n/, "");
  const blocks = body.split(/\n{2,}/);
  const titles: TitleCard[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const arrow = lines.findIndex((line) => line.includes("-->"));
    if (arrow < 0) continue;
    const [rawStart, rawEnd] = lines[arrow].split("-->");
    const start = clockToSeconds(rawStart ?? "");
    const end = clockToSeconds(rawEnd ?? "");
    if (start === null || end === null || end <= start) continue;
    const text = lines.slice(arrow + 1).join("\n").replace(/<[^>]+>/g, "").trim();
    if (!text) continue;
    titles.push({
      id: makeId(),
      text: text.slice(0, 180),
      start,
      duration: Math.min(30, Math.max(0.2, end - start)),
      x: 0.5,
      y: 0.86,
      size: 42,
      color: "#F6F1E8",
      font: "condensed",
      align: "center",
      background: "#14120fcc",
      stroke: false,
      enter: "fade",
      exit: "fade",
    });
  }
  return titles;
}
