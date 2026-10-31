import { mixTimeline } from "@/lib/mix-audio";
import { totalDuration } from "@/lib/timeline";
import type { AudioClip, Clip } from "@/lib/types";

export function fastExportSupported(): boolean {
  return typeof window !== "undefined" && typeof VideoEncoder !== "undefined";
}

type EncodeInput = {
  canvas: HTMLCanvasElement;
  overlay?: HTMLCanvasElement | null;
  clips: Clip[];
  audios: AudioClip[];
  fps?: number;
  signal: AbortSignal;
  seek: (time: number) => Promise<void>;
  onProgress: (value: number) => void;
};

async function pickVideoCodec(width: number, height: number): Promise<string | null> {
  const candidates = ["vp09.00.10.08", "vp8"];
  for (const codec of candidates) {
    try {
      const result = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate: 4_000_000 });
      if (result.supported) return codec;
    } catch {
      // Try the next codec string.
    }
  }
  return null;
}

async function audioSupported(rate: number): Promise<boolean> {
  if (typeof AudioEncoder === "undefined") return false;
  try {
    const result = await AudioEncoder.isConfigSupported({
      codec: "opus",
      sampleRate: rate,
      numberOfChannels: 2,
      bitrate: 128_000,
    });
    return result.supported === true;
  } catch {
    return false;
  }
}

async function encodeAudio(buffer: AudioBuffer, add: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void) {
  const rate = buffer.sampleRate;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => add(chunk, meta),
    error: () => undefined,
  });
  encoder.configure({ codec: "opus", sampleRate: rate, numberOfChannels: 2, bitrate: 128_000 });
  const frames = Math.floor(rate * 0.02);
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  for (let offset = 0; offset < left.length; offset += frames) {
    const count = Math.min(frames, left.length - offset);
    const interleaved = new Float32Array(count * 2);
    for (let index = 0; index < count; index += 1) {
      interleaved[index * 2] = left[offset + index] ?? 0;
      interleaved[index * 2 + 1] = right[offset + index] ?? 0;
    }
    const data = new AudioData({
      format: "f32",
      sampleRate: rate,
      numberOfFrames: count,
      numberOfChannels: 2,
      timestamp: Math.round((offset / rate) * 1_000_000),
      data: interleaved,
    });
    encoder.encode(data);
    data.close();
  }
  await encoder.flush();
  encoder.close();
}

export async function encodeFast(input: EncodeInput): Promise<Blob> {
  const { Muxer, ArrayBufferTarget } = await import("webm-muxer");
  const duration = totalDuration(input.clips);
  const fps = input.fps ?? 30;
  const width = input.canvas.width;
  const height = input.canvas.height;
  const codec = await pickVideoCodec(width, height);
  if (!codec || duration <= 0) throw new Error("encoder");
  const mixed = await mixTimeline(input.clips, input.audios, duration).catch(() => null);
  const withAudio = Boolean(mixed && (await audioSupported(mixed?.sampleRate ?? 48000)));
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: codec === "vp8" ? "V_VP8" : "V_VP9", width, height, frameRate: fps },
    ...(withAudio && mixed ? { audio: { codec: "A_OPUS" as const, numberOfChannels: 2, sampleRate: mixed.sampleRate } } : {}),
    firstTimestampBehavior: "offset",
  });
  if (withAudio && mixed) await encodeAudio(mixed, (chunk, meta) => muxer.addAudioChunk(chunk, meta));
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: () => undefined,
  });
  videoEncoder.configure({
    codec,
    width,
    height,
    bitrate: width >= 1920 ? 8_000_000 : 4_500_000,
  });
  const frames = Math.max(1, Math.round(duration * fps));
  const composite = input.overlay ? document.createElement("canvas") : null;
  const compositeCtx = composite?.getContext("2d") ?? null;
  if (composite) {
    composite.width = width;
    composite.height = height;
  }
  for (let index = 0; index < frames; index += 1) {
    if (input.signal.aborted) throw new DOMException("aborted", "AbortError");
    await input.seek(Math.min(duration - 0.0001, index / fps));
    let source: CanvasImageSource = input.canvas;
    if (composite && compositeCtx && input.overlay) {
      compositeCtx.clearRect(0, 0, width, height);
      compositeCtx.drawImage(input.canvas, 0, 0);
      compositeCtx.drawImage(input.overlay, 0, 0);
      source = composite;
    }
    const frame = new VideoFrame(source, { timestamp: Math.round((index / fps) * 1_000_000) });
    videoEncoder.encode(frame, { keyFrame: index % (fps * 2) === 0 });
    frame.close();
    if (index % 2 === 0) input.onProgress(index / frames);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await videoEncoder.flush();
  videoEncoder.close();
  muxer.finalize();
  input.onProgress(1);
  return new Blob([target.buffer], { type: "video/webm" });
}
