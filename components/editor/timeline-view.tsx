"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Flag, Pause, Play, ZoomIn, ZoomOut } from "lucide-react";
import type { PlaybackEngine } from "@/lib/engine";
import { edgePoints, snapTime } from "@/lib/snap";
import { clipStart, clipTimelineDuration, audioDuration } from "@/lib/timeline";
import { formatTime } from "@/lib/time";
import type { AudioClip, Clip, Marker, OverlayClip, TitleCard } from "@/lib/types";
import { cn } from "cn";

const RULER = 26;
const TITLE_H = 20;
const OVER_H = 24;
const VIDEO_H = 58;
const AUDIO_H = 30;
const COLORS = ["#e4a04a", "#79b7c9", "#d9896a", "#8fbf9f", "#cbb27a", "#c58bb3"];

export function TimelineView({
  clips,
  overlays,
  audios,
  titles,
  markers,
  selectedClipId,
  selectedOverlayId,
  selectedAudioId,
  selectedTitleId,
  playing,
  recording,
  duration,
  engine,
  onToggle,
  onSelectClip,
  onSelectOverlay,
  onSelectAudio,
  onSelectTitle,
  onTrim,
  onReorder,
  onMarker,
}: {
  clips: Clip[];
  overlays: OverlayClip[];
  audios: AudioClip[];
  titles: TitleCard[];
  markers: Marker[];
  selectedClipId: string | null;
  selectedOverlayId: string | null;
  selectedAudioId: string | null;
  selectedTitleId: string | null;
  playing: boolean;
  recording: boolean;
  duration: number;
  engine: PlaybackEngine | null;
  onToggle: () => void;
  onSelectClip: (id: string) => void;
  onSelectOverlay: (id: string) => void;
  onSelectAudio: (id: string) => void;
  onSelectTitle: (id: string) => void;
  onTrim: (id: string, edge: "in" | "out", value: number, history: boolean) => void;
  onReorder: (id: string, index: number) => void;
  onMarker: () => void;
}) {
  const [pps, setPps] = useState(64);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewWidth, setViewWidth] = useState(360);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const playingRef = useRef(playing);
  const dragRef = useRef<{ id: string; edge: "in" | "out"; history: boolean; originX: number; origin: number } | null>(null);
  const moveRef = useRef<{ id: string; startX: number; moved: boolean } | null>(null);
  const width = Math.max(duration, 1) * pps + 48;
  const headHeight = RULER + TITLE_H + OVER_H + VIDEO_H + AUDIO_H + 16;

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
    if (nodeRect.left < scrollerRect.left + 28) scroller.scrollLeft -= scrollerRect.left + 28 - nodeRect.left;
    else if (nodeRect.right > scrollerRect.right - 12) scroller.scrollLeft += nodeRect.right - (scrollerRect.right - 12);
  }, [selectedClipId]);

  function timeAt(clientX: number): number {
    const track = trackRef.current;
    if (!track) return 0;
    const x = clientX - track.getBoundingClientRect().left;
    const raw = Math.max(0, x / pps);
    return snapTime(raw, edgePoints(clips, markers), 12 / pps);
  }

  function snappedEdge(raw: number, exclude: number[]): number {
    const points = [...edgePoints(clips, markers), engine?.time ?? raw].filter(
      (point) => !exclude.some((item) => Math.abs(item - point) < 0.04),
    );
    return snapTime(raw, points, 12 / pps);
  }

  function seekAt(clientX: number) {
    if (!engine || recording) return;
    engine.seek(timeAt(clientX));
  }

  function indexAt(clientX: number): number {
    const time = timeAt(clientX);
    let cursor = 0;
    for (let index = 0; index < clips.length; index += 1) {
      const span = clipTimelineDuration(clips[index]);
      if (time < cursor + span / 2) return index;
      cursor += span;
    }
    return Math.max(0, clips.length - 1);
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
            aria-label="Segna o togli il segno"
            disabled={!engine || clips.length === 0 || recording}
            className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-40"
            onClick={onMarker}
          >
            <Flag className="size-4" />
          </button>
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
            <LaneLabel height={TITLE_H}>T</LaneLabel>
            <LaneLabel height={OVER_H}>S</LaneLabel>
            <LaneLabel height={VIDEO_H}>V</LaneLabel>
            <LaneLabel height={AUDIO_H}>A</LaneLabel>
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
              {markers.map((marker) => (
                <button
                  key={marker.id}
                  type="button"
                  title={marker.label}
                  className="absolute top-0 z-10 h-full w-3 -translate-x-1/2"
                  style={{ left: marker.time * pps }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => engine?.seek(marker.time)}
                >
                  <span className="absolute top-0 left-1/2 h-full w-px bg-primary" />
                </button>
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
            <div className="relative mt-1" style={{ height: OVER_H }}>
              {overlays.map((clip) => {
                const span = clipTimelineDuration(clip);
                return (
                  <button
                    key={clip.id}
                    type="button"
                    onClick={() => {
                      onSelectOverlay(clip.id);
                      engine?.seek(clip.start);
                    }}
                    className={cn(
                      "absolute inset-y-0 truncate rounded-md px-1.5 text-left text-[10px] text-white",
                      clip.id === selectedOverlayId ? "bg-primary" : "bg-[#3d6f78]",
                    )}
                    style={{ left: clip.start * pps, width: Math.max(span * pps, 16) }}
                  >
                    {clip.name}
                  </button>
                );
              })}
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
                  const selected = clip.id === selectedClipId && !selectedOverlayId;
                  return (
                    <div
                      key={clip.id}
                      className="absolute inset-y-0"
                      style={{ left: start * pps, width: Math.max(span * pps, 18) }}
                    >
                      <button
                        type="button"
                        data-clip={clip.id}
                        onPointerDown={(event) => {
                          moveRef.current = { id: clip.id, startX: event.clientX, moved: false };
                        }}
                        onPointerMove={(event) => {
                          const drag = moveRef.current;
                          if (!drag || drag.id !== clip.id) return;
                          if (Math.abs(event.clientX - drag.startX) > 8) drag.moved = true;
                        }}
                        onClick={(event) => {
                          const drag = moveRef.current;
                          moveRef.current = null;
                          onSelectClip(clip.id);
                          if (drag?.moved) onReorder(clip.id, indexAt(event.clientX));
                          else seekAt(event.clientX);
                        }}
                        className={cn(
                          "absolute inset-0 overflow-hidden rounded-lg text-left",
                          selected ? "ring-2 ring-primary" : "ring-1 ring-black/40",
                        )}
                        style={{ background: COLORS[index % COLORS.length] }}
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
                          {clip.reverse ? "↺ " : ""}
                          {clip.name}
                        </span>
                        {clip.keyframes.map((key) => (
                          <span
                            key={key.id}
                            className="absolute top-1 size-1.5 -translate-x-1/2 rotate-45 bg-white"
                            style={{ left: Math.max(4, key.time * pps) }}
                          />
                        ))}
                      </button>
                      {selected ? (
                        <>
                          <TrimHandle
                            side="left"
                            onDown={(event) => {
                              event.stopPropagation();
                              dragRef.current = { id: clip.id, edge: "in", history: true, originX: event.clientX, origin: clip.inPoint };
                              event.currentTarget.setPointerCapture(event.pointerId);
                            }}
                            onMove={(event) => {
                              const drag = dragRef.current;
                              if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                              const speed = clip.speed > 0 ? clip.speed : 1;
                              const delta = ((event.clientX - drag.originX) / pps) * speed;
                              const rawIn = drag.origin + delta;
                              const right = start + (clip.outPoint - rawIn) / speed;
                              const snapped = snappedEdge(right, [start, start + span]);
                              onTrim(clip.id, "in", clip.outPoint - (snapped - start) * speed, drag.history);
                              drag.history = false;
                            }}
                          />
                          <TrimHandle
                            side="right"
                            onDown={(event) => {
                              event.stopPropagation();
                              dragRef.current = { id: clip.id, edge: "out", history: true, originX: event.clientX, origin: clip.outPoint };
                              event.currentTarget.setPointerCapture(event.pointerId);
                            }}
                            onMove={(event) => {
                              const drag = dragRef.current;
                              if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                              const speed = clip.speed > 0 ? clip.speed : 1;
                              const track = trackRef.current;
                              const raw = track ? Math.max(0, (event.clientX - track.getBoundingClientRect().left) / pps) : start + span;
                              const snapped = snappedEdge(raw, [start + span]);
                              onTrim(clip.id, "out", clip.inPoint + (snapped - start) * speed, drag.history);
                              drag.history = false;
                            }}
                          />
                        </>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
            <div className="relative mt-1" style={{ height: AUDIO_H }}>
              {audios.map((clip) => {
                const span = audioDuration(clip);
                return (
                  <button
                    key={clip.id}
                    type="button"
                    onClick={() => {
                      onSelectAudio(clip.id);
                      engine?.seek(clip.start);
                    }}
                    className={cn(
                      "absolute inset-y-0 overflow-hidden rounded-md",
                      clip.id === selectedAudioId ? "ring-2 ring-primary" : "ring-1 ring-black/30",
                    )}
                    style={{ left: clip.start * pps, width: Math.max(span * pps, 16), background: "#2a3b32" }}
                  >
                    <span className="absolute inset-0 flex items-end gap-px px-0.5">
                      {(clip.peaks.length ? clip.peaks : [0.2, 0.5, 0.3, 0.6]).map((peak, peakIndex) => (
                        <span
                          key={peakIndex}
                          className="flex-1 rounded-sm bg-[#8fbf9f]"
                          style={{ height: `${Math.max(12, peak * 100)}%` }}
                        />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
            <div
              ref={playheadRef}
              className="pointer-events-none absolute top-0 z-10 w-px bg-primary"
              style={{ left: 0, height: headHeight }}
            >
              <div className="absolute -left-1.5 size-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-primary" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function LaneLabel({ children, height }: { children: string; height: number }) {
  return (
    <div className="mt-1 flex items-center justify-center text-[10px] text-muted-foreground" style={{ height }}>
      {children}
    </div>
  );
}

function TrimHandle({
  side,
  onDown,
  onMove,
}: {
  side: "left" | "right";
  onDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      aria-label={side === "left" ? "Accorcia inizio" : "Accorcia fine"}
      className={cn(
        "absolute top-0 bottom-0 z-10 w-3 touch-none cursor-ew-resize",
        side === "left" ? "left-0" : "right-0",
      )}
      onPointerDown={onDown}
      onPointerMove={onMove}
    >
      <span className={cn("absolute top-1 bottom-1 w-1 rounded-full bg-white", side === "left" ? "left-0.5" : "right-0.5")} />
    </div>
  );
}
