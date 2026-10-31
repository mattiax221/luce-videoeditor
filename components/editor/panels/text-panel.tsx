"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyHint, PanelHeading, SliderRow } from "@/components/editor/bits";
import { formatTime } from "@/lib/time";
import { TITLE_COLORS, type TitleCard, type TitleFont, type TitlePatch } from "@/lib/types";
import { cn } from "cn";
import { useRef } from "react";

const FONTS: { id: TitleFont; label: string; className: string }[] = [
  { id: "sans", label: "Sans", className: "font-sans" },
  { id: "serif", label: "Serif", className: "font-serif" },
  { id: "condensed", label: "Stretto", className: "font-condensed" },
];

export function TextPanel({
  titles,
  selectedId,
  duration,
  time,
  onAdd,
  onSelect,
  onPatch,
  onDelete,
}: {
  titles: TitleCard[];
  selectedId: string | null;
  duration: number;
  time: number;
  onAdd: () => void;
  onSelect: (id: string) => void;
  onPatch: (id: string, patch: TitlePatch, history: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const typing = useRef(false);
  const selected = titles.find((title) => title.id === selectedId) ?? null;

  return (
    <div className="space-y-3">
      <PanelHeading title="Testo" detail={titles.length ? `${titles.length} titoli` : "Nessuno"} />
      <Button type="button" className="h-11 w-full" onClick={onAdd} disabled={duration <= 0}>
        Aggiungi titolo sul cursore
      </Button>
      {duration <= 0 ? <EmptyHint>Prima serve un video in timeline.</EmptyHint> : null}
      {titles.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {titles.map((title, index) => (
            <button
              key={title.id}
              type="button"
              onClick={() => onSelect(title.id)}
              className={cn(
                "max-w-40 shrink-0 truncate rounded-full border px-3 py-1.5 text-xs",
                title.id === selectedId ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground",
              )}
            >
              {index + 1}. {title.text || "Titolo"}
            </button>
          ))}
        </div>
      ) : null}
      {selected ? (
        <div className="space-y-3">
          <Input
            value={selected.text}
            aria-label="Testo del titolo"
            maxLength={80}
            className="h-11"
            onChange={(event) => {
              onPatch(selected.id, { text: event.target.value }, !typing.current);
              typing.current = true;
            }}
            onBlur={() => {
              typing.current = false;
              if (!selected.text.trim()) onPatch(selected.id, { text: "Titolo" }, false);
            }}
          />
          <div className="flex gap-2">
            {FONTS.map((font) => (
              <button
                key={font.id}
                type="button"
                onClick={() => onPatch(selected.id, { font: font.id }, true)}
                className={cn(
                  "h-9 flex-1 rounded-lg border text-sm",
                  font.className,
                  selected.font === font.id ? "border-primary bg-primary/15" : "border-border",
                )}
              >
                {font.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {TITLE_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Colore ${color}`}
                onClick={() => onPatch(selected.id, { color }, true)}
                className={cn(
                  "size-8 rounded-full border",
                  selected.color === color ? "border-primary ring-2 ring-primary/50" : "border-white/20",
                )}
                style={{ background: color }}
              />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              ["Alto", 0.18],
              ["Centro", 0.5],
              ["Basso", 0.82],
            ].map(([label, y]) => (
              <Button
                key={label}
                type="button"
                variant="outline"
                className="h-9"
                onClick={() => onPatch(selected.id, { y: Number(y) }, true)}
              >
                {label}
              </Button>
            ))}
          </div>
          <SliderRow
            label="Dimensione"
            min={28}
            max={120}
            step={1}
            value={selected.size}
            display={`${Math.round(selected.size)}`}
            onChange={(size, history) => onPatch(selected.id, { size }, history)}
          />
          <SliderRow
            label="Inizio"
            min={0}
            max={Math.max(0, duration)}
            step={0.05}
            value={Math.min(selected.start, duration)}
            display={formatTime(selected.start)}
            onChange={(start, history) => onPatch(selected.id, { start }, history)}
          />
          <SliderRow
            label="Durata"
            min={0.2}
            max={8}
            step={0.05}
            value={selected.duration}
            display={formatTime(selected.duration)}
            onChange={(length, history) => onPatch(selected.id, { duration: length }, history)}
          />
          <Button type="button" variant="secondary" className="h-10 w-full" onClick={() => onPatch(selected.id, { start: time }, true)}>
            Sposta all’istante {formatTime(time)}
          </Button>
          <Button type="button" variant="destructive" className="h-10 w-full" onClick={() => onDelete(selected.id)}>
            <Trash2 />
            Elimina titolo
          </Button>
          <p className="text-[11px] text-muted-foreground">Trascina il titolo sull’anteprima per spostarlo.</p>
        </div>
      ) : null}
    </div>
  );
}
