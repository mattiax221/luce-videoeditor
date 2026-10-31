import type { TitleCard } from "@/lib/types";

export type SpeechLanguage = "it" | "en" | "auto";

export type SpeechChunk = {
  text: string;
  start: number;
  end: number;
};

const HALLUCINATIONS = [
  /sottotitol/i,
  /grazie per (la visione|aver)/i,
  /thanks for watching/i,
  /thank you for watching/i,
  /iscriviti/i,
  /subscribe/i,
  /www\./i,
  /amara\.org/i,
  /\[(?:music|silence|applause|blank_audio|musica|silenzio|applausi)\]/i,
  /^[\s.。…,!！?？\-–—]+$/,
];

export function whisperLanguage(language: SpeechLanguage): string | undefined {
  if (language === "it") return "italian";
  if (language === "en") return "english";
  return undefined;
}

export function downsampleMono(samples: Float32Array, fromRate: number, toRate = 16000): Float32Array {
  if (fromRate === toRate) return samples;
  const length = Math.max(1, Math.round((samples.length * toRate) / fromRate));
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = (index * fromRate) / toRate;
    const left = Math.floor(position);
    const mix = position - left;
    const a = samples[left] ?? 0;
    const b = samples[Math.min(samples.length - 1, left + 1)] ?? a;
    output[index] = a + (b - a) * mix;
  }
  return output;
}

export function speechVariation(samples: Float32Array, sampleRate: number): number {
  const window = Math.max(1, Math.floor(sampleRate * 0.04));
  if (samples.length < window * 6) return 0;
  const energies: number[] = [];
  for (let index = 0; index + window <= samples.length; index += window) {
    let sum = 0;
    for (let offset = 0; offset < window; offset += 1) {
      const value = samples[index + offset] ?? 0;
      sum += value * value;
    }
    energies.push(Math.sqrt(sum / window));
  }
  const mean = energies.reduce((sum, value) => sum + value, 0) / energies.length;
  if (mean < 0.008) return 0;
  let variance = 0;
  for (const value of energies) variance += (value - mean) ** 2;
  return Math.sqrt(variance / energies.length) / mean;
}

export function looksLikeSpeech(samples: Float32Array, sampleRate: number): boolean {
  return speechVariation(samples, sampleRate) >= 0.2;
}

export function cleanCueText(text: string): string | null {
  const raw = text.replace(/\s+/g, " ").trim();
  const words = raw.split(/[^\p{L}]+/u).filter(Boolean);
  if (words.length >= 4 && new Set(words.map((word) => word.toLowerCase())).size === 1) return null;
  const cleaned = raw.replace(/(\b\p{L}+\b)(?:[,\s]+\1\b){2,}/giu, "$1").trim();
  if (cleaned.length < 2) return null;
  if (HALLUCINATIONS.some((pattern) => pattern.test(cleaned))) return null;
  return cleaned.slice(0, 180);
}

export function sourceRangeToTimeline(
  sourceStart: number,
  sourceEnd: number,
  span: { inPoint: number; outPoint: number; speed: number; reverse: boolean; timelineDuration: number },
): { start: number; end: number } {
  const speed = span.speed > 0 ? span.speed : 1;
  const map = (source: number) => {
    const local = span.reverse ? (span.outPoint - source) / speed : (source - span.inPoint) / speed;
    return Math.min(span.timelineDuration, Math.max(0, local));
  };
  const start = map(sourceStart);
  const end = map(sourceEnd);
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

export function cuesFromChunks(chunks: SpeechChunk[], timelineStart: number, makeId: () => string): TitleCard[] {
  const sorted = chunks
    .map((chunk) => ({ text: chunk.text, start: chunk.start, end: Math.max(chunk.end, chunk.start) }))
    .sort((a, b) => a.start - b.start);
  const merged: SpeechChunk[] = [];
  for (const chunk of sorted) {
    const text = cleanCueText(chunk.text);
    if (!text) continue;
    const previous = merged[merged.length - 1];
    if (previous && previous.text === text && chunk.start <= previous.end + 0.35) {
      previous.end = Math.max(previous.end, chunk.end);
      continue;
    }
    merged.push({ text, start: chunk.start, end: chunk.end });
  }
  const titles: TitleCard[] = [];
  for (const chunk of merged) {
    const duration = Math.min(30, Math.max(0.2, chunk.end - chunk.start));
    titles.push({
      id: makeId(),
      text: chunk.text,
      start: Math.max(0, timelineStart + chunk.start),
      duration,
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
  titles.sort((a, b) => a.start - b.start);
  for (let index = 0; index < titles.length; index += 1) {
    const title = titles[index];
    if (!title) continue;
    const next = titles[index + 1];
    const room = next ? next.start - title.start - 0.05 : title.duration;
    title.duration = Math.min(30, Math.max(0.3, Math.min(Math.max(title.duration, 0.8), Math.max(0.3, room))));
  }
  return titles;
}
