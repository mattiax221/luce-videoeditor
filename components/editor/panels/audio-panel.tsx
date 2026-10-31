"use client";

import { Mic, Square, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyHint, PanelHeading, SliderRow } from "@/components/editor/bits";
import { audioDuration, clipTimelineDuration } from "@/lib/timeline";
import { formatTime } from "@/lib/time";
import type { AudioClip, AudioPatch, Clip, ClipPatch } from "@/lib/types";
import { cn } from "cn";

export function AudioPanel({
  clip,
  audios,
  selectedAudioId,
  recording,
  onPatch,
  onSelectAudio,
  onPatchAudio,
  onDeleteAudio,
  onImport,
  onRecord,
}: {
  clip: Clip | null;
  audios: AudioClip[];
  selectedAudioId: string | null;
  recording: boolean;
  onPatch: (patch: ClipPatch, history: boolean) => void;
  onSelectAudio: (id: string) => void;
  onPatchAudio: (id: string, patch: AudioPatch, history: boolean) => void;
  onDeleteAudio: (id: string) => void;
  onImport: () => void;
  onRecord: () => void;
}) {
  const selected = audios.find((item) => item.id === selectedAudioId) ?? null;
  const dur = clip ? clipTimelineDuration(clip) : 0;
  const fadeMax = Math.max(0, Math.min(2, dur / 2));

  return (
    <div className="space-y-4">
      <PanelHeading title="Audio" detail={clip?.name ?? "Tracce"} />
      {clip ? (
        <>
          <div className="flex items-center gap-2">
            <Button type="button" variant={clip.muted ? "destructive" : "secondary"} className="h-10" onClick={() => onPatch({ muted: !clip.muted }, true)}>
              {clip.muted ? <VolumeX /> : <Volume2 />}
              {clip.muted ? "Riattiva" : "Silenzia"}
            </Button>
            <p className="text-xs text-muted-foreground">Volume del video selezionato.</p>
          </div>
          <SliderRow label="Volume" min={0} max={1} step={0.01} value={clip.volume} display={`${Math.round(clip.volume * 100)}%`} disabled={clip.muted} onChange={(volume, history) => onPatch({ volume }, history)} />
          <SliderRow label="Fade in" min={0} max={Math.max(0.05, fadeMax)} step={0.05} value={Math.min(clip.fadeIn, fadeMax)} display={formatTime(clip.fadeIn)} disabled={fadeMax <= 0} onChange={(fadeIn, history) => onPatch({ fadeIn }, history)} />
          <SliderRow label="Fade out" min={0} max={Math.max(0.05, fadeMax)} step={0.05} value={Math.min(clip.fadeOut, fadeMax)} display={formatTime(clip.fadeOut)} disabled={fadeMax <= 0} onChange={(fadeOut, history) => onPatch({ fadeOut }, history)} />
        </>
      ) : (
        <EmptyHint>Seleziona una clip per il suo volume, oppure aggiungi una traccia sotto.</EmptyHint>
      )}
      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-sm font-semibold">Tracce</p>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" className="h-10" onClick={onImport}>
            Aggiungi audio
          </Button>
          <Button type="button" variant={recording ? "destructive" : "outline"} className="h-10" onClick={onRecord}>
            {recording ? <Square /> : <Mic />}
            {recording ? "Stop" : "Registra"}
          </Button>
        </div>
        {audios.length === 0 ? <p className="text-[11px] text-muted-foreground">Una canzone o una voce stanno su una traccia a parte, con la forma d’onda.</p> : null}
        <div className="flex gap-2 overflow-x-auto">
          {audios.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectAudio(item.id)}
              className={cn(
                "max-w-36 shrink-0 truncate rounded-full border px-3 py-1 text-xs",
                item.id === selectedAudioId ? "border-primary bg-primary/15" : "border-border text-muted-foreground",
              )}
            >
              {item.name}
            </button>
          ))}
        </div>
        {selected ? (
          <div className="space-y-3">
            <SliderRow label="Volume traccia" min={0} max={1} step={0.01} value={selected.volume} display={`${Math.round(selected.volume * 100)}%`} onChange={(volume, history) => onPatchAudio(selected.id, { volume }, history)} />
            <SliderRow label="Inizio traccia" min={0} max={Math.max(durationSafe(selected), 30)} step={0.05} value={selected.start} display={formatTime(selected.start)} onChange={(start, history) => onPatchAudio(selected.id, { start }, history)} />
            <p className="text-[11px] text-muted-foreground">Durata {formatTime(audioDuration(selected))}.</p>
            <Button type="button" variant="destructive" className="h-10 w-full" onClick={() => onDeleteAudio(selected.id)}>
              Elimina traccia
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function durationSafe(clip: AudioClip): number {
  return Math.max(clip.start + 8, audioDuration(clip));
}
