"use client";

import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import {
  Aperture,
  AudioLines,
  Download,
  Gauge,
  Loader2,
  Palette,
  Pause,
  Play,
  RectangleHorizontal,
  RectangleVertical,
  Redo2,
  Scissors,
  Square,
  Type,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PreviewStage } from "@/components/editor/preview-stage";
import { TimelineView } from "@/components/editor/timeline-view";
import { AudioPanel } from "@/components/editor/panels/audio-panel";
import { ColorPanel } from "@/components/editor/panels/color-panel";
import { CutPanel } from "@/components/editor/panels/cut-panel";
import { ShapePanel } from "@/components/editor/panels/shape-panel";
import { ExportPanel, type ExportFile } from "@/components/editor/panels/export-panel";
import { SpeedPanel } from "@/components/editor/panels/speed-panel";
import { TextPanel } from "@/components/editor/panels/text-panel";
import { readFonts } from "@/lib/draw-titles";
import { PlaybackEngine, type PlaybackSnap } from "@/lib/engine";
import {
  collectUrls,
  createEditorState,
  reduceEditor,
  sanitizeTitle,
  selectedClip,
} from "@/lib/editor-state";
import { createClip, followKeyframe, touchKeyframe } from "@/lib/clip";
import type { SpeechLanguage } from "@/lib/speech-cues";
import { fastExportSupported } from "@/lib/fast-export";
import { parseCube } from "@/lib/lut";
import { captureThumbs, createDemoFile, fileToAudio, fileToClip, measurePeaks } from "@/lib/media";
import { attachUrls, clearProject, loadProject, saveProject } from "@/lib/project-store";
import { measureShake } from "@/lib/stabilize";
import { projectSize } from "@/lib/frame";
import { canSplit, clampEdge, clipStart, totalDuration } from "@/lib/timeline";
import { exportFilename, formatTime, uid } from "@/lib/time";
import { PIP_TRANSFORM, type Aspect, type ClipPatch, type Grade, type OverlayClip, type TitleCard, type TitlePatch, type Tool } from "@/lib/types";
import { cn } from "cn";

const TOOLS: { id: Tool; label: string; icon: typeof Scissors }[] = [
  { id: "cut", label: "Taglio", icon: Scissors },
  { id: "audio", label: "Audio", icon: AudioLines },
  { id: "text", label: "Testo", icon: Type },
  { id: "color", label: "Colore", icon: Palette },
  { id: "speed", label: "Velocità", icon: Gauge },
];

const ASPECTS: { id: Aspect; label: string; icon: typeof Square }[] = [
  { id: "16:9", label: "Orizzontale 16:9", icon: RectangleHorizontal },
  { id: "9:16", label: "Verticale 9:16", icon: RectangleVertical },
  { id: "1:1", label: "Quadrato 1:1", icon: Square },
];

export function Editor() {
  const [state, dispatch] = useReducer(reduceEditor, undefined, createEditorState);
  const [engine, setEngine] = useState<PlaybackEngine | null>(null);
  const [snap, setSnap] = useState<PlaybackSnap>({ time: 0, playing: false, recording: false, duration: 0 });
  const [busy, setBusy] = useState<string | null>(null);
  const [canCancel, setCanCancel] = useState(false);
  const [exported, setExported] = useState<ExportFile | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const frameRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const overlayFileRef = useRef<HTMLInputElement>(null);
  const micRef = useRef<MediaRecorder | null>(null);
  const transcribeAbort = useRef<AbortController | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [storeReady, setStoreReady] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const toolSeen = useRef(state.tool);
  const urlsRef = useRef<Set<string>>(new Set());
  const pendingSeek = useRef<number | null>(null);
  const stateRef = useRef(state);
  const engineRef = useRef(engine);
  stateRef.current = state;
  engineRef.current = engine;

  useEffect(() => {
    if (toolSeen.current === state.tool) return;
    toolSeen.current = state.tool;
    setSheetOpen(true);
  }, [state.tool]);

  function openTool(id: Tool) {
    if (state.tool === id) {
      setSheetOpen((open) => !open);
      return;
    }
    dispatch({ type: "setTool", tool: id });
  }

  useEffect(() => {
    const frame = frameRef.current;
    const overlay = overlayRef.current;
    if (!frame || !overlay) return;
    const playback = new PlaybackEngine(frame, overlay);
    playback.setFonts(readFonts());
    playback.onError = (message) => {
      if (/esport/i.test(message)) setExportError(message);
      toast.error(message);
    };
    playback.onExported = (blob, extension) => {
      const name = exportFilename(extension);
      const url = URL.createObjectURL(blob);
      setExported((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return { blob, url, name };
      });
      setExportError(null);
      dispatch({ type: "setTool", tool: "export" });
      toast.success("Video pronto");
    };
    setEngine(playback);
    const unsubscribe = playback.subscribe(setSnap);
    let alive = true;
    void document.fonts.ready.then(() => {
      if (alive) playback.setFonts(readFonts());
    });
    return () => {
      alive = false;
      unsubscribe();
      playback.dispose();
      setEngine(null);
    };
  }, []);

  useLayoutEffect(() => {
    engine?.setView({
      clips: state.clips,
      overlays: state.overlays,
      audios: state.audios,
      titles: state.titles,
      luts: state.luts,
      aspect: state.aspect,
      quality: state.quality,
      selectedTitleId: state.selectedTitleId,
    });
    if (pendingSeek.current !== null && engine) {
      const at = pendingSeek.current;
      pendingSeek.current = null;
      engine.seek(at);
    }
  }, [engine, state.clips, state.overlays, state.audios, state.titles, state.luts, state.aspect, state.quality, state.selectedTitleId]);

  useEffect(() => {
    let cancel = false;
    void loadProject()
      .then((loaded) => {
        if (cancel) return;
        if (loaded && stateRef.current.clips.length === 0 && stateRef.current.audios.length === 0) {
          const { project, urls } = loaded;
          dispatch({
            type: "replaceProject",
            project: {
              ...project,
              clips: attachUrls(project.clips, urls),
              overlays: attachUrls(project.overlays, urls),
              audios: attachUrls(project.audios, urls),
            },
          });
          if (project.clips.length || project.audios.length) toast.success("Montaggio riaperto");
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancel) setStoreReady(true);
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!storeReady) return;
    const timer = window.setTimeout(() => {
      const current = stateRef.current;
      const media = new Map<string, Blob>();
      const pending = [...current.clips, ...current.overlays, ...current.audios].map(async (item) => {
        if (!item.url || media.has(item.mediaId)) return;
        try {
          const response = await fetch(item.url);
          media.set(item.mediaId, await response.blob());
        } catch {
          // A missing blob is skipped. The rest of the project still saves.
        }
      });
      void Promise.all(pending).then(() =>
        saveProject(
          {
            version: 1,
            aspect: current.aspect,
            quality: current.quality,
            clips: current.clips,
            overlays: current.overlays,
            audios: current.audios,
            titles: current.titles,
            markers: current.markers,
            luts: current.luts,
          },
          media,
        ).catch(() => undefined),
      );
    }, 700);
    return () => window.clearTimeout(timer);
  }, [storeReady, state.clips, state.overlays, state.audios, state.titles, state.markers, state.luts, state.aspect, state.quality]);

  useEffect(() => {
    const next = collectUrls(state);
    for (const url of urlsRef.current) {
      if (!next.has(url)) URL.revokeObjectURL(url);
    }
    urlsRef.current = next;
  }, [state]);

  useEffect(() => {
    return () => {
      if (exported) URL.revokeObjectURL(exported.url);
    };
  }, [exported]);

  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (state.clips.length === 0) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [state.clips.length]);

  useEffect(() => {
    const unlock = () => engineRef.current?.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, [engine]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      const playback = engineRef.current;
      const current = stateRef.current;
      if (!playback || playback.recording) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? "redo" : "undo" });
        return;
      }
      if (event.code === "Space") {
        if (target?.closest("button, a")) return;
        event.preventDefault();
        playback.toggle();
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const step = event.shiftKey ? 1 : 1 / 30;
        playback.seek(playback.time + (event.key === "ArrowLeft" ? -step : step));
        return;
      }
      if (event.key === "Home") {
        playback.seek(0);
        return;
      }
      if (event.key === "End") {
        playback.seek(totalDuration(current.clips));
        return;
      }
      if ((event.key === "s" || event.key === "b" || event.key === "S" || event.key === "B") && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        splitAt(playback.time);
        return;
      }
      if ((event.key === "i" || event.key === "I") && current.selectedClipId) {
        dispatch({ type: "trimToPlayhead", id: current.selectedClipId, edge: "in", time: playback.time });
        return;
      }
      if ((event.key === "o" || event.key === "O") && current.selectedClipId) {
        dispatch({ type: "trimToPlayhead", id: current.selectedClipId, edge: "out", time: playback.time });
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeCurrent();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const clip = selectedClip(state);
  const duration = totalDuration(state.clips);
  const progress = snap.duration > 0 ? snap.time / snap.duration : 0;

  function rememberThumbs(clips: { id: string; url: string; duration: number }[]) {
    for (const item of clips) {
      void captureThumbs(item.url, item.duration)
        .then((thumbs) => dispatch({ type: "setThumbs", id: item.id, thumbs }))
        .catch(() => undefined);
    }
  }

  async function importFiles(list: File[]) {
    const videos = list.filter((file) => file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name));
    if (videos.length === 0) {
      toast.error("Scegli un file video.");
      return;
    }
    setBusy(videos.length === 1 ? "Leggo il video…" : `Leggo ${videos.length} video…`);
    const clips = [];
    let failed = 0;
    for (const file of videos) {
      try {
        clips.push(await fileToClip(file));
      } catch {
        failed += 1;
      }
    }
    setBusy(null);
    if (clips.length === 0) {
      toast.error("Non riesco a leggere questi file. Prova un MP4.");
      return;
    }
    pendingSeek.current = totalDuration(stateRef.current.clips);
    dispatch({ type: "addClips", clips });
    if (failed > 0) toast.error(`${failed} file saltati. Gli altri sono in timeline.`);
    else toast.success(clips.length === 1 ? "Clip aggiunta" : `${clips.length} clip aggiunte`);
    rememberThumbs(clips);
  }

  async function createDemo() {
    setBusy("Preparo due clip di prova…");
    try {
      const first = await createDemoFile("a");
      const second = await createDemoFile("b");
      const clips = [await fileToClip(first), await fileToClip(second)];
      setBusy(null);
      pendingSeek.current = 0;
      dispatch({ type: "addClips", clips });
      toast.success("Due clip di prova pronte");
      rememberThumbs(clips);
    } catch {
      setBusy(null);
      toast.error("Questo browser non crea il video di prova. Apri un file dal rullino.");
    }
  }

  function splitAt(time: number) {
    if (!canSplit(stateRef.current.clips, time)) {
      toast.error("Metti il cursore dentro una clip, lontano dai bordi.");
      return;
    }
    dispatch({ type: "split", time, newId: uid() });
  }

  function removeCurrent() {
    const current = stateRef.current;
    if (current.selectedOverlayId) {
      dispatch({ type: "deleteOverlay", id: current.selectedOverlayId });
      return;
    }
    if (current.tool === "text" && current.selectedTitleId) {
      dispatch({ type: "deleteTitle", id: current.selectedTitleId });
      return;
    }
    if (current.tool === "audio" && current.selectedAudioId) {
      dispatch({ type: "deleteAudio", id: current.selectedAudioId });
      return;
    }
    if (current.selectedClipId) dispatch({ type: "deleteClip", id: current.selectedClipId });
  }

  function localOf(clipId: string | null): number {
    if (!clipId) return 0;
    const overlay = state.overlays.find((item) => item.id === clipId);
    if (overlay) return Math.max(0, (engine?.time ?? snap.time) - overlay.start);
    const index = state.clips.findIndex((item) => item.id === clipId);
    if (index < 0) return 0;
    return Math.max(0, (engine?.time ?? snap.time) - clipStart(state.clips, index));
  }

  function patchActive(patch: ClipPatch, history: boolean) {
    const current = stateRef.current;
    if (current.selectedOverlayId) {
      const clip = current.overlays.find((item) => item.id === current.selectedOverlayId);
      const next = clip ? followKeyframe(clip, localOf(clip.id), patch) : patch;
      dispatch({ type: "patchOverlay", id: current.selectedOverlayId, patch: next, history });
      return;
    }
    if (!current.selectedClipId) return;
    const clip = current.clips.find((item) => item.id === current.selectedClipId);
    const next = clip ? followKeyframe(clip, localOf(clip.id), patch) : patch;
    dispatch({ type: "patchClip", id: current.selectedClipId, patch: next, history });
  }

  function addKeyframe() {
    const current = stateRef.current;
    const clip = selectedClip(current);
    if (!clip) return;
    const time = localOf(clip.id);
    const keyframes = touchKeyframe(clip.keyframes, time, { opacity: clip.opacity, scale: clip.transform.scale, exposure: clip.grade.exposure }, uid());
    patchActive({ keyframes }, true);
  }

  async function freezeFrame() {
    const playback = engineRef.current;
    const current = stateRef.current;
    if (!playback || current.clips.length === 0) return;
    setBusy("Preparo il fermo immagine…");
    try {
      const blob = await playback.captureFrame();
      if (!blob) throw new Error("frame");
      const url = URL.createObjectURL(blob);
      const size = projectSize(current.aspect, current.quality);
      const still = createClip({
        id: uid(),
        mediaId: uid(),
        name: "Fermo",
        url,
        duration: 2,
        width: size.width,
        height: size.height,
        kind: "image",
      });
      const hit = current.clips.findIndex((item) => item.id === current.selectedClipId);
      const index = hit >= 0 ? hit + 1 : current.clips.length;
      dispatch({ type: "insertClip", clip: still, index });
    } catch {
      toast.error("Non riesco a catturare questo fotogramma.");
    } finally {
      setBusy(null);
    }
  }

  async function stabilizeClip() {
    const current = stateRef.current;
    const clip = current.clips.find((item) => item.id === current.selectedClipId);
    if (!clip || clip.kind !== "video") return;
    if (clip.stab.length) {
      dispatch({ type: "patchClip", id: clip.id, patch: { stab: [] }, history: true });
      return;
    }
    setBusy("Stabilizzo la clip…");
    try {
      const stab = await measureShake(clip.url, clip.inPoint, clip.outPoint);
      dispatch({ type: "patchClip", id: clip.id, patch: { stab }, history: true });
      toast.success(stab.length ? "Stabilizzazione pronta" : "Movimento troppo poco per stabilizzare");
    } catch {
      toast.error("Non riesco a stabilizzare questo video.");
    } finally {
      setBusy(null);
    }
  }

  function liftOverlay() {
    const clip = stateRef.current.clips.find((item) => item.id === stateRef.current.selectedClipId);
    if (!clip) return;
    const start = clipStart(stateRef.current.clips, stateRef.current.clips.findIndex((item) => item.id === clip.id));
    const overlay: OverlayClip = {
      ...clip,
      id: uid(),
      start,
      transform: { ...PIP_TRANSFORM },
      transition: "cut",
    };
    dispatch({ type: "addOverlay", clip: overlay });
  }

  async function importAudio(list: File[]) {
    const file = list[0];
    if (!file) return;
    setBusy("Leggo l’audio…");
    try {
      const clip = await fileToAudio(file, engineRef.current?.time ?? 0);
      dispatch({ type: "addAudio", clip });
      const peaks = await measurePeaks(clip.url);
      if (peaks.length) dispatch({ type: "setPeaks", id: clip.id, peaks });
      toast.success("Traccia audio aggiunta");
    } catch {
      toast.error("Non riesco a leggere questo audio.");
    } finally {
      setBusy(null);
    }
  }

  async function importOverlay(list: File[]) {
    const file = list[0];
    if (!file) return;
    setBusy("Leggo la clip sopra…");
    try {
      const clip = await fileToClip(file);
      const overlay: OverlayClip = { ...clip, start: engineRef.current?.time ?? 0, transform: { ...PIP_TRANSFORM } };
      dispatch({ type: "addOverlay", clip: overlay });
      rememberThumbs([clip]);
    } catch {
      toast.error("Non riesco a leggere questo video.");
    } finally {
      setBusy(null);
    }
  }

  async function importLut(file: File) {
    try {
      const text = await file.text();
      const lut = parseCube(text, uid(), file.name);
      if (!lut) {
        toast.error("Questo file .cube non è una LUT 3D.");
        return;
      }
      dispatch({ type: "addLut", lut });
      patchActive({ lutId: lut.id }, true);
      toast.success("LUT applicata");
    } catch {
      toast.error("Non riesco a leggere la LUT.");
    }
  }

  async function toggleMic() {
    if (micRef.current) {
      micRef.current.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        micRef.current = null;
        setMicOn(false);
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const file = new File([blob], "voce.webm", { type: blob.type });
        void importAudio([file]);
      };
      micRef.current = recorder;
      recorder.start();
      setMicOn(true);
    } catch {
      toast.error("Il microfono non è disponibile.");
    }
  }

  async function resetProject() {
    await clearProject().catch(() => undefined);
    dispatch({ type: "resetProject" });
    toast.success("Montaggio nuovo");
  }

  function patchTitle(id: string, patch: TitlePatch, history: boolean) {
    dispatch({ type: "patchTitle", id, patch, history });
  }

  async function generateSpeech(language: SpeechLanguage) {
    if (totalDuration(stateRef.current.clips) <= 0) {
      toast.error("Aggiungi prima un video.");
      return;
    }
    const abort = new AbortController();
    transcribeAbort.current = abort;
    setCanCancel(true);
    abort.signal.addEventListener("abort", () => setBusy("Annullamento…"));
    setBusy("Preparo il riconoscimento vocale…");
    try {
      const { transcribeTimeline } = await import("@/lib/transcribe");
      const result = await transcribeTimeline({
        clips: stateRef.current.clips,
        audios: stateRef.current.audios,
        language,
        signal: abort.signal,
        onProgress: (message) => {
          if (!abort.signal.aborted) setBusy(message);
        },
        makeId: uid,
      });
      if (abort.signal.aborted) return;
      if (result.titles.length === 0) {
        toast.error(
          result.heard
            ? "Ho sentito audio, ma non un parlato riconoscibile."
            : "Non ho sentito parlato. Serve una voce, oppure incolla un SRT.",
        );
        return;
      }
      dispatch({ type: "addTitles", titles: result.titles });
      const count = result.titles.length;
      const noun = count === 1 ? "sottotitolo" : "sottotitoli";
      toast.success(result.capped ? `${count} ${noun}, dai primi 10 minuti` : `${count} ${noun} dal parlato`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error("Non riesco a generare i sottotitoli in questo browser.");
    } finally {
      transcribeAbort.current = null;
      setCanCancel(false);
      setBusy(null);
    }
  }

  function addTitle() {
    const length = totalDuration(state.clips);
    if (length <= 0) {
      toast.error("Aggiungi prima un video.");
      return;
    }
    const start = Math.min(engine?.time ?? 0, Math.max(0, length - 0.4));
    dispatch({
      type: "addTitle",
      title: sanitizeTitle({
        id: uid(),
        text: "Titolo",
        start,
        duration: Math.min(2.5, Math.max(0.4, length - start)),
        x: 0.5,
        y: 0.82,
        size: 64,
        color: "#F6F1E8",
        font: "serif",
        align: "center",
        background: null,
        stroke: false,
        enter: "fade",
        exit: "fade",
      }),
    });
  }

  async function shareExport() {
    if (!exported) return;
    const file = new File([exported.blob], exported.name, { type: exported.blob.type || "video/mp4" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Luce" });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    downloadExport();
  }

  function downloadExport() {
    if (!exported) return;
    const link = document.createElement("a");
    link.href = exported.url;
    link.download = exported.name;
    link.click();
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#0c0b09] text-foreground">
      <header className="z-40 flex shrink-0 items-center gap-2 bg-[#0c0b09] px-3 pt-[max(0.45rem,env(safe-area-inset-top))] pb-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-full border border-primary/40 bg-primary/10 text-primary">
          <Aperture className="size-4" />
        </span>
        <p className="min-w-0 truncate font-serif text-lg leading-none tracking-tight">Luce</p>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <div className="flex rounded-full bg-muted p-0.5" role="radiogroup" aria-label="Formato">
            {ASPECTS.map((item) => {
              const Icon = item.icon;
              const active = state.aspect === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={item.label}
                  onClick={() => dispatch({ type: "setAspect", aspect: item.id })}
                  className={cn(
                    "grid size-8 place-items-center rounded-full",
                    active ? "bg-background text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon className="size-4" />
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="h-8 rounded-full bg-muted px-2.5 text-[11px] font-semibold tracking-wide"
            onClick={() => openTool("export")}
          >
            {state.quality}P
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1 rounded-full bg-primary px-3 text-sm font-semibold text-primary-foreground"
            onClick={() => openTool("export")}
          >
            <Download className="size-3.5" />
            Esporta
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-[10rem] flex-1">
        <div className="absolute inset-0">
            <PreviewStage
              frameRef={frameRef}
              overlayRef={overlayRef}
              engine={engine}
              titles={state.titles}
              aspect={state.aspect}
              quality={state.quality}
              duration={duration}
              playing={snap.playing}
              recording={snap.recording}
              progress={progress}
              hasClips={state.clips.length > 0}
              onToggle={() => engine?.toggle()}
              onSeek={(time) => engine?.seek(time)}
              onSelectTitle={(id) => dispatch({ type: "selectTitle", id })}
              onMoveTitle={(id, x, y, history) => patchTitle(id, { x, y }, history)}
              onOpen={() => fileRef.current?.click()}
              onDemo={() => void createDemo()}
            />
        </div>
      </div>

      <div className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center bg-[#0c0b09] px-2">
        <div className="flex items-center">
          <Button type="button" size="icon" variant="ghost" aria-label="Annulla" disabled={state.past.length === 0 || snap.recording} onClick={() => dispatch({ type: "undo" })}>
            <Undo2 />
          </Button>
          <Button type="button" size="icon" variant="ghost" aria-label="Ripeti" disabled={state.future.length === 0 || snap.recording} onClick={() => dispatch({ type: "redo" })}>
            <Redo2 />
          </Button>
          <span className="min-w-14 text-xs tabular-nums text-foreground/90">{formatTime(snap.time)}</span>
        </div>
        <button
          type="button"
          aria-label={snap.playing ? "Pausa" : "Play"}
          disabled={state.clips.length === 0 || snap.recording}
          onClick={() => engine?.toggle()}
          className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
        >
          {snap.playing ? <Pause className="size-5 fill-current" /> : <Play className="size-5 translate-x-0.5 fill-current" />}
        </button>
        <span className="pr-2 text-right text-xs tabular-nums text-muted-foreground">{formatTime(duration)}</span>
      </div>

          <TimelineView
            clips={state.clips}
            overlays={state.overlays}
            audios={state.audios}
            titles={state.titles}
            markers={state.markers}
            selectedClipId={state.selectedClipId}
            selectedOverlayId={state.selectedOverlayId}
            selectedAudioId={state.selectedAudioId}
            selectedTitleId={state.selectedTitleId}
            playing={snap.playing}
            recording={snap.recording}
            duration={duration}
            engine={engine}
            onAdd={() => fileRef.current?.click()}
            onSelectClip={(id) => dispatch({ type: "selectClip", id })}
            onSelectOverlay={(id) => dispatch({ type: "selectOverlay", id })}
            onSelectAudio={(id) => dispatch({ type: "selectAudio", id })}
            onSelectTitle={(id) => dispatch({ type: "selectTitle", id })}
            onTrim={(id, edge, value, history) => dispatch({ type: "setEdge", id, edge, value, history })}
            onReorder={(id, index) => dispatch({ type: "moveClipTo", id, index })}
            onMarker={() => {
              const time = engine?.time ?? snap.time;
              const near = state.markers.find((marker) => Math.abs(marker.time - time) < 0.2);
              if (near) dispatch({ type: "deleteMarker", id: near.id });
              else dispatch({ type: "addMarker", marker: { id: uid(), time, label: "Segno" } });
            }}
          />

        {sheetOpen ? (
          <section className="absolute inset-x-0 bottom-0 z-30 max-h-[min(46dvh,22rem)] overflow-y-auto overscroll-contain border-t border-border bg-background px-4 py-4 shadow-[0_-16px_40px_rgba(0,0,0,0.45)]">
            {state.tool === "cut" ? (
              <CutPanel
                clips={state.clips}
                clip={clip}
                time={snap.time}
                canSplitNow={canSplit(state.clips, snap.time)}
                onSplit={() => splitAt(engine?.time ?? snap.time)}
                onDelete={() => {
                  if (state.selectedOverlayId) dispatch({ type: "deleteOverlay", id: state.selectedOverlayId });
                  else if (clip) dispatch({ type: "deleteClip", id: clip.id });
                }}
                onDuplicate={() => clip && !state.selectedOverlayId && dispatch({ type: "duplicateClip", id: clip.id, newId: uid() })}
                onMove={(dir) => clip && !state.selectedOverlayId && dispatch({ type: "moveClip", id: clip.id, dir })}
                onTrim={(edge) => clip && !state.selectedOverlayId && dispatch({ type: "trimToPlayhead", id: clip.id, edge, time: engine?.time ?? snap.time })}
                onPatch={patchActive}
                onEdge={(edge, value, history) => {
                  if (!clip) return;
                  const next = clampEdge(clip, edge, value);
                  if (state.selectedOverlayId) patchActive(edge === "in" ? { inPoint: next.inPoint } : { outPoint: next.outPoint }, history);
                  else dispatch({ type: "setEdge", id: clip.id, edge, value, history });
                }}
              />
            ) : null}
            {state.tool === "cut" && clip ? (
              <ShapePanel
                clip={clip}
                local={localOf(clip.id)}
                onPatch={patchActive}
                onFreeze={() => void freezeFrame()}
                onStabilize={() => void stabilizeClip()}
                onOverlay={liftOverlay}
                onImportOverlay={() => overlayFileRef.current?.click()}
                onKeyframe={addKeyframe}
                start={state.selectedOverlayId ? (clip as OverlayClip).start : undefined}
                duration={duration}
                onStart={
                  state.selectedOverlayId
                    ? (start, history) => {
                        const id = state.selectedOverlayId;
                        if (id) dispatch({ type: "patchOverlay", id, patch: { start }, history });
                      }
                    : undefined
                }
              />
            ) : null}
            {state.tool === "color" ? (
              <ColorPanel
                clip={clip}
                frame={frameRef.current}
                luts={state.luts}
                canPaste={state.gradeClipboard !== null}
                onPatch={patchActive}
                onApplyAll={(grade: Grade) => dispatch({ type: "applyGradeAll", grade })}
                onCopy={() => clip && dispatch({ type: "copyGrade", grade: clip.grade })}
                onPaste={() => clip && dispatch({ type: "pasteGrade", id: clip.id })}
                onLut={(file) => void importLut(file)}
                onClearLut={() => patchActive({ lutId: null }, true)}
                onKeyframe={addKeyframe}
              />
            ) : null}
            {state.tool === "text" ? (
              <TextPanel
                titles={state.titles}
                selectedId={state.selectedTitleId}
                duration={duration}
                time={engine?.time ?? snap.time}
                onAdd={addTitle}
                onAddMany={(titles: TitleCard[]) => dispatch({ type: "addTitles", titles })}
                onGenerate={(language) => void generateSpeech(language)}
                generating={busy !== null}
                onSelect={(id) => dispatch({ type: "selectTitle", id })}
                onPatch={patchTitle}
                onDelete={(id) => dispatch({ type: "deleteTitle", id })}
              />
            ) : null}
            {state.tool === "audio" ? (
              <AudioPanel
                clip={state.selectedOverlayId ? null : clip}
                audios={state.audios}
                selectedAudioId={state.selectedAudioId}
                recording={micOn}
                onPatch={patchActive}
                onSelectAudio={(id) => dispatch({ type: "selectAudio", id })}
                onPatchAudio={(id, patch, history) => dispatch({ type: "patchAudio", id, patch, history })}
                onDeleteAudio={(id) => dispatch({ type: "deleteAudio", id })}
                onImport={() => audioRef.current?.click()}
                onRecord={() => void toggleMic()}
              />
            ) : null}
            {state.tool === "speed" ? <SpeedPanel clip={clip} onPatch={patchActive} /> : null}
            {state.tool === "export" ? (
              <ExportPanel
                aspect={state.aspect}
                quality={state.quality}
                clipCount={state.clips.length}
                duration={duration}
                recording={snap.recording}
                progress={progress}
                exported={exported}
                error={exportError}
                fastReady={fastExportSupported()}
                onQuality={(quality) => dispatch({ type: "setQuality", quality })}
                onExport={() => {
                  setExportError(null);
                  engine?.unlock();
                  engine?.startExport();
                }}
                onFast={() => {
                  setExportError(null);
                  void engine?.startFastExport();
                }}
                onReset={() => void resetProject()}
                onCancel={() => engine?.cancelExport()}
                onDownload={downloadExport}
                onShare={() => void shareExport()}
              />
            ) : null}
          </section>
        ) : null}
      </div>

        <nav className="relative z-40 flex shrink-0 gap-1 border-t border-border bg-[#0c0b09] px-1 pt-1 pb-[max(0.35rem,env(safe-area-inset-bottom))]">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            const active = sheetOpen && state.tool === tool.id;
            return (
              <button
                key={tool.id}
                type="button"
                aria-pressed={active}
                onClick={() => openTool(tool.id)}
                className={cn(
                  "flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[11px] leading-tight font-medium",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="size-5" />
                <span className="max-w-full truncate">{tool.label}</span>
              </button>
            );
          })}
        </nav>

      <input
        ref={fileRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,video/*"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void importFiles(files);
        }}
      />
      <input
        ref={audioRef}
        type="file"
        accept="audio/*,video/*"
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void importAudio(files);
        }}
      />
      <input
        ref={overlayFileRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,video/*"
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void importOverlay(files);
        }}
      />

      {busy ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 px-6 backdrop-blur-sm">
          <div className="w-full max-w-xs rounded-2xl border border-border bg-card px-5 py-4 text-center shadow-2xl">
            <Loader2 className="mx-auto size-5 animate-spin text-primary" />
            <p className="mt-3 text-sm">{busy}</p>
            {canCancel ? (
              <button type="button" className="mt-3 text-xs text-muted-foreground" onClick={() => transcribeAbort.current?.abort()}>
                Annulla
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
