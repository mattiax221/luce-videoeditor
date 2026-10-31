export type ShakeSample = { t: number; x: number; y: number };

function luma(data: Uint8ClampedArray, index: number): number {
  return data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
}

function matchShift(prev: Uint8ClampedArray, next: Uint8ClampedArray, width: number, height: number): { x: number; y: number } {
  const range = 5;
  let bestX = 0;
  let bestY = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  const x0 = range + 2;
  const y0 = range + 2;
  const x1 = width - range - 2;
  const y1 = height - range - 2;
  for (let dy = -range; dy <= range; dy += 1) {
    for (let dx = -range; dx <= range; dx += 1) {
      let score = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const a = luma(prev, (y * width + x) * 4);
          const b = luma(next, ((y + dy) * width + (x + dx)) * 4);
          score += Math.abs(a - b);
          count += 1;
        }
      }
      if (count > 0 && score / count < bestScore) {
        bestScore = score / count;
        bestX = dx;
        bestY = dy;
      }
    }
  }
  return { x: bestX / width, y: bestY / height };
}

function smooth(samples: ShakeSample[]): ShakeSample[] {
  const window = 4;
  return samples.map((sample, index) => {
    let x = 0;
    let y = 0;
    let count = 0;
    for (let offset = -window; offset <= window; offset += 1) {
      const other = samples[index + offset];
      if (!other) continue;
      x += other.x;
      y += other.y;
      count += 1;
    }
    return { t: sample.t, x: x / count, y: y / count };
  });
}

export async function measureShake(url: string, inPoint: number, outPoint: number): Promise<ShakeSample[]> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timeout")), 8000);
    video.onloadeddata = () => {
      window.clearTimeout(timer);
      resolve();
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("decode"));
    };
  });
  const width = 64;
  const height = 36;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  const span = Math.max(0.2, outPoint - inPoint);
  const step = Math.max(0.08, span / 36);
  const raw: ShakeSample[] = [];
  let previous: Uint8ClampedArray | null = null;
  let accX = 0;
  let accY = 0;
  for (let time = inPoint; time <= outPoint; time += step) {
    video.currentTime = Math.min(time, Math.max(0, video.duration - 0.04));
    await new Promise<void>((resolve) => {
      const done = () => {
        video.removeEventListener("seeked", done);
        resolve();
      };
      video.addEventListener("seeked", done);
      window.setTimeout(done, 500);
    });
    context.drawImage(video, 0, 0, width, height);
    const frame = context.getImageData(0, 0, width, height).data;
    if (previous) {
      const shift = matchShift(previous, frame, width, height);
      accX += shift.x;
      accY += shift.y;
    }
    raw.push({ t: time, x: accX, y: accY });
    previous = frame;
  }
  video.removeAttribute("src");
  video.load();
  const smoothed = smooth(raw);
  const origin = smoothed[0] ?? { t: inPoint, x: 0, y: 0 };
  return smoothed.map((sample) => ({
    t: sample.t,
    x: -(sample.x - origin.x),
    y: -(sample.y - origin.y),
  }));
}
