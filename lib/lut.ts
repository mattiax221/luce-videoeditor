import type { Lut } from "@/lib/types";

export function parseCube(source: string, id: string, filename: string): Lut | null {
  const lines = source.split(/\r?\n/);
  let size = 0;
  let title = filename.replace(/\.cube$/i, "");
  const values: number[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^TITLE\s+/i.test(line)) {
      title = line.replace(/^TITLE\s+/i, "").replace(/^"|"$/g, "").trim() || title;
      continue;
    }
    if (/^LUT_3D_SIZE\s+/i.test(line)) {
      size = Number(line.split(/\s+/)[1]);
      continue;
    }
    if (/^LUT_1D_SIZE/i.test(line) || /^DOMAIN_/i.test(line)) continue;
    const parts = line.split(/\s+/).map(Number);
    if (parts.length >= 3 && parts.every((part) => Number.isFinite(part))) {
      values.push(parts[0], parts[1], parts[2]);
    }
  }
  if (size < 2 || size > 64) return null;
  const expected = size * size * size * 3;
  if (values.length < expected) return null;
  const data = values.slice(0, expected);
  const peak = data.reduce((max, value) => Math.max(max, value), 0);
  const scale = peak > 1.5 ? 1 / 255 : 1;
  return {
    id,
    name: title.slice(0, 42),
    size,
    data: scale === 1 ? data : data.map((value) => value * scale),
  };
}

export function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.trim().replace("#", "");
  const full = cleaned.length === 3 ? cleaned.split("").map((char) => char + char).join("") : cleaned;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value) || full.length !== 6) return [0, 1, 0];
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
