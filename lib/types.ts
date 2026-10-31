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
export type Transition = "cut" | "dissolve" | "cross";
export type TitleFont = "sans" | "serif" | "condensed";
export type TitleAlign = "left" | "center" | "right";
export type TitleMotion = "none" | "fade" | "rise";
export type Aspect = "16:9" | "9:16" | "1:1";
export type Quality = "720" | "1080";
export type Tool = "cut" | "color" | "text" | "audio" | "speed" | "export";
export type MediaKind = "video" | "image";

export type Transform = { x: number; y: number; scale: number; rotate: number };

export type Mask = {
  enabled: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  feather: number;
};

export type Chroma = {
  enabled: boolean;
  color: string;
  similarity: number;
  smoothness: number;
};

export type StabSample = { t: number; x: number; y: number };

export type Keyframe = {
  id: string;
  time: number;
  opacity?: number;
  scale?: number;
  exposure?: number;
};

export type Lut = {
  id: string;
  name: string;
  size: number;
  data: number[];
};

export type Clip = {
  id: string;
  mediaId: string;
  name: string;
  url: string;
  kind: MediaKind;
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
  reverse: boolean;
  opacity: number;
  grade: Grade;
  transform: Transform;
  mask: Mask;
  chroma: Chroma;
  lutId: string | null;
  keyframes: Keyframe[];
  stab: StabSample[];
  thumbs: string[];
};

export type OverlayClip = Clip & { start: number };

export type AudioClip = {
  id: string;
  mediaId: string;
  name: string;
  url: string;
  duration: number;
  inPoint: number;
  outPoint: number;
  start: number;
  volume: number;
  muted: boolean;
  fadeIn: number;
  fadeOut: number;
  peaks: number[];
};

export type Marker = {
  id: string;
  time: number;
  label: string;
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
  align: TitleAlign;
  background: string | null;
  stroke: boolean;
  enter: TitleMotion;
  exit: TitleMotion;
};

export type ClipPatch = Partial<Omit<Clip, "id" | "url" | "thumbs" | "duration" | "width" | "height" | "name" | "mediaId">>;

export type TitlePatch = Partial<Omit<TitleCard, "id">>;

export type AudioPatch = Partial<Omit<AudioClip, "id" | "url" | "mediaId" | "name" | "duration" | "peaks">>;

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export const TITLE_COLORS = ["#F6F1E8", "#E4A04A", "#1A1916", "#F2D7D5", "#D7E6F2", "#E7F2D7"] as const;

export const NEUTRAL_TRANSFORM: Transform = { x: 0, y: 0, scale: 1, rotate: 0 };

export const NEUTRAL_MASK: Mask = { enabled: false, x: 0.12, y: 0.12, w: 0.76, h: 0.76, feather: 0.08 };

export const NEUTRAL_CHROMA: Chroma = { enabled: false, color: "#00ff00", similarity: 0.42, smoothness: 0.14 };

export const PIP_TRANSFORM: Transform = { x: 0.24, y: -0.3, scale: 0.42, rotate: 0 };
