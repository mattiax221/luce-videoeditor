import { stabAt } from "@/lib/clip";
import { drawTitles, readFonts, type FontSet } from "@/lib/draw-titles";
import { encodeFast } from "@/lib/fast-export";
import { fitRect, projectSize } from "@/lib/frame";
import { cssFilter, gradeVectors } from "@/lib/grade";
import { GradeRenderer, type GradeDraw } from "@/lib/gl-renderer";
import { sampleTrack } from "@/lib/keyframes";
import { extensionForMime, pickRecorderMime } from "@/lib/media";
import {
  audioDuration,
  clipStart,
  clipTimelineDuration,
  crossMix,
  fadeAt,
  locate,
  overlayLocal,
  overlaysAt,
  sourceTime,
  totalDuration,
} from "@/lib/timeline";
import { clamp } from "@/lib/time";
import type { Aspect, AudioClip, Clip, Lut, OverlayClip, Quality, TitleCard } from "@/lib/types";

export type ProjectView = {
  clips: Clip[];
  overlays: OverlayClip[];
  audios: AudioClip[];
  titles: TitleCard[];
  luts: Lut[];
  aspect: Aspect;
  quality: Quality;
  selectedTitleId: string | null;
};

export type PlaybackSnap = {
  time: number;
  playing: boolean;
  recording: boolean;
  duration: number;
};

const EMPTY_VIEW: ProjectView = {
  clips: [],
  overlays: [],
  audios: [],
  titles: [],
  luts: [],
  aspect: "16:9",
  quality: "720",
  selectedTitleId: null,
};

export class PlaybackEngine {
  time = 0;
  playing = false;
  recording = false;

  private view: ProjectView = EMPTY_VIEW;
  private fonts: FontSet = readFonts();
  private renderer: GradeRenderer | null = null;
  private fallback: CanvasRenderingContext2D | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private exportCtx: CanvasRenderingContext2D | null = null;
  private readonly exportCanvas: HTMLCanvasElement;
  private readonly preloader: HTMLVideoElement;
  private readonly overlayVideo: HTMLVideoElement;
  private readonly video: HTMLVideoElement;
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly beds = new Map<string, HTMLAudioElement>();

  private raf = 0;
  private disposed = false;
  private clipId: string | null = null;
  private currentUrl: string | null = null;
  private preloadUrl: string | null = null;
  private overlayUrl: string | null = null;
  private seeking = false;
  private awaitingLoad = false;
  private seekStarted = 0;
  private loadToken = 0;
  private wantPlay = false;
  private audioCtx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private streamDest: MediaStreamAudioDestinationNode | null = null;
  private recorder: MediaRecorder | null = null;
  private exportStream: MediaStream | null = null;
  private linkedAudio = false;
  private chunks: Blob[] = [];
  private exportGen = 0;
  private wakeLock: WakeLockSentinel | null = null;
  private lastEmit = 0;
  private lastTick = 0;
  private stepping = false;
  private fastAbort: AbortController | null = null;
  private readonly listeners = new Set<(snap: PlaybackSnap) => void>();
  private readonly frameListeners = new Set<(time: number) => void>();
  private onHidden = () => {
    if (document.hidden && this.playing && !this.recording) this.pause();
  };

  onExported: ((blob: Blob, extension: string) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  constructor(
    private frameCanvas: HTMLCanvasElement,
    private overlayCanvas: HTMLCanvasElement,
  ) {
    this.video = document.createElement("video");
    this.video.playsInline = true;
    this.video.preload = "auto";
    this.video.setAttribute("playsinline", "true");
    this.hide(this.video);
    document.body.appendChild(this.video);
    this.video.addEventListener("seeked", this.onSeeked);
    this.video.addEventListener("ended", this.onEnded);
    this.video.addEventListener("error", this.onVideoError);

    this.preloader = document.createElement("video");
    this.preloader.muted = true;
    this.preloader.playsInline = true;
    this.preloader.preload = "auto";
    this.hide(this.preloader);
    document.body.appendChild(this.preloader);

    this.overlayVideo = document.createElement("video");
    this.overlayVideo.muted = true;
    this.overlayVideo.playsInline = true;
    this.overlayVideo.preload = "auto";
    this.hide(this.overlayVideo);
    document.body.appendChild(this.overlayVideo);

    this.exportCanvas = document.createElement("canvas");
    this.hide(this.exportCanvas);
    document.body.appendChild(this.exportCanvas);

    this.renderer = GradeRenderer.tryCreate(frameCanvas);
    if (!this.renderer) this.fallback = frameCanvas.getContext("2d");
    this.overlayCtx = overlayCanvas.getContext("2d");
    this.exportCtx = this.exportCanvas.getContext("2d", { alpha: false });
    this.resize();
    document.addEventListener("visibilitychange", this.onHidden);
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.cancelExport();
    document.removeEventListener("visibilitychange", this.onHidden);
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.video.remove();
    this.preloader.removeAttribute("src");
    this.preloader.load();
    this.preloader.remove();
    this.overlayVideo.pause();
    this.overlayVideo.removeAttribute("src");
    this.overlayVideo.load();
    this.overlayVideo.remove();
    for (const bed of this.beds.values()) {
      bed.pause();
      bed.remove();
    }
    this.beds.clear();
    this.exportCanvas.remove();
    this.renderer?.destroy();
    void this.audioCtx?.close();
  }

  subscribe(listener: (snap: PlaybackSnap) => void) {
    this.listeners.add(listener);
    listener(this.snap());
    return () => {
      this.listeners.delete(listener);
    };
  }

  onFrame(listener: (time: number) => void) {
    this.frameListeners.add(listener);
    listener(this.time);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  setFonts(fonts: FontSet) {
    this.fonts = fonts;
    this.draw();
  }

  setView(view: ProjectView) {
    const sizeChanged = view.aspect !== this.view.aspect || view.quality !== this.view.quality;
    this.view = view;
    if (sizeChanged) this.resize();
    const duration = totalDuration(view.clips);
    if (this.time > duration) this.time = duration;
    if (this.recording) {
      this.draw();
      return;
    }
    if (view.clips.length === 0) {
      this.clipId = null;
      this.currentUrl = null;
      this.video.pause();
      this.draw();
      this.emit(true);
      return;
    }
    const sample = Math.min(this.time, Math.max(0, duration - 0.0001));
    const hit = locate(view.clips, sample);
    if (!hit) {
      this.draw();
      return;
    }
    const src = Math.min(sourceTime(hit), Math.max(hit.clip.inPoint, hit.clip.outPoint - 0.001));
    const drift = Math.abs((this.video.currentTime || 0) - src);
    const structural =
      hit.clip.url !== this.currentUrl ||
      hit.clip.id !== this.clipId ||
      drift > (this.playing ? 0.35 : 0.045);
    if (structural) {
      if (!this.playing) this.wantPlay = false;
      this.loadOrSeek(hit.clip, src);
    } else if (!this.playing) {
      this.video.playbackRate = hit.clip.speed;
      this.applyVolume(hit.clip, hit.local);
      this.draw();
    }
  }

  unlock() {
    this.ensureAudio();
    if (!this.video.src) return;
    const pending = this.video.play();
    pending
      ?.then(() => {
        if (!this.playing) this.video.pause();
      })
      .catch(() => undefined);
  }

  play() {
    if (this.view.clips.length === 0) return;
    this.ensureAudio();
    const duration = totalDuration(this.view.clips);
    if (duration <= 0) return;
    if (this.time >= duration - 0.03) this.time = 0;
    this.playing = true;
    this.wantPlay = true;
    const hit = locate(this.view.clips, this.time);
    if (!hit) return;
    const src = Math.min(sourceTime(hit), Math.max(hit.clip.inPoint, hit.clip.outPoint - 0.001));
    this.loadOrSeek(hit.clip, src);
    this.preloadAround(hit.index);
    this.emit(true);
  }

  pause() {
    if (this.recording) return;
    this.playing = false;
    this.wantPlay = false;
    this.video.pause();
    this.emit(true);
    this.publishFrame();
  }

  toggle() {
    if (this.recording) return;
    if (this.playing) this.pause();
    else this.play();
  }

  seek(time: number) {
    if (this.recording) return;
    const duration = totalDuration(this.view.clips);
    this.time = clamp(time, 0, duration);
    this.playing = false;
    this.wantPlay = false;
    this.video.pause();
    if (duration <= 0) {
      this.draw();
      this.emit(true);
      return;
    }
    const sample = this.time >= duration ? Math.max(0, duration - 0.0001) : this.time;
    const hit = locate(this.view.clips, sample);
    if (!hit) return;
    const src = Math.min(sourceTime(hit), Math.max(hit.clip.inPoint, hit.clip.outPoint - 0.001));
    this.loadOrSeek(hit.clip, src);
    this.emit(true);
    this.publishFrame();
  }

  startExport() {
    if (this.recording) return;
    const mime = pickRecorderMime();
    if (!mime || !this.exportCtx || typeof this.exportCanvas.captureStream !== "function") {
      this.onError?.("Questo browser non riesce a esportare. Apri Luce in Chrome, Edge o Safari aggiornato.");
      return;
    }
    if (totalDuration(this.view.clips) <= 0) {
      this.onError?.("Aggiungi un video prima di esportare.");
      return;
    }
    this.ensureAudio();
    void navigator.wakeLock
      ?.request("screen")
      .then((lock) => {
        this.wakeLock = lock;
      })
      .catch(() => undefined);

    this.time = 0;
    this.playing = true;
    this.wantPlay = true;
    if (this.video.src) void this.video.play().catch(() => undefined);
    const hit = locate(this.view.clips, 0);
    if (!hit) {
      this.playing = false;
      this.wantPlay = false;
      return;
    }
    this.loadOrSeek(hit.clip, hit.clip.inPoint);

    const stream = this.exportCanvas.captureStream(30);
    this.exportStream = stream;
    this.linkedAudio = false;
    if (this.gain && this.streamDest) {
      try {
        this.gain.connect(this.streamDest);
        this.linkedAudio = true;
        const track = this.streamDest.stream.getAudioTracks()[0];
        if (track) stream.addTrack(track);
      } catch {
        this.linkedAudio = false;
      }
    }
    const bits = this.view.quality === "1080" ? 10_000_000 : 5_000_000;
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: bits,
        audioBitsPerSecond: 128_000,
      });
    } catch {
      try {
        recorder = new MediaRecorder(stream);
      } catch {
        this.releaseStream();
        this.onError?.("Esportazione non disponibile su questo browser.");
        this.playing = false;
        this.wantPlay = false;
        return;
      }
    }
    const generation = ++this.exportGen;
    this.chunks = [];
    this.recorder = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    recorder.onerror = () => {
      if (generation !== this.exportGen) return;
      this.recording = false;
      this.playing = false;
      this.releaseStream();
      this.emit(true);
      this.onError?.("Esportazione interrotta.");
    };
    recorder.onstop = () => {
      if (generation !== this.exportGen) return;
      const type = recorder.mimeType || mime;
      const blob = new Blob(this.chunks, { type });
      this.recording = false;
      this.playing = false;
      this.wantPlay = false;
      this.releaseStream();
      void this.wakeLock?.release().catch(() => undefined);
      this.wakeLock = null;
      this.emit(true);
      if (blob.size < 800) {
        this.onError?.("Il file esportato è vuoto. Riprova tenendo la pagina in primo piano.");
        return;
      }
      this.onExported?.(blob, extensionForMime(type));
    };

    const begin = () => {
      if (this.disposed || generation !== this.exportGen || this.recording) return;
      this.draw();
      this.recording = true;
      try {
        recorder.start(200);
      } catch {
        this.recording = false;
        this.playing = false;
        this.releaseStream();
        this.onError?.("Esportazione non disponibile su questo browser.");
      }
      this.emit(true);
    };
    if (!this.seeking && !this.awaitingLoad) {
      begin();
      return;
    }
    const onReady = () => {
      window.clearTimeout(timer);
      this.video.removeEventListener("seeked", onReady);
      begin();
    };
    const timer = window.setTimeout(() => {
      this.video.removeEventListener("seeked", onReady);
      if (generation !== this.exportGen || this.recording) return;
      if (this.seeking || this.awaitingLoad) {
        this.playing = false;
        this.wantPlay = false;
        this.exportGen += 1;
        this.releaseStream();
        this.onError?.("Il video non è pronto per l'esportazione. Attendi il primo fotogramma e riprova.");
        this.emit(true);
        return;
      }
      begin();
    }, 2000);
    this.video.addEventListener("seeked", onReady);
  }

  cancelExport() {
    if (!this.recording && !this.recorder) return;
    this.exportGen += 1;
    this.recording = false;
    this.playing = false;
    this.wantPlay = false;
    this.video.pause();
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.onerror = null;
      try {
        recorder.stop();
      } catch {
        // The recorder can already be stopping.
      }
    }
    this.releaseStream();
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
    this.fastAbort?.abort();
    this.fastAbort = null;
    this.stepping = false;
    this.emit(true);
  }

  captureFrame(): Promise<Blob | null> {
    this.draw();
    return new Promise((resolve) => {
      this.frameCanvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.92);
    });
  }

  async startFastExport() {
    if (this.recording || this.stepping) return;
    if (totalDuration(this.view.clips) <= 0) {
      this.onError?.("Aggiungi un video prima di esportare.");
      return;
    }
    this.video.pause();
    this.playing = false;
    this.wantPlay = false;
    this.recording = true;
    this.stepping = true;
    this.emit(true);
    const abort = new AbortController();
    this.fastAbort = abort;
    try {
      const blob = await encodeFast({
        canvas: this.frameCanvas,
        overlay: this.overlayCanvas,
        clips: this.view.clips,
        audios: this.view.audios,
        signal: abort.signal,
        onProgress: (value) => {
          this.time = value * totalDuration(this.view.clips);
          this.emit(true);
        },
        seek: (time) => this.renderAt(time),
      });
      if (!abort.signal.aborted) this.onExported?.(blob, "webm");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        this.onError?.("Esportazione veloce non riuscita. Usa Esporta video.");
      }
    } finally {
      this.stepping = false;
      this.recording = false;
      this.fastAbort = null;
      this.emit(true);
    }
  }

  redraw() {
    this.draw();
  }

  private hide(element: HTMLElement) {
    element.style.cssText =
      "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
  }

  private resize() {
    const { width, height } = projectSize(this.view.aspect, this.view.quality);
    for (const canvas of [this.frameCanvas, this.overlayCanvas, this.exportCanvas]) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }
  }

  private snap(): PlaybackSnap {
    return {
      time: this.time,
      playing: this.playing,
      recording: this.recording,
      duration: totalDuration(this.view.clips),
    };
  }

  private emit(force = false) {
    const now = performance.now();
    if (!force && now - this.lastEmit < 80) return;
    this.lastEmit = now;
    const snap = this.snap();
    for (const listener of this.listeners) listener(snap);
  }

  private publishFrame() {
    for (const listener of this.frameListeners) listener(this.time);
  }

  private ensureAudio() {
    if (this.audioCtx) {
      if (this.audioCtx.state === "suspended") void this.audioCtx.resume();
      return;
    }
    try {
      const context = new AudioContext();
      const source = context.createMediaElementSource(this.video);
      const gain = context.createGain();
      source.connect(gain);
      gain.connect(context.destination);
      this.audioCtx = context;
      this.gain = gain;
      this.streamDest = context.createMediaStreamDestination();
      if (context.state === "suspended") void context.resume();
    } catch {
      this.audioCtx = null;
    }
  }

  private applyVolume(clip: Clip, local: number) {
    const dur = clipTimelineDuration(clip);
    let volume = clip.muted ? 0 : clip.volume;
    if (clip.fadeIn > 0) volume *= clamp(local / clip.fadeIn, 0, 1);
    if (clip.fadeOut > 0) volume *= clamp((dur - local) / clip.fadeOut, 0, 1);
    volume *= fadeAt(this.view.clips, this.time);
    volume = clamp(volume, 0, 1);
    this.video.muted = volume <= 0.001;
    if (this.gain) {
      this.gain.gain.value = volume;
      this.video.volume = 1;
    } else {
      try {
        this.video.volume = volume;
      } catch {
        // iOS ignores element volume; mute still works.
      }
    }
  }

  private markSeeking(value: boolean) {
    this.seeking = value;
    if (value) this.seekStarted = performance.now();
    const recorder = this.recorder;
    if (!this.recording || !recorder) return;
    try {
      if (value && recorder.state === "recording") recorder.pause();
      if (!value && recorder.state === "paused") recorder.resume();
    } catch {
      // Pause is optional. The export still finishes if the browser lacks it.
    }
  }

  private loadOrSeek(clip: Clip, src: number) {
    this.clipId = clip.id;
    if (clip.kind === "image") {
      this.currentUrl = clip.url;
      this.awaitingLoad = false;
      this.markSeeking(false);
      this.video.pause();
      this.draw();
      return;
    }
    this.video.playbackRate = clip.speed > 0 ? clip.speed : 1;
    if (this.currentUrl !== clip.url) {
      const token = ++this.loadToken;
      this.currentUrl = clip.url;
      this.awaitingLoad = true;
      this.markSeeking(true);
      this.video.pause();
      const onReady = () => {
        if (token !== this.loadToken) return;
        this.video.removeEventListener("loadeddata", onReady);
        this.awaitingLoad = false;
        this.video.playbackRate = clip.speed > 0 ? clip.speed : 1;
        this.commitSeek(src);
      };
      this.video.addEventListener("loadeddata", onReady);
      this.video.src = clip.url;
      return;
    }
    this.commitSeek(src);
  }

  private commitSeek(src: number) {
    const duration = Number.isFinite(this.video.duration) ? this.video.duration : src + 1;
    const clamped = clamp(src, 0, Math.max(0, duration - 0.001));
    if (this.video.readyState >= 2 && Math.abs(this.video.currentTime - clamped) < 0.02) {
      this.markSeeking(false);
      if (this.playing && this.wantPlay) this.safePlay();
      else this.video.pause();
      this.draw();
      return;
    }
    this.markSeeking(true);
    try {
      this.video.currentTime = clamped;
    } catch {
      this.markSeeking(false);
    }
  }

  private safePlay() {
    if (this.seeking || this.awaitingLoad) return;
    const pending = this.video.play();
    pending?.catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (!this.playing) return;
      const exporting = this.recording || this.recorder !== null;
      this.playing = false;
      this.wantPlay = false;
      if (exporting) {
        this.cancelExport();
        this.onError?.("Il browser ha bloccato la riproduzione. Tocca play e riprova a esportare.");
      }
      this.emit(true);
    });
  }

  private readonly onSeeked = () => {
    if (this.awaitingLoad) return;
    this.markSeeking(false);
    const reverse = this.view.clips.find((clip) => clip.id === this.clipId)?.reverse;
    if (this.playing && this.wantPlay && !reverse) this.safePlay();
    else if (!this.playing || reverse) this.video.pause();
    this.draw();
  };

  private readonly onEnded = () => {
    const hit = locate(this.view.clips, this.time);
    if (!hit) return;
    if (this.playing || this.recording) this.advanceFrom(hit.index);
  };

  private readonly onVideoError = () => {
    if (this.disposed) return;
    if (!this.awaitingLoad && !this.currentUrl) return;
    this.awaitingLoad = false;
    this.markSeeking(false);
    this.playing = false;
    this.wantPlay = false;
    this.onError?.("Non riesco a leggere questo video. Prova un MP4.");
    this.emit(true);
  };

  private advanceFrom(index: number) {
    const next = this.view.clips[index + 1];
    if (!next) {
      this.time = totalDuration(this.view.clips);
      this.playing = false;
      this.wantPlay = false;
      this.video.pause();
      this.draw();
      this.publishFrame();
      this.emit(true);
      if (this.recording) this.finishRecording();
      return;
    }
    if (this.clipId === next.id && (this.seeking || this.awaitingLoad)) return;
    this.time = clipStart(this.view.clips, index + 1);
    this.wantPlay = true;
    this.loadOrSeek(next, next.inPoint);
    this.preloadAround(index + 1);
    this.publishFrame();
  }

  private preloadAround(index: number) {
    if (crossMix(this.view.clips, this.time)) return;
    const next = this.view.clips[index + 1];
    if (!next || next.kind !== "video" || next.url === this.preloadUrl || next.url === this.currentUrl) return;
    this.preloadUrl = next.url;
    this.preloader.src = next.url;
  }

  private finishRecording() {
    const recorder = this.recorder;
    if (!this.recording || !recorder) return;
    if (recorder.state === "paused") {
      try {
        recorder.resume();
      } catch {
        // Stop still flushes the buffer on most browsers.
      }
    }
    if (recorder.state !== "inactive") {
      try {
        recorder.requestData();
      } catch {
        // requestData is optional before stop.
      }
      try {
        recorder.stop();
      } catch {
        this.recording = false;
        this.emit(true);
      }
    }
  }

  private releaseStream() {
    this.exportStream?.getTracks().forEach((track) => track.stop());
    this.exportStream = null;
    if (this.linkedAudio && this.gain && this.streamDest) {
      try {
        this.gain.disconnect(this.streamDest);
      } catch {
        // Already disconnected.
      }
    }
    this.linkedAudio = false;
    this.recorder = null;
  }

  private readonly frame = (now: number) => {
    if (this.disposed) return;
    if (this.lastTick === 0) this.lastTick = now;
    const dt = Math.min(0.05, (now - this.lastTick) / 1000);
    this.lastTick = now;
    if (this.seeking && now - this.seekStarted > 2500) {
      this.awaitingLoad = false;
      this.markSeeking(false);
    }
    if (!this.stepping && this.playing && !this.seeking && !this.awaitingLoad) {
      const hit = locate(this.view.clips, this.time);
      if (!hit) {
        this.playing = false;
      } else if (hit.clip.kind === "image" || hit.clip.reverse) {
        this.time += dt;
        const end = hit.start + clipTimelineDuration(hit.clip);
        if (this.time >= end - 0.0001) this.advanceFrom(hit.index);
        else if (hit.clip.reverse && hit.clip.kind === "video") {
          const src = this.sourceSeconds(hit.clip, this.time - hit.start);
          if (Math.abs(this.video.currentTime - src) > 0.05) {
            try {
              this.video.currentTime = src;
            } catch {
              // The next frame retries the reverse seek.
            }
          }
          this.applyVolume(hit.clip, Math.max(0, this.time - hit.start));
        }
      } else if (this.clipId === hit.clip.id && this.video.readyState >= 2) {
        const speed = hit.clip.speed > 0 ? hit.clip.speed : 1;
        const local = (this.video.currentTime - hit.clip.inPoint) / speed;
        const dur = clipTimelineDuration(hit.clip);
        if (local >= dur - 0.012 || this.video.currentTime >= hit.clip.outPoint - 0.008) {
          this.advanceFrom(hit.index);
        } else {
          this.time = hit.start + Math.max(0, local);
          if (this.video.playbackRate !== speed) this.video.playbackRate = speed;
          this.applyVolume(hit.clip, Math.max(0, local));
          if (this.video.paused) this.safePlay();
        }
      }
    }
    if (!this.stepping) this.syncAux();
    const hit = locate(this.view.clips, this.time);
    const grain = hit?.clip.grade.grain ?? 0;
    if (!this.stepping && (this.playing || this.recording || grain > 0)) this.draw();
    if (!this.stepping && (this.playing || this.recording)) {
      this.publishFrame();
      this.emit(false);
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private draw() {
    const hit =
      this.view.clips.length === 0
        ? null
        : locate(this.view.clips, Math.min(this.time, Math.max(0, totalDuration(this.view.clips) - 0.0001)));
    const dip = !hit ? 1 : fadeAt(this.view.clips, this.time);
    const cross = hit ? crossMix(this.view.clips, this.time) : null;
    const partner = cross ? this.sourceFor(cross.clip, "partner") : null;
    this.renderer?.clear();
    if (this.fallback) {
      this.fallback.clearRect(0, 0, this.frameCanvas.width, this.frameCanvas.height);
      this.fallback.fillStyle = "#000";
      this.fallback.fillRect(0, 0, this.frameCanvas.width, this.frameCanvas.height);
    }
    if (hit) {
      const base = this.sourceFor(hit.clip, "main");
      if (base) this.paintClip(hit.clip, hit.local, base, dip);
      if (cross && partner) this.paintClip(cross.clip, cross.local, partner, cross.mix);
      const overlay = overlaysAt(this.view.overlays, this.time);
      if (overlay) {
        const source = this.sourceFor(overlay, "overlay");
        if (source) this.paintClip(overlay, overlayLocal(overlay, this.time), source, 1);
      }
    }
    if (this.overlayCtx) {
      drawTitles(
        this.overlayCtx,
        this.view.titles,
        this.time,
        this.fonts,
        this.view.selectedTitleId,
        !this.recording,
        this.playing || this.recording,
      );
    }
    if (this.recording && !this.stepping && this.exportCtx) {
      this.exportCtx.drawImage(this.frameCanvas, 0, 0);
      this.exportCtx.drawImage(this.overlayCanvas, 0, 0);
    }
  }

  private paintClip(clip: Clip, local: number, source: HTMLVideoElement | HTMLImageElement, fade: number) {
    const width =
      source instanceof HTMLVideoElement
        ? source.videoWidth || clip.width
        : source instanceof HTMLImageElement
          ? source.naturalWidth || clip.width
          : clip.width;
    const height =
      source instanceof HTMLVideoElement
        ? source.videoHeight || clip.height
        : source instanceof HTMLImageElement
          ? source.naturalHeight || clip.height
          : clip.height;
    const rect = fitRect(width, height, this.frameCanvas.width, this.frameCanvas.height, clip.fit);
    const exposure = sampleTrack(clip.keyframes, local, "exposure", clip.grade.exposure);
    const opacity = sampleTrack(clip.keyframes, local, "opacity", clip.opacity);
    const scale = sampleTrack(clip.keyframes, local, "scale", clip.transform.scale);
    const stab = stabAt(clip.stab, this.sourceSeconds(clip, local));
    const graded = { ...clip, grade: { ...clip.grade, exposure } };
    const lut = this.view.luts.find((item) => item.id === clip.lutId) ?? null;
    if (this.renderer) {
      this.renderer.draw(
        {
          source,
          rect,
          grade: this.gradeFor(graded, fade),
          opacity,
          panX: clip.transform.x + stab.x,
          panY: clip.transform.y - stab.y,
          scale,
          rotate: clip.transform.rotate,
          mask: clip.mask,
          chroma: clip.chroma,
        },
        lut,
      );
      return;
    }
    if (!this.fallback) return;
    const context = this.fallback;
    context.save();
    context.translate(
      rect.x + rect.w / 2 + (clip.transform.x + stab.x) * this.frameCanvas.width,
      rect.y + rect.h / 2 - (clip.transform.y - stab.y) * this.frameCanvas.height,
    );
    context.rotate((clip.transform.rotate * Math.PI) / 180);
    context.scale(scale, scale);
    context.globalAlpha = clamp(opacity * fade, 0, 1);
    context.filter = cssFilter(graded.grade);
    context.drawImage(source, -rect.w / 2, -rect.h / 2, rect.w, rect.h);
    context.filter = "none";
    context.restore();
  }

  private sourceFor(clip: Clip, slot: "main" | "partner" | "overlay"): HTMLVideoElement | HTMLImageElement | null {
    if (clip.kind === "image") return this.imageOf(clip.url);
    const video = slot === "partner" ? this.preloader : slot === "overlay" ? this.overlayVideo : this.video;
    return video.readyState >= 2 ? video : null;
  }

  private imageOf(url: string): HTMLImageElement | null {
    let image = this.images.get(url);
    if (!image) {
      image = new Image();
      image.src = url;
      this.images.set(url, image);
      image.onload = () => {
        if (!this.disposed) this.draw();
      };
    }
    return image.complete && image.naturalWidth > 0 ? image : null;
  }

  private sourceSeconds(clip: Clip, local: number): number {
    const speed = clip.speed > 0 ? clip.speed : 1;
    const offset = Math.max(0, local) * speed;
    if (clip.reverse) return clamp(clip.outPoint - offset, clip.inPoint, clip.outPoint);
    return clip.inPoint + offset;
  }

  private syncAux() {
    const cross = crossMix(this.view.clips, this.time);
    if (cross && cross.clip.kind === "video") this.syncVideo(this.preloader, cross.clip.url, cross.src, "preload");
    const overlay = overlaysAt(this.view.overlays, this.time);
    if (overlay && overlay.kind === "video") {
      this.syncVideo(this.overlayVideo, overlay.url, this.sourceSeconds(overlay, overlayLocal(overlay, this.time)), "overlay");
    }
    this.syncBeds();
  }

  private syncVideo(video: HTMLVideoElement, url: string, time: number, slot: "preload" | "overlay") {
    const current = slot === "preload" ? this.preloadUrl : this.overlayUrl;
    if (current !== url) {
      if (slot === "preload") this.preloadUrl = url;
      else this.overlayUrl = url;
      video.src = url;
      return;
    }
    const speed = 1;
    if (video.playbackRate !== speed) video.playbackRate = speed;
    if (video.readyState >= 1 && Math.abs(video.currentTime - time) > (this.playing ? 0.18 : 0.05)) {
      try {
        video.currentTime = time;
      } catch {
        // Metadata can still be settling.
      }
    }
  }

  private syncBeds() {
    const active = new Set<string>();
    for (const clip of this.view.audios) {
      const span = audioDuration(clip);
      if (this.time < clip.start || this.time >= clip.start + span) continue;
      active.add(clip.id);
      let element = this.beds.get(clip.id);
      if (!element) {
        element = document.createElement("audio");
        element.preload = "auto";
        element.src = clip.url;
        this.hide(element);
        document.body.appendChild(element);
        this.beds.set(clip.id, element);
      }
      const src = clip.inPoint + (this.time - clip.start);
      const fade = clip.fadeIn > 0 ? clamp((this.time - clip.start) / clip.fadeIn, 0, 1) : 1;
      const tail = clip.fadeOut > 0 ? clamp((clip.start + span - this.time) / clip.fadeOut, 0, 1) : 1;
      element.volume = clamp((clip.muted ? 0 : clip.volume) * fade * tail, 0, 1);
      if (Number.isFinite(element.duration) && Math.abs(element.currentTime - src) > 0.28) {
        try {
          element.currentTime = src;
        } catch {
          // The element is not seekable yet.
        }
      }
      if (this.playing && element.paused) void element.play().catch(() => undefined);
      if (!this.playing && !element.paused) element.pause();
    }
    for (const [id, element] of this.beds) {
      if (!active.has(id)) element.pause();
    }
  }

  private async renderAt(time: number): Promise<void> {
    const duration = totalDuration(this.view.clips);
    this.time = clamp(time, 0, Math.max(0, duration - 0.0001));
    const hit = locate(this.view.clips, this.time);
    if (hit && hit.clip.kind === "video") {
      await this.seekTo(this.video, hit.clip.url, sourceTime({ ...hit, local: this.time - hit.start }));
      this.clipId = hit.clip.id;
      this.currentUrl = hit.clip.url;
    }
    const cross = crossMix(this.view.clips, this.time);
    if (cross && cross.clip.kind === "video") {
      await this.seekTo(this.preloader, cross.clip.url, cross.src);
      this.preloadUrl = cross.clip.url;
    }
    const overlay = overlaysAt(this.view.overlays, this.time);
    if (overlay && overlay.kind === "video") {
      await this.seekTo(this.overlayVideo, overlay.url, this.sourceSeconds(overlay, overlayLocal(overlay, this.time)));
      this.overlayUrl = overlay.url;
    }
    this.draw();
  }

  private seekTo(video: HTMLVideoElement, url: string, time: number): Promise<void> {
    if (this.videoSource(video) === url && video.readyState >= 2 && Math.abs(video.currentTime - time) < 0.04) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let timer = 0;
      const finish = () => {
        window.clearTimeout(timer);
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("loadeddata", onLoaded);
        resolve();
      };
      timer = window.setTimeout(finish, 900);
      const onSeeked = () => finish();
      const onLoaded = () => {
        video.addEventListener("seeked", onSeeked);
        try {
          video.currentTime = time;
        } catch {
          finish();
        }
      };
      if (this.videoSource(video) !== url) {
        if (video === this.video) this.currentUrl = url;
        else if (video === this.preloader) this.preloadUrl = url;
        else this.overlayUrl = url;
        video.addEventListener("loadeddata", onLoaded);
        video.src = url;
        return;
      }
      onLoaded();
    });
  }

  private videoSource(video: HTMLVideoElement): string | null {
    if (video === this.video) return this.currentUrl;
    if (video === this.preloader) return this.preloadUrl;
    return this.overlayUrl;
  }

  private gradeFor(clip: Clip, fade: number): GradeDraw {
    const vectors = gradeVectors(clip.grade);
    return {
      exposure: clip.grade.exposure,
      contrast: clip.grade.contrast,
      saturation: clip.grade.saturation,
      temperature: clip.grade.temperature,
      tint: clip.grade.tint,
      vignette: clip.grade.vignette,
      grain: clip.grade.grain,
      fade,
      time: this.time,
      lift: vectors.lift,
      gamma: vectors.gamma,
      gain: vectors.gain,
    };
  }
}
