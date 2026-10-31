export type Wheel = { x: number; y: number };

export type Grade = {
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  vignette: number;
  grain: number;
  lift: Wheel;
  gamma: Wheel;
  gain: Wheel;
};

export type Fit = "contain" | "cover";
export type Transition = "cut" | "dissolve";
export type TitleFont = "sans" | "serif" | "condensed";
export type Aspect = "16:9" | "9:16" | "1:1";
export type Quality = "720" | "1080";
export type Tool = "cut" | "color" | "text" | "audio" | "speed" | "export";

export type Clip = {
  id: string;
  name: string;
  url: string;
  duration: number;
  width: number;
  height: number;
  inPoint: number;
  outPoint: number;
  speed: number;
  volume: number;
  muted: boolean;
  fadeIn: number;
  fadeOut: number;
  fit: Fit;
  transition: Transition;
  dissolve: number;
  grade: Grade;
  thumbs: string[];
};

export type TitleCard = {
  id: string;
  text: string;
  start: number;
  duration: number;
  x: number;
  y: number;
  size: number;
  color: string;
  font: TitleFont;
};

export type ClipPatch = Partial<
  Omit<Clip, "id" | "url" | "thumbs" | "duration" | "width" | "height" | "name">
>;

export type TitlePatch = Partial<Omit<TitleCard, "id">>;

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export const TITLE_COLORS = [
  "#F6F1E8",
  "#E4A04A",
  "#1A1916",
  "#F2D7D5",
  "#D7E6F2",
  "#E7F2D7",
] as const;
