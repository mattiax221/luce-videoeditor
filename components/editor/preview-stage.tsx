"use client";

import { useEffect, useRef, type RefObject } from "react";
import { Play } from "lucide-react";
import { titleAtPoint } from "@/lib/draw-titles";
import type { PlaybackEngine } from "@/lib/engine";
import { aspectLabel, projectSize } from "@/lib/frame";
import { clamp } from "@/lib/time";
import type { Aspect, Quality, TitleCard } from "@/lib/types";

function canvasPoint(event: { clientX: number; clientY: number }, canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const drawnW = canvas.width * scale;
  const drawnH = canvas.height * scale;
  const offsetX = rect.left + (rect.width - drawnW) / 2;
  const offsetY = rect.top + (rect.height - drawnH) / 2;
  return {
    x: (event.clientX - offsetX) / drawnW,
    y: (event.clientY - offsetY) / drawnH,
    inside:
      event.clientX >= offsetX &&
      event.clientX <= offsetX + drawnW &&
      event.clientY >= offsetY &&
      event.clientY <= offsetY + drawnH,
  };
}

export function PreviewStage({
  frameRef,
  overlayRef,
  engine,
  titles,
  aspect,
  quality,
  duration,
  playing,
  recording,
  progress,
  hasClips,
  onToggle,
  onSeek,
  onSelectTitle,
  onMoveTitle,
  onOpen,
  onDemo,
}: {
  frameRef: RefObject<HTMLCanvasElement | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
  engine: PlaybackEngine | null;
  titles: TitleCard[];
  aspect: Aspect;
  quality: Quality;
  duration: number;
  playing: boolean;
  recording: boolean;
  progress: number;
  hasClips: boolean;
  onToggle: () => void;
  onSeek: (time: number) => void;
  onSelectTitle: (id: string) => void;
  onMoveTitle: (id: string, x: number, y: number, history: boolean) => void;
  onOpen: () => void;
  onDemo: () => void;
}) {
  const scrub = useRef<HTMLInputElement>(null);
  const draggingScrub = useRef(false);
  const gesture = useRef<{
    id: string | null;
    moved: boolean;
    history: boolean;
    originX: number;
    originY: number;
    start: { x: number; y: number };
  } | null>(null);
  const size = projectSize(aspect, quality);

  useEffect(() => {
    if (!engine) return;
    return engine.onFrame((time) => {
      const input = scrub.current;
      if (!input || draggingScrub.current || document.activeElement === input) return;
      input.value = String(time);
    });
  }, [engine]);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[#070706]">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <canvas
          ref={frameRef}
          width={size.width}
          height={size.height}
          className="absolute inset-0 h-full w-full object-contain"
          aria-hidden
        />
        <canvas
          ref={overlayRef}
          width={size.width}
          height={size.height}
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          aria-hidden
        />
        {!hasClips ? (
          <div className="absolute inset-0 z-20 overflow-hidden @container">
            <div className="flex h-full items-center justify-center px-4 py-3">
              <div className="w-full max-w-md text-center">
                <p className="font-serif text-2xl leading-none text-balance text-foreground lg:text-3xl">Il montaggio è vuoto</p>
                <p className="mx-auto mt-2 max-w-[18rem] text-[13px] leading-snug text-muted-foreground">
                  Apri un video dal telefono. Resta sul dispositivo: niente account, niente upload.
                </p>
                <div className="mx-auto mt-3 flex w-full max-w-[18rem] flex-col gap-2 @min-[28rem]:max-w-none @min-[28rem]:flex-row @min-[28rem]:justify-center">
                  <button
                    type="button"
                    onClick={onOpen}
                    className="h-11 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground @min-[28rem]:min-w-40"
                  >
                    Apri video
                  </button>
                  <button
                    type="button"
                    onClick={onDemo}
                    className="h-11 rounded-full border border-border px-5 text-sm font-medium text-foreground @min-[28rem]:min-w-40"
                  >
                    Prova con due clip
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div
            className="absolute inset-0 z-10 touch-manipulation"
            onPointerDown={(event) => {
              if (recording || !engine || !frameRef.current) return;
              const point = canvasPoint(event, frameRef.current);
              const hit = point.inside
                ? titleAtPoint(titles, engine.time, point.x, point.y, frameRef.current.width, frameRef.current.height)
                : null;
              gesture.current = {
                id: hit?.id ?? null,
                moved: false,
                history: false,
                originX: hit?.x ?? 0.5,
                originY: hit?.y ?? 0.5,
                start: point,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const current = gesture.current;
              if (!current || !frameRef.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
              const point = canvasPoint(event, frameRef.current);
              if (Math.hypot(point.x - current.start.x, point.y - current.start.y) > 0.012) current.moved = true;
              if (!current.id || !current.moved) return;
              onMoveTitle(
                current.id,
                clamp(current.originX + (point.x - current.start.x), 0.06, 0.94),
                clamp(current.originY + (point.y - current.start.y), 0.06, 0.94),
                !current.history,
              );
              current.history = true;
            }}
            onPointerUp={() => {
              const current = gesture.current;
              gesture.current = null;
              if (!current || current.moved || recording) return;
              if (current.id) onSelectTitle(current.id);
              else onToggle();
            }}
          >
            {!playing && !recording ? (
              <span className="pointer-events-none absolute top-1/2 left-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white shadow-lg backdrop-blur-sm">
                <Play className="size-7 translate-x-0.5 fill-current" />
              </span>
            ) : null}
          </div>
        )}
        {hasClips ? (
          <div className="pointer-events-none absolute top-3 left-3 z-30 rounded-full bg-black/50 px-2.5 py-1 text-[10px] tracking-wide text-white/80 uppercase">
            {aspectLabel(aspect)} · {quality}p
          </div>
        ) : null}
        {recording ? (
          <div className="absolute right-3 bottom-3 left-3 z-30 rounded-xl bg-black/70 px-3 py-2 text-white backdrop-blur-sm">
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-red-500" />
                REC
              </span>
              <span className="tabular-nums">{Math.round(progress * 100)}%</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-white/20">
              <div className="h-full bg-primary" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          </div>
        ) : null}
      </div>
      <label className="relative z-30 block px-4 pt-1 pb-2">
        <span className="sr-only">Posizione nel montaggio</span>
        <input
          ref={scrub}
          type="range"
          min={0}
          max={Math.max(duration, 0.01)}
          step={0.01}
          defaultValue={0}
          disabled={!hasClips || recording}
          aria-label="Posizione nel montaggio"
          className="luce-scrubber w-full"
          onPointerDown={(event) => {
            event.stopPropagation();
            draggingScrub.current = true;
          }}
          onPointerUp={() => {
            draggingScrub.current = false;
          }}
          onPointerCancel={() => {
            draggingScrub.current = false;
          }}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
      </label>
    </div>
  );
}
