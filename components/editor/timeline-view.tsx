"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, ZoomIn, ZoomOut } from "lucide-react";
import type { PlaybackEngine } from "@/lib/engine";
import { clipStart, clipTimelineDuration } from "@/lib/timeline";
import { formatTime } from "@/lib/time";
import type { Clip, TitleCard } from "@/lib/types";
import { cn } from "cn";

const RULER = 28;
const TITLE_H = 22;
const VIDEO_H = 72;
const COLORS = ["#e4a04a", "#79b7c9", "#d9896a", "#8fbf9f", "#cbb27a", "#c58bb3"];

export function TimelineView({
  clips,
  titles,
  selectedClipId,
  selectedTitleId,
  playing,
  recording,
  duration,
  engine,
  onToggle,
  onSelectClip,
  onSelectTitle,
}: {
  clips: Clip[];
  titles: TitleCard[];
  selectedClipId: string | null;
  selectedTitleId: string | null;
  playing: boolean;
  recording: boolean;
  duration: number;
  engine: PlaybackEngine | null;
  onToggle: () => void;
  onSelectClip: (id: string) => void;
  onSelectTitle: (id: string) => void;
}) {
  const [pps, setPps] = useState(64);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewWidth, setViewWidth] = useState(360);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const playingRef = useRef(playing);
  const width = Math.max(duration, 1) * pps + 32;

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver(() => setViewWidth(scroller.clientWidth));
    observer.observe(scroller);
    setViewWidth(scroller.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!engine) return;
    return engine.onFrame((time) => {
      if (playheadRef.current) playheadRef.current.style.left = `${time * pps}px`;
      if (clockRef.current) clockRef.current.textContent = `${formatTime(time)} / ${formatTime(duration)}`;
      const scroller = scrollerRef.current;
      if (!playingRef.current || !scroller) return;
      const x = time * pps;
      if (x < scroller.scrollLeft + 28 || x > scroller.scrollLeft + scroller.clientWidth - 28) {
        scroller.scrollLeft = Math.max(0, x - scroller.clientWidth * 0.35);
      }
    });
  }, [engine, pps, duration]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !selectedClipId) return;
    const node = scroller.querySelector(`[data-clip="${CSS.escape(selectedClipId)}"]`);
    if (!(node instanceof HTMLElement)) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    if (nodeRect.left < scrollerRect.left + 28) {
      scroller.scrollLeft -= scrollerRect.left + 28 - nodeRect.left;
    } else if (nodeRect.right > scrollerRect.right - 12) {
      scroller.scrollLeft += nodeRect.right - (scrollerRect.right - 12);
    }
  }, [selectedClipId]);

  function seekAt(clientX: number) {
    const track = trackRef.current;
    if (!engine || !track || recording) return;
    const x = clientX - track.getBoundingClientRect().left;
    engine.seek(Math.max(0, x / pps));
  }

  const firstTick = Math.max(0, Math.floor(scrollLeft / pps) - 1);
  const lastTick = Math.ceil((scrollLeft + viewWidth) / pps) + 1;
  const ticks: number[] = [];
  for (let second = firstTick; second <= lastTick; second += 1) ticks.push(second);

  return (
    <section className="shrink-0 border-t border-border bg-[#141310]">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-label={playing ? "Pausa" : "Play"}
          disabled={!engine || clips.length === 0 || recording}
          onClick={onToggle}
          className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
        >
          {playing ? <Pause className="size-5 fill-current" /> : <Play className="size-5 translate-x-0.5 fill-current" />}
        </button>
        <div className="min-w-0">
          <p className="text-[10px] tracking-[0.16em] text-muted-foreground uppercase">Timeline</p>
          <span ref={clockRef} className="text-sm tabular-nums">
            {formatTime(0)} / {formatTime(duration)}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="Riduci timeline"
            className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
            onClick={() => setPps((value) => Math.max(28, Math.round(value / 1.25)))}
          >
            <ZoomOut className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Ingrandisci timeline"
            className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
            onClick={() => setPps((value) => Math.min(180, Math.round(value * 1.25)))}
          >
            <ZoomIn className="size-4" />
          </button>
        </div>
      </div>
      <div
        ref={scrollerRef}
        className="overflow-x-auto overflow-y-hidden pb-2"
        onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}
      >
        <div className="flex min-w-full">
          <div className="sticky left-0 z-20 w-7 shrink-0 bg-[#141310]">
            <div style={{ height: RULER }} />
            <div className="mt-1 flex items-center justify-center text-[10px] text-muted-foreground" style={{ height: TITLE_H }}>
              T
            </div>
            <div className="mt-1 flex items-center justify-center text-[10px] text-muted-foreground" style={{ height: VIDEO_H }}>
              V
            </div>
          </div>
          <div ref={trackRef} className="relative" style={{ width }}>
            <div
              className="relative touch-none"
              style={{ height: RULER }}
              onPointerDown={(event) => {
                if (recording) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                seekAt(event.clientX);
              }}
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                seekAt(event.clientX);
              }}
            >
              {ticks.map((second) => (
                <div key={second} className="absolute top-0 h-full" style={{ left: second * pps }}>
                  <div className="h-2 w-px bg-border" />
                  <span className="absolute top-2 left-1 text-[10px] text-muted-foreground tabular-nums">
                    {Math.floor(second / 60)}:{String(second % 60).padStart(2, "0")}
                  </span>
                </div>
              ))}
            </div>
            <div className="relative mt-1" style={{ height: TITLE_H }}>
              {titles.map((title) => (
                <button
                  key={title.id}
                  type="button"
                  onClick={() => {
                    onSelectTitle(title.id);
                    engine?.seek(title.start);
                  }}
                  className={cn(
                    "absolute inset-y-0 truncate rounded-md px-2 text-left text-[10px]",
                    title.id === selectedTitleId ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground",
                  )}
                  style={{ left: title.start * pps, width: Math.max(title.duration * pps, 18) }}
                >
                  {title.text || "Titolo"}
                </button>
              ))}
            </div>
            <div className="relative mt-1" style={{ height: VIDEO_H }}>
              {clips.length === 0 ? (
                <div className="flex h-full items-center rounded-xl border border-dashed border-border px-3 text-xs text-muted-foreground">
                  Le clip compariranno qui
                </div>
              ) : (
                clips.map((clip, index) => {
                  const start = clipStart(clips, index);
                  const span = clipTimelineDuration(clip);
                  const selected = clip.id === selectedClipId;
                  return (
                    <button
                      key={clip.id}
                      type="button"
                      data-clip={clip.id}
                      onClick={(event) => {
                        onSelectClip(clip.id);
                        seekAt(event.clientX);
                      }}
                      className={cn(
                        "absolute inset-y-0 overflow-hidden rounded-lg text-left",
                        selected ? "ring-2 ring-primary" : "ring-1 ring-black/40",
                      )}
                      style={{ left: start * pps, width: Math.max(span * pps, 10), background: COLORS[index % COLORS.length] }}
                    >
                      <span className="absolute inset-0 flex">
                        {clip.thumbs.length === 0 ? (
                          <span className="h-full w-full bg-black/15" />
                        ) : (
                          clip.thumbs.map((src, thumbIndex) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={thumbIndex} src={src} alt="" className="h-full min-w-0 flex-1 object-cover" />
                          ))
                        )}
                      </span>
                      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/75 to-transparent px-1.5 py-1 text-[10px] text-white">
                        {clip.name}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <div
              ref={playheadRef}
              className="pointer-events-none absolute top-0 z-10 w-px bg-primary"
              style={{ left: 0, height: RULER + TITLE_H + VIDEO_H + 8 }}
            >
              <div className="absolute -top-0 -left-1.5 size-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-primary" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
