import { clamp } from "@/lib/time";
import type { Grade, Wheel } from "@/lib/types";

export type Vec3 = [number, number, number];

export const NEUTRAL_GRADE: Grade = {
  exposure: 0,
  contrast: 1,
  saturation: 1,
  temperature: 0,
  tint: 0,
  vignette: 0,
  grain: 0,
  lift: { x: 0, y: 0 },
  gamma: { x: 0, y: 0 },
  gain: { x: 0, y: 0 },
};

export function cloneGrade(grade: Grade): Grade {
  return {
    ...grade,
    lift: { ...grade.lift },
    gamma: { ...grade.gamma },
    gain: { ...grade.gain },
  };
}

export function gradesEqual(a: Grade, b: Grade): boolean {
  return (
    a.exposure === b.exposure &&
    a.contrast === b.contrast &&
    a.saturation === b.saturation &&
    a.temperature === b.temperature &&
    a.tint === b.tint &&
    a.vignette === b.vignette &&
    a.grain === b.grain &&
    a.lift.x === b.lift.x &&
    a.lift.y === b.lift.y &&
    a.gamma.x === b.gamma.x &&
    a.gamma.y === b.gamma.y &&
    a.gain.x === b.gain.x &&
    a.gain.y === b.gain.y
  );
}

function hslToRgb(h: number, s: number, l: number): Vec3 {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [f(0), f(8), f(4)];
}

/** Clockwise hue, matching the on-screen wheel. Center is zero. */
export function polarOffset(x: number, y: number): Vec3 {
  const radius = Math.min(1, Math.hypot(x, y));
  if (radius < 0.001) return [0, 0, 0];
  const hue = ((Math.atan2(-y, x) / (Math.PI * 2)) + 1) % 1;
  const [r, g, b] = hslToRgb(hue, 1, 0.5);
  return [(r - 0.5) * 2 * radius, (g - 0.5) * 2 * radius, (b - 0.5) * 2 * radius];
}

export function gradeVectors(grade: Grade): { lift: Vec3; gamma: Vec3; gain: Vec3 } {
  const lift = polarOffset(grade.lift.x, grade.lift.y);
  const gamma = polarOffset(grade.gamma.x, grade.gamma.y);
  const gain = polarOffset(grade.gain.x, grade.gain.y);
  return {
    lift: [lift[0] * 0.22, lift[1] * 0.22, lift[2] * 0.22],
    gamma: [
      clamp(1 + gamma[0] * 0.4, 0.25, 2.6),
      clamp(1 + gamma[1] * 0.4, 0.25, 2.6),
      clamp(1 + gamma[2] * 0.4, 0.25, 2.6),
    ],
    gain: [
      clamp(1 + gain[0] * 0.65, 0, 2.8),
      clamp(1 + gain[1] * 0.65, 0, 2.8),
      clamp(1 + gain[2] * 0.65, 0, 2.8),
    ],
  };
}

export function cssFilter(grade: Grade): string {
  const brightness = 2 ** grade.exposure;
  const hue = grade.temperature * -18 + grade.tint * 12;
  return `brightness(${brightness}) contrast(${grade.contrast}) saturate(${grade.saturation}) hue-rotate(${hue}deg)`;
}

function withWheel(partial: Partial<Grade> & { lift?: Wheel; gamma?: Wheel; gain?: Wheel }): Grade {
  return {
    ...NEUTRAL_GRADE,
    ...partial,
    lift: partial.lift ?? { x: 0, y: 0 },
    gamma: partial.gamma ?? { x: 0, y: 0 },
    gain: partial.gain ?? { x: 0, y: 0 },
  };
}

export type GradePreset = {
  id: string;
  name: string;
  swatch: string;
  grade: Grade;
};

export const GRADE_PRESETS: GradePreset[] = [
  {
    id: "neutral",
    name: "Neutro",
    swatch: "linear-gradient(135deg,#6b675f,#e6e0d6)",
    grade: withWheel({}),
  },
  {
    id: "cinema",
    name: "Cinema",
    swatch: "linear-gradient(135deg,#1c2430,#c7a36a)",
    grade: withWheel({
      exposure: -0.08,
      contrast: 1.16,
      saturation: 0.86,
      temperature: 0.1,
      vignette: 0.42,
      grain: 0.14,
      lift: { x: -0.22, y: -0.04 },
      gain: { x: 0.28, y: 0.1 },
    }),
  },
  {
    id: "teal",
    name: "Teal Orange",
    swatch: "linear-gradient(135deg,#1f6f78,#e08a3c)",
    grade: withWheel({
      contrast: 1.14,
      saturation: 1.1,
      temperature: 0.14,
      vignette: 0.26,
      lift: { x: -0.48, y: 0.08 },
      gain: { x: 0.58, y: 0.18 },
    }),
  },
  {
    id: "pellicola",
    name: "Pellicola",
    swatch: "linear-gradient(135deg,#6a4a32,#e6d2a8)",
    grade: withWheel({
      exposure: 0.06,
      contrast: 1.06,
      saturation: 0.76,
      temperature: 0.32,
      vignette: 0.36,
      grain: 0.48,
      lift: { x: 0.14, y: 0.04 },
    }),
  },
  {
    id: "notte",
    name: "Notte",
    swatch: "linear-gradient(135deg,#0e1b33,#6f8cae)",
    grade: withWheel({
      exposure: -0.28,
      contrast: 1.2,
      saturation: 0.9,
      temperature: -0.48,
      tint: 0.08,
      vignette: 0.55,
      lift: { x: -0.18, y: 0.16 },
    }),
  },
  {
    id: "caldo",
    name: "Caldo",
    swatch: "linear-gradient(135deg,#c47a3a,#f3d2a4)",
    grade: withWheel({
      exposure: 0.08,
      contrast: 1.04,
      saturation: 1.08,
      temperature: 0.58,
      gain: { x: 0.22, y: 0.06 },
    }),
  },
  {
    id: "freddo",
    name: "Freddo",
    swatch: "linear-gradient(135deg,#8eb4d4,#e7eef5)",
    grade: withWheel({
      contrast: 1.05,
      saturation: 0.94,
      temperature: -0.55,
      tint: 0.06,
    }),
  },
  {
    id: "bn",
    name: "Bianco e nero",
    swatch: "linear-gradient(135deg,#161616,#f3f3f3)",
    grade: withWheel({
      saturation: 0,
      contrast: 1.18,
      vignette: 0.32,
      grain: 0.22,
    }),
  },
  {
    id: "vivace",
    name: "Vivace",
    swatch: "linear-gradient(135deg,#ef5d5d,#f2c14e 55%,#3db8c7)",
    grade: withWheel({
      exposure: 0.06,
      contrast: 1.1,
      saturation: 1.45,
    }),
  },
  {
    id: "pastello",
    name: "Pastello",
    swatch: "linear-gradient(135deg,#f3c1c8,#f7e1b5 50%,#c9e4ef)",
    grade: withWheel({
      exposure: 0.18,
      contrast: 0.86,
      saturation: 0.7,
      temperature: 0.12,
    }),
  },
  {
    id: "contrasto",
    name: "Contrasto",
    swatch: "linear-gradient(135deg,#111,#eee)",
    grade: withWheel({
      contrast: 1.42,
      saturation: 1.04,
      vignette: 0.18,
    }),
  },
];
