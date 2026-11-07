import { loadMyStats } from './mystats.js';
import { extractMatch, coach } from './coach.js';
import { parseSteam } from './engine.js';

const API = 'https://api.deadlock-api.com';
const ASSETS = 'https://assets.deadlock-api.com';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('cb.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('cb.' + k, JSON.stringify(v)); } catch {} },
};

async function getJSON(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) { const e = new Error(r.status === 429 ? 'too many requests' : `error ${r.status}`); e.status = r.status; throw e; }
    return await r.json();
  } finally { clearTimeout(t); }
}

// Same hero list cache as the Build page.
async function loadHeroes() {
  const hit = store.get('c.heroes2', null);
  let raw = hit && Date.now() - hit.t < 6 * 3600e3 ? hit.v : null;
  if (!raw) {
    for (const u of [`${API}/v1/assets/heroes`, `${ASSETS}/v2/heroes`]) {
      try { raw = await getJSON(u); store.set('c.heroes2', { t: Date.now(), v: raw }); break; } catch {}
    }
    raw ??= hit?.v || [];
  }
  const img = (h) => { const i = h.images || {}; return i.icon_hero_card_webp || i.icon_hero_card || i.icon_image_small_webp || i.icon_image_small || i.minimap_image || ''; };
  return new Map(raw.filter((h) => h.name).map((h) => [h.id, { id: h.id, name: h.name, img: img(h) }]));
}

const face = (h) => (!h ? '<span class="face empty" aria-hidden="true"></span>'
  : h.img ? `<img class="face" src="${esc(h.img)}" alt="" loading="lazy">` : `<span class="face" aria-hidden="true">${esc(h.name.slice(0, 2))}</span>`);

let heroById = new Map();
let lastSummary = null;
let account = null;

// Each match's coaching numbers never change, so keep them once worked out.
async function matchNumbers(id, acc) {
  const key = `cm.${acc}.${id}`;
  const hit = store.get(key, undefined);
  if (hit !== undefined) return hit;
  const meta = await getJSON(`${API}/v1/matches/${id}/metadata`);
  const v = extractMatch(meta, acc);
  store.set(key, v);
  return v;
}

const LEVEL = { fix: 'Fix first', work: 'Work on', good: 'Keep doing' };

async function runCoach(count) {
  const body = $('coach-body');
  if (!lastSummary || !account) return;
  const games = lastSummary.games.slice(0, count);
  const results = [];
  let done = 0, failed = 0, limited = false;
  const show = () => { body.innerHTML = `<p class="empty-note">Looking at match ${Math.min(done + 1, games.length)} of ${games.length}…</p>`; };
  show();
  const queue = [...games];
  async function worker() {
    while (queue.length && !limited) {
      const g = queue.shift();
      try {
        const m = await matchNumbers(g.id, account);
        if (m) { if (m.won == null) m.won = g.won; results.push(m); }
      } catch (e) { failed++; if (e.status === 429) limited = true; }
      done++; show();
    }
  }
  await Promise.all([worker(), worker()]);

  const heroCount = new Set(lastSummary.games.slice(0, 20).map((g) => g.hero)).size;
  const c = coach(results, heroCount);
  $('coach-meta').textContent = `${results.length} matches looked at`;
  $('coach-more').hidden = count >= 20 || lastSummary.games.length <= count;

  if (c.n < 3) {
    body.innerHTML = `<p class="warn">Couldn't get enough match details to coach you (${results.length} of ${games.length}). ${limited ? 'The stats service asked us to slow down. Try again in a minute.' : 'Try again later.'}</p>`;
    return;
  }
  const nb = c.numbers;
  const bar = (label, you, them, fmt, lowIsGood) => {
    const max = Math.max(you, them) * 1.15 || 1;
    const better = lowIsGood ? you <= them : you >= them;
    return `<div class="cmp"><span class="cmp-l">${label}</span>
      <span class="cmp-bars"><i class="you ${better ? 'good' : 'bad'}" style="width:${(you / max) * 100}%"></i><i class="them" style="width:${(them / max) * 100}%"></i></span>
      <span class="cmp-v"><b>${fmt(you)}</b><small>lobby ${fmt(them)}</small></span></div>`;
  };
  const r0 = (x) => Math.round(x).toLocaleString(), r1 = (x) => x.toFixed(1);
  body.innerHTML = `
    <div class="cmp-wrap">
      <p class="cmp-key"><span><i class="you good"></i>You</span><span><i class="them"></i>Average player in your games</span></p>
      ${bar('Deaths a game', nb.d, nb.ld, r1, true)}
      ${bar('Souls a minute', nb.s, nb.ls, r0, false)}
      ${bar('Last hits a game', nb.lh, nb.llh, r0, false)}
      ${nb.lane != null ? `<p class="lane-note">At 10:00 you're <b class="${nb.lane >= 0 ? 'good' : 'bad'}">${r0(Math.abs(nb.lane))} souls ${nb.lane >= 0 ? 'ahead of' : 'behind'}</b> your lane opponent on average.</p>` : ''}
    </div>
    ${c.tips.length ? `<ol class="tips">${c.tips.map((t) => `<li class="tip-card lv-${t.level}">
      <span class="lv">${LEVEL[t.level]}</span>
      <h3>${esc(t.title)}</h3>
      <p>${esc(t.body)}</p>
      <p class="ev">${esc(t.evidence)}</p></li>`).join('')}</ol>`
    : '<p class="empty-note">Nothing stands out. You\'re close to the average player in your games on deaths, souls and last hits.</p>'}
    ${failed ? `<p class="hint">${failed} match${failed > 1 ? 'es' : ''} couldn't be loaded and ${failed > 1 ? 'were' : 'was'} skipped.</p>` : ''}`;
}

async function load(fresh = false) {
  const acc = parseSteam($('steam').value);
  if (!acc) { $('id-status').textContent = 'Paste your Steam profile link or the 7656… number from Steam → Account details.'; $('id-status').className = 'status bad'; return; }
  store.set('steam', $('steam').value.trim());
  $('id-status').textContent = 'Saved on this device, shared with the Build page.'; $('id-status').className = 'status good';
  account = acc;
  $('coach-body').innerHTML = '<p class="empty-note">Loading your matches…</p>';
  lastSummary = await loadMyStats(acc, {
    heroById, face, el: $('me-body'), fresh,
    onPickHero: (id) => { store.set('me', id); location.href = './'; },
  });
  if (!lastSummary) { $('coach-body').innerHTML = '<p class="empty-note">Coaching needs your match history first.</p>'; return; }
  await runCoach(10);
}

async function boot() {
  $('steam').value = store.get('steam', '');
  $('id-form').addEventListener('submit', (e) => { e.preventDefault(); load(); });
  $('coach-more').addEventListener('click', () => runCoach(20));
  $('me-fresh').addEventListener('click', async () => {
    const b = $('me-fresh');
    b.disabled = true; b.textContent = 'Checking…';
    try { await load(true); } finally { b.disabled = false; b.textContent = 'Check for new matches'; }
  });
  heroById = await loadHeroes();
  if (parseSteam($('steam').value)) load();
}
boot();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
