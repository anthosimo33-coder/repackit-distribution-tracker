"use client";

import { useEffect, useRef } from "react";

/**
 * Diamant filaire du hero — le même objet que la landing Jarvia (rayons depuis
 * la pointe, arêtes blanches, quelques arêtes améthyste et champagne), mais
 * écrit en WebGL BRUT : la landing charge three.js depuis un CDN (~600 ko) pour
 * dessiner 108 segments de ligne. Ici c'est un seul buffer et deux shaders.
 *
 * Respecte l'environnement :
 *   - `prefers-reduced-motion` → rien n'est monté, le canvas reste vide ;
 *   - hors hero (scroll > 1,15 écran) ou onglet caché → la boucle s'arrête ;
 *   - pas de WebGL → on ne rend rien, les rayons SVG suffisent au décor.
 * Purement décoratif : `aria-hidden`, jamais dans l'ordre de tabulation.
 */

const VERT = `
attribute vec3 p;
attribute vec3 c;
uniform mat4 mvp;
varying vec3 vc;
void main() {
  vc = c;
  gl_Position = mvp * vec4(p, 1.0);
}`;

const FRAG = `
precision mediump float;
varying vec3 vc;
uniform float alpha;
void main() {
  gl_FragColor = vec4(vc * alpha, alpha);
}`;

/** Géométrie du diamant : couronne, rayons vers la pointe, rayons vers l'apex. */
function buildGeometry() {
  const N = 36;
  const R = 1.25;
  const rimY = 0.95;
  const tipY = -1.4;
  const apexY = 1.5;
  const white = [1, 1, 1];
  const amethyst = [0.66, 0.55, 0.93];
  const champagne = [0.93, 0.88, 0.79];
  const pts: number[] = [];
  const cols: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const a2 = ((i + 1) / N) * Math.PI * 2;
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    const c = i % 7 === 0 ? amethyst : i % 5 === 0 ? champagne : white;
    pts.push(x, rimY, z, Math.cos(a2) * R, rimY, Math.sin(a2) * R);
    cols.push(...white, ...white);
    pts.push(x, rimY, z, 0, tipY, 0);
    cols.push(...c, ...c);
    pts.push(x, rimY, z, Math.cos(a) * 0.16, apexY, Math.sin(a) * 0.16);
    cols.push(...c, ...c);
  }
  return { pts: new Float32Array(pts), cols: new Float32Array(cols) };
}

/** mvp = perspective · translation caméra · rotations X/Y/Z, en colonne-major. */
function mvpMatrix(rx: number, ry: number, rz: number, aspect: number) {
  const f = 1 / Math.tan((35 * Math.PI) / 180 / 2);
  const near = 0.1;
  const far = 50;
  const cz = 5.4;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cr = Math.cos(rz);
  const sr = Math.sin(rz);
  // R = Rz · Ry · Rx (ordre des rotations de la landing)
  const m00 = cr * cy;
  const m01 = cr * sy * sx - sr * cx;
  const m02 = cr * sy * cx + sr * sx;
  const m10 = sr * cy;
  const m11 = sr * sy * sx + cr * cx;
  const m12 = sr * sy * cx - cr * sx;
  const m20 = -sy;
  const m21 = cy * sx;
  const m22 = cy * cx;
  const px = f / aspect;
  const pz = (far + near) / (near - far);
  const pw = (2 * far * near) / (near - far);
  return new Float32Array([
    px * m00, f * m10, pz * m20, -m20,
    px * m01, f * m11, pz * m21, -m21,
    px * m02, f * m12, pz * m22, -m22,
    0, 0, pz * -cz + pw, cz,
  ]);
}

export function HeroDiamond({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
    if (!gl) return;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const { pts, cols } = buildGeometry();
    const bind = (data: Float32Array, name: string) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
      return buf;
    };
    const posBuf = bind(pts, "p");
    const colBuf = bind(cols, "c");
    const mvpLoc = gl.getUniformLocation(prog, "mvp");
    gl.uniform1f(gl.getUniformLocation(prog, "alpha"), 0.5);
    // Additif sur fond noir : les arêtes qui se croisent s'éclairent.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    let width = 0;
    let height = 0;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = Math.max(1, Math.round(r.width * dpr));
      height = Math.max(1, Math.round(r.height * dpr));
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    };
    resize();
    window.addEventListener("resize", resize);

    // La souris incline l'objet, comme sur la landing (amorti, jamais brutal).
    let px = window.innerWidth / 2;
    let py = window.innerHeight / 2;
    const onMove = (e: PointerEvent) => {
      px = e.clientX;
      py = e.clientY;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    let rx = 0.12;
    let ry = 0;
    let rz = 0;
    let last = performance.now();
    let shown = false;
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      // Hors hero ou onglet caché : on ne dessine pas (batterie).
      if (document.hidden || window.scrollY > window.innerHeight * 1.15) {
        last = performance.now();
        return;
      }
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ry += dt * ((Math.PI * 2) / 40); // un tour en 40 s
      const tx = 0.12 + (py / window.innerHeight - 0.45) * 0.16;
      const tz = (px / window.innerWidth - 0.5) * -0.1;
      rx += (tx - rx) * 0.04;
      rz += (tz - rz) * 0.04;
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniformMatrix4fv(mvpLoc, false, mvpMatrix(rx, ry, rz, width / height));
      gl.drawArrays(gl.LINES, 0, pts.length / 3);
      if (!shown) {
        shown = true;
        canvas.style.opacity = "0.85";
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      gl.deleteBuffer(posBuf);
      gl.deleteBuffer(colBuf);
      gl.deleteProgram(prog);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={className}
      style={{ opacity: 0, transition: "opacity 1.4s ease" }}
    />
  );
}
