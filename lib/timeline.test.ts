import assert from "node:assert/strict";
import test from "node:test";
import { createEditorState, makeInitialClip, reduceEditor } from "./editor-state";
import { cloneGrade, gradeVectors, NEUTRAL_GRADE, polarOffset } from "./grade";
import { canSplit, fadeAt, locate, splitClips, totalDuration } from "./timeline";
import { formatTime } from "./time";
import type { Clip } from "./types";

function clip(id: string, seconds = 4, extra: Partial<Clip> = {}): Clip {
  return { ...makeInitialClip(id, seconds), ...extra };
}

test("formatTime renders minutes and tenths", () => {
  assert.equal(formatTime(0), "00:00.0");
  assert.equal(formatTime(65.44), "01:05.4");
  assert.equal(formatTime(3661), "1:01:01");
});

test("locate walks sequential clips and clamps the end", () => {
  const clips = [clip("a", 4), clip("b", 6)];
  assert.equal(totalDuration(clips), 10);
  const mid = locate(clips, 5);
  assert.equal(mid?.clip.id, "b");
  assert.equal(mid?.local, 1);
  const end = locate(clips, 99);
  assert.equal(end?.clip.id, "b");
  assert.equal(end?.local, 6);
});

test("split keeps the source contiguous and the timeline duration", () => {
  const clips = [clip("a", 4)];
  assert.equal(canSplit(clips, 0.02), false);
  const result = splitClips(clips, 1.5, "b");
  assert.ok(result);
  assert.equal(result.clips[0].outPoint, 1.5);
  assert.equal(result.clips[1].inPoint, 1.5);
  assert.equal(result.clips[1].id, "b");
  assert.equal(totalDuration(result.clips), 4);
});

test("dissolve fades in and out around the cut", () => {
  const first = clip("a", 2, { transition: "cut" });
  const second = clip("b", 2, { transition: "dissolve", dissolve: 0.5 });
  const clips = [first, second];
  assert.ok(Math.abs(fadeAt(clips, 1.8) - 0.4) < 1e-9);
  assert.equal(fadeAt(clips, 2), 0);
  assert.equal(fadeAt(clips, 2.5), 1);
});

test("center of a color wheel is neutral", () => {
  assert.deepEqual(polarOffset(0, 0), [0, 0, 0]);
  const vectors = gradeVectors(NEUTRAL_GRADE);
  assert.deepEqual(vectors.lift, [0, 0, 0]);
  assert.deepEqual(vectors.gamma, [1, 1, 1]);
  assert.deepEqual(vectors.gain, [1, 1, 1]);
  assert.ok(polarOffset(1, 0)[0] > 0.5);
});

test("undo restores a deleted clip and redo removes it again", () => {
  let state = createEditorState();
  state = reduceEditor(state, { type: "addClips", clips: [clip("a"), clip("b")] });
  state = reduceEditor(state, { type: "deleteClip", id: "a" });
  assert.deepEqual(
    state.clips.map((item) => item.id),
    ["b"],
  );
  state = reduceEditor(state, { type: "undo" });
  assert.deepEqual(
    state.clips.map((item) => item.id),
    ["a", "b"],
  );
  state = reduceEditor(state, { type: "redo" });
  assert.deepEqual(
    state.clips.map((item) => item.id),
    ["b"],
  );
});

test("grade drags can coalesce into one undo step", () => {
  let state = reduceEditor(createEditorState(), { type: "addClips", clips: [clip("a")] });
  const base = state.clips[0].grade;
  state = reduceEditor(state, {
    type: "patchClip",
    id: "a",
    history: true,
    patch: { grade: { ...cloneGrade(base), exposure: 0.2 } },
  });
  state = reduceEditor(state, {
    type: "patchClip",
    id: "a",
    history: false,
    patch: { grade: { ...cloneGrade(state.clips[0].grade), exposure: 0.4 } },
  });
  assert.equal(state.past.length, 2);
  assert.equal(state.clips[0].grade.exposure, 0.4);
  state = reduceEditor(state, { type: "undo" });
  assert.equal(state.clips[0].grade.exposure, 0);
});

test("trim to the playhead shortens the selected side", () => {
  let state = reduceEditor(createEditorState(), { type: "addClips", clips: [clip("a", 10)] });
  state = reduceEditor(state, { type: "trimToPlayhead", id: "a", edge: "out", time: 4 });
  assert.equal(state.clips[0].outPoint, 4);
  assert.equal(totalDuration(state.clips), 4);
  state = reduceEditor(state, { type: "trimToPlayhead", id: "a", edge: "in", time: 1 });
  assert.equal(state.clips[0].inPoint, 1);
  assert.equal(totalDuration(state.clips), 3);
});
