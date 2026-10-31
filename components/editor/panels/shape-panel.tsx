"use client";

import { Button } from "@/components/ui/button";
import { SliderRow } from "@/components/editor/bits";
import { signed } from "@/lib/time";
import { NEUTRAL_TRANSFORM, type Clip, type ClipPatch } from "@/lib/types";

export function ShapePanel({
  clip,
  local,
  onPatch,
  onFreeze,
  onStabilize,
  onOverlay,
  onImportOverlay,
  onKeyframe,
  start,
  duration,
  onStart,
}: {
  clip: Clip;
  local: number;
  onPatch: (patch: ClipPatch, history: boolean) => void;
  onFreeze: () => void;
  onStabilize: () => void;
  onOverlay: () => void;
  onImportOverlay: () => void;
  onKeyframe: () => void;
  start?: number;
  duration?: number;
  onStart?: (start: number, history: boolean) => void;
}) {
  const transform = clip.transform;

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <p className="text-sm font-semibold">Immagine</p>
      <SliderRow
        label="Scala"
        min={0.4}
        max={2.6}
        step={0.01}
        value={transform.scale}
        display={`${Math.round(transform.scale * 100)}%`}
        onChange={(scale, history) => onPatch({ transform: { ...transform, scale } }, history)}
      />
      <SliderRow
        label="Orizzontale"
        min={-0.6}
        max={0.6}
        step={0.01}
        value={transform.x}
        display={signed(transform.x)}
        onChange={(x, history) => onPatch({ transform: { ...transform, x } }, history)}
      />
      <SliderRow
        label="Verticale"
        min={-0.6}
        max={0.6}
        step={0.01}
        value={transform.y}
        display={signed(transform.y)}
        onChange={(y, history) => onPatch({ transform: { ...transform, y } }, history)}
      />
      <SliderRow
        label="Rotazione"
        min={-45}
        max={45}
        step={0.5}
        value={transform.rotate}
        display={`${Math.round(transform.rotate)}°`}
        onChange={(rotate, history) => onPatch({ transform: { ...transform, rotate } }, history)}
      />
      <SliderRow
        label="Opacità"
        min={0}
        max={1}
        step={0.01}
        value={clip.opacity}
        display={`${Math.round(clip.opacity * 100)}%`}
        onChange={(opacity, history) => onPatch({ opacity }, history)}
      />
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" className="h-10" onClick={() => onPatch({ transform: { ...NEUTRAL_TRANSFORM } }, true)}>
          Azzera
        </Button>
        <Button type="button" variant="secondary" className="h-10" onClick={onKeyframe}>
          Fotogramma
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {clip.keyframes.length
          ? `${clip.keyframes.length} fotogrammi. Scala, opacità ed esposizione si interpolano. Istante ${local.toFixed(1)}s.`
          : "Il fotogramma ricorda scala, opacità ed esposizione in questo punto."}
      </p>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>Maschera</span>
        <input
          type="checkbox"
          checked={clip.mask.enabled}
          onChange={(event) => onPatch({ mask: { ...clip.mask, enabled: event.target.checked } }, true)}
        />
      </label>
      {onStart && start !== undefined ? (
        <SliderRow
          label="Inizio sopra"
          min={0}
          max={Math.max(duration ?? start, start, 0.5)}
          step={0.05}
          value={start}
          display={`${start.toFixed(1)}s`}
          onChange={onStart}
        />
      ) : null}
      {clip.mask.enabled ? (
        <div className="space-y-3">
          <SliderRow label="Maschera X" min={0} max={0.8} step={0.01} value={clip.mask.x} display={`${Math.round(clip.mask.x * 100)}%`} onChange={(x, history) => onPatch({ mask: { ...clip.mask, x } }, history)} />
          <SliderRow label="Maschera Y" min={0} max={0.8} step={0.01} value={clip.mask.y} display={`${Math.round(clip.mask.y * 100)}%`} onChange={(y, history) => onPatch({ mask: { ...clip.mask, y } }, history)} />
          <SliderRow label="Larghezza" min={0.1} max={1} step={0.01} value={clip.mask.w} display={`${Math.round(clip.mask.w * 100)}%`} onChange={(w, history) => onPatch({ mask: { ...clip.mask, w } }, history)} />
          <SliderRow label="Altezza" min={0.1} max={1} step={0.01} value={clip.mask.h} display={`${Math.round(clip.mask.h * 100)}%`} onChange={(h, history) => onPatch({ mask: { ...clip.mask, h } }, history)} />
          <SliderRow label="Sfumatura" min={0} max={0.3} step={0.01} value={clip.mask.feather} display={`${Math.round(clip.mask.feather * 100)}`} onChange={(feather, history) => onPatch({ mask: { ...clip.mask, feather } }, history)} />
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant={clip.reverse ? "default" : "outline"} className="h-10" onClick={() => onPatch({ reverse: !clip.reverse }, true)}>
          {clip.reverse ? "Avanti" : "Inverti"}
        </Button>
        <Button type="button" variant="outline" className="h-10" onClick={onFreeze}>
          Fermo immagine
        </Button>
        <Button type="button" variant="outline" className="h-10" onClick={onStabilize}>
          {clip.stab.length ? "Togli stab" : "Stabilizza"}
        </Button>
        <Button type="button" variant="outline" className="h-10" onClick={onOverlay}>
          Metti sopra
        </Button>
        <Button type="button" variant="outline" className="h-10" onClick={onImportOverlay}>
          File sopra
        </Button>
      </div>
      <div className="space-y-2 rounded-xl border border-border p-3">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Chroma key</span>
          <input
            type="checkbox"
            checked={clip.chroma.enabled}
            onChange={(event) => onPatch({ chroma: { ...clip.chroma, enabled: event.target.checked } }, true)}
          />
        </label>
        {clip.chroma.enabled ? (
          <>
            <label className="flex items-center justify-between text-sm">
              Colore
              <input
                type="color"
                value={clip.chroma.color}
                aria-label="Colore da togliere"
                onChange={(event) => onPatch({ chroma: { ...clip.chroma, color: event.target.value } }, true)}
              />
            </label>
            <SliderRow
              label="Tolleranza"
              min={0.05}
              max={1}
              step={0.01}
              value={clip.chroma.similarity}
              display={`${Math.round(clip.chroma.similarity * 100)}`}
              onChange={(similarity, history) => onPatch({ chroma: { ...clip.chroma, similarity } }, history)}
            />
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground">Toglie un fondo, per esempio il verde. Sulla traccia sopra resta il video di sotto.</p>
        )}
      </div>
    </div>
  );
}
