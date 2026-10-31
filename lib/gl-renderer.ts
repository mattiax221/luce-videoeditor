import type { Vec3 } from "@/lib/grade";
import type { Rect } from "@/lib/frame";

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform float uTemperature;
uniform float uTint;
uniform float uVignette;
uniform float uGrain;
uniform float uFade;
uniform float uTime;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;

vec3 toLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }

void main() {
  vec3 color = toLinear(texture2D(uTex, vUv).rgb);
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
  float n = fract(sin(dot(gl_FragCoord.xy + vec2(uTime * 13.1, uTime * 7.7), vec2(12.9898, 78.233))) * 43758.5453);
  color += (n - 0.5) * uGrain * 0.16;
  float vig = smoothstep(0.9, 0.28, distance(vUv, vec2(0.5)));
  color *= mix(1.0, vig, clamp(uVignette, 0.0, 1.0));
  color *= uFade;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
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
  private buffer: WebGLBuffer;
  private position: number;
  private locations: Record<string, WebGLUniformLocation | null> = {};

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
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.position = gl.getAttribLocation(program, "aPos");
    for (const name of [
      "uTex",
      "uExposure",
      "uContrast",
      "uSaturation",
      "uTemperature",
      "uTint",
      "uVignette",
      "uGrain",
      "uFade",
      "uTime",
      "uLift",
      "uGamma",
      "uGain",
    ]) {
      this.locations[name] = gl.getUniformLocation(program, name);
    }
  }

  clear() {
    const canvas = this.gl.canvas as HTMLCanvasElement;
    this.gl.viewport(0, 0, canvas.width, canvas.height);
    this.gl.clearColor(0, 0, 0, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  draw(video: HTMLVideoElement, rect: Rect, grade: GradeDraw) {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    this.clear();
    if (video.readyState < 2 || rect.w < 1 || rect.h < 1) return;
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    } catch {
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(this.position);
    gl.vertexAttribPointer(this.position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(this.locations.uTex, 0);
    gl.uniform1f(this.locations.uExposure, grade.exposure);
    gl.uniform1f(this.locations.uContrast, grade.contrast);
    gl.uniform1f(this.locations.uSaturation, grade.saturation);
    gl.uniform1f(this.locations.uTemperature, grade.temperature);
    gl.uniform1f(this.locations.uTint, grade.tint);
    gl.uniform1f(this.locations.uVignette, grade.vignette);
    gl.uniform1f(this.locations.uGrain, grade.grain);
    gl.uniform1f(this.locations.uFade, grade.fade);
    gl.uniform1f(this.locations.uTime, grade.time);
    gl.uniform3fv(this.locations.uLift, grade.lift);
    gl.uniform3fv(this.locations.uGamma, grade.gamma);
    gl.uniform3fv(this.locations.uGain, grade.gain);
    gl.viewport(
      Math.round(rect.x),
      Math.round(canvas.height - rect.y - rect.h),
      Math.max(1, Math.round(rect.w)),
      Math.max(1, Math.round(rect.h)),
    );
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  destroy() {
    this.gl.deleteTexture(this.texture);
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteProgram(this.program);
  }
}
