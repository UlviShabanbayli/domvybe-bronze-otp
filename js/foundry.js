// DV90 BRONZE OTP · renderer. Two WebGL2 canvases in stage coordinates (CSS px from the plate's corner):
//   fx    — the plate + a glow margin, ≤ 1.5 DPR (iron, bezels, moulds, cast faces, pour, heat light on the page)
//   metal — only over the tiles, clipped by the DOM/SVG <text> digits, so every glyph edge stays vector-sharp.
import { makeGL } from './gl.js';
import { PLATE_FS, METAL_FS } from './shaders.js';
import { CELL_W, CELL_H, AF, BASE_ROW } from './atlas.js';

export class Foundry {
  constructor(fxCanvas, metalCanvas) { this.fxCanvas = fxCanvas; this.metalCanvas = metalCanvas; this.draws = 0; }

  init(atlas, noise) {
    this.atlas = atlas; this.noise = noise;
    this.fx = makeGL(this.fxCanvas, { alpha: true, dprMax: 1.5, maxPixels: 2.4e6 });
    this.mt = makeGL(this.metalCanvas, { alpha: true, dprMax: 2, maxPixels: 2.0e6 });
    if (!this.fx || !this.mt) return false;
    try { this.setup(); } catch (e) { console.warn('foundry setup', e); return false; }
    return true;
  }

  setup() {
    const A = this.atlas, N = this.noise;
    this.pFx = this.fx.program(PLATE_FS);
    this.fxAtlas = this.fx.texture(A.data, { w: A.w, h: A.h });
    this.fxNoise = this.fx.texture(N.data, { w: N.w, h: N.h, repeat: true, mip: true });
    this.pMt = this.mt.program(METAL_FS);
    this.mtAtlas = this.mt.texture(A.data, { w: A.w, h: A.h });
    this.mtNoise = this.mt.texture(N.data, { w: N.w, h: N.h, repeat: true, mip: true });
  }

  resize() { this.fx.resize(); this.mt.resize(); }

  common(P, f) {
    P.v4('uSlot', f.slot).v4('uSt', f.st).v4('uSx', f.sx)
      .f('uGeo', f.F, f.baseOff, f.ring, f.br).f('uPlate', 0, 0, f.pw, f.ph).f('uPl2', f.pr, f.tw, 0, 0)
      .f('uLight', f.light[0], f.light[1], f.light[2], f.light[3]).f('uFx', f.t, f.sweep, f.err, f.cold)
      .f('uCam', f.cam[0], f.cam[1], f.cam[2], f.exposure).f('uEnv', f.env[0], f.env[1])
      .f('uAtl', CELL_W, CELL_H, AF, BASE_ROW).f('uAtlSize', this.atlas.w, this.atlas.h).i('uAtlas', 0).i('uNoise', 1);
  }

  render(f, { metal = true } = {}) {
    if (this.fx.lost || this.mt.lost) return;
    { const X = this.fx, gl = X.gl;
      gl.viewport(0, 0, this.fxCanvas.width, this.fxCanvas.height);
      X.bind(0, this.fxAtlas); X.bind(1, this.fxNoise);
      const P = this.pFx.use().tri();
      this.common(P, f);
      P.f('uRes', this.fxCanvas.width, this.fxCanvas.height).f('uS', X.dpr).f('uOff', f.fxOff[0], f.fxOff[1]).draw();
    }
    if (metal) { const M = this.mt, gl = M.gl;
      gl.viewport(0, 0, this.metalCanvas.width, this.metalCanvas.height);
      M.bind(0, this.mtAtlas); M.bind(1, this.mtNoise);
      const P = this.pMt.use().tri();
      this.common(P, f);
      P.f('uRes', this.metalCanvas.width, this.metalCanvas.height).f('uS', M.dpr).f('uOff', f.mtOff[0], f.mtOff[1]).draw();
    }
    this.draws++;
  }
}
