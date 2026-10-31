import type { Rect } from "@/lib/frame";
import type { Vec3 } from "@/lib/grade";
import { hexToRgb } from "@/lib/lut";
import type { Chroma, Lut, Mask } from "@/lib/types";

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform float uRot;
void main() {
  vUv = aPos * 0.5 + 0.5;
  vec2 p = aPos * uHalf;
  float c = cos(uRot);
  float s = sin(uRot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  gl_Position = vec4(p + uCenter, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uLut;
uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform float uTemperature;
uniform float uTint;
uniform float uVignette;
uniform float uGrain;
uniform float uFade;
uniform float uOpacity;
uniform float uTime;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform float uUseLut;
uniform float uLutSize;
uniform float uChromaOn;
uniform vec3 uKey;
uniform float uSimilarity;
uniform float uSmooth;
uniform float uMaskOn;
uniform vec4 uMask;
uniform float uFeather;

vec3 toLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }

vec3 applyLut(vec3 color) {
  if (uUseLut < 0.5) return color;
  float size = max(uLutSize, 2.0);
  float maxIndex = size - 1.0;
  float blue = clamp(color.b, 0.0, 1.0) * maxIndex;
  float z0 = floor(blue);
  float z1 = min(z0 + 1.0, maxIndex);
  float zf = blue - z0;
  float r = clamp(color.r, 0.0, 1.0) * maxIndex;
  float g = clamp(color.g, 0.0, 1.0) * maxIndex;
  float width = size * size;
  vec2 uv0 = vec2((z0 * size + r + 0.5) / width, (g + 0.5) / size);
  vec2 uv1 = vec2((z1 * size + r + 0.5) / width, (g + 0.5) / size);
  return mix(texture2D(uLut, uv0).rgb, texture2D(uLut, uv1).rgb, zf);
}

void main() {
  vec3 src = texture2D(uTex, vUv).rgb;
  float alpha = 1.0;
  if (uChromaOn > 0.5) {
    float dist = distance(src, uKey);
    alpha *= smoothstep(uSimilarity, uSimilarity + max(uSmooth, 0.001), dist);
  }
  vec3 color = toLinear(src);
  color *= pow(2.0, uExposure);
  color = color * uGain + uLift;
  color = pow(max(color, vec3(0.0)), vec3(1.0) / max(uGamma, vec3(0.05)));
  color = toSrgb(max(color, vec3(0.0)));
  color.r += uTemperature * 0.09;
  color.b -= uTemperature * 0.09;
  color.g += uTint * 0.07;
  color = (color - 0.5) * uContrast + 0.5;
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luma), color, uSaturation);
  color = applyLut(clamp(color, 0.0, 1.0));
  float n = fract(sin(dot(gl_FragCoord.xy + vec2(uTime * 13.1, uTime * 7.7), vec2(12.9898, 78.233))) * 43758.5453);
  color += (n - 0.5) * uGrain * 0.16;
  float vig = smoothstep(0.9, 0.28, distance(vUv, vec2(0.5)));
  color *= mix(1.0, vig, clamp(uVignette, 0.0, 1.0));
  if (uMaskOn > 0.5) {
    float py = 1.0 - vUv.y;
    float feather = max(uFeather, 0.001);
    float inside = smoothstep(uMask.x - feather, uMask.x + feather, vUv.x);
    inside *= smoothstep(uMask.x + uMask.z + feather, uMask.x + uMask.z - feather, vUv.x);
    inside *= smoothstep(uMask.y - feather, uMask.y + feather, py);
    inside *= smoothstep(uMask.y + uMask.w + feather, uMask.y + uMask.w - feather, py);
    alpha *= inside;
  }
  alpha *= clamp(uOpacity, 0.0, 1.0) * clamp(uFade, 0.0, 1.0);
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), alpha);
}
`;

export type GradeDraw = {
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  vignette: number;
  grain: number;
  fade: number;
  time: number;
  lift: Vec3;
  gamma: Vec3;
  gain: Vec3;
};

export type LayerDraw = {
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
  rect: Rect;
  grade: GradeDraw;
  opacity: number;
  panX: number;
  panY: number;
  scale: number;
  rotate: number;
  mask: Mask;
  chroma: Chroma;
};

const UNIFORMS = [
  "uTex",
  "uLut",
  "uExposure",
  "uContrast",
  "uSaturation",
  "uTemperature",
  "uTint",
  "uVignette",
  "uGrain",
  "uFade",
  "uOpacity",
  "uTime",
  "uLift",
  "uGamma",
  "uGain",
  "uUseLut",
  "uLutSize",
  "uChromaOn",
  "uKey",
  "uSimilarity",
  "uSmooth",
  "uMaskOn",
  "uMask",
  "uFeather",
  "uCenter",
  "uHalf",
  "uRot",
];

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export class GradeRenderer {
  private program: WebGLProgram;
  private texture: WebGLTexture;
  private lutTexture: WebGLTexture;
  private buffer: WebGLBuffer;
  private position: number;
  private locations: Record<string, WebGLUniformLocation | null> = {};
  private lutId: string | null = null;

  static tryCreate(canvas: HTMLCanvasElement): GradeRenderer | null {
    try {
      const gl = canvas.getContext("webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
      });
      if (!gl) return null;
      return new GradeRenderer(gl);
    } catch {
      return null;
    }
  }

  private constructor(private gl: WebGLRenderingContext) {
    const vertex = compile(gl, gl.VERTEX_SHADER, VERT);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) throw new Error("shader");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      throw new Error("link");
    }
    this.program = program;
    this.texture = gl.createTexture()!;
    this.lutTexture = gl.createTexture()!;
    for (const texture of [this.texture, this.lutTexture]) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }
    this.buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.position = gl.getAttribLocation(program, "aPos");
    for (const name of UNIFORMS) this.locations[name] = gl.getUniformLocation(program, name);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  clear() {
    const canvas = this.gl.canvas as HTMLCanvasElement;
    this.gl.viewport(0, 0, canvas.width, canvas.height);
    this.gl.clearColor(0, 0, 0, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  setLut(lut: Lut | null) {
    if (!lut) {
      this.lutId = null;
      return;
    }
    if (this.lutId === lut.id) return;
    const size = lut.size;
    const width = size * size;
    const rgba = new Uint8Array(width * size * 4);
    for (let blue = 0; blue < size; blue += 1) {
      for (let green = 0; green < size; green += 1) {
        for (let red = 0; red < size; red += 1) {
          const source = (red + green * size + blue * size * size) * 3;
          const x = red + blue * size;
          const pixel = (green * width + x) * 4;
          rgba[pixel] = Math.round(Math.min(1, Math.max(0, lut.data[source] ?? 0)) * 255);
          rgba[pixel + 1] = Math.round(Math.min(1, Math.max(0, lut.data[source + 1] ?? 0)) * 255);
          rgba[pixel + 2] = Math.round(Math.min(1, Math.max(0, lut.data[source + 2] ?? 0)) * 255);
          rgba[pixel + 3] = 255;
        }
      }
    }
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    this.lutId = lut.id;
  }

  draw(layer: LayerDraw, lut: Lut | null) {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    const rect = layer.rect;
    if (rect.w < 1 || rect.h < 1) return;
    this.setLut(lut);
    gl.useProgram(this.program);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.source);
    } catch {
      return;
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(this.position);
    gl.vertexAttribPointer(this.position, 2, gl.FLOAT, false, 0, 0);
    const scale = layer.scale > 0 ? layer.scale : 1;
    const halfX = (rect.w / canvas.width) * scale;
    const halfY = (rect.h / canvas.height) * scale;
    const centerX = ((rect.x + rect.w / 2) / canvas.width) * 2 - 1 + layer.panX * 2;
    const centerY = 1 - ((rect.y + rect.h / 2) / canvas.height) * 2 + layer.panY * 2;
    const grade = layer.grade;
    const key = hexToRgb(layer.chroma.color);
    gl.uniform1i(this.locations.uTex, 0);
    gl.uniform1i(this.locations.uLut, 1);
    gl.uniform1f(this.locations.uExposure, grade.exposure);
    gl.uniform1f(this.locations.uContrast, grade.contrast);
    gl.uniform1f(this.locations.uSaturation, grade.saturation);
    gl.uniform1f(this.locations.uTemperature, grade.temperature);
    gl.uniform1f(this.locations.uTint, grade.tint);
    gl.uniform1f(this.locations.uVignette, grade.vignette);
    gl.uniform1f(this.locations.uGrain, grade.grain);
    gl.uniform1f(this.locations.uFade, grade.fade);
    gl.uniform1f(this.locations.uOpacity, layer.opacity);
    gl.uniform1f(this.locations.uTime, grade.time);
    gl.uniform3fv(this.locations.uLift, grade.lift);
    gl.uniform3fv(this.locations.uGamma, grade.gamma);
    gl.uniform3fv(this.locations.uGain, grade.gain);
    gl.uniform1f(this.locations.uUseLut, lut ? 1 : 0);
    gl.uniform1f(this.locations.uLutSize, lut?.size ?? 2);
    gl.uniform1f(this.locations.uChromaOn, layer.chroma.enabled ? 1 : 0);
    gl.uniform3f(this.locations.uKey, key[0], key[1], key[2]);
    gl.uniform1f(this.locations.uSimilarity, layer.chroma.similarity);
    gl.uniform1f(this.locations.uSmooth, layer.chroma.smoothness);
    gl.uniform1f(this.locations.uMaskOn, layer.mask.enabled ? 1 : 0);
    gl.uniform4f(this.locations.uMask, layer.mask.x, layer.mask.y, layer.mask.w, layer.mask.h);
    gl.uniform1f(this.locations.uFeather, layer.mask.feather);
    gl.uniform2f(this.locations.uCenter, centerX, centerY);
    gl.uniform2f(this.locations.uHalf, halfX, halfY);
    gl.uniform1f(this.locations.uRot, (layer.rotate * Math.PI) / 180);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  destroy() {
    this.gl.deleteTexture(this.texture);
    this.gl.deleteTexture(this.lutTexture);
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteProgram(this.program);
  }
}
