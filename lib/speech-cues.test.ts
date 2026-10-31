import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanCueText,
  cuesFromChunks,
  downsampleMono,
  looksLikeSpeech,
  sourceRangeToTimeline,
  speechVariation,
  whisperLanguage,
} from "./speech-cues";

test("whisperLanguage maps the picker and leaves auto open", () => {
  assert.equal(whisperLanguage("it"), "italian");
  assert.equal(whisperLanguage("en"), "english");
  assert.equal(whisperLanguage("auto"), undefined);
});

test("downsampleMono keeps the duration", () => {
  const input = new Float32Array(22050).fill(0.5);
  const output = downsampleMono(input, 22050, 16000);
  assert.equal(output.length, 16000);
  assert.ok(Math.abs((output[400] ?? 0) - 0.5) < 1e-6);
});

test("a steady tone is not speech and a broken voice is", () => {
  const rate = 16000;
  const tone = new Float32Array(rate);
  for (let index = 0; index < tone.length; index += 1) tone[index] = Math.sin((2 * Math.PI * 220 * index) / rate) * 0.2;
  assert.ok(speechVariation(tone, rate) < 0.05);
  assert.equal(looksLikeSpeech(tone, rate), false);
  const voice = new Float32Array(rate);
  for (let index = 0; index < voice.length; index += 1) {
    const gate = Math.floor(index / 800) % 2 === 0;
    voice[index] = gate ? (Math.random() - 0.5) * 0.4 : 0;
  }
  assert.equal(looksLikeSpeech(voice, rate), true);
});

test("cleanCueText drops silence hallucinations", () => {
  assert.equal(cleanCueText("  Ciao mondo  "), "Ciao mondo");
  assert.equal(cleanCueText("Thanks for watching"), null);
  assert.equal(cleanCueText("[musica]"), null);
  assert.equal(cleanCueText("Sottotitoli a cura di qualcuno"), null);
  assert.equal(cleanCueText("Ciao, ciao, ciao, ciao, ciao"), null);
});

test("source times land on the timeline, also when the clip is reversed or sped up", () => {
  const forward = sourceRangeToTimeline(1, 3, { inPoint: 0, outPoint: 8, speed: 2, reverse: false, timelineDuration: 4 });
  assert.deepEqual(forward, { start: 0.5, end: 1.5 });
  const reversed = sourceRangeToTimeline(1, 3, { inPoint: 0, outPoint: 8, speed: 1, reverse: true, timelineDuration: 8 });
  assert.deepEqual(reversed, { start: 5, end: 7 });
});

test("cuesFromChunks writes readable subtitle cards and merges repeats", () => {
  let next = 0;
  const titles = cuesFromChunks(
    [
      { text: " Ciao ", start: 0.2, end: 1.2 },
      { text: "Ciao", start: 1.1, end: 1.6 },
      { text: "Thanks for watching", start: 2, end: 3 },
      { text: "Seconda", start: 4, end: 5 },
    ],
    10,
    () => `id-${next++}`,
  );
  assert.deepEqual(
    titles.map((title) => title.text),
    ["Ciao", "Seconda"],
  );
  assert.equal(titles[0]?.start, 10.2);
  assert.ok((titles[0]?.duration ?? 0) >= 0.8);
  assert.equal(titles[0]?.y, 0.86);
  assert.equal(titles[0]?.background, "#14120fcc");
  assert.ok((titles[0]?.start ?? 0) + (titles[0]?.duration ?? 0) <= (titles[1]?.start ?? 0) + 0.001);
});
