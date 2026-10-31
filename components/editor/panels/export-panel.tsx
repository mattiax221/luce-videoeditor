"use client";

import { useEffect, useRef } from "react";
import { Download, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelHeading, Segmented } from "@/components/editor/bits";
import { aspectLabel, projectSize } from "@/lib/frame";
import { formatTime } from "@/lib/time";
import type { Aspect, Quality } from "@/lib/types";

export type ExportFile = {
  blob: Blob;
  url: string;
  name: string;
};

export function ExportPanel({
  aspect,
  quality,
  clipCount,
  duration,
  recording,
  progress,
  exported,
  error,
  onQuality,
  onExport,
  onFast,
  fastReady,
  onReset,
  onCancel,
  onDownload,
  onShare,
}: {
  aspect: Aspect;
  quality: Quality;
  clipCount: number;
  duration: number;
  recording: boolean;
  progress: number;
  exported: ExportFile | null;
  error: string | null;
  onQuality: (quality: Quality) => void;
  onExport: () => void;
  onFast: () => void;
  fastReady: boolean;
  onReset: () => void;
  onCancel: () => void;
  onDownload: () => void;
  onShare: () => void;
}) {
  const size = projectSize(aspect, quality);
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exported) return;
    resultRef.current?.scrollIntoView({ block: "nearest" });
  }, [exported]);

  return (
    <div className="space-y-3">
      <PanelHeading title="Esporta" detail={`${size.width}×${size.height}`} />
      <Segmented
        label="Qualità"
        value={quality}
        onChange={onQuality}
        options={[
          { value: "720", label: "720p" },
          { value: "1080", label: "1080p" },
        ]}
      />
      <dl className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Formato" value={aspectLabel(aspect)} />
        <Stat label="Clip" value={String(clipCount)} />
        <Stat label="Durata" value={formatTime(duration)} />
      </dl>
      <p className="text-xs leading-relaxed text-muted-foreground">
        L’esportazione dura quanto il montaggio e resta sul telefono. Tieni la pagina aperta, a schermo acceso.
      </p>
      {duration > 90 ? (
        <p className="text-xs text-primary">Questo montaggio è lungo: l’attesa sarà la stessa della durata.</p>
      ) : null}
      {recording ? (
        <div className="space-y-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span>Esportazione {percent}%</span>
            <button type="button" className="text-destructive" onClick={onCancel}>
              Annulla
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Button type="button" className="h-12 w-full text-base" disabled={clipCount === 0} onClick={onExport}>
            <Download />
            Esporta video
          </Button>
          {fastReady ? (
            <>
              <Button type="button" variant="secondary" className="h-10 w-full" disabled={clipCount === 0} onClick={onFast}>
                Esporta veloce
              </Button>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Esporta veloce scrive un WebM più in fretta del tempo reale, se il browser ha i codec. Se non parte, usa Esporta video.
              </p>
            </>
          ) : null}
          <button type="button" className="w-full text-center text-xs text-muted-foreground" onClick={onReset}>
            Nuovo montaggio
          </button>
        </div>
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {exported ? (
        <div ref={resultRef} className="space-y-2 rounded-xl border border-border bg-background/40 p-2">
          <video src={exported.url} controls playsInline className="max-h-48 w-full rounded-lg bg-black" />
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" className="h-10" onClick={onDownload}>
              <Download />
              Scarica
            </Button>
            <Button type="button" className="h-10" onClick={onShare}>
              <Share2 />
              Condividi
            </Button>
          </div>
          <p className="truncate text-[11px] text-muted-foreground">{exported.name}</p>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted px-2 py-2">
      <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium">{value}</dd>
    </div>
  );
}
