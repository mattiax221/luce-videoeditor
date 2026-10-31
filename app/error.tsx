"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="grid h-dvh place-items-center bg-[#100f0d] px-6 text-[#f6f1e8]">
      <div className="max-w-sm text-center">
        <p className="font-serif text-3xl">Qualcosa si è interrotto</p>
        <p className="mt-2 text-sm text-[#b1aa9e]">Ricarica l’editor. I video non lasciano il telefono.</p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 h-11 rounded-full bg-[#e4a04a] px-5 text-sm font-medium text-[#1c1308]"
        >
          Riprova
        </button>
      </div>
    </div>
  );
}
