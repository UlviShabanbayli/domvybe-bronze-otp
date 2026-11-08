// DV90 BRONZE OTP · textures built once per page: the digit atlas and a tileable noise texture.
// Atlas: ten cells 0–9 of Playfair Display 900. R = sharp coverage, G = small blur (chamfer normal),
// A = medium blur (rounded body of the relief), B = wide blur (drop shadow, glow). The visible glyph EDGE never comes
// from here: it is an SVG <text> clip in the DOM, sharp at any DSF.

export const FAMILY = "'Playfair Display'";
export const AF = 200;                        // atlas font px
export const PAD = 40;                        // blur room around each glyph
export const CELL_W = Math.ceil(0.78 * AF) + 2 * PAD;
export const ASC = Math.ceil(0.80 * AF);
export const BASE_ROW = PAD + ASC;            // baseline row inside a cell
export const CELL_H = BASE_ROW + Math.ceil(0.06 * AF) + PAD;

function boxBlur(src, w, h, r, passes) {
  let a = Float32Array.from(src), b = new Float32Array(w * h);
  const inv = 1 / (2 * r + 1);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const o = y * w; let s = 0;
      for (let x = -r; x <= r; x++) s += a[o + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) { b[o + x] = s * inv; s += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)]; }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) { a[y * w + x] = s * inv; s += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x]; }
    }
  }
  return a;
}

// cap height of the numerals / font size, measured from the font itself (centres the digit in the mould)
export function measureCap() {
  const c = document.createElement('canvas').getContext('2d');
  c.font = `900 ${AF}px ${FAMILY}`;
  let asc = 0, n = 0;
  for (const d of '0123456789') { const m = c.measureText(d); asc += m.actualBoundingBoxAscent - Math.max(0, m.actualBoundingBoxDescent); n++; }
  const v = asc / n / AF;
  return v > 0.4 && v < 1 ? v : 0.72;
}

export function buildAtlas() {
  const W = CELL_W * 10, H = CELL_H;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = `900 ${AF}px ${FAMILY}`;
  for (let d = 0; d < 10; d++) g.fillText(String(d), d * CELL_W + CELL_W / 2, BASE_ROW);
  const img = g.getImageData(0, 0, W, H).data;
  const R = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) R[i] = img[i * 4] / 255;
  const G = boxBlur(R, W, H, 3, 2), A = boxBlur(R, W, H, 7, 3), B = boxBlur(R, W, H, 13, 3);
  const out = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    out[i * 4] = R[i] * 255; out[i * 4 + 1] = Math.min(255, G[i] * 255);
    out[i * 4 + 2] = Math.min(255, B[i] * 255 * 1.4); out[i * 4 + 3] = Math.min(255, A[i] * 255);
  }
  return { data: out, w: W, h: H };
}

// tileable value-noise fbm, 256², four independent channels:
// R fine grain (sand / cast skin) · G medium (convection, crust) · B second medium (crack warp) · A coarse (patina clouds)
export function buildNoise(N = 256) {
  const lat = (n, seed) => { const a = new Float32Array(n * n); let s = seed; for (let i = 0; i < a.length; i++) { s = (s * 16807) % 2147483647; a[i] = s / 2147483647; } return a; };
  const fbm = (base, oct, seed, gain = 0.5) => {
    const out = new Float32Array(N * N); let amp = 0.5, tot = 0;
    for (let o = 0, n = base; o < oct; o++, n *= 2, amp *= gain) {
      const L = lat(n, seed + o * 131), k = N / n;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const fx = x / k, fy = y / k, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const a = L[(iy % n) * n + ix % n], b = L[(iy % n) * n + (ix + 1) % n], c = L[((iy + 1) % n) * n + ix % n], d = L[((iy + 1) % n) * n + (ix + 1) % n];
        out[y * N + x] += amp * ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy);
      }
      tot += amp;
    }
    // normalise to 0..1 by the actual range (keeps contrast on every channel)
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i < out.length; i++) { const v = out[i] / tot; out[i] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo);
    return out;
  };
  const R = fbm(32, 3, 101, 0.55), G = fbm(4, 5, 202), B = fbm(4, 5, 303), A = fbm(2, 4, 404);
  const u8 = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) { u8[i * 4] = R[i] * 255; u8[i * 4 + 1] = G[i] * 255; u8[i * 4 + 2] = B[i] * 255; u8[i * 4 + 3] = A[i] * 255; }
  return { data: u8, w: N, h: N };
}
