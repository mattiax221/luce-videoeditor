export function renderScopes(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  wave: CanvasRenderingContext2D,
  scope: CanvasRenderingContext2D,
) {
  const waveW = wave.canvas.width;
  const waveH = wave.canvas.height;
  wave.clearRect(0, 0, waveW, waveH);
  wave.fillStyle = "rgba(228,160,74,0.9)";
  const stepX = Math.max(1, Math.floor(width / waveW));
  const stepY = Math.max(1, Math.floor(height / 48));
  for (let x = 0; x < waveW; x += 1) {
    const srcX = Math.min(width - 1, x * stepX);
    for (let y = 0; y < height; y += stepY) {
      const index = (y * width + srcX) * 4;
      const luma = (pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722) / 255;
      const plot = Math.round((1 - luma) * (waveH - 1));
      wave.fillRect(x, plot, 1, 1);
    }
  }

  const size = scope.canvas.width;
  scope.fillStyle = "#100f0d";
  scope.fillRect(0, 0, size, size);
  const image = scope.getImageData(0, 0, size, size);
  const data = image.data;
  const stride = Math.max(1, Math.floor((width * height) / 4000));
  for (let index = 0; index < width * height; index += stride) {
    const offset = index * 4;
    const r = pixels[offset] / 255;
    const g = pixels[offset + 1] / 255;
    const b = pixels[offset + 2] / 255;
    const cb = (b - (0.2126 * r + 0.7152 * g + 0.0722 * b)) * 0.5 + 0.5;
    const cr = (r - (0.2126 * r + 0.7152 * g + 0.0722 * b)) * 0.5 + 0.5;
    const px = Math.max(0, Math.min(size - 1, Math.round(cr * (size - 1))));
    const py = Math.max(0, Math.min(size - 1, Math.round((1 - cb) * (size - 1))));
    const pixel = (py * size + px) * 4;
    data[pixel] = Math.min(255, data[pixel] + 40);
    data[pixel + 1] = Math.min(255, data[pixel + 1] + 28);
    data[pixel + 2] = Math.min(255, data[pixel + 2] + 18);
    data[pixel + 3] = 255;
  }
  scope.putImageData(image, 0, 0);
}
