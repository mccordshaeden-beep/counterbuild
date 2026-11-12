// Match timer: follows the in-game clock from when you press Start. It never reads the game.
import { EVENTS, TAP_TIMERS, PHASES, PATCH_NOTE, ALERT_GROUPS } from './timers.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('cb.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('cb.' + k, JSON.stringify(v)); } catch {} },
};

const HIGHLIGHT = 30; // list rows light up this many seconds before
const UNTIL = 3600; // plan up to 60:00

// run: { startAt: epoch ms when the match clock was 0:00, paused: seconds or null }
let run = store.get('timer.run', null);
let taps = store.get('timer.taps', {}); // id -> { at: clock seconds, n: count }
const opts = Object.assign({
  sound: true, voice: true, awake: true,
  volume: 80,      // 0..100, voice and beeps
  rate: 1.1,       // speaking speed
  voiceURI: '',    // '' = browser default
  warn: 30,        // seconds of warning before a spawn; 0 = only when it's up
  muted: [],       // alert groups switched off
}, store.get('timer.opts', {}));
const saveOpts = () => store.set('timer.opts', opts);
const groupOn = (g) => !opts.muted.includes(g);
const fired = new Set();
let audio = null;
let wake = null;

const save = () => { store.set('timer.run', run); store.set('timer.taps', taps); };

export function clock() {
  if (!run) return 0;
  if (run.paused != null) return run.paused;
  return (Date.now() - run.startAt) / 1000;
}

export const fmt = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function parseClock(str) {
  const m = String(str || '').trim().match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return null;
  return m[2] == null ? Number(m[1]) * 60 : Number(m[1]) * 60 + Number(m[2]);
}

// Every upcoming spawn as { key, name, kind, at, tip }.
export function occurrences(now, tapState = taps) {
  const out = [];
  for (const e of EVENTS) {
    const times = e.every ? [] : [e.first];
    if (e.every) for (let t = e.first; t <= UNTIL; t += e.every) times.push(t);
    for (const t of times) out.push({ key: `${e.id}@${t}`, name: e.name, kind: e.kind, group: e.group, at: t, tip: e.tip });
  }
  // Phase changes show in the list too, so you can see the next one coming.
  PHASES.forEach((p, i) => {
    if (!p.from) return;
    out.push({ key: `phase@${p.from}`, name: `${p.title} phase`, kind: 'phase', group: 'phase', at: p.from, tip: p.tips[0],
      prev: PHASES[i - 1]?.title, title: p.title });
  });
  for (const t of TAP_TIMERS) {
    const s = tapState[t.id];
    if (!s) continue;
    const at = s.at + t.respawn(s.n);
    out.push({ key: `tap:${t.id}@${at}`, name: t.name, kind: 'tap', group: t.group, at, tip: t.tip });
  }
  return out.filter((o) => o.at >= now - 10).sort((a, b) => a.at - b.at);
}

// ---------- alerts ----------
function beep(high) {
  if (!opts.sound || !audio || !opts.volume) return;
  try {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = high ? 880 : 587;
    g.gain.setValueAtTime(0.0001, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.35 * (opts.volume / 100)), audio.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.35);
    o.connect(g).connect(audio.destination);
    o.start(); o.stop(audio.currentTime + 0.4);
  } catch {}
}

function pickVoice() {
  if (!opts.voiceURI || !('speechSynthesis' in window)) return null;
  return speechSynthesis.getVoices().find((v) => v.voiceURI === opts.voiceURI) || null;
}

function say(text, force = false) {
  if ((!opts.voice && !force) || !('speechSynthesis' in window) || !opts.volume) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = opts.rate; u.volume = opts.volume / 100;
    const v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang; }
    speechSynthesis.speak(u);
  } catch {}
}

const warnWords = (s) => (s % 60 === 0 ? `${s / 60} minute${s > 60 ? 's' : ''}` : `${s} seconds`);

function checkAlerts(now) {
  if (!run || run.paused != null) return;
  const soon = [], up = [];
  let phaseMsg = '';
  const W = opts.warn;
  for (const o of occurrences(now)) {
    const pre = o.key + '|pre', on = o.key + '|now';
    if (o.group && !groupOn(o.group)) continue;
    if (o.kind === 'phase') {
      if (now >= o.at && now < o.at + 3 && !fired.has(on)) { fired.add(on); phaseMsg = `${o.prev} phase is over. Now: ${o.title}. ${o.tip}`; }
      continue;
    }
    if (W && o.kind !== 'info' && now >= o.at - W && now < o.at - W + 4 && !fired.has(pre)) { fired.add(pre); soon.push(o.name); }
    if (now >= o.at && now < o.at + 3 && !fired.has(on)) { fired.add(on); up.push(o.name); }
  }
  const join = (a) => a.length < 2 ? a[0] : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  if (soon.length) { beep(false); say(`${join(soon)} in ${warnWords(W)}`); }
  if (up.length) { beep(true); say(`${join(up)} now`); }
  if (phaseMsg) { if (!up.length) beep(true); say(phaseMsg); }
}

// ---------- screen awake ----------
async function keepAwake() {
  if (!opts.awake || !run || run.paused != null || document.hidden) return;
  try { if (!wake && navigator.wakeLock) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch {}
}
function letSleep() { try { wake?.release(); } catch {} wake = null; }

// ---------- controls ----------
function ensureAudio() {
  if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch {} }
  audio?.resume?.();
}

function start(at = 0) {
  ensureAudio();
  run = { startAt: Date.now() - at * 1000, paused: null };
  taps = {}; fired.clear(); save(); keepAwake(); render();
}
function togglePause() {
  if (!run) return start(0);
  ensureAudio();
  if (run.paused == null) { run.paused = clock(); letSleep(); }
  else { run.startAt = Date.now() - run.paused * 1000; run.paused = null; keepAwake(); }
  save(); render();
}
function nudge(d) {
  if (!run) return;
  if (run.paused != null) run.paused = Math.max(0, run.paused + d);
  else run.startAt -= d * 1000;
  save(); render();
}
function reset() { run = null; taps = {}; fired.clear(); save(); letSleep(); render(); }
function tap(id) {
  if (!run) return;
  const cur = taps[id];
  taps[id] = { at: clock(), n: (cur?.n || 0) + 1 };
  save(); render();
}

// ---------- alert settings ----------
function fillVoices() {
  const sel = $('t-voice-pick');
  if (!sel || !('speechSynthesis' in window)) { if (sel) { sel.disabled = true; sel.innerHTML = '<option>Not available in this browser</option>'; } return; }
  const voices = speechSynthesis.getVoices();
  const lang = (navigator.language || 'en').slice(0, 2);
  const mine = voices.filter((v) => v.lang?.toLowerCase().startsWith(lang));
  const rest = voices.filter((v) => !mine.includes(v));
  const opt = (v) => `<option value="${esc(v.voiceURI)}">${esc(v.name)}${v.lang ? ` (${esc(v.lang)})` : ''}</option>`;
  sel.innerHTML = '<option value="">Browser default</option>'
    + (mine.length ? `<optgroup label="Your language">${mine.map(opt).join('')}</optgroup>` : '')
    + (rest.length ? `<optgroup label="Other languages">${rest.map(opt).join('')}</optgroup>` : '');
  sel.value = voices.some((v) => v.voiceURI === opts.voiceURI) ? opts.voiceURI : '';
}

function initAlertSettings() {
  const box = $('t-alerts');
  if (!box) return;
  box.innerHTML = ALERT_GROUPS.map((g) => `<label><input type="checkbox" id="t-g-${g.id}" data-group="${g.id}" ${groupOn(g.id) ? 'checked' : ''}> ${esc(g.label)}</label>`).join('');
  box.addEventListener('change', (e) => {
    const g = e.target.dataset.group; if (!g) return;
    opts.muted = e.target.checked ? opts.muted.filter((x) => x !== g) : [...new Set([...opts.muted, g])];
    saveOpts(); render();
  });
  $('t-all-on').addEventListener('click', () => { opts.muted = []; saveOpts(); box.querySelectorAll('input').forEach((i) => { i.checked = true; }); render(); });
  $('t-all-off').addEventListener('click', () => { opts.muted = ALERT_GROUPS.map((g) => g.id); saveOpts(); box.querySelectorAll('input').forEach((i) => { i.checked = false; }); render(); });

  fillVoices();
  if ('speechSynthesis' in window) speechSynthesis.addEventListener?.('voiceschanged', fillVoices);
  $('t-voice-pick').addEventListener('change', (e) => { opts.voiceURI = e.target.value; saveOpts(); });

  const vol = $('t-volume'), volOut = $('t-volume-out');
  vol.value = opts.volume; volOut.textContent = `${opts.volume}%`;
  vol.addEventListener('input', () => { opts.volume = Number(vol.value); volOut.textContent = `${opts.volume}%`; saveOpts(); });

  const rate = $('t-rate'), rateOut = $('t-rate-out');
  rate.value = opts.rate; rateOut.textContent = `${Number(opts.rate).toFixed(1)}×`;
  rate.addEventListener('input', () => { opts.rate = Number(rate.value); rateOut.textContent = `${opts.rate.toFixed(1)}×`; saveOpts(); });

  const warn = $('t-warn');
  warn.value = String(opts.warn);
  warn.addEventListener('change', () => { opts.warn = Number(warn.value); saveOpts(); render(); });

  $('t-test').addEventListener('click', () => {
    ensureAudio();
    try { speechSynthesis.cancel(); } catch {}
    beep(false);
    say(opts.warn ? `Soul Urn in ${warnWords(opts.warn)}` : 'Soul Urn now', true);
  });
}

// ---------- render ----------
const KIND = { phase: 'Phase', camp: 'Camp', souls: 'Souls', buff: 'Buff', obj: 'Objective', heal: 'Heal', info: 'Heads-up', tap: 'Respawn' };

function render() {
  const now = clock();
  const running = run && run.paused == null;
  $('t-clock').textContent = fmt(now);
  $('t-clock').classList.toggle('idle', !run);
  $('t-start').textContent = !run ? 'Start at 0:00' : running ? 'Pause' : 'Resume';
  $('t-state').textContent = !run ? 'Press Start when the match clock starts.' : running ? 'Following the match clock.' : 'Paused.';

  const phase = [...PHASES].reverse().find((p) => now >= p.from) || PHASES[0];
  $('t-phase').innerHTML = `<h3>${esc(phase.title)}</h3><ul>${phase.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;

  const list = occurrences(now).slice(0, 5);
  $('t-next').innerHTML = list.map((o) => {
    const left = o.at - now;
    const state = left <= 0 ? 'now' : left <= Math.max(HIGHLIGHT, opts.warn) ? 'soon' : '';
    const muted = o.group && !groupOn(o.group);
    return `<li class="ev k-${o.kind} ${state} ${muted ? 'muted' : ''}" ${muted ? 'title="Alerts off for this in Alert settings"' : ''}>
      <span class="ev-when"><b>${left <= 0 ? 'Now' : fmt(left)}</b><small>at ${fmt(o.at)}</small></span>
      <span class="ev-body"><span class="ev-name">${esc(o.name)} <em>${KIND[o.kind] || ''}${muted ? ' · muted' : ''}</em></span><span class="ev-tip">${esc(o.tip)}</span></span>
    </li>`;
  }).join('');

  // Buttons are built once (see initTimer) and only their text changes, so taps never get lost mid-redraw.
  for (const t of TAP_TIMERS) {
    const btn = document.querySelector(`[data-tap="${t.id}"]`);
    if (!btn) continue;
    const s = taps[t.id];
    const left = s ? s.at + t.respawn(s.n) - now : null;
    btn.disabled = !run;
    btn.classList.toggle('counting', !!s && left > 0);
    btn.querySelector('span').textContent = (!s ? 'Not started' : left > 0 ? `Back in ${fmt(left)}` : 'Up now')
      + (s && s.n > 1 && t.id === 'boss' ? ` · kill ${s.n}` : '');
  }
}

export function initTimer() {
  $('t-patch').textContent = PATCH_NOTE;
  for (const k of ['sound', 'voice', 'awake']) {
    const el = $('t-' + k);
    el.checked = opts[k];
    el.addEventListener('change', () => {
      opts[k] = el.checked; saveOpts();
      if (k === 'awake') (el.checked ? keepAwake() : letSleep());
      if (k !== 'awake' && el.checked) ensureAudio();
    });
  }
  $('t-start').addEventListener('click', togglePause);
  $('t-reset').addEventListener('click', reset);
  $('t-minus').addEventListener('click', () => nudge(-5));
  $('t-plus').addEventListener('click', () => nudge(5));
  $('t-set').addEventListener('submit', (e) => {
    e.preventDefault();
    const sec = parseClock($('t-at').value);
    const msg = $('t-set-msg');
    if (sec == null) { msg.textContent = 'Type the game clock like 4:12.'; return; }
    msg.textContent = '';
    if (run && run.paused != null) { run.paused = sec; save(); render(); }
    else start(sec);
    $('t-at').value = '';
  });
  $('t-taps').innerHTML = TAP_TIMERS.map((t) =>
    `<button class="tap" data-tap="${t.id}" title="${esc(t.tip)}"><b>${esc(t.button)}</b><span>Not started</span></button>`).join('');
  $('t-taps').addEventListener('click', (e) => { const b = e.target.closest('[data-tap]'); if (b) tap(b.dataset.tap); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });

  initAlertSettings();

  // Don't replay alerts that were already due before this page opened.
  const now = clock();
  for (const o of occurrences(now)) {
    if (now >= o.at - opts.warn + 4) fired.add(o.key + '|pre');
    if (now >= o.at + 3) fired.add(o.key + '|now');
  }

  render();
  setInterval(() => { const n = clock(); checkAlerts(n); render(); }, 250);
}
