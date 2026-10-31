"use client";

import { Button } from "@/components/ui/button";

import { EmptyHint, PanelHeading, SliderRow } from "@/components/editor/bits";
import { ColorWheel } from "@/components/editor/color-wheel";
import { ScopesView } from "@/components/editor/scopes-view";
import { GRADE_PRESETS, NEUTRAL_GRADE, cloneGrade } from "@/lib/grade";
import { signed } from "@/lib/time";
import type { Clip, ClipPatch, Grade, Lut, Wheel } from "@/lib/types";

export function ColorPanel({
  clip,
  frame,
  luts,
  canPaste,
  onPatch,
  onApplyAll,
  onCopy,
  onPaste,
  onLut,
  onClearLut,
  onKeyframe,
}: {
  clip: Clip | null;
  frame: HTMLCanvasElement | null;
  luts: Lut[];
  canPaste: boolean;
  onPatch: (patch: ClipPatch, history: boolean) => void;
  onApplyAll: (grade: Grade) => void;
  onCopy: () => void;
  onPaste: () => void;
  onLut: (file: File) => void;
  onClearLut: () => void;
  onKeyframe: () => void;
}) {
  if (!clip) return <EmptyHint>Seleziona una clip per correggere il colore.</EmptyHint>;
  const grade = clip.grade;

  function setGrade(partial: Partial<Grade>, history: boolean) {
    onPatch({ grade: { ...grade, ...partial } }, history);
  }

  function setWheel(key: "lift" | "gamma" | "gain", value: Wheel, history: boolean) {
    setGrade({ [key]: value }, history);
  }

  return (
    <div className="space-y-4">
      <PanelHeading title="Colore" detail={clip.name} />
      <ScopesView source={frame} />
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {GRADE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onPatch({ grade: cloneGrade(preset.grade) }, true)}
            className="w-16 shrink-0 text-left"
          >
            <span className="block h-9 rounded-lg border border-white/10" style={{ background: preset.swatch }} />
            <span className="mt-1 block truncate text-[10px] text-muted-foreground">{preset.name}</span>
          </button>
        ))}
      </div>
      <div className="flex items-start justify-between gap-3">
        <ColorWheel label="Ombre" hint="Lift" value={grade.lift} onChange={(value, history) => setWheel("lift", value, history)} />
        <ColorWheel label="Mezzi" hint="Gamma" value={grade.gamma} onChange={(value, history) => setWheel("gamma", value, history)} />
        <ColorWheel label="Luci" hint="Gain" value={grade.gain} onChange={(value, history) => setWheel("gain", value, history)} />
      </div>
      <div className="space-y-3">
        <SliderRow label="Esposizione" min={-1.5} max={1.5} step={0.01} value={grade.exposure} display={`${signed(grade.exposure)} EV`} onChange={(exposure, history) => setGrade({ exposure }, history)} />
        <SliderRow label="Contrasto" min={0.6} max={1.7} step={0.01} value={grade.contrast} display={`${Math.round(grade.contrast * 100)}%`} onChange={(contrast, history) => setGrade({ contrast }, history)} />
        <SliderRow label="Saturazione" min={0} max={2} step={0.01} value={grade.saturation} display={`${Math.round(grade.saturation * 100)}%`} onChange={(saturation, history) => setGrade({ saturation }, history)} />
        <SliderRow label="Temperatura" min={-1} max={1} step={0.01} value={grade.temperature} display={signed(grade.temperature)} onChange={(temperature, history) => setGrade({ temperature }, history)} />
        <SliderRow label="Tinta" min={-1} max={1} step={0.01} value={grade.tint} display={signed(grade.tint)} onChange={(tint, history) => setGrade({ tint }, history)} />
        <SliderRow label="Vignettatura" min={0} max={1} step={0.01} value={grade.vignette} display={`${Math.round(grade.vignette * 100)}%`} onChange={(vignette, history) => setGrade({ vignette }, history)} />
        <SliderRow label="Grana" min={0} max={1} step={0.01} value={grade.grain} display={`${Math.round(grade.grain * 100)}%`} onChange={(grain, history) => setGrade({ grain }, history)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" className="h-10" onClick={() => onPatch({ grade: cloneGrade(NEUTRAL_GRADE) }, true)}>
          Reimposta
        </Button>
        <Button type="button" variant="secondary" className="h-10" onClick={() => onApplyAll(grade)}>
          Applica a tutte
        </Button>
        <Button type="button" variant="outline" className="h-10" onClick={onCopy}>
          Copia
        </Button>
        <Button type="button" variant="outline" className="h-10" disabled={!canPaste} onClick={onPaste}>
          Incolla
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <label className="flex h-10 flex-1 cursor-pointer items-center justify-center rounded-lg border border-border text-sm">
          LUT
          <input
            type="file"
            accept=".cube,text/plain"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onLut(file);
            }}
          />
        </label>
        <Button type="button" variant="secondary" className="h-10 flex-1" onClick={onKeyframe}>
          Fotogramma
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {luts.map((lut) => (
          <button
            key={lut.id}
            type="button"
            onClick={() => onPatch({ lutId: clip.lutId === lut.id ? null : lut.id }, true)}
            className={`rounded-full border px-3 py-1 text-xs ${clip.lutId === lut.id ? "border-primary bg-primary/15" : "border-border text-muted-foreground"}`}
          >
            {lut.name}
          </button>
        ))}
        {clip.lutId ? (
          <button type="button" className="text-xs text-muted-foreground" onClick={onClearLut}>
            Togli LUT
          </button>
        ) : null}
      </div>
    </div>
  );
}
