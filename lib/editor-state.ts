import { createClip } from "@/lib/clip";
import { cloneGrade, gradesEqual } from "@/lib/grade";
import {
  clampEdge,
  moveClip,
  splitClips,
  trimClipToTime,
} from "@/lib/timeline";
import type {
  Aspect,
  Clip,
  ClipPatch,
  Grade,
  Quality,
  TitleCard,
  TitlePatch,
  Tool,
} from "@/lib/types";

export type Snapshot = {
  clips: Clip[];
  titles: TitleCard[];
  aspect: Aspect;
  quality: Quality;
};

export type EditorState = {
  clips: Clip[];
  titles: TitleCard[];
  aspect: Aspect;
  quality: Quality;
  tool: Tool;
  selectedClipId: string | null;
  selectedTitleId: string | null;
  past: Snapshot[];
  future: Snapshot[];
};

export type Action =
  | { type: "addClips"; clips: Clip[] }
  | { type: "setThumbs"; id: string; thumbs: string[] }
  | { type: "selectClip"; id: string | null }
  | { type: "selectTitle"; id: string | null }
  | { type: "setTool"; tool: Tool }
  | { type: "split"; time: number; newId: string }
  | { type: "deleteClip"; id: string }
  | { type: "duplicateClip"; id: string; newId: string }
  | { type: "moveClip"; id: string; dir: -1 | 1 }
  | { type: "setEdge"; id: string; edge: "in" | "out"; value: number; history: boolean }
  | { type: "trimToPlayhead"; id: string; edge: "in" | "out"; time: number }
  | { type: "patchClip"; id: string; patch: ClipPatch; history: boolean }
  | { type: "applyGradeAll"; grade: Grade }
  | { type: "setAspect"; aspect: Aspect }
  | { type: "setQuality"; quality: Quality }
  | { type: "addTitle"; title: TitleCard }
  | { type: "patchTitle"; id: string; patch: TitlePatch; history: boolean }
  | { type: "deleteTitle"; id: string }
  | { type: "undo" }
  | { type: "redo" };

const HISTORY_LIMIT = 40;

export function createEditorState(): EditorState {
  return {
    clips: [],
    titles: [],
    aspect: "16:9",
    quality: "720",
    tool: "cut",
    selectedClipId: null,
    selectedTitleId: null,
    past: [],
    future: [],
  };
}

export function collectUrls(state: EditorState): Set<string> {
  const urls = new Set<string>();
  const take = (clips: Clip[]) => {
    for (const clip of clips) urls.add(clip.url);
  };
  take(state.clips);
  for (const snap of state.past) take(snap.clips);
  for (const snap of state.future) take(snap.clips);
  return urls;
}

function snapshotOf(state: EditorState): Snapshot {
  return {
    clips: state.clips,
    titles: state.titles,
    aspect: state.aspect,
    quality: state.quality,
  };
}

function commit(state: EditorState, patch: Partial<EditorState>): EditorState {
  const clips = patch.clips ?? state.clips;
  const titles = patch.titles ?? state.titles;
  const aspect = patch.aspect ?? state.aspect;
  const quality = patch.quality ?? state.quality;
  const changed =
    clips !== state.clips ||
    titles !== state.titles ||
    aspect !== state.aspect ||
    quality !== state.quality;
  if (!changed) return { ...state, ...patch };
  const past = [...state.past, snapshotOf(state)];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { ...state, ...patch, clips, titles, aspect, quality, past, future: [] };
}

function restoreSelection(state: EditorState, snap: Snapshot): Pick<EditorState, "selectedClipId" | "selectedTitleId"> {
  return {
    selectedClipId: snap.clips.some((clip) => clip.id === state.selectedClipId)
      ? state.selectedClipId
      : (snap.clips[0]?.id ?? null),
    selectedTitleId: snap.titles.some((title) => title.id === state.selectedTitleId)
      ? state.selectedTitleId
      : null,
  };
}

function samePatch(clip: Clip, patch: ClipPatch): boolean {
  const keys = Object.keys(patch) as (keyof ClipPatch)[];
  return keys.every((key) => {
    if (key === "grade") return patch.grade ? gradesEqual(clip.grade, patch.grade) : true;
    return clip[key] === patch[key];
  });
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

export function reduceEditor(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "addClips": {
      if (action.clips.length === 0) return state;
      return commit(state, {
        clips: [...state.clips, ...action.clips],
        selectedClipId: action.clips[0]?.id ?? state.selectedClipId,
        tool: "cut",
      });
    }
    case "setThumbs": {
      const clip = state.clips.find((item) => item.id === action.id);
      if (!clip) return state;
      return {
        ...state,
        clips: paintThumbs(state.clips, clip.url, action.thumbs),
        past: state.past.map((snap) => ({ ...snap, clips: paintThumbs(snap.clips, clip.url, action.thumbs) })),
        future: state.future.map((snap) => ({
          ...snap,
          clips: paintThumbs(snap.clips, clip.url, action.thumbs),
        })),
      };
    }
    case "selectClip":
      return state.selectedClipId === action.id ? state : { ...state, selectedClipId: action.id };
    case "selectTitle":
      return {
        ...state,
        selectedTitleId: action.id,
        tool: action.id ? "text" : state.tool,
      };
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
      const copy: Clip = {
        ...clip,
        id: action.newId,
        grade: cloneGrade(clip.grade),
        transition: "cut",
        thumbs: clip.thumbs,
      };
      const clips = [...state.clips.slice(0, index + 1), copy, ...state.clips.slice(index + 1)];
      return commit(state, { clips, selectedClipId: copy.id });
    }
    case "moveClip": {
      const clips = moveClip(state.clips, action.id, action.dir);
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
      const clips = mapClip(state.clips, action.id, (clip) => {
        if (samePatch(clip, action.patch)) return clip;
        const next: Clip = { ...clip, ...action.patch };
        next.volume = Math.min(1, Math.max(0, next.volume));
        next.fadeIn = Math.min(5, Math.max(0, next.fadeIn));
        next.fadeOut = Math.min(5, Math.max(0, next.fadeOut));
        next.dissolve = Math.min(2, Math.max(0.15, next.dissolve));
        if (!(next.speed > 0)) next.speed = 1;
        return next;
      });
      if (clips === state.clips) return state;
      return action.history ? commit(state, { clips }) : { ...state, clips };
    }
    case "applyGradeAll": {
      const grade = cloneGrade(action.grade);
      const clips = state.clips.map((clip) => ({ ...clip, grade: cloneGrade(grade) }));
      return commit(state, { clips });
    }
    case "setAspect":
      return state.aspect === action.aspect ? state : commit(state, { aspect: action.aspect });
    case "setQuality":
      return state.quality === action.quality ? state : commit(state, { quality: action.quality });
    case "addTitle":
      return commit(state, {
        titles: [...state.titles, action.title],
        selectedTitleId: action.title.id,
        tool: "text",
      });
    case "patchTitle": {
      let changed = false;
      const titles = state.titles.map((title) => {
        if (title.id !== action.id) return title;
        const next = sanitizeTitle({ ...title, ...action.patch });
        if (
          next.text === title.text &&
          next.start === title.start &&
          next.duration === title.duration &&
          next.x === title.x &&
          next.y === title.y &&
          next.size === title.size &&
          next.color === title.color &&
          next.font === title.font
        ) {
          return title;
        }
        changed = true;
        return next;
      });
      if (!changed) return state;
      return action.history ? commit(state, { titles }) : { ...state, titles };
    }
    case "deleteTitle": {
      if (!state.titles.some((title) => title.id === action.id)) return state;
      const titles = state.titles.filter((title) => title.id !== action.id);
      return commit(state, {
        titles,
        selectedTitleId: state.selectedTitleId === action.id ? null : state.selectedTitleId,
      });
    }
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
    text: title.text.slice(0, 80),
    start: Math.max(0, title.start),
    duration: Math.min(12, Math.max(0.2, title.duration)),
    x: Math.min(0.94, Math.max(0.06, title.x)),
    y: Math.min(0.94, Math.max(0.06, title.y)),
    size: Math.min(140, Math.max(24, title.size)),
  };
}

export function selectedClip(state: EditorState): Clip | null {
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
