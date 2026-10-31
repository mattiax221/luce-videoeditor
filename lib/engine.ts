import { drawTitles, readFonts, type FontSet } from "@/lib/draw-titles";
import { fitRect, projectSize } from "@/lib/frame";
import { cssFilter, gradeVectors } from "@/lib/grade";
import { GradeRenderer, type GradeDraw } from "@/lib/gl-renderer";
import { extensionForMime, pickRecorderMime } from "@/lib/media";
import {
  clipStart,
  clipTimelineDuration,
  fadeAt,
  locate,
  sourceTime,
  totalDuration,
} from "@/lib/timeline";
import { clamp } from "@/lib/time";
import type { Aspect, Clip, Quality, TitleCard } from "@/lib/types";

export type ProjectView = {
  clips: Clip[];
  titles: TitleCard[];
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
  titles: [],
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
  private readonly video: HTMLVideoElement;

  private raf = 0;
  private disposed = false;
  private clipId: string | null = null;
  private currentUrl: string | null = null;
  private preloadUrl: string | null = null;
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
    this.emit(true);
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
    if (this.playing && this.wantPlay) this.safePlay();
    else if (!this.playing) this.video.pause();
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
    const next = this.view.clips[index + 1];
    if (!next || next.url === this.preloadUrl || next.url === this.currentUrl) return;
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
    if (this.seeking && now - this.seekStarted > 2500) {
      this.awaitingLoad = false;
      this.markSeeking(false);
    }
    if (this.playing && !this.seeking && !this.awaitingLoad) {
      const hit = locate(this.view.clips, this.time);
      if (!hit) {
        this.playing = false;
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
    const hit = locate(this.view.clips, this.time);
    const grain = hit?.clip.grade.grain ?? 0;
    if (this.playing || this.recording || grain > 0) this.draw();
    if (this.playing || this.recording) {
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
    const fade = this.view.clips.length === 0 ? 1 : fadeAt(this.view.clips, this.time);
    if (!hit || this.video.readyState < 2) {
      this.renderer?.clear();
      if (this.fallback) {
        this.fallback.fillStyle = "#000";
        this.fallback.fillRect(0, 0, this.frameCanvas.width, this.frameCanvas.height);
      }
    } else if (this.renderer) {
      const rect = fitRect(
        this.video.videoWidth || hit.clip.width,
        this.video.videoHeight || hit.clip.height,
        this.frameCanvas.width,
        this.frameCanvas.height,
        hit.clip.fit,
      );
      this.renderer.draw(this.video, rect, this.gradeFor(hit.clip, fade));
    } else if (this.fallback) {
      const rect = fitRect(
        this.video.videoWidth || hit.clip.width,
        this.video.videoHeight || hit.clip.height,
        this.frameCanvas.width,
        this.frameCanvas.height,
        hit.clip.fit,
      );
      this.fallback.fillStyle = "#000";
      this.fallback.fillRect(0, 0, this.frameCanvas.width, this.frameCanvas.height);
      this.fallback.filter = cssFilter(hit.clip.grade);
      this.fallback.globalAlpha = fade;
      this.fallback.drawImage(this.video, rect.x, rect.y, rect.w, rect.h);
      this.fallback.filter = "none";
      this.fallback.globalAlpha = 1;
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
    if (this.recording && this.exportCtx) {
      this.exportCtx.drawImage(this.frameCanvas, 0, 0);
      this.exportCtx.drawImage(this.overlayCanvas, 0, 0);
    }
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
