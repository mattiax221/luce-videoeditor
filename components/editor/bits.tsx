"use client";

import { useRef, type ReactNode } from "react";
import { Slider } from "@/components/ui/slider";
import { cn } from "cn";

export function PanelHeading({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {detail ? <p className="truncate text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-muted p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex h-9 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors",
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  disabled?: boolean;
  onChange: (value: number, history: boolean) => void;
}) {
  const armed = useRef(false);
  const timer = useRef(0);

  return (
    <label
      className={cn("grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5", disabled && "opacity-40")}
      onPointerDownCapture={() => {
        armed.current = false;
      }}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs tabular-nums text-foreground/90">{display}</span>
      <Slider
        className="col-span-2"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={[value]}
        onValueChange={(next) => {
          const amount = next[0];
          if (amount === undefined) return;
          onChange(amount, !armed.current);
          armed.current = true;
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => {
            armed.current = false;
          }, 450);
        }}
      />
    </label>
  );
}

export function EmptyHint({ children }: { children: string }) {
  return <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">{children}</p>;
}
