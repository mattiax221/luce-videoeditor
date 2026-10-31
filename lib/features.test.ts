import assert from "node:assert/strict";
import test from "node:test";
import { followKeyframe, touchKeyframe } from "./clip";
import { makeInitialClip } from "./editor-state";
import { sampleTrack } from "./keyframes";
import { parseCube } from "./lut";
import { snapTime } from "./snap";
import { parseSubtitles } from "./srt";
import { crossMix, moveClipTo, sourceTime, splitClips, totalDuration } from "./timeline";
import type { Clip } from "./types";

function clip(id: string, seconds = 4, extra: Partial<Clip> = {}): Clip {
  return { ...makeInitialClip(id, seconds), ...extra };
}

test("snapTime picks the nearest cut inside the threshold", () => {
  assert.equal(snapTime(1.92, [0, 2, 5], 0.1), 2);
  assert.equal(snapTime(1.7, [0, 2, 5], 0.1), 1.7);
});

test("sourceTime walks backward on a reversed clip", () => {
  const hit = {
    index: 0,
    clip: clip("a", 4, { reverse: true }),
    start: 0,
    local: 1,
  };
  assert.equal(sourceTime(hit), 3);
});

test("crossMix blends only inside the outgoing window", () => {
  const clips = [clip("a", 2), clip("b", 2, { transition: "cross", dissolve: 0.5 })];
  assert.equal(crossMix(clips, 1.2), null);
  const mix = crossMix(clips, 1.8);
  assert.ok(mix);
  assert.equal(mix.clip.id, "b");
  assert.ok(Math.abs(mix.mix - 0.6) < 1e-9);
  assert.ok(Math.abs(mix.src - 0.3) < 1e-9);
});

test("moveClipTo reorders without changing duration", () => {
  const clips = [clip("a", 2), clip("b", 3), clip("c", 1)];
  const moved = moveClipTo(clips, "a", 2);
  assert.deepEqual(
    moved.map((item) => item.id),
    ["b", "c", "a"],
  );
  assert.equal(totalDuration(moved), 6);
  assert.equal(moveClipTo(clips, "missing", 0), clips);
});

test("split of a reversed clip keeps both directions contiguous", () => {
  const result = splitClips([clip("a", 4, { reverse: true })], 1, "b");
  assert.ok(result);
  assert.equal(result.clips[0].inPoint, 3);
  assert.equal(result.clips[0].outPoint, 4);
  assert.equal(result.clips[1].inPoint, 0);
  assert.equal(result.clips[1].outPoint, 3);
  assert.equal(totalDuration(result.clips), 4);
});

test("sampleTrack interpolates between keys and holds the ends", () => {
  const keys = [
    { id: "a", time: 0, opacity: 0 },
    { id: "b", time: 2, opacity: 1 },
  ];
  assert.equal(sampleTrack(keys, -1, "opacity", 0.5), 0);
  assert.equal(sampleTrack(keys, 1, "opacity", 0.5), 0.5);
  assert.equal(sampleTrack(keys, 4, "opacity", 0.5), 1);
  assert.equal(sampleTrack([], 1, "scale", 1.2), 1.2);
});

test("followKeyframe updates a nearby key when scale changes", () => {
  const base = clip("a");
  const withKey = { ...base, keyframes: touchKeyframe([], 1, { scale: 1, opacity: 1 }, "k") };
  const next = followKeyframe(withKey, 1.02, { transform: { ...base.transform, scale: 1.4 } });
  assert.equal(next.keyframes?.[0]?.scale, 1.4);
  const far = followKeyframe(withKey, 2, { opacity: 0.2 });
  assert.equal(far.keyframes, undefined);
});

test("parseSubtitles reads SRT and WebVTT cues", () => {
  const srt = "1\n00:00:01,000 --> 00:00:02,500\nCiao mondo\n";
  const cues = parseSubtitles(srt, () => "t1");
  assert.equal(cues.length, 1);
  assert.equal(cues[0]?.text, "Ciao mondo");
  assert.equal(cues[0]?.start, 1);
  assert.equal(cues[0]?.duration, 1.5);
  assert.equal(cues[0]?.y, 0.86);
  const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nUna riga\n";
  assert.equal(parseSubtitles(vtt, () => "t2")[0]?.text, "Una riga");
  assert.equal(parseSubtitles("senza tempi", () => "x").length, 0);
});

test("parseCube reads a 3D lattice and scales 8-bit values", () => {
  const cube = ["TITLE Warm", "LUT_3D_SIZE 2", "0 0 0", "255 0 0", "0 255 0", "255 255 0", "0 0 255", "255 0 255", "0 255 255", "255 255 255"].join("\n");
  const lut = parseCube(cube, "lut", "warm.cube");
  assert.ok(lut);
  assert.equal(lut.size, 2);
  assert.equal(lut.name, "Warm");
  assert.ok(Math.abs((lut.data[3] ?? 0) - 1) < 1e-9);
  assert.equal(parseCube("LUT_3D_SIZE 2\n0 0 0\n", "x", "bad.cube"), null);
});
