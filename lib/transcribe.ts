import { audioDuration, clipStart, clipTimelineDuration } from "@/lib/timeline";
import {
  cuesFromChunks,
  downsampleMono,
  looksLikeSpeech,
  sourceRangeToTimeline,
  whisperLanguage,
  type SpeechChunk,
  type SpeechLanguage,
} from "@/lib/speech-cues";
import type { AudioClip, Clip, TitleCard } from "@/lib/types";

const MODEL = "onnx-community/whisper-tiny";
const MAX_SOURCE_SECONDS = 10 * 60;
const WINDOW_SECONDS = 30;

export type TranscribeResult = {
  titles: TitleCard[];
  capped: boolean;
  heard: boolean;
};

type Span = {
  url: string;
  inPoint: number;
  outPoint: number;
  timelineStart: number;
  speed: number;
  reverse: boolean;
  timelineDuration: number;
  label: string;
};

type Asr = (
  audio: Float32Array,
  options: { return_timestamps: true; task: "transcribe"; language?: string },
) => Promise<{ chunks?: { text: string; timestamp: [number, number | null] }[] }>;

let loading: Promise<Asr> | null = null;

function spansOf(clips: Clip[], audios: AudioClip[]): Span[] {
  const spans: Span[] = [];
  clips.forEach((clip, index) => {
    if (clip.kind !== "video") return;
    spans.push({
      url: clip.url,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
      timelineStart: clipStart(clips, index),
      speed: clip.speed,
      reverse: clip.reverse,
      timelineDuration: clipTimelineDuration(clip),
      label: clip.name,
    });
  });
  for (const clip of audios) {
    spans.push({
      url: clip.url,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
      timelineStart: clip.start,
      speed: 1,
      reverse: false,
      timelineDuration: audioDuration(clip),
      label: clip.name,
    });
  }
  return spans.filter((span) => span.outPoint - span.inPoint >= 0.35 && span.timelineDuration >= 0.35);
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Trascrizione annullata", "AbortError");
}

async function loadModel(onProgress: (message: string) => void, device: "wasm" | "cpu"): Promise<Asr> {
  if (!loading) {
    loading = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      const wasm = env.backends.onnx.wasm;
      if (wasm) wasm.numThreads = 1;
      let shown = -1;
      const transcriber = await pipeline("automatic-speech-recognition", MODEL, {
        dtype: "q8",
        device,
        progress_callback: (info) => {
          if (info.status === "progress_total") {
            const percent = Math.round(info.progress);
            if (percent === shown) return;
            shown = percent;
            onProgress(`Scarico il riconoscimento vocale… ${percent}%`);
          } else if (info.status === "initiate" || info.status === "download") {
            onProgress("Scarico il riconoscimento vocale…");
          }
        },
      });
      return transcriber as Asr;
    })().catch((error: unknown) => {
      loading = null;
      throw error;
    });
  }
  return loading;
}

async function readSlice(context: AudioContext, url: string, start: number, end: number): Promise<Float32Array | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  const bytes = await response.arrayBuffer();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(bytes.slice(0));
  } catch {
    return null;
  }
  const rate = decoded.sampleRate;
  const from = Math.max(0, Math.floor(start * rate));
  const to = Math.min(decoded.length, Math.floor(end * rate));
  if (to - from < rate * 0.35) return null;
  const mono = new Float32Array(to - from);
  for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
    const data = decoded.getChannelData(channel);
    for (let index = 0; index < mono.length; index += 1) mono[index] += (data[from + index] ?? 0) / decoded.numberOfChannels;
  }
  return downsampleMono(mono, rate);
}

function heardWindow(span: Span): { start: number; end: number; capped: boolean } {
  const length = span.outPoint - span.inPoint;
  if (length <= MAX_SOURCE_SECONDS) return { start: span.inPoint, end: span.outPoint, capped: false };
  if (span.reverse) return { start: span.outPoint - MAX_SOURCE_SECONDS, end: span.outPoint, capped: true };
  return { start: span.inPoint, end: span.inPoint + MAX_SOURCE_SECONDS, capped: true };
}

export async function transcribeTimeline(input: {
  clips: Clip[];
  audios: AudioClip[];
  language: SpeechLanguage;
  signal: AbortSignal;
  onProgress: (message: string) => void;
  makeId: () => string;
}): Promise<TranscribeResult> {
  const spans = spansOf(input.clips, input.audios);
  if (spans.length === 0) return { titles: [], capped: false, heard: false };
  input.onProgress("Preparo il riconoscimento vocale…");
  const device = typeof window === "undefined" ? "cpu" : "wasm";
  const model = await loadModel(input.onProgress, device);
  throwIfAborted(input.signal);
  const context = new AudioContext();
  const titles: TitleCard[] = [];
  let capped = false;
  let heard = false;
  const language = whisperLanguage(input.language);
  try {
    for (let index = 0; index < spans.length; index += 1) {
      throwIfAborted(input.signal);
      const span = spans[index];
      if (!span) continue;
      const window = heardWindow(span);
      if (window.capped) capped = true;
      input.onProgress(`Leggo l’audio ${index + 1} di ${spans.length}…`);
      const samples = await readSlice(context, span.url, window.start, window.end);
      if (!samples || !looksLikeSpeech(samples, 16000)) continue;
      heard = true;
      const chunks: SpeechChunk[] = [];
      const windowSamples = WINDOW_SECONDS * 16000;
      for (let offset = 0; offset < samples.length; offset += windowSamples) {
        throwIfAborted(input.signal);
        const at = offset / 16000;
        input.onProgress(`Ascolto ${span.label}… ${Math.round(at)}s`);
        const piece = samples.subarray(offset, Math.min(samples.length, offset + windowSamples));
        const audio = piece.length === samples.length ? samples : new Float32Array(piece);
        const output = await model(audio, {
          return_timestamps: true,
          task: "transcribe",
          ...(language ? { language } : {}),
        });
        for (const chunk of output.chunks ?? []) {
          const start = chunk.timestamp?.[0];
          if (typeof start !== "number") continue;
          const end = typeof chunk.timestamp?.[1] === "number" ? chunk.timestamp[1] : start + 2;
          const placed = sourceRangeToTimeline(window.start + at + start, window.start + at + end, span);
          if (placed.end - placed.start < 0.05) continue;
          chunks.push({ text: chunk.text, start: placed.start, end: placed.end });
        }
      }
      titles.push(...cuesFromChunks(chunks, span.timelineStart, input.makeId));
    }
  } finally {
    await context.close().catch(() => undefined);
  }
  titles.sort((a, b) => a.start - b.start);
  return { titles, capped, heard };
}
