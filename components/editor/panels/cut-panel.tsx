"use client";

import { Copy, Scissors, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyHint, PanelHeading, Segmented, SliderRow } from "@/components/editor/bits";
import { SourceTrim } from "@/components/editor/source-trim";
import { clipStart, playheadInside } from "@/lib/timeline";
import { formatTime } from "@/lib/time";
import type { Clip, ClipPatch } from "@/lib/types";

export function CutPanel({
  clips,
  clip,
  time,
  canSplitNow,
  onSplit,
  onDelete,
  onDuplicate,
  onMove,
  onTrim,
  onPatch,
  onEdge,
}: {
  clips: Clip[];
  clip: Clip | null;
  time: number;
  canSplitNow: boolean;
  onSplit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (dir: -1 | 1) => void;
  onTrim: (edge: "in" | "out") => void;
  onPatch: (patch: ClipPatch, history: boolean) => void;
  onEdge: (edge: "in" | "out", value: number, history: boolean) => void;
}) {
  if (!clip) return <EmptyHint>Apri un video o genera le clip di prova.</EmptyHint>;
  const index = clips.findIndex((item) => item.id === clip.id);
  const inside = playheadInside(clips, clip.id, time);
  const start = index >= 0 ? clipStart(clips, index) : 0;
  const local = time - start;
  const speed = clip.speed > 0 ? clip.speed : 1;
  const sourceMark = inside
    ? clip.reverse
      ? clip.outPoint - Math.max(0, local) * speed
      : clip.inPoint + Math.max(0, local) * speed
    : null;

  return (
    <div className="space-y-3">
      <PanelHeading title="Taglio" detail={clip.name} />
      <SourceTrim clip={clip} sourceMark={sourceMark} onEdge={onEdge} />
      <Button type="button" className="h-11 w-full" onClick={onSplit} disabled={!canSplitNow}>
        <Scissors />
        Dividi al cursore
      </Button>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" className="h-10" disabled={!inside} onClick={() => onTrim("in")}>
          Taglia inizio
        </Button>
        <Button type="button" variant="secondary" className="h-10" disabled={!inside} onClick={() => onTrim("out")}>
          Taglia fine
        </Button>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <Button type="button" variant="outline" className="h-10" disabled={index <= 0} onClick={() => onMove(-1)}>
          Prima
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10"
          disabled={index < 0 || index >= clips.length - 1}
          onClick={() => onMove(1)}
        >
          Dopo
        </Button>
        <Button type="button" variant="outline" className="h-10" onClick={onDuplicate} aria-label="Duplica">
          <Copy />
        </Button>
        <Button type="button" variant="destructive" className="h-10" onClick={onDelete} aria-label="Elimina">
          <Trash2 />
        </Button>
      </div>
      <Segmented
        label="Transizione in entrata"
        value={clip.transition}
        onChange={(transition) => onPatch({ transition }, true)}
        options={[
          { value: "cut", label: "Secco" },
          { value: "dissolve", label: "Nero" },
          { value: "cross", label: "Mix" },
        ]}
      />
      {clip.transition !== "cut" ? (
        <SliderRow
          label={clip.transition === "cross" ? "Durata mix" : "Durata al nero"}
          min={0.15}
          max={1.5}
          step={0.05}
          value={clip.dissolve}
          display={formatTime(clip.dissolve)}
          onChange={(dissolve, history) => onPatch({ dissolve }, history)}
        />
      ) : null}
      <Segmented
        label="Inquadratura"
        value={clip.fit}
        onChange={(fit) => onPatch({ fit }, true)}
        options={[
          { value: "contain", label: "Adatta" },
          { value: "cover", label: "Riempi" },
        ]}
      />
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        I inizio · O fine · S dividi · Spazio play. Trascina i bordi della clip. Nero chiude in nero, Mix fonde con la clip dopo.
        {sourceMark !== null ? ` Cursore a ${formatTime(local)} nella clip.` : ""}
      </p>
    </div>
  );
}
