"use client";

import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import {
  Aperture,
  AudioLines,
  Download,
  Gauge,
  Loader2,
  Palette,
  Plus,
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
import { captureThumbs, createDemoFile, fileToClip } from "@/lib/media";
import { canSplit, totalDuration } from "@/lib/timeline";
import { exportFilename, uid } from "@/lib/time";
import type { Aspect, ClipPatch, Grade, TitlePatch, Tool } from "@/lib/types";
import { cn } from "cn";

const TOOLS: { id: Tool; label: string; icon: typeof Scissors }[] = [
  { id: "cut", label: "Taglio", icon: Scissors },
  { id: "color", label: "Colore", icon: Palette },
  { id: "text", label: "Testo", icon: Type },
  { id: "audio", label: "Audio", icon: AudioLines },
  { id: "speed", label: "Velocità", icon: Gauge },
  { id: "export", label: "Esporta", icon: Download },
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
  const [exported, setExported] = useState<ExportFile | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const frameRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<Set<string>>(new Set());
  const pendingSeek = useRef<number | null>(null);
  const stateRef = useRef(state);
  const engineRef = useRef(engine);
  stateRef.current = state;
  engineRef.current = engine;

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
      titles: state.titles,
      aspect: state.aspect,
      quality: state.quality,
      selectedTitleId: state.selectedTitleId,
    });
    if (pendingSeek.current !== null && engine) {
      const at = pendingSeek.current;
      pendingSeek.current = null;
      engine.seek(at);
    }
  }, [engine, state.clips, state.titles, state.aspect, state.quality, state.selectedTitleId]);

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
    if (current.tool === "text" && current.selectedTitleId) {
      dispatch({ type: "deleteTitle", id: current.selectedTitleId });
      return;
    }
    if (current.selectedClipId) dispatch({ type: "deleteClip", id: current.selectedClipId });
  }

  function patchClip(patch: ClipPatch, history: boolean) {
    if (!state.selectedClipId) return;
    dispatch({ type: "patchClip", id: state.selectedClipId, patch, history });
  }

  function patchTitle(id: string, patch: TitlePatch, history: boolean) {
    dispatch({ type: "patchTitle", id, patch, history });
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
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 pt-[max(0.45rem,env(safe-area-inset-top))] pb-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-full border border-primary/40 bg-primary/10 text-primary">
          <Aperture className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="font-serif text-lg leading-none tracking-tight">Luce</p>
          <p className="hidden text-[10px] text-muted-foreground sm:block">Taglia, colora, esporta</p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <div className="flex rounded-lg bg-muted p-0.5" role="radiogroup" aria-label="Formato">
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
                    "grid size-8 place-items-center rounded-md",
                    active ? "bg-background text-primary shadow-sm" : "text-muted-foreground",
                  )}
                >
                  <Icon className="size-4" />
                </button>
              );
            })}
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Annulla"
            disabled={state.past.length === 0 || snap.recording}
            onClick={() => dispatch({ type: "undo" })}
          >
            <Undo2 />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Ripeti"
            disabled={state.future.length === 0 || snap.recording}
            onClick={() => dispatch({ type: "redo" })}
          >
            <Redo2 />
          </Button>
          <Button type="button" className="h-9 px-2.5" onClick={() => fileRef.current?.click()} disabled={snap.recording}>
            <Plus />
            <span className="hidden min-[420px]:inline">Aggiungi</span>
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
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
          <TimelineView
            clips={state.clips}
            titles={state.titles}
            selectedClipId={state.selectedClipId}
            selectedTitleId={state.selectedTitleId}
            playing={snap.playing}
            recording={snap.recording}
            duration={duration}
            engine={engine}
            onToggle={() => engine?.toggle()}
            onSelectClip={(id) => dispatch({ type: "selectClip", id })}
            onSelectTitle={(id) => dispatch({ type: "selectTitle", id })}
          />
        </div>

        <aside className="flex h-[min(300px,42dvh)] w-full shrink-0 flex-col border-t border-border pb-[env(safe-area-inset-bottom)] landscape:max-lg:h-[168px] lg:h-full lg:w-[400px] lg:border-t-0 lg:border-l">
          <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border px-1.5 py-1.5">
            {TOOLS.map((tool) => {
              const Icon = tool.icon;
              const active = state.tool === tool.id;
              return (
                <button
                  key={tool.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => dispatch({ type: "setTool", tool: tool.id })}
                  className={cn(
                    "flex min-w-[3.35rem] flex-1 flex-col items-center gap-1 rounded-xl px-1 py-1.5 text-[10px] font-medium",
                    active ? "bg-primary/15 text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon className="size-5" />
                  {tool.label}
                </button>
              );
            })}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
            {state.tool === "cut" ? (
              <CutPanel
                clips={state.clips}
                clip={clip}
                time={snap.time}
                canSplitNow={canSplit(state.clips, snap.time)}
                onSplit={() => splitAt(engine?.time ?? snap.time)}
                onDelete={() => clip && dispatch({ type: "deleteClip", id: clip.id })}
                onDuplicate={() => clip && dispatch({ type: "duplicateClip", id: clip.id, newId: uid() })}
                onMove={(dir) => clip && dispatch({ type: "moveClip", id: clip.id, dir })}
                onTrim={(edge) => clip && dispatch({ type: "trimToPlayhead", id: clip.id, edge, time: engine?.time ?? snap.time })}
                onPatch={patchClip}
                onEdge={(edge, value, history) =>
                  clip && dispatch({ type: "setEdge", id: clip.id, edge, value, history })
                }
              />
            ) : null}
            {state.tool === "color" ? (
              <ColorPanel
                clip={clip}
                onPatch={patchClip}
                onApplyAll={(grade: Grade) => dispatch({ type: "applyGradeAll", grade })}
              />
            ) : null}
            {state.tool === "text" ? (
              <TextPanel
                titles={state.titles}
                selectedId={state.selectedTitleId}
                duration={duration}
                time={engine?.time ?? snap.time}
                onAdd={addTitle}
                onSelect={(id) => dispatch({ type: "selectTitle", id })}
                onPatch={patchTitle}
                onDelete={(id) => dispatch({ type: "deleteTitle", id })}
              />
            ) : null}
            {state.tool === "audio" ? <AudioPanel clip={clip} onPatch={patchClip} /> : null}
            {state.tool === "speed" ? <SpeedPanel clip={clip} onPatch={patchClip} /> : null}
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
                onQuality={(quality) => dispatch({ type: "setQuality", quality })}
                onExport={() => {
                  setExportError(null);
                  engine?.unlock();
                  engine?.startExport();
                }}
                onCancel={() => engine?.cancelExport()}
                onDownload={downloadExport}
                onShare={() => void shareExport()}
              />
            ) : null}
          </div>
        </aside>
      </div>

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

      {busy ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 px-6 backdrop-blur-sm">
          <div className="w-full max-w-xs rounded-2xl border border-border bg-card px-5 py-4 text-center shadow-2xl">
            <Loader2 className="mx-auto size-5 animate-spin text-primary" />
            <p className="mt-3 text-sm">{busy}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
