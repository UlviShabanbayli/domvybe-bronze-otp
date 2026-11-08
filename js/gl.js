// DV90 BRONZE OTP (from DV85) · small WebGL2 helper: a context per canvas, programs (full-screen triangle or custom vertex
// shader), uniforms by name, textures, a resize that measures the untransformed box.

const VS_TRI = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

export function makeGL(canvas, { alpha = false, dprMax = 2, maxPixels = 4.5e6 } = {}) {
  let gl = null;
  try {
    gl = canvas.getContext('webgl2', { alpha, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
      preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  } catch (e) { gl = null; }
  if (!gl) return null;
  const tri = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, tri);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const ctx = {
    gl, canvas, dpr: 1, w: 1, h: 1, dprMax, maxPixels, lost: false,
    program(fs, vs = VS_TRI) {
      const sh = (type, src) => {
        const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s) || 'shader');
        return s;
      };
      const pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(pr, 0, 'p'); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(pr) || 'link');
      const locs = {};
      const P = {
        pr,
        use() { gl.useProgram(pr); return P; },
        tri() { gl.bindBuffer(gl.ARRAY_BUFFER, tri); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(0, 0); return P; },
        loc(n) { return n in locs ? locs[n] : (locs[n] = gl.getUniformLocation(pr, n)); },
        f(n, ...v) {
          const l = P.loc(n); if (l === null) return P;
          if (v.length === 1) gl.uniform1f(l, v[0]); else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
          else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]); else gl.uniform4f(l, v[0], v[1], v[2], v[3]);
          return P;
        },
        v4(n, a) { const l = P.loc(n); if (l !== null) gl.uniform4fv(l, a); return P; },
        fv(n, a) { const l = P.loc(n); if (l !== null) gl.uniform1fv(l, a); return P; },
        i(n, v) { const l = P.loc(n); if (l !== null) gl.uniform1i(l, v); return P; },
        draw() { gl.drawArrays(gl.TRIANGLES, 0, 3); return P; },
      };
      return P;
    },
    // size the drawing buffer to the element's layout box (CSS px × dpr, capped by maxPixels); true when it changed
    resize() {
      const w0 = canvas.offsetWidth, h0 = canvas.offsetHeight;
      let dpr = Math.min(window.devicePixelRatio || 1, ctx.dprMax);
      if (w0 * h0 * dpr * dpr > ctx.maxPixels) dpr = Math.sqrt(ctx.maxPixels / Math.max(1, w0 * h0));
      const w = Math.max(1, Math.round(w0 * dpr)), h = Math.max(1, Math.round(h0 * dpr));
      const changed = canvas.width !== w || canvas.height !== h;
      if (changed) { canvas.width = w; canvas.height = h; }
      ctx.dpr = w / Math.max(1, w0); ctx.w = w0; ctx.h = h0;
      return changed;
    },
    texture(src, { w, h, format = 'RGBA', repeat = false, mip = false } = {}) {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      const F = format === 'R' ? gl.R8 : gl.RGBA8, B = format === 'R' ? gl.RED : gl.RGBA;
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, F, w, h, 0, B, gl.UNSIGNED_BYTE, src);
      const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      if (mip) gl.generateMipmap(gl.TEXTURE_2D);
      return t;
    },
    bind(unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); },
  };
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); ctx.lost = true; ctx.onlost && ctx.onlost(); });
  canvas.addEventListener('webglcontextrestored', () => { ctx.lost = false; ctx.onrestored && ctx.onrestored(); });
  return ctx;
}
