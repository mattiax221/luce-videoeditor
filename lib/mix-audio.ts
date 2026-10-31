import { audioDuration, clipStart, clipTimelineDuration } from "@/lib/timeline";
import type { AudioClip, Clip } from "@/lib/types";

async function decodeUrl(context: BaseAudioContext, url: string): Promise<AudioBuffer | null> {
  try {
    const response = await fetch(url);
    const bytes = await response.arrayBuffer();
    return await context.decodeAudioData(bytes.slice(0));
  } catch {
    return null;
  }
}

function sliceBuffer(context: BaseAudioContext, buffer: AudioBuffer, inPoint: number, outPoint: number, reverse: boolean): AudioBuffer {
  const rate = buffer.sampleRate;
  const start = Math.max(0, Math.floor(inPoint * rate));
  const end = Math.min(buffer.length, Math.max(start + 1, Math.floor(outPoint * rate)));
  const length = end - start;
  const sliced = context.createBuffer(buffer.numberOfChannels, length, rate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const from = buffer.getChannelData(channel).subarray(start, end);
    const to = sliced.getChannelData(channel);
    if (reverse) {
      for (let index = 0; index < length; index += 1) to[index] = from[length - 1 - index];
    } else {
      to.set(from);
    }
  }
  return sliced;
}

function place(
  context: OfflineAudioContext,
  buffer: AudioBuffer,
  when: number,
  speed: number,
  volume: number,
  fadeIn: number,
  fadeOut: number,
  timelineDur: number,
) {
  if (volume <= 0 || timelineDur <= 0) return;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = speed > 0 ? speed : 1;
  const gain = context.createGain();
  const end = when + timelineDur;
  gain.gain.setValueAtTime(volume, when);
  if (fadeIn > 0.02) {
    const rise = when + Math.min(fadeIn, timelineDur / 2);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(volume, Math.max(when + 0.01, rise));
  }
  if (fadeOut > 0.02) {
    const fall = Math.max(when + 0.03, end - fadeOut);
    gain.gain.setValueAtTime(volume, fall);
    gain.gain.linearRampToValueAtTime(0, Math.max(fall + 0.01, end));
  }
  source.connect(gain);
  gain.connect(context.destination);
  source.start(when);
  source.stop(end + 0.05);
}

export async function mixTimeline(clips: Clip[], audios: AudioClip[], duration: number): Promise<AudioBuffer | null> {
  if (duration <= 0) return null;
  const rate = 48000;
  const length = Math.max(1, Math.ceil(duration * rate));
  const offline = new OfflineAudioContext(2, length, rate);
  let placed = 0;
  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index];
    if (clip.kind !== "video" || clip.muted || clip.volume <= 0) continue;
    const decoded = await decodeUrl(offline, clip.url);
    if (!decoded) continue;
    const sliced = sliceBuffer(offline, decoded, clip.inPoint, clip.outPoint, clip.reverse);
    place(offline, sliced, clipStart(clips, index), clip.speed, clip.volume, clip.fadeIn, clip.fadeOut, clipTimelineDuration(clip));
    placed += 1;
  }
  for (const clip of audios) {
    if (clip.muted || clip.volume <= 0) continue;
    const decoded = await decodeUrl(offline, clip.url);
    if (!decoded) continue;
    const sliced = sliceBuffer(offline, decoded, clip.inPoint, clip.outPoint, false);
    place(offline, sliced, clip.start, 1, clip.volume, clip.fadeIn, clip.fadeOut, audioDuration(clip));
    placed += 1;
  }
  if (placed === 0) return null;
  return offline.startRendering();
}
