"use client";

import { useRef, type PointerEvent } from "react";
import { clipTimelineDuration } from "@/lib/timeline";
import { formatTime } from "@/lib/time";
import type { Clip } from "@/lib/types";

export function SourceTrim({
  clip,
  sourceMark,
  onEdge,
}: {
  clip: Clip;
  sourceMark: number | null;
  onEdge: (edge: "in" | "out", value: number, history: boolean) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const drag = useRef<{ edge: "in" | "out"; history: boolean } | null>(null);

  function timeAt(clientX: number) {
    const rect = strip.current!.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * clip.duration;
  }

  const inRatio = clip.duration > 0 ? clip.inPoint / clip.duration : 0;
  const outRatio = clip.duration > 0 ? clip.outPoint / clip.duration : 1;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Sorgente</span>
        <span className="tabular-nums">
          {formatTime(clip.inPoint)} – {formatTime(clip.outPoint)} · {formatTime(clipTimelineDuration(clip))}
        </span>
      </div>
      <div
        ref={strip}
        className="relative h-16 overflow-hidden rounded-xl bg-black"
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          onEdge(current.edge, timeAt(event.clientX), !current.history);
          current.history = true;
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <div className="absolute inset-0 flex">
          {clip.thumbs.length === 0 ? (
            <div className="h-full w-full bg-[linear-gradient(90deg,#2a241c,#3a3124,#2a241c)]" />
          ) : (
            clip.thumbs.map((src, index) => (
              // Filmstrip frames are generated locally from the user's video.
              // eslint-disable-next-line @next/next/no-img-element
              <img key={`${src.slice(0, 32)}-${index}`} src={src} alt="" className="h-full min-w-0 flex-1 object-cover" />
            ))
          )}
        </div>
        <div className="absolute inset-y-0 left-0 bg-black/65" style={{ width: `${inRatio * 100}%` }} />
        <div className="absolute inset-y-0 right-0 bg-black/65" style={{ width: `${(1 - outRatio) * 100}%` }} />
        <div
          className="pointer-events-none absolute inset-y-0 border-y-2 border-primary"
          style={{ left: `${inRatio * 100}%`, right: `${(1 - outRatio) * 100}%` }}
        />
        {sourceMark !== null ? (
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-white"
            style={{ left: `${(sourceMark / clip.duration) * 100}%` }}
          />
        ) : null}
        <TrimHandle
          label="Inizio clip"
          percent={inRatio * 100}
          onPointerDown={(event) => {
            drag.current = { edge: "in", history: false };
            strip.current?.setPointerCapture(event.pointerId);
          }}
        />
        <TrimHandle
          label="Fine clip"
          percent={outRatio * 100}
          onPointerDown={(event) => {
            drag.current = { edge: "out", history: false };
            strip.current?.setPointerCapture(event.pointerId);
          }}
        />
      </div>
    </div>
  );
}

function TrimHandle({
  label,
  percent,
  onPointerDown,
}: {
  label: string;
  percent: number;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="absolute inset-y-0 z-10 w-6 -translate-x-1/2 touch-none"
      style={{ left: `${percent}%` }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onPointerDown(event);
      }}
    >
      <span className="mx-auto block h-full w-1.5 rounded-full bg-primary shadow" />
    </button>
  );
}
