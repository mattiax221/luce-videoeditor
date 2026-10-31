export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const totalTenths = Math.floor(safe * 10 + 1e-6);
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const secs = totalSeconds % 60;
  const mins = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (value: number) => value.toString().padStart(2, "0");
  if (hours > 0) return `${hours}:${pad(mins)}:${pad(secs)}`;
  return `${pad(mins)}:${pad(secs)}.${tenths}`;
}

export function signed(value: number, digits = 2): string {
  const text = value.toFixed(digits);
  return value > 0 ? `+${text}` : text;
}

export function uid(): string {
  return crypto.randomUUID();
}

export function clipLabel(filename: string): string {
  const trimmed = filename.replace(/\.[^.]+$/, "").trim();
  return trimmed || "Clip";
}

export function exportFilename(ext: string): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `luce-${get("year")}${get("month")}${get("day")}-${get("hour")}${get("minute")}.${ext}`;
}
