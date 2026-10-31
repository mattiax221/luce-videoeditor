"use client";

import { EmptyHint, PanelHeading } from "@/components/editor/bits";
import { clipTimelineDuration } from "@/lib/timeline";
import { formatTime } from "@/lib/time";
import { SPEEDS, type Clip, type ClipPatch } from "@/lib/types";
import { cn } from "cn";

export function SpeedPanel({
  clip,
  onPatch,
}: {
  clip: Clip | null;
  onPatch: (patch: ClipPatch, history: boolean) => void;
}) {
  if (!clip) return <EmptyHint>Seleziona una clip per cambiarne la velocità.</EmptyHint>;
  const timeline = clipTimelineDuration(clip);

  return (
    <div className="space-y-3">
      <PanelHeading title="Velocità" detail={clip.name} />
      <div className="grid grid-cols-3 gap-2">
        {SPEEDS.map((speed) => (
          <button
            key={speed}
            type="button"
            onClick={() => onPatch({ speed }, true)}
            className={cn(
              "h-12 rounded-xl border text-sm font-medium tabular-nums",
              clip.speed === speed ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card",
            )}
          >
            {speed}×
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        In timeline dura {formatTime(timeline)}. L’audio cambia tono insieme alla velocità.
      </p>
    </div>
  );
}
