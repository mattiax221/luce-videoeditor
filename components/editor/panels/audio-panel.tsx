"use client";

import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyHint, PanelHeading, SliderRow } from "@/components/editor/bits";
import { clipTimelineDuration } from "@/lib/timeline";
import { formatTime } from "@/lib/time";
import type { Clip, ClipPatch } from "@/lib/types";

export function AudioPanel({
  clip,
  onPatch,
}: {
  clip: Clip | null;
  onPatch: (patch: ClipPatch, history: boolean) => void;
}) {
  if (!clip) return <EmptyHint>Seleziona una clip per il volume e le dissolvenze.</EmptyHint>;
  const dur = clipTimelineDuration(clip);
  const fadeMax = Math.max(0, Math.min(2, dur / 2));

  return (
    <div className="space-y-4">
      <PanelHeading title="Audio" detail={clip.name} />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant={clip.muted ? "destructive" : "secondary"}
          className="h-10"
          onClick={() => onPatch({ muted: !clip.muted }, true)}
        >
          {clip.muted ? <VolumeX /> : <Volume2 />}
          {clip.muted ? "Riattiva" : "Silenzia"}
        </Button>
        <p className="text-xs text-muted-foreground">Il volume segue anche la dissolvenza video.</p>
      </div>
      <SliderRow
        label="Volume"
        min={0}
        max={1}
        step={0.01}
        value={clip.volume}
        display={`${Math.round(clip.volume * 100)}%`}
        disabled={clip.muted}
        onChange={(volume, history) => onPatch({ volume }, history)}
      />
      <SliderRow
        label="Fade in"
        min={0}
        max={Math.max(0.05, fadeMax)}
        step={0.05}
        value={Math.min(clip.fadeIn, fadeMax)}
        display={formatTime(clip.fadeIn)}
        disabled={fadeMax <= 0}
        onChange={(fadeIn, history) => onPatch({ fadeIn }, history)}
      />
      <SliderRow
        label="Fade out"
        min={0}
        max={Math.max(0.05, fadeMax)}
        step={0.05}
        value={Math.min(clip.fadeOut, fadeMax)}
        display={formatTime(clip.fadeOut)}
        disabled={fadeMax <= 0}
        onChange={(fadeOut, history) => onPatch({ fadeOut }, history)}
      />
    </div>
  );
}
