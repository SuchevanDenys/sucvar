// app/lib/studio/meshRenderer.ts
// Randarea plasei reale a scanării (OBJ texturat / colorat) cu WebGL2 nativ — fără biblioteci 3D.
//
//   • `ScanMeshRenderer` — încarcă plasa o singură dată în buffere GPU (indici Uint32, un apel de desen per material)
//     și o desenează pentru o `MeshView` (lib/studio/scanRender.ts). Contextul are `preserveDrawingBuffer: true`,
//     deci `canvas.toDataURL()` capturează mereu exact cadrul afișat.
//   • Texturile: JPEG / PNG din arhivă decodate o singură dată (`loadScanTextures`, cache pe plasă), limitate la
//     4096 px (garantat pe orice GPU WebGL2, inclusiv telefoane); mipmap + filtrare anizotropă.
//   • „Vedere ansamblu”: fețele din spate sunt eliminate după orientarea detectată de parser, deci pereții apropiați
//     dispar (casă de păpuși); în vederile interioare se desenează ambele fețe (fără găuri la orientări amestecate).
//   • Umbrire netedă pe ambele fețe: normalele pe vârf din parser (`ScanMesh.normals`), întoarse spre ochi.
//   • `renderScanMeshToImage` — sursa Studio: aceeași vedere, 1280 × 800, pe un canvas separat (fără cotele 2D).

import type { RoomScan, ScanMesh } from './lidarParser';
import { AI_LIMITS } from './aiConfig';
import { STUDIO_SCAN_SIZE, meshCamera, meshViewProjection, type MeshView } from './scanRender';

const MAX_TEXTURE_SIDE = 4096;

const VERTEX_SHADER = `#version 300 es
in vec3 aPos;
in vec2 aUv;
in vec3 aCol;
in vec3 aNor;
uniform mat4 uMvp;
out vec2 vUv;
out vec3 vCol;
out vec3 vPos;
out vec3 vNor;
void main() {
  vUv = aUv;
  vCol = aCol;
  vPos = aPos;
  vNor = aNor;
  gl_Position = uMvp * vec4(aPos, 1.0);
}`;

// Umbrire netedă, pe ambele fețe (plasele LiDAR au orientări amestecate, iar din interior vedem spatele pereților):
//   • normala netedă interpolată (din parser), întoarsă spre ochi; dacă deviază mult de la fața reală (colțurile unei
//     cutii RoomPlan cu vârfuri comune), revine lin la normala plană din derivate → muchii curate, suprafețe catifelate.
//   • lumina: emisferică (cer / podea) + o lumină caldă de sus + o lumină „de cameră” (din ochi) — nicio zonă neagră.
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vCol;
in vec3 vPos;
in vec3 vNor;
uniform int uMode;
uniform sampler2D uTex;
uniform vec3 uColor;
uniform vec3 uEye;
out vec4 outColor;
const vec3 KEY = vec3(0.3487, 0.8767, 0.3188); // normalize(0.35, 0.88, 0.32)
void main() {
  vec3 toEye = normalize(uEye - vPos);
  vec3 nf = normalize(cross(dFdx(vPos), dFdy(vPos)));
  if (dot(nf, toEye) < 0.0) nf = -nf;
  vec3 n = nf;
  float ls = length(vNor);
  if (ls > 0.2) {
    vec3 ns = vNor / ls;
    if (dot(ns, toEye) < 0.0) ns = -ns;
    n = normalize(mix(nf, ns, smoothstep(0.55, 0.85, dot(ns, nf))));
  }
  float hemi = 0.5 + 0.5 * n.y;
  float key = max(dot(n, KEY), 0.0);
  float head = max(dot(n, toEye), 0.0);
  float diffuse = 0.45 * key + 0.35 * head + 0.2 * hemi;
  vec3 c;
  if (uMode == 0) {
    // Textura are deja lumina reală a camerei (fotogrammetrie): fără umbrire suplimentară
    c = texture(uTex, vec2(vUv.x, 1.0 - vUv.y)).rgb;
  } else if (uMode == 1) {
    // Culorile pe vârf au și ele lumina reală, dar la rezoluția plasei: umbrire moderată pentru relief
    c = vCol * (0.72 + 0.36 * diffuse);
  } else {
    c = uColor * (0.5 + 0.56 * diffuse);
  }
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export type TextureSource = ImageBitmap | HTMLCanvasElement;

// ── Texturi (cache pe plasă: vizualizatorul și captura Studio folosesc aceleași imagini decodate) ─────────────

const textureCache = new WeakMap<ScanMesh, Promise<Map<string, TextureSource>>>();

async function decodeTexture(data: Uint8Array, mime: string): Promise<TextureSource> {
  const bitmap = await createImageBitmap(new Blob([data as BlobPart], { type: mime }));
  const side = Math.max(bitmap.width, bitmap.height);
  if (side <= MAX_TEXTURE_SIDE) return bitmap;
  const k = MAX_TEXTURE_SIDE / side;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * k));
  canvas.height = Math.max(1, Math.round(bitmap.height * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) return bitmap;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

/** Decodează (o singură dată) texturile plasei; o textură care nu se poate decoda e omisă (grupul cade pe culoare). */
export function loadScanTextures(mesh: ScanMesh): Promise<Map<string, TextureSource>> {
  let p = textureCache.get(mesh);
  if (!p) {
    p = (async () => {
      const out = new Map<string, TextureSource>();
      await Promise.all(
        mesh.textures.map(async (t) => {
          try {
            out.set(t.name, await decodeTexture(t.data, t.mime));
          } catch {
            /* imagine coruptă: grupul rămâne colorat */
          }
        }),
      );
      return out;
    })();
    textureCache.set(mesh, p);
  }
  return p;
}

// ── Renderer ─────────────────────────────────────────────────────────────────

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error('createShader failed');
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`shader: ${log}`);
  }
  return s;
}

export class ScanMeshRenderer {
  readonly gl: WebGL2RenderingContext;
  private readonly mesh: ScanMesh;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly buffers: WebGLBuffer[] = [];
  private readonly textures = new Map<string, WebGLTexture>();
  private readonly uMvp: WebGLUniformLocation | null;
  private readonly uMode: WebGLUniformLocation | null;
  private readonly uColor: WebGLUniformLocation | null;
  private readonly uTex: WebGLUniformLocation | null;
  private readonly uEye: WebGLUniformLocation | null;
  private readonly aniso: { ext: EXT_texture_filter_anisotropic; max: number } | null;

  /** null = WebGL2 indisponibil (vizualizatorul cade pe schema 2D). */
  static create(canvas: HTMLCanvasElement, mesh: ScanMesh): ScanMeshRenderer | null {
    const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) return null;
    try {
      return new ScanMeshRenderer(gl, mesh);
    } catch {
      return null;
    }
  }

  private constructor(gl: WebGL2RenderingContext, mesh: ScanMesh) {
    this.gl = gl;
    this.mesh = mesh;
    const prog = gl.createProgram();
    if (!prog) throw new Error('createProgram failed');
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.bindAttribLocation(prog, 1, 'aUv');
    gl.bindAttribLocation(prog, 2, 'aCol');
    gl.bindAttribLocation(prog, 3, 'aNor');
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(prog)}`);
    this.program = prog;
    this.uMvp = gl.getUniformLocation(prog, 'uMvp');
    this.uMode = gl.getUniformLocation(prog, 'uMode');
    this.uColor = gl.getUniformLocation(prog, 'uColor');
    this.uTex = gl.getUniformLocation(prog, 'uTex');
    this.uEye = gl.getUniformLocation(prog, 'uEye');

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('createVertexArray failed');
    this.vao = vao;
    gl.bindVertexArray(vao);
    const attrib = (loc: number, data: Float32Array | null, size: number, fallback: number[]) => {
      if (!data) {
        gl.disableVertexAttribArray(loc);
        if (size === 2) gl.vertexAttrib2f(loc, fallback[0], fallback[1]);
        else gl.vertexAttrib3f(loc, fallback[0], fallback[1], fallback[2]);
        return;
      }
      const b = gl.createBuffer();
      if (!b) throw new Error('createBuffer failed');
      this.buffers.push(b);
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    attrib(0, mesh.positions, 3, [0, 0, 0]);
    attrib(1, mesh.uvs, 2, [0, 0]);
    attrib(2, mesh.colors, 3, [0.9, 0.87, 0.83]);
    attrib(3, mesh.normals, 3, [0, 0, 0]);
    const ib = gl.createBuffer();
    if (!ib) throw new Error('createBuffer failed');
    this.buffers.push(ib);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    this.aniso = ext ? { ext, max: Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) } : null;
  }

  get hasPendingTextures(): boolean {
    return this.mesh.groups.some((g) => g.texture && !this.textures.has(g.texture));
  }

  setTextures(images: Map<string, TextureSource>): void {
    const gl = this.gl;
    for (const [name, img] of images) {
      if (this.textures.has(name)) continue;
      const tex = gl.createTexture();
      if (!tex) continue;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.ext.TEXTURE_MAX_ANISOTROPY_EXT, this.aniso.max);
      this.textures.set(name, tex);
    }
  }

  /**
   * Desenează vederea în tot canvas-ul (`width` × `height` = pixelii buffer-ului). Returnează matricea folosită
   * (cotele 2D se proiectează cu exact aceeași matrice).
   */
  draw(view: MeshView, scan: RoomScan, width: number, height: number, background: [number, number, number]): Float32Array {
    const gl = this.gl;
    const aspect = width / Math.max(1, height);
    const cam = meshCamera(view, scan, aspect);
    const mvp = meshViewProjection(cam, aspect);
    gl.viewport(0, 0, width, height);
    gl.clearColor(background[0], background[1], background[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    // Casa de păpuși doar din exterior; din interior ambele fețe (o plasă cu orientare amestecată nu face găuri)
    if (view.kind === 'orbit') {
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.frontFace(this.mesh.windingInward ? gl.CCW : gl.CW);
    } else {
      gl.disable(gl.CULL_FACE);
    }
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uMvp, false, mvp);
    gl.uniform3f(this.uEye, cam.eye[0], cam.eye[1], cam.eye[2]);
    gl.uniform1i(this.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(this.vao);
    const vertexColors = Boolean(this.mesh.colors);
    for (const g of this.mesh.groups) {
      const tex = g.texture ? this.textures.get(g.texture) : undefined;
      if (tex) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(this.uMode, 0);
      } else {
        gl.uniform1i(this.uMode, vertexColors ? 1 : 2);
        gl.uniform3f(this.uColor, g.color[0], g.color[1], g.color[2]);
      }
      gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, g.start * 4);
    }
    gl.bindVertexArray(null);
    return mvp;
  }

  dispose(loseContext = false): void {
    const gl = this.gl;
    for (const t of this.textures.values()) gl.deleteTexture(t);
    for (const b of this.buffers) gl.deleteBuffer(b);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
    this.textures.clear();
    if (loseContext) gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/** Fundalul capturii (același ca exportul schematic: imaginea trimisă modelului nu depinde de tema interfeței). */
export const CAPTURE_BACKGROUND: [number, number, number] = [0xfa / 255, 0xf8 / 255, 0xf6 / 255];

/**
 * Sursa Studio din plasa reală: vederea curentă, 1280 × 800 (vizualizatorul din modal are tot 16:10, deci încadrarea e
 * identică), cu aceleași culori / texturi / umbrire netedă, fără cote: liniile și etichetele de cotă ar fi „redesenate”
 * de modelul AI ca obiecte în cameră; cotele reale ajung în prompt prin `roomDimensions`.
 * PNG; dacă PNG-ul depășește limita serverului (texturi foarte bogate), JPEG 0,92 → 0,8.
 */
export async function renderScanMeshToImage(
  scan: RoomScan,
  view: MeshView,
  opts: { width?: number; height?: number } = {},
): Promise<string> {
  if (!scan.mesh) throw new Error('renderScanMeshToImage: scan has no mesh');
  const width = opts.width ?? STUDIO_SCAN_SIZE.width;
  const height = opts.height ?? STUDIO_SCAN_SIZE.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const renderer = ScanMeshRenderer.create(canvas, scan.mesh);
  if (!renderer) throw new Error('renderScanMeshToImage: WebGL2 unavailable');
  try {
    renderer.setTextures(await loadScanTextures(scan.mesh));
    renderer.draw(view, scan, width, height, CAPTURE_BACKGROUND);
    renderer.gl.finish();
    let url = canvas.toDataURL('image/png');
    for (const q of [0.92, 0.8]) {
      if (url.length <= AI_LIMITS.maxImageLength) break;
      url = canvas.toDataURL('image/jpeg', q);
    }
    if (!url.startsWith('data:image/')) throw new Error('renderScanMeshToImage: export failed');
    return url;
  } finally {
    renderer.dispose(true);
  }
}

/** WebGL2 disponibil în acest browser (verificare ieftină, rezultat memorat). */
let webgl2Support: boolean | null = null;
export function supportsWebGL2(): boolean {
  if (webgl2Support === null) {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      webgl2Support = Boolean(gl);
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      webgl2Support = false;
    }
  }
  return webgl2Support;
}