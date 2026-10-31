"use client";

import { useRef } from "react";
import { X } from "lucide-react";
import type { Wheel } from "@/lib/types";

export function ColorWheel({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: Wheel;
  onChange: (value: Wheel, history: boolean) => void;
}) {
  const pad = useRef<HTMLDivElement>(null);
  const history = useRef(false);
  const offset = Math.hypot(value.x, value.y);

  function point(event: { clientX: number; clientY: number }): Wheel {
    const box = pad.current!.getBoundingClientRect();
    const radius = box.width / 2;
    let x = (event.clientX - (box.left + radius)) / radius;
    let y = (box.top + radius - event.clientY) / radius;
    const magnitude = Math.hypot(x, y);
    if (magnitude > 1) {
      x /= magnitude;
      y /= magnitude;
    }
    return { x, y };
  }

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col items-center gap-2">
      <div
        ref={pad}
        aria-label={`${label}, trascina per spostare il colore`}
        className="relative aspect-square w-full max-w-28 touch-none rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
        style={{
          background:
            "radial-gradient(circle, #141311 0 22%, transparent 23%), conic-gradient(from 90deg, #e15b4a, #e4a04a, #d6e07a, #67c17a, #6ec8d6, #6a7de0, #c46ad4, #e15b4a)",
        }}
        onPointerDown={(event) => {
          history.current = false;
          event.currentTarget.setPointerCapture(event.pointerId);
          onChange(point(event), true);
          history.current = true;
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          onChange(point(event), !history.current);
          history.current = true;
        }}
        onDoubleClick={() => onChange({ x: 0, y: 0 }, true)}
      >
        <span
          className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-white/80 shadow"
          style={{
            left: `${((value.x + 1) / 2) * 100}%`,
            top: `${((1 - value.y) / 2) * 100}%`,
          }}
        />
        {offset > 0.04 ? (
          <button
            type="button"
            aria-label={`Azzera ${label}`}
            className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full bg-background text-foreground shadow"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onChange({ x: 0, y: 0 }, true)}
          >
            <X className="size-3" />
          </button>
        ) : null}
      </div>
      <div className="text-center">
        <div className="text-xs font-medium">{label}</div>
        <div className="text-[10px] tracking-wide text-muted-foreground uppercase">{hint}</div>
      </div>
    </div>
  );
}
