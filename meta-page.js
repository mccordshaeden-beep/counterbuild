import { loadAssets, store, getJSON, cached, API } from './assets.js';
import { initItemTips } from './itemtip.js';
import { tierList, matchups, movers, itemTable, latestPatch } from './meta.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x, d = 1) => (x == null ? '—' : (x * 100).toFixed(d) + '%');
const pts = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}`;
const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);

let A = { heroes: [], heroById: new Map(), items: new Map() };
const S = {
  mode: store.get('matchMode', 'Ranked,Unranked'),
  rank: store.get('rank', 'all'),
  muHero: store.get('me', null),
  iwHero: 'all', iwSlot: 'all', iwTier: 0, iwSort: 'vsTier', iwDir: -1,
  heroWr: new Map(), counters: null, tiers: [], itemRows: [], totalPlayerGames: 0,
};

const face = (h, cls = '') => (!h ? '<span class="face empty" aria-hidden="true"></span>'
  : h.img ? `<img class="face ${cls}" src="${esc(h.img)}" alt="" loading="lazy">` : `<span class="face ${cls}" aria-hidden="true">${esc(h.name.slice(0, 2))}</span>`);
const heroName = (id) => A.heroById.get(id)?.name || `Hero ${id}`;

function q({ from, to } = {}) {
  let s = `game_mode=normal&match_mode=${encodeURIComponent(S.mode)}&min_unix_timestamp=${from ?? now() - 14 * DAY}`;
  if (to) s += `&max_unix_timestamp=${to}`;
  if (S.mode === 'Ranked' && S.rank !== 'all') s += `&min_average_badge=${S.rank}`;
  return s;
}
const fkey = () => `${S.mode}|${S.mode === 'Ranked' ? S.rank : 'all'}`;
const load = (name, url, hours = 3) => cached(`m.${name}.${fkey()}`, hours, () => getJSON(url, 30000));

// ---------- hero tier list ----------
async function renderTiers() {
  const el = $('tiers');
  el.innerHTML = '<p class="empty-note">Loading heroes…</p>';
  let rows;
  try { rows = await load('hs', `${API}/v1/analytics/hero-stats?${q()}`); }
  catch (e) { el.innerHTML = `<p class="warn">Couldn't load hero stats (${esc(e.message)}).</p>`; return; }
  S.tiers = tierList(rows).filter((r) => A.heroById.has(r.hero));
  S.heroWr = new Map(S.tiers.map((r) => [r.hero, r.wr]));
  S.totalPlayerGames = S.tiers.reduce((a, r) => a + r.matches, 0);
  $('tier-meta').textContent = `${Math.round(S.totalPlayerGames / 12).toLocaleString()} matches`;
  if (!S.tiers.length) { el.innerHTML = '<p class="warn">No games with these filters.</p>'; return; }
  el.innerHTML = ['S', 'A', 'B', 'C', 'D'].map((t) => {
    const hs = S.tiers.filter((r) => r.tier === t);
    if (!hs.length) return '';
    return `<div class="tier-row"><span class="tier-badge t-${t}">${t}</span><div class="tier-heroes">
      ${hs.map((r) => `<button class="tier-hero" data-mu="${r.hero}" title="${esc(heroName(r.hero))}: ${pct(r.wr)} win rate, picked in ${pct(r.pick, 0)} of matches, ${r.matches.toLocaleString()} games">
        ${face(A.heroById.get(r.hero))}<span class="th-name">${esc(heroName(r.hero))}</span>
        <span class="th-num"><b>${pct(r.wr)}</b><small>${pct(r.pick, 0)} pick</small></span></button>`).join('')}
    </div></div>`;
  }).join('');
}

// ---------- lane matchups ----------
async function renderMatchups() {
  const el = $('mu');
  const hero = S.muHero;
  if (!hero || !A.heroById.has(hero)) { el.innerHTML = '<p class="empty-note">Pick a hero.</p>'; return; }
  el.innerHTML = '<p class="empty-note">Loading matchups…</p>';
  try { S.counters ??= await load('hc', `${API}/v1/analytics/hero-counter-stats?${q()}`); }
  catch (e) { el.innerHTML = `<p class="warn">Couldn't load matchups (${esc(e.message)}).</p>`; return; }
  const list = matchups(S.counters, S.heroWr, hero);
  if (!list.length) { el.innerHTML = '<p class="warn">Not enough lane games for this hero with these filters.</p>'; return; }
  const row = (r) => `<li class="${r.edge >= 0 ? 'good' : 'bad'}">
      ${face(A.heroById.get(r.enemy))}<span class="mu-name">${esc(heroName(r.enemy))}</span>
      <span class="edge-bar" aria-hidden="true"><i style="${r.edge >= 0 ? 'left:50%' : `right:50%`};width:${Math.min(50, Math.abs(r.edge) * 500)}%"></i></span>
      <span class="mu-num"><b>${pts(r.edge)}</b><small>${pct(r.wr)} · ${r.matches.toLocaleString()}</small></span></li>`;
  const good = list.filter((r) => r.edge > 0).slice(0, 6), bad = list.filter((r) => r.edge < 0).slice(-6).reverse();
  el.innerHTML = `<div class="mu-cols">
      <div><h3 class="mu-h good">Good lanes for ${esc(heroName(hero))}</h3><ol class="mu-list">${good.map(row).join('') || '<li class="empty-note">None stand out.</li>'}</ol></div>
      <div><h3 class="mu-h bad">Hard lanes</h3><ol class="mu-list">${bad.map(row).join('') || '<li class="empty-note">None stand out.</li>'}</ol></div>
    </div>
    <details class="mu-all"><summary>All ${list.length} matchups</summary><ol class="mu-list">${list.map(row).join('')}</ol></details>
    <p class="hint">Numbers are win-rate points better (+) or worse (−) than expected. Small print: actual lane win rate · games.</p>`;
}

// ---------- items ----------
async function renderItems() {
  const el = $('iw');
  el.innerHTML = '<p class="empty-note">Loading items…</p>';
  const hero = S.iwHero === 'all' ? '' : `hero_id=${S.iwHero}&`;
  try { S.itemRows = await load(`is${S.iwHero}`, `${API}/v1/analytics/item-stats?${hero}${q()}`); }
  catch (e) { el.innerHTML = `<p class="warn">Couldn't load item stats (${esc(e.message)}).</p>`; return; }
  drawItems();
}

function drawItems() {
  const heroGames = S.iwHero === 'all' ? S.totalPlayerGames : S.tiers.find((r) => r.hero === Number(S.iwHero))?.matches;
  let list = itemTable(S.itemRows, A.items, heroGames)
    .filter((r) => { const it = A.items.get(r.id); return (S.iwSlot === 'all' || it.slot === S.iwSlot) && (!S.iwTier || it.tier === S.iwTier); });
  const key = { name: (r) => A.items.get(r.id).name, wr: (r) => r.wr, vsTier: (r) => r.vsTier, buy: (r) => r.buy, matches: (r) => r.matches }[S.iwSort];
  list.sort((a, b) => { const x = key(a), y = key(b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * S.iwDir; });
  if (!list.length) { $('iw').innerHTML = '<p class="empty-note">No items with enough games.</p>'; return; }
  const th = (k, label) => `<th><button data-sort="${k}" class="${S.iwSort === k ? 'on' : ''}">${label}${S.iwSort === k ? (S.iwDir < 0 ? ' ↓' : ' ↑') : ''}</button></th>`;
  $('iw').innerHTML = `<div class="table-wrap"><table class="iw-table">
    <thead><tr>${th('name', 'Item')}${th('wr', 'Win')}${th('vsTier', 'Vs tier')}${th('buy', 'Bought')}${th('matches', 'Games')}</tr></thead>
    <tbody>${list.slice(0, 80).map((r) => { const it = A.items.get(r.id); return `<tr>
      <td><span class="iw-item s-${esc(it.slot)}" data-item="${it.id}" tabindex="0">${it.img ? `<img src="${esc(it.img)}" alt="">` : ''}<span>${esc(it.name)}</span><small>T${it.tier}</small></span></td>
      <td>${pct(r.wr)}</td><td class="${r.vsTier >= 0 ? 'good' : 'bad'}">${pts(r.vsTier)}</td>
      <td>${pct(r.buy, 0)}</td><td>${r.matches.toLocaleString()}</td></tr>`; }).join('')}</tbody></table></div>`;
}

// ---------- patch movers ----------
async function renderMovers() {
  const hEl = $('hero-movers'), iEl = $('item-movers');
  let patch = null;
  try { patch = latestPatch(await cached('patches', 6, () => getJSON(`${API}/v1/patches`).catch(() => getJSON(`${API}/v2/patches`)))); } catch {}
  const t = now();
  const since = patch && t - patch < 45 * DAY ? patch : t - 7 * DAY;
  const span = Math.min(14 * DAY, Math.max(7 * DAY, t - since));
  const label = patch && since === patch
    ? `Since the ${new Date(patch * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} update, compared with the ${Math.round(span / DAY)} days before it`
    : 'Last 7 days compared with the 7 days before';
  $('patch-meta').textContent = '';
  const caption = `<p class="hint movers-cap">${esc(label)}.</p>`;
  let hn, hp, inow, iprev;
  try {
    [hn, hp, inow, iprev] = await Promise.all([
      load(`hsn${since}`, `${API}/v1/analytics/hero-stats?${q({ from: since })}`),
      load(`hsp${since}`, `${API}/v1/analytics/hero-stats?${q({ from: since - span, to: since })}`, 24),
      load(`isn${since}`, `${API}/v1/analytics/item-stats?${q({ from: since })}`),
      load(`isp${since}`, `${API}/v1/analytics/item-stats?${q({ from: since - span, to: since })}`, 24),
    ]);
  } catch (e) {
    hEl.innerHTML = iEl.innerHTML = `<p class="warn">Couldn't load patch data (${esc(e.message)}).</p>`;
    return;
  }
  const hm = movers(hn, hp, 'hero_id').filter((r) => A.heroById.has(r.id));
  const im = movers(inow, iprev, 'item_id', { minGames: 1000 }).filter((r) => A.items.get(r.id)?.tier);
  const col = (list, draw, title, cls) => `<div><h3 class="mu-h ${cls}">${title}</h3><ol class="mv-list">${list.map(draw).join('') || '<li class="empty-note">Nothing big.</li>'}</ol></div>`;
  const heroRow = (r) => `<li>${face(A.heroById.get(r.id))}<span class="mu-name">${esc(heroName(r.id))}</span>
    <span class="mu-num"><b class="${r.delta >= 0 ? 'good' : 'bad'}">${pts(r.delta)}</b><small>${pct(r.before)} → ${pct(r.now)}</small></span></li>`;
  const itemRow = (r) => { const it = A.items.get(r.id); return `<li><span class="iw-item s-${esc(it.slot)}" data-item="${it.id}" tabindex="0">${it.img ? `<img src="${esc(it.img)}" alt="">` : ''}<span>${esc(it.name)}</span></span>
    <span class="mu-num"><b class="${r.delta >= 0 ? 'good' : 'bad'}">${pts(r.delta)}</b><small>${pct(r.before)} → ${pct(r.now)}</small></span></li>`; };
  const split = (list) => [list.filter((r) => r.delta > 0.005).slice(0, 6), list.filter((r) => r.delta < -0.005).slice(0, 6)];
  const [hu, hd] = split(hm), [iu, id] = split(im);
  hEl.innerHTML = caption + `<div class="mu-cols">${col(hu, heroRow, 'Rising', 'good')}${col(hd, heroRow, 'Falling', 'bad')}</div>`;
  iEl.innerHTML = caption + `<div class="mu-cols">${col(iu, itemRow, 'Rising', 'good')}${col(id, itemRow, 'Falling', 'bad')}</div>`;
}

// ---------- wiring ----------
async function reloadAll() {
  S.counters = null;
  await renderTiers();
  renderMatchups(); renderItems(); renderMovers();
}

function wire() {
  $('mode').value = S.mode; $('rank').value = S.rank;
  const sync = () => { $('rank').disabled = S.mode !== 'Ranked'; };
  sync();
  $('mode').addEventListener('change', (e) => { S.mode = e.target.value; store.set('matchMode', S.mode); sync(); reloadAll(); });
  $('rank').addEventListener('change', (e) => { S.rank = e.target.value; store.set('rank', S.rank); reloadAll(); });
  $('tiers').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mu]'); if (!b) return;
    S.muHero = Number(b.dataset.mu); $('mu-hero').value = String(S.muHero); renderMatchups();
    $('mu-h').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('mu-hero').addEventListener('change', (e) => { S.muHero = Number(e.target.value); renderMatchups(); });
  $('iw-hero').addEventListener('change', (e) => { S.iwHero = e.target.value; renderItems(); });
  const seg = (id, attr, set) => $(id).addEventListener('click', (e) => {
    const b = e.target.closest(`[data-${attr}]`); if (!b) return;
    $(id).querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    set(b.dataset[attr]); drawItems();
  });
  seg('iw-slot', 'slot', (v) => { S.iwSlot = v; });
  seg('iw-tier', 'tier', (v) => { S.iwTier = Number(v); });
  $('iw').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]'); if (!b) return;
    const k = b.dataset.sort;
    S.iwDir = S.iwSort === k ? -S.iwDir : (k === 'name' ? 1 : -1); S.iwSort = k; drawItems();
  });
}

async function boot() {
  wire();
  try { A = await loadAssets(); } catch (e) {
    $('tiers').innerHTML = `<p class="warn">Couldn't load heroes and items (${esc(e.message)}). Check your connection and reload.</p>`;
    return;
  }
  const opts = A.heroes.map((h) => `<option value="${h.id}">${esc(h.name)}</option>`).join('');
  $('mu-hero').innerHTML = opts;
  $('iw-hero').innerHTML = '<option value="all">All heroes</option>' + opts;
  if (!A.heroById.has(S.muHero)) S.muHero = A.heroes[0]?.id;
  $('mu-hero').value = String(S.muHero);
  initItemTips({ getItem: (id) => A.items.get(id) });
  reloadAll();
}
boot();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
