"use client";

import { useEffect, useRef } from "react";
import { renderScopes } from "@/lib/scopes";

export function ScopesView({ source }: { source: HTMLCanvasElement | null }) {
  const waveRef = useRef<HTMLCanvasElement>(null);
  const scopeRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let timer = 0;
    const tick = () => {
      const wave = waveRef.current?.getContext("2d");
      const scope = scopeRef.current?.getContext("2d");
      if (source && wave && scope) {
        const sample = document.createElement("canvas");
        sample.width = 96;
        sample.height = 54;
        const context = sample.getContext("2d", { willReadFrequently: true });
        if (context) {
          context.drawImage(source, 0, 0, sample.width, sample.height);
          const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
          renderScopes(pixels, sample.width, sample.height, wave, scope);
        }
      }
      timer = window.setTimeout(tick, 320);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [source]);

  return (
    <div className="grid grid-cols-2 gap-2">
      <figure>
        <canvas ref={waveRef} width={120} height={72} className="h-16 w-full rounded-lg bg-black" />
        <figcaption className="mt-1 text-[10px] text-muted-foreground">Forma d’onda</figcaption>
      </figure>
      <figure>
        <canvas ref={scopeRef} width={96} height={96} className="mx-auto h-16 w-16 rounded-lg bg-black" />
        <figcaption className="mt-1 text-center text-[10px] text-muted-foreground">Vettorscopio</figcaption>
      </figure>
    </div>
  );
}
