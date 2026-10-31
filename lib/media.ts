import { clipLabel, uid } from "@/lib/time";
import { createClip } from "@/lib/clip";
import type { AudioClip, Clip } from "@/lib/types";

export function pickRecorderMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const types = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1.4D401E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

export function extensionForMime(mime: string): "mp4" | "webm" {
  return mime.includes("mp4") ? "mp4" : "webm";
}

function waitFor(target: EventTarget, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, timeoutMs);
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      target.removeEventListener(event, onEvent);
    };
    target.addEventListener(event, onEvent);
  });
}

export function probeVideo(url: string): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, 12000);
    const cleanup = () => {
      window.clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
    };
    video.onloadedmetadata = () => {
      const duration = video.duration;
      const width = video.videoWidth;
      const height = video.videoHeight;
      cleanup();
      if (!Number.isFinite(duration) || duration <= 0 || width === 0 || height === 0) {
        reject(new Error("meta"));
        return;
      }
      resolve({ duration, width, height });
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("decode"));
    };
    video.src = url;
  });
}

async function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) return;
  const pending = waitFor(video, "seeked", 1800);
  try {
    video.currentTime = time;
  } catch {
    return;
  }
  try {
    await pending;
  } catch {
    // A missed seek still leaves us with the nearest decoded frame.
  }
}

export async function captureThumbs(url: string, duration: number): Promise<string[]> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  await waitFor(video, "loadeddata", 8000);
  const count = Math.min(8, Math.max(4, Math.round(duration / 1.5)));
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 90;
  const context = canvas.getContext("2d");
  if (!context) return [];
  const thumbs: string[] = [];
  const length = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : duration;
  for (let index = 0; index < count; index += 1) {
    const at = Math.min(length * ((index + 0.5) / count), Math.max(0, length - 0.05));
    await seekTo(video, at);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    thumbs.push(canvas.toDataURL("image/jpeg", 0.62));
  }
  video.removeAttribute("src");
  video.load();
  return thumbs;
}

export async function fileToClip(file: File): Promise<Clip> {
  const url = URL.createObjectURL(file);
  try {
    const meta = await probeVideo(url);
    return createClip({
      id: uid(),
      name: clipLabel(file.name),
      url,
      duration: meta.duration,
      width: meta.width,
      height: meta.height,
    });
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function drawDemoFrame(context: CanvasRenderingContext2D, kind: "a" | "b", time: number) {
  const { width, height } = context.canvas;
  const gradient = context.createLinearGradient(0, 0, width, height);
  if (kind === "a") {
    gradient.addColorStop(0, "#1b2433");
    gradient.addColorStop(0.55, "#8a4b28");
    gradient.addColorStop(1, "#e4a04a");
  } else {
    gradient.addColorStop(0, "#10262b");
    gradient.addColorStop(0.6, "#1f6f78");
    gradient.addColorStop(1, "#d7e6ea");
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.fillStyle = "rgba(255,255,255,0.16)";
  const travel = ((time * 140) % (width + 120)) - 60;
  context.beginPath();
  context.arc(kind === "a" ? travel : width - travel, height * 0.4, 78, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#f6f1e8";
  context.font = "600 64px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(kind === "a" ? "CLIP A" : "CLIP B", width / 2, height * 0.72);
}

export async function createDemoFile(kind: "a" | "b"): Promise<File> {
  const mime = pickRecorderMime();
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 540;
  const context = canvas.getContext("2d");
  if (!mime || !context || typeof canvas.captureStream !== "function") {
    throw new Error("recorder");
  }
  const stream = canvas.captureStream(30);
  let audio: AudioContext | null = null;
  try {
    audio = new AudioContext();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.value = kind === "a" ? 196 : 262;
    gain.gain.value = 0.035;
    const destination = audio.createMediaStreamDestination();
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start();
    const track = destination.stream.getAudioTracks()[0];
    if (track) stream.addTrack(track);
  } catch {
    audio = null;
  }
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_200_000 });
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => reject(new Error("recorder"));
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || mime }));
  });
  recorder.start();
  const seconds = 3.2;
  const started = performance.now();
  await new Promise<void>((resolve) => {
    const frame = (now: number) => {
      const time = (now - started) / 1000;
      drawDemoFrame(context, kind, time);
      if (time < seconds) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  recorder.stop();
  stream.getTracks().forEach((track) => track.stop());
  const blob = await stopped;
  await audio?.close().catch(() => undefined);
  const ext = extensionForMime(blob.type || mime);
  return new File([blob], kind === "a" ? `prova-a.${ext}` : `prova-b.${ext}`, {
    type: blob.type || mime,
  });
}

export function probeAudio(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, 8000);
    const cleanup = () => {
      window.clearTimeout(timer);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute("src");
      audio.load();
    };
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      cleanup();
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error("meta"));
        return;
      }
      resolve(duration);
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error("decode"));
    };
    audio.src = url;
  });
}

export async function measurePeaks(url: string, bars = 42): Promise<number[]> {
  try {
    const response = await fetch(url);
    const bytes = await response.arrayBuffer();
    const context = new AudioContext();
    const decoded = await context.decodeAudioData(bytes.slice(0));
    await context.close();
    const channel = decoded.getChannelData(0);
    const size = Math.max(1, Math.floor(channel.length / bars));
    const peaks: number[] = [];
    for (let index = 0; index < bars; index += 1) {
      let peak = 0;
      const start = index * size;
      for (let sample = start; sample < start + size && sample < channel.length; sample += 8) {
        peak = Math.max(peak, Math.abs(channel[sample] ?? 0));
      }
      peaks.push(peak);
    }
    const max = Math.max(...peaks, 0.001);
    return peaks.map((peak) => peak / max);
  } catch {
    return [];
  }
}

export async function fileToAudio(file: File, start: number): Promise<AudioClip> {
  const url = URL.createObjectURL(file);
  try {
    const duration = await probeAudio(url);
    return {
      id: uid(),
      mediaId: uid(),
      name: clipLabel(file.name),
      url,
      duration,
      inPoint: 0,
      outPoint: duration,
      start,
      volume: 1,
      muted: false,
      fadeIn: 0,
      fadeOut: 0,
      peaks: [],
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
