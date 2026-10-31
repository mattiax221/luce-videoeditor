import { cloneClipFields, createClip } from "@/lib/clip";
import { cloneGrade, gradesEqual } from "@/lib/grade";
import { clampEdge, moveClip, moveClipTo, splitClips, trimClipToTime } from "@/lib/timeline";
import { clamp } from "@/lib/time";
import type {
  Aspect,
  AudioClip,
  AudioPatch,
  Clip,
  ClipPatch,
  Grade,
  Lut,
  Marker,
  OverlayClip,
  Quality,
  TitleCard,
  TitlePatch,
  Tool,
} from "@/lib/types";

export type Snapshot = {
  clips: Clip[];
  overlays: OverlayClip[];
  audios: AudioClip[];
  titles: TitleCard[];
  markers: Marker[];
  luts: Lut[];
  aspect: Aspect;
  quality: Quality;
};

export type EditorState = Snapshot & {
  tool: Tool;
  selectedClipId: string | null;
  selectedOverlayId: string | null;
  selectedAudioId: string | null;
  selectedTitleId: string | null;
  gradeClipboard: Grade | null;
  past: Snapshot[];
  future: Snapshot[];
};

export type Action =
  | { type: "addClips"; clips: Clip[] }
  | { type: "insertClip"; clip: Clip; index: number }
  | { type: "setThumbs"; id: string; thumbs: string[] }
  | { type: "selectClip"; id: string | null }
  | { type: "selectOverlay"; id: string | null }
  | { type: "selectAudio"; id: string | null }
  | { type: "selectTitle"; id: string | null }
  | { type: "setTool"; tool: Tool }
  | { type: "split"; time: number; newId: string }
  | { type: "deleteClip"; id: string }
  | { type: "duplicateClip"; id: string; newId: string }
  | { type: "moveClip"; id: string; dir: -1 | 1 }
  | { type: "moveClipTo"; id: string; index: number }
  | { type: "setEdge"; id: string; edge: "in" | "out"; value: number; history: boolean }
  | { type: "trimToPlayhead"; id: string; edge: "in" | "out"; time: number }
  | { type: "patchClip"; id: string; patch: ClipPatch; history: boolean }
  | { type: "applyGradeAll"; grade: Grade }
  | { type: "copyGrade"; grade: Grade }
  | { type: "pasteGrade"; id: string }
  | { type: "addOverlay"; clip: OverlayClip }
  | { type: "patchOverlay"; id: string; patch: ClipPatch & { start?: number }; history: boolean }
  | { type: "deleteOverlay"; id: string }
  | { type: "addAudio"; clip: AudioClip }
  | { type: "patchAudio"; id: string; patch: AudioPatch; history: boolean }
  | { type: "setPeaks"; id: string; peaks: number[] }
  | { type: "deleteAudio"; id: string }
  | { type: "addMarker"; marker: Marker }
  | { type: "deleteMarker"; id: string }
  | { type: "addLut"; lut: Lut }
  | { type: "deleteLut"; id: string }
  | { type: "setAspect"; aspect: Aspect }
  | { type: "setQuality"; quality: Quality }
  | { type: "addTitle"; title: TitleCard }
  | { type: "addTitles"; titles: TitleCard[] }
  | { type: "patchTitle"; id: string; patch: TitlePatch; history: boolean }
  | { type: "deleteTitle"; id: string }
  | { type: "replaceProject"; project: Snapshot }
  | { type: "resetProject" }
  | { type: "undo" }
  | { type: "redo" };

const HISTORY_LIMIT = 40;

export function createEditorState(): EditorState {
  return {
    clips: [],
    overlays: [],
    audios: [],
    titles: [],
    markers: [],
    luts: [],
    aspect: "16:9",
    quality: "720",
    tool: "cut",
    selectedClipId: null,
    selectedOverlayId: null,
    selectedAudioId: null,
    selectedTitleId: null,
    gradeClipboard: null,
    past: [],
    future: [],
  };
}

function takeUrls(clips: { url: string }[], urls: Set<string>) {
  for (const clip of clips) if (clip.url) urls.add(clip.url);
}

export function collectUrls(state: EditorState): Set<string> {
  const urls = new Set<string>();
  const takeSnap = (snap: Snapshot) => {
    takeUrls(snap.clips, urls);
    takeUrls(snap.overlays, urls);
    takeUrls(snap.audios, urls);
  };
  takeSnap(state);
  for (const snap of state.past) takeSnap(snap);
  for (const snap of state.future) takeSnap(snap);
  return urls;
}

function snapshotOf(state: EditorState): Snapshot {
  return {
    clips: state.clips,
    overlays: state.overlays,
    audios: state.audios,
    titles: state.titles,
    markers: state.markers,
    luts: state.luts,
    aspect: state.aspect,
    quality: state.quality,
  };
}

function commit(state: EditorState, patch: Partial<EditorState>): EditorState {
  const next = { ...state, ...patch };
  const changed =
    next.clips !== state.clips ||
    next.overlays !== state.overlays ||
    next.audios !== state.audios ||
    next.titles !== state.titles ||
    next.markers !== state.markers ||
    next.luts !== state.luts ||
    next.aspect !== state.aspect ||
    next.quality !== state.quality;
  if (!changed) return next;
  const past = [...state.past, snapshotOf(state)];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { ...next, past, future: [] };
}

function restoreSelection(state: EditorState, snap: Snapshot) {
  return {
    selectedClipId: snap.clips.some((clip) => clip.id === state.selectedClipId) ? state.selectedClipId : (snap.clips[0]?.id ?? null),
    selectedOverlayId: snap.overlays.some((clip) => clip.id === state.selectedOverlayId) ? state.selectedOverlayId : null,
    selectedAudioId: snap.audios.some((clip) => clip.id === state.selectedAudioId) ? state.selectedAudioId : null,
    selectedTitleId: snap.titles.some((title) => title.id === state.selectedTitleId) ? state.selectedTitleId : null,
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left === "object" && left && typeof right === "object" && right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return false;
}

function samePatch(clip: Clip, patch: ClipPatch): boolean {
  const keys = Object.keys(patch) as (keyof ClipPatch)[];
  return keys.every((key) => {
    if (key === "grade") return patch.grade ? gradesEqual(clip.grade, patch.grade) : true;
    return sameValue(clip[key], patch[key]);
  });
}

function tidyClip(clip: Clip): Clip {
  const next = { ...clip };
  next.volume = clamp(next.volume, 0, 1);
  next.opacity = clamp(next.opacity ?? 1, 0, 1);
  next.fadeIn = clamp(next.fadeIn, 0, 5);
  next.fadeOut = clamp(next.fadeOut, 0, 5);
  next.dissolve = clamp(next.dissolve, 0.15, 2);
  if (!(next.speed > 0)) next.speed = 1;
  next.transform = {
    x: clamp(next.transform?.x ?? 0, -1, 1),
    y: clamp(next.transform?.y ?? 0, -1, 1),
    scale: clamp(next.transform?.scale ?? 1, 0.2, 4),
    rotate: clamp(next.transform?.rotate ?? 0, -180, 180),
  };
  next.mask = {
    enabled: Boolean(next.mask?.enabled),
    x: clamp(next.mask?.x ?? 0, 0, 1),
    y: clamp(next.mask?.y ?? 0, 0, 1),
    w: clamp(next.mask?.w ?? 0.5, 0.05, 1),
    h: clamp(next.mask?.h ?? 0.5, 0.05, 1),
    feather: clamp(next.mask?.feather ?? 0.08, 0, 0.4),
  };
  next.chroma = {
    enabled: Boolean(next.chroma?.enabled),
    color: next.chroma?.color || "#00ff00",
    similarity: clamp(next.chroma?.similarity ?? 0.4, 0, 1.2),
    smoothness: clamp(next.chroma?.smoothness ?? 0.12, 0.01, 0.8),
  };
  next.keyframes = next.keyframes ?? [];
  next.stab = next.stab ?? [];
  return next;
}

function mapClip(clips: Clip[], id: string, update: (clip: Clip) => Clip): Clip[] {
  let changed = false;
  const next = clips.map((clip) => {
    if (clip.id !== id) return clip;
    const updated = update(clip);
    if (updated !== clip) changed = true;
    return updated;
  });
  return changed ? next : clips;
}

function paintThumbs(clips: Clip[], url: string, thumbs: string[]): Clip[] {
  let changed = false;
  const next = clips.map((clip) => {
    if (clip.url !== url || clip.thumbs === thumbs) return clip;
    changed = true;
    return { ...clip, thumbs };
  });
  return changed ? next : clips;
}

function patchOne(clip: Clip, patch: ClipPatch): Clip {
  if (samePatch(clip, patch)) return clip;
  return tidyClip({ ...clip, ...patch });
}

export function reduceEditor(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "addClips": {
      if (action.clips.length === 0) return state;
      return commit(state, {
        clips: [...state.clips, ...action.clips],
        selectedClipId: action.clips[0]?.id ?? state.selectedClipId,
        selectedOverlayId: null,
        tool: "cut",
      });
    }
    case "insertClip": {
      const index = clamp(action.index, 0, state.clips.length);
      const clips = [...state.clips.slice(0, index), action.clip, ...state.clips.slice(index)];
      return commit(state, { clips, selectedClipId: action.clip.id, selectedOverlayId: null, tool: "cut" });
    }
    case "setThumbs": {
      const clip = state.clips.find((item) => item.id === action.id) ?? state.overlays.find((item) => item.id === action.id);
      if (!clip) return state;
      const paint = (items: Clip[]) => paintThumbs(items, clip.url, action.thumbs);
      return {
        ...state,
        clips: paint(state.clips),
        overlays: paint(state.overlays) as OverlayClip[],
        past: state.past.map((snap) => ({ ...snap, clips: paint(snap.clips), overlays: paint(snap.overlays) as OverlayClip[] })),
        future: state.future.map((snap) => ({
          ...snap,
          clips: paint(snap.clips),
          overlays: paint(snap.overlays) as OverlayClip[],
        })),
      };
    }
    case "selectClip":
      return state.selectedClipId === action.id && !state.selectedOverlayId
        ? state
        : { ...state, selectedClipId: action.id, selectedOverlayId: null };
    case "selectOverlay":
      return { ...state, selectedOverlayId: action.id, tool: action.id ? "cut" : state.tool };
    case "selectAudio":
      return { ...state, selectedAudioId: action.id, tool: action.id ? "audio" : state.tool };
    case "selectTitle":
      return { ...state, selectedTitleId: action.id, tool: action.id ? "text" : state.tool };
    case "setTool":
      return state.tool === action.tool ? state : { ...state, tool: action.tool };
    case "split": {
      const result = splitClips(state.clips, action.time, action.newId);
      if (!result) return state;
      return commit(state, { clips: result.clips, selectedClipId: result.selectedId });
    }
    case "deleteClip": {
      const index = state.clips.findIndex((clip) => clip.id === action.id);
      if (index < 0) return state;
      const clips = state.clips.filter((clip) => clip.id !== action.id);
      const neighbor = clips[Math.min(index, clips.length - 1)] ?? null;
      return commit(state, {
        clips,
        selectedClipId: state.selectedClipId === action.id ? (neighbor?.id ?? null) : state.selectedClipId,
      });
    }
    case "duplicateClip": {
      const index = state.clips.findIndex((clip) => clip.id === action.id);
      if (index < 0) return state;
      const clip = state.clips[index];
      const copy: Clip = { ...clip, ...cloneClipFields(clip), id: action.newId, transition: "cut" };
      const clips = [...state.clips.slice(0, index + 1), copy, ...state.clips.slice(index + 1)];
      return commit(state, { clips, selectedClipId: copy.id });
    }
    case "moveClip": {
      const clips = moveClip(state.clips, action.id, action.dir);
      if (clips === state.clips) return state;
      return commit(state, { clips });
    }
    case "moveClipTo": {
      const clips = moveClipTo(state.clips, action.id, action.index);
      if (clips === state.clips) return state;
      return commit(state, { clips });
    }
    case "setEdge": {
      const clips = mapClip(state.clips, action.id, (clip) => clampEdge(clip, action.edge, action.value));
      if (clips === state.clips) return state;
      return action.history ? commit(state, { clips }) : { ...state, clips };
    }
    case "trimToPlayhead": {
      const clips = trimClipToTime(state.clips, action.id, action.edge, action.time);
      if (clips === state.clips) return state;
      return commit(state, { clips });
    }
    case "patchClip": {
      const clips = mapClip(state.clips, action.id, (clip) => patchOne(clip, action.patch));
      if (clips === state.clips) return state;
      return action.history ? commit(state, { clips }) : { ...state, clips };
    }
    case "applyGradeAll": {
      const grade = cloneGrade(action.grade);
      const clips = state.clips.map((clip) => ({ ...clip, grade: cloneGrade(grade) }));
      return commit(state, { clips });
    }
    case "copyGrade":
      return { ...state, gradeClipboard: cloneGrade(action.grade) };
    case "pasteGrade": {
      if (!state.gradeClipboard) return state;
      const grade = cloneGrade(state.gradeClipboard);
      const clips = mapClip(state.clips, action.id, (clip) => ({ ...clip, grade }));
      const overlays = state.overlays.map((clip) => (clip.id === action.id ? { ...clip, grade: cloneGrade(grade) } : clip));
      if (clips === state.clips && overlays === state.overlays) return state;
      return commit(state, { clips, overlays });
    }
    case "addOverlay":
      return commit(state, { overlays: [...state.overlays, action.clip], selectedOverlayId: action.clip.id, tool: "cut" });
    case "patchOverlay": {
      const overlays = state.overlays.map((clip) => {
        if (clip.id !== action.id) return clip;
        const { start, ...rest } = action.patch;
        const patched = patchOne(clip, rest);
        const nextStart = start === undefined ? clip.start : Math.max(0, start);
        if (patched === clip && nextStart === clip.start) return clip;
        return { ...patched, start: nextStart };
      });
      if (overlays.every((clip, index) => clip === state.overlays[index])) return state;
      return action.history ? commit(state, { overlays }) : { ...state, overlays };
    }
    case "deleteOverlay": {
      if (!state.overlays.some((clip) => clip.id === action.id)) return state;
      return commit(state, {
        overlays: state.overlays.filter((clip) => clip.id !== action.id),
        selectedOverlayId: state.selectedOverlayId === action.id ? null : state.selectedOverlayId,
      });
    }
    case "addAudio":
      return commit(state, { audios: [...state.audios, action.clip], selectedAudioId: action.clip.id, tool: "audio" });
    case "patchAudio": {
      const audios = state.audios.map((clip) => {
        if (clip.id !== action.id) return clip;
        const next = { ...clip, ...action.patch };
        next.volume = clamp(next.volume, 0, 1);
        next.fadeIn = clamp(next.fadeIn, 0, 5);
        next.fadeOut = clamp(next.fadeOut, 0, 5);
        next.start = Math.max(0, next.start);
        next.inPoint = clamp(next.inPoint, 0, Math.max(0, next.outPoint - 0.05));
        next.outPoint = clamp(next.outPoint, next.inPoint + 0.05, next.duration);
        return next;
      });
      return action.history ? commit(state, { audios }) : { ...state, audios };
    }
    case "setPeaks":
      return {
        ...state,
        audios: state.audios.map((clip) => (clip.id === action.id ? { ...clip, peaks: action.peaks } : clip)),
      };
    case "deleteAudio":
      if (!state.audios.some((clip) => clip.id === action.id)) return state;
      return commit(state, {
        audios: state.audios.filter((clip) => clip.id !== action.id),
        selectedAudioId: state.selectedAudioId === action.id ? null : state.selectedAudioId,
      });
    case "addMarker":
      return commit(state, { markers: [...state.markers, action.marker].sort((a, b) => a.time - b.time) });
    case "deleteMarker":
      return commit(state, { markers: state.markers.filter((marker) => marker.id !== action.id) });
    case "addLut":
      return commit(state, { luts: [...state.luts.filter((lut) => lut.id !== action.lut.id), action.lut] });
    case "deleteLut":
      return commit(state, {
        luts: state.luts.filter((lut) => lut.id !== action.id),
        clips: state.clips.map((clip) => (clip.lutId === action.id ? { ...clip, lutId: null } : clip)),
        overlays: state.overlays.map((clip) => (clip.lutId === action.id ? { ...clip, lutId: null } : clip)),
      });
    case "setAspect":
      return state.aspect === action.aspect ? state : commit(state, { aspect: action.aspect });
    case "setQuality":
      return state.quality === action.quality ? state : commit(state, { quality: action.quality });
    case "addTitle":
      return commit(state, { titles: [...state.titles, sanitizeTitle(action.title)], selectedTitleId: action.title.id, tool: "text" });
    case "addTitles": {
      if (action.titles.length === 0) return state;
      const titles = action.titles.map((title) => sanitizeTitle(title));
      return commit(state, { titles: [...state.titles, ...titles], selectedTitleId: titles[0]?.id ?? state.selectedTitleId, tool: "text" });
    }
    case "patchTitle": {
      let changed = false;
      const titles = state.titles.map((title) => {
        if (title.id !== action.id) return title;
        const next = sanitizeTitle({ ...title, ...action.patch });
        if (JSON.stringify(next) === JSON.stringify(title)) return title;
        changed = true;
        return next;
      });
      if (!changed) return state;
      return action.history ? commit(state, { titles }) : { ...state, titles };
    }
    case "deleteTitle": {
      if (!state.titles.some((title) => title.id === action.id)) return state;
      return commit(state, {
        titles: state.titles.filter((title) => title.id !== action.id),
        selectedTitleId: state.selectedTitleId === action.id ? null : state.selectedTitleId,
      });
    }
    case "replaceProject":
      return {
        ...createEditorState(),
        ...action.project,
        selectedClipId: action.project.clips[0]?.id ?? null,
        past: [],
        future: [],
      };
    case "resetProject":
      return createEditorState();
    case "undo": {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return {
        ...state,
        ...prev,
        ...restoreSelection(state, prev),
        past: state.past.slice(0, -1),
        future: [...state.future, snapshotOf(state)],
      };
    }
    case "redo": {
      const next = state.future[state.future.length - 1];
      if (!next) return state;
      return {
        ...state,
        ...next,
        ...restoreSelection(state, next),
        future: state.future.slice(0, -1),
        past: [...state.past, snapshotOf(state)],
      };
    }
    default:
      return state;
  }
}

export function sanitizeTitle(title: TitleCard): TitleCard {
  return {
    ...title,
    text: title.text.slice(0, 180),
    start: Math.max(0, title.start),
    duration: Math.min(30, Math.max(0.2, title.duration)),
    x: Math.min(0.94, Math.max(0.06, title.x)),
    y: Math.min(0.94, Math.max(0.06, title.y)),
    size: Math.min(140, Math.max(18, title.size)),
    align: title.align ?? "center",
    background: title.background ?? null,
    stroke: Boolean(title.stroke),
    enter: title.enter ?? "fade",
    exit: title.exit ?? "fade",
  };
}

export function selectedClip(state: EditorState): Clip | null {
  if (state.selectedOverlayId) return state.overlays.find((clip) => clip.id === state.selectedOverlayId) ?? null;
  return state.clips.find((clip) => clip.id === state.selectedClipId) ?? null;
}

export function makeInitialClip(id: string, seconds = 4): Clip {
  return createClip({
    id,
    name: id,
    url: `blob:${id}`,
    duration: seconds,
    width: 1280,
    height: 720,
  });
}
