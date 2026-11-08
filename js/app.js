// DV90 BRONZE OTP · the code input, its states, the cooling model, the scheduler and the test hook (window.__otp).
import { Foundry } from './foundry.js';
import { buildAtlas, buildNoise, measureCap, FAMILY } from './atlas.js';

const $ = (s) => document.querySelector(s);
const qs = new URLSearchParams(location.search);
const DEMO = '482913';
const KEY_RESEND = 'dv90.v1.resendAt', KEY_LOCK = 'dv90.v1.lockUntil', KEY_ATT = 'dv90.v1.attempts';
const MAX_ATT = 3, LOCK_S = 30, RESEND_S = 30, CODE_S = 60, SHOW_S = 42;
const POUR = 0.66, DRAIN = 0.56, REMELT = 0.72, SETTLE = 13;
const FAST = qs.has('fast');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

const el = {
  otp: $('#otp'), plate: $('#plate'), tiles: $('#tiles'), fx: $('#fx'), metal: $('#metal'), clip: $('#dg-clip'), input: $('#code'),
  slots: [...document.querySelectorAll('.slot')], verify: $('#verify'), verifyT: $('#verify-t'), resend: $('#resend'),
  tm: $('#tm'), timer: $('#timer'), timerL: $('#timer-l'), status: $('#status'), alert: $('#alert'), toast: $('#toast'),
};

// ---------------- state ----------------
const S = {
  slots: Array.from({ length: 6 }, () => ({ d: -1, next: -1, mode: 'empty', t0: -99, castAt: -99, errAt: -99 })),
  digits: [], phase: 'entry',            // entry | busy | ok | error | locked | expired
  attempts: +store.get(KEY_ATT) || 0, lockUntil: +store.get(KEY_LOCK) || 0, resendAt: +store.get(KEY_RESEND) || 0,
  expiresAt: 0, okAt: -99, errAt: -99, active: 0, focused: false,
  ptr: { x: 0, y: 0, tx: 0, ty: 0, str: 0, tstr: 0, last: -99 }, lastInput: 0, idleFrom: 0,
  holdT: null, rate: 'sleep', sleeping: true, frames: 0, geo: null, cap: 0.72,
};
const clock = () => (S.holdT !== null ? S.holdT : performance.now() / 1000);
const smooth = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// per-slot look at clock time t: level, temperature, temper film, digit visibility, ribbon head/tail, error flash
function look(i, t) {
  const sl = S.slots[i];
  let L = 0, T = 0, tn = 0, vis = 1, head = 0, tail = 1, flash = 0, d = sl.d;
  const age = t - sl.castAt;
  const cool = () => {
    T = age < 0.8 ? 1 : Math.exp(-(age - 0.8) / 2.1); if (T < 0.004) T = 0;
    tn = clamp01((age - 2.4) / 10.1);
  };
  if (sl.mode === 'empty') { L = 0; d = -1; }
  else if (sl.mode === 'pour') {
    const k = t - sl.t0;
    head = clamp01(k / 0.16); L = smooth(0.0, 1.0, clamp01((k - 0.08) / 0.5)); tail = clamp01((k - 0.44) / 0.2);
    T = 1; if (tail >= 1) head = 0;
  } else if (sl.mode === 'solid') { L = 1; cool(); }
  else if (sl.mode === 'remelt') {
    const k = t - sl.t0; L = 1;
    cool(); T = Math.max(T, smooth(0, 0.14, k)); if (k < 0.14) tn *= 1 - smooth(0, 0.14, k);
    vis = k < 0.24 ? 1 - smooth(0.0, 0.22, k) : smooth(0.3, 0.62, k);
    if (k >= 0.24) d = sl.next;
  } else if (sl.mode === 'drain') {
    const k = t - sl.t0;
    T = Math.max(sl.mode0T || 0, 0.92 * smooth(0, 0.14, k));
    vis = 1 - smooth(0.02, 0.26, k);
    L = 1 - smooth(0.0, 1.0, clamp01((k - 0.12) / 0.42));
  }
  if (sl.errAt > -50) flash = Math.exp(-Math.max(0, t - sl.errAt) * 3.2) * smooth(0, 0.08, t - sl.errAt);
  return { L, T, tn, vis, head, tail, flash, d };
}
// advance modes (pour → solid, drain → empty, remelt → solid)
function stepModes(t) {
  let changed = false;
  S.slots.forEach((sl, i) => {
    const k = t - sl.t0;
    if (sl.mode === 'pour' && k >= POUR) { sl.mode = 'solid'; changed = true; }
    else if (sl.mode === 'remelt' && k >= 0.24 && sl.d !== sl.next) { sl.d = sl.next; changed = true; }
    else if (sl.mode === 'remelt' && k >= REMELT) { sl.mode = 'solid'; changed = true; }
    else if (sl.mode === 'drain' && k >= DRAIN) { sl.mode = 'empty'; sl.d = -1; changed = true; }
    if (sl.errAt > -50 && t - sl.errAt > 1.4) sl.errAt = -99;
  });
  if (changed) syncClip();
  return changed;
}
const moving = (t) => S.slots.some((sl) => sl.mode === 'pour' || sl.mode === 'drain' || sl.mode === 'remelt' || (sl.errAt > -50));
const cooling = (t) => S.slots.some((sl) => sl.mode === 'solid' && t - sl.castAt < SETTLE);
const hot = (t) => S.slots.some((sl) => (sl.mode === 'solid' && t - sl.castAt < 6) || sl.mode !== 'solid' && sl.mode !== 'empty');

// ---------------- the cast ----------------
// without the WebGL loop (CSS fallback, lost context) nothing ever ends a re-melt or a drain, so they finish at once
const noLoop = () => !foundry || foundry.fx.lost || foundry.mt.lost;
function pour(i, d, t, delay = 0) {
  const sl = S.slots[i];
  if (reduced.matches) { sl.d = d; sl.mode = 'solid'; sl.castAt = t - 60; sl.t0 = t - 60; return; }
  sl.d = d; sl.next = d; sl.mode = 'pour'; sl.t0 = t + delay; sl.castAt = t + delay;
}
function remelt(i, d, t) {
  const sl = S.slots[i];
  if (reduced.matches || noLoop() || sl.mode === 'empty' || sl.mode === 'drain') return pour(i, d, t);
  if (sl.mode === 'pour') { sl.d = d; sl.next = d; return; }
  sl.next = d; sl.mode = 'remelt'; sl.t0 = t; sl.castAt = t + 0.1;
}
function drain(i, t, delay = 0) {
  const sl = S.slots[i];
  if (sl.mode === 'empty') return;
  if (reduced.matches || noLoop()) { sl.mode = 'empty'; sl.d = -1; return; }
  const lk = look(i, t); sl.mode0T = lk.T;
  sl.mode = 'drain'; sl.t0 = t + delay;
}

// ---------------- the input ----------------
function readDigits() { return el.input.value.replace(/\D/g, '').slice(0, 6).split('').map(Number); }
function applyValue(src = 'type') {
  const clean = el.input.value.replace(/\D/g, '').slice(0, 6);
  if (clean !== el.input.value) { const pos = el.input.selectionStart; el.input.value = clean; try { el.input.setSelectionRange(Math.min(pos, clean.length), Math.min(pos, clean.length)); } catch (e) {} }
  const nd = clean.split('').map(Number), old = S.digits, t = clock();
  let born = 0;
  const many = nd.filter((v, i) => old[i] === undefined).length > 1;
  for (let i = 0; i < 6; i++) {
    if (nd[i] === old[i]) continue;
    if (nd[i] === undefined) drain(i, t);
    else if (old[i] === undefined) { pour(i, nd[i], t, many ? born * 0.1 : 0); born++; }
    else remelt(i, nd[i], t);
  }
  S.digits = nd;
  if (S.phase === 'error') setPhase('entry');
  clearAlert();
  S.lastInput = t; syncClip(); syncDom(); wake();
}
function setActiveFromCaret() {
  const n = S.digits.length, a = el.input.selectionStart ?? n, b = el.input.selectionEnd ?? n;
  S.active = (b - a === 1) ? a : Math.min(a, n);
  if (S.active > 5) S.active = -1;
  el.slots.forEach((s, i) => s.classList.toggle('is-active', i === S.active));
}
function slotAt(x, y) {
  let k = -1, best = 1e9;
  el.slots.forEach((s, i) => { const r = s.getBoundingClientRect(); const dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom); const dd = dx * dx + dy * dy; if (dd < best) { best = dd; k = i; } });
  return k;
}

// ---------------- DOM ----------------
function syncDom() {
  const n = S.digits.length, live = S.phase === 'entry' || S.phase === 'error';
  el.slots.forEach((s, i) => {
    const sl = S.slots[i];
    s.querySelector('b').textContent = sl.d >= 0 ? String(sl.d) : '';
    s.classList.toggle('filled', sl.d >= 0);
    s.classList.toggle('hot', sl.d >= 0 && (sl.mode !== 'solid' || clock() - sl.castAt < 2.5));
  });
  el.otp.classList.toggle('complete', n === 6);
  el.otp.classList.toggle('locked', S.phase === 'locked');
  el.otp.classList.toggle('done', S.phase === 'ok');
  el.otp.classList.toggle('has-alert', !!el.alert.textContent);
  const expired = S.phase === 'expired';
  el.verify.disabled = !(live && n === 6);
  el.verify.classList.toggle('busy', S.phase === 'busy');
  el.verify.classList.toggle('ok', S.phase === 'ok');
  if (S.phase === 'busy') el.verify.setAttribute('aria-busy', 'true'); else el.verify.removeAttribute('aria-busy');
  el.verifyT.textContent = S.phase === 'busy' ? 'Verifying…' : S.phase === 'ok' ? 'Verified' : expired ? 'Code expired' : 'Verify & continue';
  el.input.disabled = S.phase === 'locked' || S.phase === 'busy' || expired;
  el.input.readOnly = S.phase === 'ok';
  el.resend.classList.toggle('primary', expired);
  if (S.phase === 'entry' || S.phase === 'error') setStatus(n === 6 ? 'Ready. Press Enter or Verify.' : n === 0 ? 'Enter the 6-digit code' : `${6 - n} digit${6 - n > 1 ? 's' : ''} to go`);
  setActiveFromCaret();
}
function setStatus(text, kind = '') {
  if (el.status.dataset.text === text + kind) return;
  el.status.dataset.text = text + kind;
  el.status.className = 'status' + (kind ? ' ' + kind : '');
  el.status.textContent = text;
}
function setAlert(text) { el.alert.textContent = text; el.otp.classList.toggle('has-alert', !!text); }
function clearAlert() { if (el.alert.textContent && S.phase !== 'locked' && S.phase !== 'expired') setAlert(''); }
let toastT = 0;
function toast(text) { el.toast.textContent = text; el.toast.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.toast.classList.remove('on'), 2600); }

function setPhase(p) { S.phase = p; syncDom(); }

// ---------------- verify ----------------
function submit(e) {
  e && e.preventDefault();
  if (S.phase !== 'entry' && S.phase !== 'error') return;
  if (S.digits.length < 6) { setAlert(`Enter all six digits. ${6 - S.digits.length} to go.`); return; }
  setAlert(''); setPhase('busy'); setStatus('Checking your code…');
  setTimeout(() => {
    const t = clock();
    if (S.digits.join('') === DEMO) {
      S.phase = 'ok'; S.okAt = t; S.attempts = 0; store.del(KEY_ATT);
      syncDom();
      el.status.className = 'status ok'; el.status.dataset.text = '';
      el.status.innerHTML = 'Verified. Welcome back, Ana. <button type="button" id="again">Start over</button>';
      $('#again').addEventListener('click', startOver);
      el.verify.focus();
    } else {
      S.attempts++; store.set(KEY_ATT, String(S.attempts));
      S.errAt = t;
      el.plate.classList.remove('shake'); void el.plate.offsetWidth; if (!reduced.matches) el.plate.classList.add('shake');
      S.slots.forEach((sl) => { sl.errAt = t; });
      for (let i = 5; i >= 0; i--) drain(i, t, reduced.matches ? 0 : 0.55 + (5 - i) * 0.07);
      S.digits = []; el.input.value = '';
      if (S.attempts >= MAX_ATT) { lock(Date.now() + LOCK_S * 1000); }
      else {
        S.phase = 'error';
        const left = MAX_ATT - S.attempts;
        setAlert(`That code doesn't match. ${left} attempt${left > 1 ? 's' : ''} left.`);
        syncDom();
        el.input.disabled = false; el.input.focus();
        try { el.input.setSelectionRange(0, 0); } catch (e2) {}
      }
    }
    syncClip(); wake();
  }, FAST ? 60 : 900);
}
function lock(until) {
  S.lockUntil = until; store.set(KEY_LOCK, String(until));
  S.phase = 'locked'; tickClock(); syncDom(); wake();
}
function unlock() {
  S.lockUntil = 0; S.attempts = 0; store.del(KEY_LOCK); store.del(KEY_ATT);
  S.phase = 'entry'; setAlert(''); syncDom(); wake();
}
function startOver() {
  const t = clock();
  for (let i = 5; i >= 0; i--) drain(i, t, (5 - i) * 0.06);
  S.digits = []; el.input.value = ''; S.okAt = -99;
  S.expiresAt = Date.now() + CODE_S * 1000;
  S.phase = 'entry'; setAlert(''); el.status.dataset.text = ''; syncDom(); tickClock();
  el.input.focus(); syncClip(); wake();
}
function resend() {
  if (S.resendAt > Date.now() || S.phase === 'locked' || S.phase === 'busy') return;
  const t = clock();
  for (let i = 5; i >= 0; i--) drain(i, t, (5 - i) * 0.06);
  S.digits = []; el.input.value = '';
  S.expiresAt = Date.now() + CODE_S * 1000;
  S.resendAt = Date.now() + RESEND_S * 1000; store.set(KEY_RESEND, String(S.resendAt));
  S.phase = 'entry'; setAlert(''); el.status.dataset.text = '';
  syncDom(); tickClock();
  setStatus('A new code is on its way. (Demo code is still 482913.)');
  el.input.focus(); syncClip(); wake();
}

// once a second: expiry, resend cooldown, lock countdown (text only, never the canvas)
function tickClock() {
  const now = Date.now();
  const left = Math.max(0, Math.ceil((S.expiresAt - now) / 1000));
  if (S.phase !== 'ok') {
    el.tm.textContent = fmt(left);
    el.timer.classList.toggle('low', left <= 10 && left > 0);
    el.timer.classList.toggle('out', left === 0);
    el.timerL.textContent = left === 0 ? 'Code expired' : 'Code expires in';
  }
  if (left === 0 && (S.phase === 'entry' || S.phase === 'error')) {
    S.phase = 'expired'; setAlert('This code has expired. Send a new one to continue.'); syncDom();
  }
  const rs = Math.max(0, Math.ceil((S.resendAt - now) / 1000));
  el.resend.disabled = rs > 0 || S.phase === 'locked' || S.phase === 'busy';
  el.resend.textContent = rs > 0 ? `Resend in ${fmt(rs)}` : 'Resend code';
  if (S.phase === 'locked') {
    const ls = Math.max(0, Math.ceil((S.lockUntil - now) / 1000));
    if (ls === 0) unlock();
    else setAlert(`Too many attempts. Try again in ${fmt(ls)}.`);
  }
}

// ---------------- SVG clip (vector digit edges) ----------------
const SVGNS = 'http://www.w3.org/2000/svg';
const clipText = [];
function buildClip() {
  el.clip.textContent = ''; clipText.length = 0;
  for (let i = 0; i < 6; i++) {
    const t = document.createElementNS(SVGNS, 'text');
    t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-family', `${FAMILY}, Georgia, serif`); t.setAttribute('font-weight', '900');
    el.clip.appendChild(t); clipText.push(t);
  }
}
function syncClip() {
  const g = S.geo; if (!g || !clipText.length) return;
  clipText.forEach((n, i) => {
    const sl = S.slots[i], d = sl.mode === 'remelt' && clock() - sl.t0 >= 0.24 ? sl.next : sl.d;
    const v = d >= 0 ? String(d) : '';
    if (n.textContent !== v) n.textContent = v;
    n.setAttribute('display', v ? 'inline' : 'none');
  });
}
function placeClip() {
  const g = S.geo;
  clipText.forEach((n, i) => {
    const s = g.slots[i];
    n.setAttribute('font-size', g.F.toFixed(2));
    n.setAttribute('x', (s[0] - g.mtOff[0]).toFixed(2));
    n.setAttribute('y', (s[1] + g.baseOff - g.mtOff[1]).toFixed(2));
  });
  syncClip();
}

// ---------------- layout ----------------
function layout() {
  const pr = el.plate.getBoundingClientRect(), fr = el.fx.getBoundingClientRect(), mr = el.metal.getBoundingClientRect();
  const slots = el.slots.map((s) => { const r = s.getBoundingClientRect(); return [r.left + r.width / 2 - pr.left, r.top + r.height / 2 - pr.top, r.width, r.height]; });
  const tw = slots[0][2], th = slots[0][3];
  const F = th * 0.66;
  const cs = getComputedStyle(el.plate);
  S.geo = {
    pw: pr.width, ph: pr.height, pr: parseFloat(cs.borderTopLeftRadius) || tw * 0.17, tw, F, baseOff: S.cap * F * 0.5,
    ring: tw * 0.058, br: parseFloat(getComputedStyle(el.slots[0]).borderTopLeftRadius) || tw * 0.1,
    slots, fxOff: [fr.left - pr.left, fr.top - pr.top], mtOff: [mr.left - pr.left, mr.top - pr.top],
  };
  if (foundry) { foundry.resize(); placeClip(); }
  wake(true);
}

// ---------------- rendering ----------------
let foundry = null;
const U = { slot: new Float32Array(24), st: new Float32Array(24), sx: new Float32Array(24), light: [0, 0, 0, 1], env: [0, 0], cam: [0, 0, 1700, 1.25], f: {} };
function frameUniforms(t) {
  const g = S.geo;
  for (let i = 0; i < 6; i++) {
    const lk = look(i, t), s = g.slots[i], o = i * 4;
    U.slot[o] = s[0]; U.slot[o + 1] = s[1]; U.slot[o + 2] = s[2]; U.slot[o + 3] = s[3];
    U.st[o] = lk.L; U.st[o + 1] = lk.T; U.st[o + 2] = lk.tn; U.st[o + 3] = lk.vis;
    U.sx[o] = lk.d; U.sx[o + 1] = lk.head; U.sx[o + 2] = lk.tail; U.sx[o + 3] = lk.flash;
  }
  // pointer light (smoothed) + idle drift of the soft boxes
  const P = S.ptr;
  const idle = reduced.matches ? 0 : smooth(0, 1.5, t - S.idleFrom) * (1 - smooth(9, 14, t - S.idleFrom)) * (1 - P.str);
  const dx = 0.10 * Math.sin((t - S.idleFrom) * 0.42), dy = 0.025 * Math.sin((t - S.idleFrom) * 0.61);
  const px = (P.x - g.pw / 2) / g.pw, py = (P.y - g.ph / 2) / g.ph;
  U.env[0] = -px * 0.32 * P.str + dx * idle; U.env[1] = -py * 0.12 * P.str + dy * idle;
  U.light[0] = P.x; U.light[1] = P.y; U.light[2] = P.str * 1.0; U.light[3] = g.tw * 1.6;
  U.cam[0] = g.pw / 2; U.cam[1] = g.ph * 0.45; U.cam[2] = Math.max(1400, g.pw * 1.25);
  const f = U.f;
  f.t = t; f.slot = U.slot; f.st = U.st; f.sx = U.sx; f.F = g.F; f.baseOff = g.baseOff; f.ring = g.ring; f.br = g.br;
  f.pw = g.pw; f.ph = g.ph; f.pr = g.pr; f.tw = g.tw; f.light = U.light; f.env = U.env; f.cam = U.cam; f.exposure = 1.25;
  f.sweep = S.okAt > -50 && t - S.okAt < 1.8 ? (t - S.okAt) / 1.6 : -1;
  f.err = 0;
  f.cold = S.phase === 'locked' ? 1 : 0;
  f.fxOff = g.fxOff; f.mtOff = g.mtOff;
  return f;
}
function draw(t) {
  if (!foundry || !S.geo) return;
  foundry.render(frameUniforms(t));
  S.frames++;
}

// ---------------- scheduler: full rate while metal moves, 60 / 30 fps while it cools or drifts, sleeps at rest ----------------
let raf = 0, lastDraw = -1, lastT = 0, visible = true, onscreen = true, lastSync = 0;
function frame() {
  raf = 0;
  const t = clock();
  const dt = Math.min(0.1, Math.max(0, t - lastT)); lastT = t;
  stepModes(t);
  const P = S.ptr;
  const ptrLive = t - P.last < 0.9;
  P.str += ((ptrLive ? P.tstr : 0) - P.str) * (1 - Math.exp(-dt / (ptrLive ? 0.12 : 0.6)));
  P.x += (P.tx - P.x) * (1 - Math.exp(-dt / 0.07)); P.y += (P.ty - P.y) * (1 - Math.exp(-dt / 0.07));
  if (P.str < 0.002 && !ptrLive) P.str = 0;
  if (t - lastSync > 0.25) { lastSync = t; S.slots.forEach((sl, i) => el.slots[i].classList.toggle('hot', sl.d >= 0 && (sl.mode !== 'solid' || t - sl.castAt < 2.5))); }
  const sweeping = S.okAt > -50 && t - S.okAt < 1.9;
  const full = moving(t) || sweeping || ptrLive || P.str > 0.004;
  const mid = !full && hot(t);
  const slow = !full && !mid && (cooling(t) || (t - S.idleFrom < 14.2 && !reduced.matches));
  if (!full && !mid && !slow && S.holdT === null) { draw(t); S.rate = 'sleep'; S.sleeping = true; return; }
  S.rate = full ? 'full' : mid ? '60' : '30';
  const minDt = full ? 0 : mid ? 1 / 60 - 0.004 : 1 / 30 - 0.004;
  if (t - lastDraw >= minDt || S.holdT !== null) { draw(t); lastDraw = t; }
  if (visible && onscreen) raf = requestAnimationFrame(frame);
  else { S.sleeping = true; S.rate = 'sleep'; }
}
function wake(resetIdle = false) {
  if (!foundry) return;
  if (resetIdle) S.idleFrom = clock();
  if (reduced.matches) { staticFrame(); return; }
  if (!visible || !onscreen) return;
  S.sleeping = false;
  if (!raf) { lastT = clock(); raf = requestAnimationFrame(frame); }
}
function staticFrame() {
  S.rate = 'static'; S.sleeping = true;
  if (!S.geo) return;
  const t = clock();
  stepModes(t + 10);
  S.slots.forEach((sl) => { if (sl.mode === 'pour' || sl.mode === 'remelt') { sl.mode = 'solid'; sl.d = sl.next >= 0 ? sl.next : sl.d; } if (sl.mode === 'drain') { sl.mode = 'empty'; sl.d = -1; } sl.castAt = Math.min(sl.castAt, t - 60); sl.errAt = -99; });
  syncClip();
  foundry.render(frameUniforms(t));
  S.frames++;
}

// ---------------- input wiring ----------------
function onPointer(e) {
  if (!S.geo || reduced.matches) return;
  const r = el.plate.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top, m = S.geo.tw * 0.8;
  const inside = x > -m && y > -m && x < r.width + m && y < r.height + m;
  if (!inside) return;
  const t = clock(), P = S.ptr;
  if (P.str < 0.01) { P.x = x; P.y = y; }
  P.tx = x; P.ty = y; P.last = t; P.tstr = 1; S.idleFrom = t - 20;
  wake();
}
function bind() {
  const inp = el.input;
  inp.addEventListener('input', () => applyValue());
  inp.addEventListener('paste', (e) => {
    const txt = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    const dg = txt.replace(/\D/g, '').slice(0, 6);
    if (!dg) { e.preventDefault(); return; }
    e.preventDefault(); inp.value = dg; applyValue('paste');
    try { inp.setSelectionRange(dg.length, dg.length); } catch (er) {}
    setActiveFromCaret();
  });
  inp.addEventListener('keydown', (e) => {
    if (/^\d$/.test(e.key) && !e.metaKey && !e.ctrlKey) {
      const a = inp.selectionStart, b = inp.selectionEnd;
      if (a === b && a < inp.value.length) inp.setSelectionRange(a, a + 1);   // overwrite, never insert
    } else if (e.key.length === 1 && !/\d/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) e.preventDefault();
    requestAnimationFrame(setActiveFromCaret);
  });
  inp.addEventListener('keyup', setActiveFromCaret);
  inp.addEventListener('select', setActiveFromCaret);
  document.addEventListener('selectionchange', () => { if (document.activeElement === inp) setActiveFromCaret(); });
  inp.addEventListener('click', (e) => {
    const i = slotAt(e.clientX, e.clientY), n = inp.value.length;
    try { if (i >= 0 && i < n) inp.setSelectionRange(i, i + 1); else inp.setSelectionRange(n, n); } catch (er) {}
    setActiveFromCaret();
  });
  inp.addEventListener('focus', () => { S.focused = true; el.otp.classList.add('focused'); el.otp.classList.toggle('kbd', inp.matches(':focus-visible')); setActiveFromCaret(); });
  inp.addEventListener('blur', () => { S.focused = false; el.otp.classList.remove('focused', 'kbd'); });
  el.otp.addEventListener('submit', submit);
  el.resend.addEventListener('click', resend);
  $('#help').addEventListener('click', (e) => { e.preventDefault(); toast('Demo page · the code is 482913. Help is not part of this component.'); });
  addEventListener('pointermove', onPointer, { passive: true });
  addEventListener('pointerdown', onPointer, { passive: true });
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; if (visible) wake(); });
  new IntersectionObserver((es) => { onscreen = es[0].isIntersecting; if (onscreen) wake(); }).observe(el.plate);
  let rz = 0; addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(layout); });
  reduced.addEventListener('change', () => { if (reduced.matches) staticFrame(); else wake(true); });
  setInterval(tickClock, 1000);
}

// ---------------- boot ----------------
let readyResolve; const ready = new Promise((r) => (readyResolve = r));
window.__otp = {
  ready, S, get foundry() { return foundry; },
  state() {
    const t = clock();
    return { value: el.input.value, digits: S.digits.join(''), phase: S.phase, attempts: S.attempts, active: S.active, fx: !!foundry,
      rate: S.rate, sleeping: S.sleeping, frames: S.frames, draws: foundry ? foundry.draws : 0,
      modes: S.slots.map((s) => s.mode), shown: S.slots.map((s) => s.d), clip: clipText.map((n) => (n.getAttribute('display') === 'inline' ? n.textContent : '')).join(''),
      looks: S.slots.map((_, i) => { const l = look(i, t); return { L: +l.L.toFixed(3), T: +l.T.toFixed(3), tn: +l.tn.toFixed(3), vis: +l.vis.toFixed(3) }; }),
      timer: el.tm.textContent, status: el.status.textContent, alert: el.alert.textContent, verify: el.verifyT.textContent, verifyDisabled: el.verify.disabled };
  },
  hold(on) {
    if (on) { S.holdT = clock(); if (foundry && S.geo) { stepModes(S.holdT); draw(S.holdT); } }
    else { S.holdT = null; wake(); }
  },
  at(t) { S.holdT = t; stepModes(t); syncClip(); draw(t); },
  clock, layout, lock, expireNow() { S.expiresAt = Date.now() - 1; tickClock(); },
};

async function boot() {
  try {
    await Promise.all([document.fonts.load(`900 100px ${FAMILY}`), document.fonts.load("500 58px 'Fraunces'"), document.fonts.load("500 13px 'Inter'"), document.fonts.load("600 13px 'Inter'")]);
  } catch (e) {}
  S.cap = measureCap();
  const now = Date.now();
  S.expiresAt = now + SHOW_S * 1000 + 600;
  if (!document.documentElement.classList.contains('no-fx')) {
    foundry = new Foundry(el.fx, el.metal);
    if (!foundry.init(buildAtlas(), buildNoise())) { foundry = null; document.documentElement.classList.add('no-fx'); }
  }
  if (foundry) {
    buildClip();
    foundry.fx.onlost = foundry.mt.onlost = () => { document.documentElement.classList.add('no-fx'); cancelAnimationFrame(raf); raf = 0; };
    foundry.fx.onrestored = foundry.mt.onrestored = () => {
      if (foundry.fx.lost || foundry.mt.lost) return;
      try { foundry.setup(); document.documentElement.classList.remove('no-fx'); layout(); } catch (e) {}
    };
  }
  bind();
  // the showcase: "4829" — 4 polished, 8 late temper film, 2 strongest film, 9 poured on load; mould 5 is next
  const t = clock();
  const seed = [[4, 40], [8, 8.4], [2, 5.0]];
  seed.forEach(([d, age], i) => { const sl = S.slots[i]; sl.d = d; sl.next = d; sl.mode = 'solid'; sl.castAt = t - age; sl.t0 = t - age; });
  const intro = !reduced.matches && !qs.has('nointro');
  if (intro) pour(3, 9, t, 0.45); else { const sl = S.slots[3]; sl.d = 9; sl.next = 9; sl.mode = 'solid'; sl.castAt = t - 1.1; sl.t0 = t - 1.1; }
  el.input.value = '4829'; S.digits = [4, 8, 2, 9];
  if (S.lockUntil > now) S.phase = 'locked';
  else if (S.lockUntil) { S.lockUntil = 0; store.del(KEY_LOCK); store.del(KEY_ATT); S.attempts = 0; }
  syncDom(); tickClock();
  layout();
  if (foundry) { placeClip(); if (reduced.matches) staticFrame(); else wake(true); }
  if (S.phase !== 'locked') {
    // focus the input without scrolling or showing the keyboard ring; mould 5 glows as the next one
    try { el.input.focus({ preventScroll: true }); el.input.setSelectionRange(4, 4); } catch (e) {}
    setActiveFromCaret();
  }
  requestAnimationFrame(() => requestAnimationFrame(() => readyResolve(true)));
}
boot();
