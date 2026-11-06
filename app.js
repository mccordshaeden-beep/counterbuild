import { TAGS } from './rules.js';
import { loadMyStats } from './mystats.js';
import { initTimer, clock, fmt as fmtClock } from './timer.js';
import { computeBuild, threatProfile, defaultTags, parseSteam, teamKey } from './engine.js';

const API = 'https://api.deadlock-api.com';
const ASSETS = 'https://assets.deadlock-api.com';
const DAY = 86400;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- storage ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('cb.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('cb.' + k, JSON.stringify(v)); } catch {} },
};

// ---------- state ----------
const state = {
  heroes: [],                 // [{ id, name, img, type }]
  heroById: new Map(),
  items: new Map(),           // id -> { id, name, tier, slot, cost, img }
  me: store.get('me', null),
  enemies: [],
  tagOverrides: store.get('tags', {}), // heroId -> [tags]
  mode: 'me',
  rank: store.get('rank', 'all'),
  matchMode: store.get('matchMode', 'Ranked,Unranked'),
  style: store.get('style', 'stats'),
  stats: new Map(),           // cache key -> item stats array
  counters: new Map(),        // rank -> counter rows
  filter: '',
};

// ---------- network ----------
async function getJSON(url, ms = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status} from ${new URL(url).pathname}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function firstOk(urls) {
  let last;
  for (const u of urls) {
    try { return await getJSON(u); } catch (e) { last = e; }
  }
  throw last;
}

async function cached(key, hours, loader) {
  const hit = store.get('c.' + key, null);
  if (hit && Date.now() - hit.t < hours * 3600e3) return hit.v;
  try {
    const v = await loader();
    store.set('c.' + key, { t: Date.now(), v });
    return v;
  } catch (e) {
    if (hit) return hit.v; // stale is better than nothing
    throw e;
  }
}

// ---------- item details for the hover card ----------
const toText = (html) => {
  const raw = String(html ?? '').replace(/\{[^}]*\}/g, '').replace(/<br\s*\/?>/gi, '\n');
  try { return (new DOMParser().parseFromString(raw, 'text/html').body.textContent || '').replace(/[ \t]+/g, ' ').trim(); }
  catch { return raw.replace(/<[^>]+>/g, '').trim(); }
};
const SKIP = /^(ability_?)?(channel|cast|charge_?delay|duration_?scale|tech_?power_?scale)/i;

function itemInfo(i) {
  const props = i.properties || {};
  // Prefer the properties the game itself shows in the tooltip, in its order.
  const order = [];
  for (const sec of i.tooltip_sections || []) for (const at of sec.section_attributes || [])
    for (const k of [...(at.important_properties || []), ...(at.properties || []), ...(at.elevated_properties || [])]) if (!order.includes(k)) order.push(k);
  const names = order.length ? order : Object.keys(props);
  const stats = [];
  let cooldown = null;
  for (const k of names) {
    const p = props[k];
    if (!p || typeof p !== 'object') continue;
    const label = toText(p.label || p.name || '');
    const num = Number(p.value);
    if (!label || p.value == null || p.value === '' || (Number.isFinite(num) && num === 0)) continue;
    if (/cooldown/i.test(k) && /^ability/i.test(k)) { cooldown = `${p.value}${p.postfix || 's'}`; continue; }
    if (SKIP.test(k)) continue;
    const sign = String(p.prefix || '').includes('sign') && Number.isFinite(num) && num > 0 ? '+' : '';
    stats.push({ label, value: `${sign}${p.value}${toText(p.postfix || '')}` });
    if (stats.length >= 10) break;
  }
  const d = i.description;
  const desc = toText(typeof d === 'string' ? d : d?.desc || d?.passive || d?.active || '');
  const activation = String(i.activation || '').toLowerCase();
  return { stats, desc, cooldown, active: !!activation && activation !== 'passive' };
}

const pickImg = (o, keys) => { for (const k of keys) if (o && o[k]) return o[k]; return ''; };

async function loadAssets() {
  const [heroesRaw, itemsRaw] = await Promise.all([
    cached('heroes2', 6, () => firstOk([`${API}/v1/assets/heroes`, `${ASSETS}/v2/heroes`])),
    cached('items2', 12, () => firstOk([`${API}/v1/assets/items/by-type/upgrade`, `${ASSETS}/v2/items/by-type/upgrade`, `${API}/v1/assets/items`, `${ASSETS}/v2/items`])),
  ]);

  state.heroes = (heroesRaw || [])
    // Only hide heroes the data says you can't pick. "In development" can still mean released.
    .filter((h) => h.player_selectable !== false && !h.disabled && h.name)
    .map((h) => ({
      id: h.id, name: h.name, type: h.hero_type,
      img: pickImg(h.images, ['icon_hero_card_webp', 'icon_hero_card', 'icon_image_small_webp', 'icon_image_small', 'minimap_image_webp', 'minimap_image']),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  state.heroById = new Map(state.heroes.map((h) => [h.id, h]));

  for (const i of itemsRaw || []) {
    if (i.type && i.type !== 'upgrade') continue;
    if (i.shopable === false || i.disabled) continue;
    state.items.set(Number(i.id), {
      id: Number(i.id), name: i.name, tier: Number(i.item_tier) || 0,
      slot: i.item_slot_type, cost: Number(i.cost) || 0,
      img: pickImg(i, ['shop_image_small_webp', 'shop_image_small', 'shop_image_webp', 'shop_image', 'image_webp', 'image']),
      cls: i.class_name, rawComponents: i.component_items || i.components || [],
      info: itemInfo(i),
    });
  }
  // Upgrade parts arrive as class names or ids; turn them into item ids.
  const byClass = new Map([...state.items.values()].filter((it) => it.cls).map((it) => [it.cls, it.id]));
  for (const it of state.items.values()) {
    it.components = (Array.isArray(it.rawComponents) ? it.rawComponents : [])
      .map((c) => (typeof c === 'number' ? c : byClass.get(c) ?? (Number(c) || null)))
      .filter((id) => id && id !== it.id && state.items.has(id));
    delete it.rawComponents;
  }
}

// Unranked games have no rank badge, so a rank filter would silently drop all of them.
// The rank filter only applies when looking at ranked games.
const rankApplies = () => state.matchMode === 'Ranked' && state.rank !== 'all';
const filterKey = () => `${state.matchMode}|${rankApplies() ? state.rank : 'all'}`;

function rankQuery() {
  const since = Math.floor(Date.now() / 1000) - 30 * DAY;
  let q = `game_mode=normal&match_mode=${encodeURIComponent(state.matchMode)}&min_unix_timestamp=${since}`;
  if (rankApplies()) q += `&min_average_badge=${state.rank}`;
  return q;
}

async function loadItemStats(heroId) {
  const key = `${heroId}|${filterKey()}`;
  if (state.stats.has(key)) return state.stats.get(key);
  const v = await cached('is.' + key, 6, () => getJSON(`${API}/v1/analytics/item-stats?hero_id=${heroId}&${rankQuery()}`));
  state.stats.set(key, v);
  return v;
}

async function loadCounters() {
  const key = filterKey();
  if (state.counters.has(key)) return state.counters.get(key);
  const v = await cached('hc.' + key, 12, () => getJSON(`${API}/v1/analytics/hero-counter-stats?${rankQuery()}`));
  state.counters.set(key, v);
  return v;
}

// ---------- tags ----------
const tagsFor = (id) => state.tagOverrides[id] ?? defaultTags(state.heroById.get(id));

function toggleTag(id, tag) {
  const cur = new Set(tagsFor(id));
  cur.has(tag) ? cur.delete(tag) : cur.add(tag);
  state.tagOverrides[id] = [...cur];
  store.set('tags', state.tagOverrides);
  renderThreats();
  renderBuild();
}

// ---------- rendering ----------
function heroFace(h, cls = '') {
  if (!h) return `<span class="face empty ${cls}" aria-hidden="true"></span>`;
  return h.img
    ? `<img class="face ${cls}" src="${esc(h.img)}" alt="" loading="lazy">`
    : `<span class="face ${cls}" aria-hidden="true">${esc(h.name.slice(0, 2))}</span>`;
}

function renderLineup() {
  const me = state.heroById.get(state.me);
  $('me-slot').innerHTML = `${heroFace(me, 'big')}<span>${me ? esc(me.name) : 'Pick your hero'}</span>`;
  const slots = [];
  for (let i = 0; i < 6; i++) {
    const h = state.heroById.get(state.enemies[i]);
    slots.push(h
      ? `<button class="enemy" data-remove="${h.id}" title="Remove ${esc(h.name)}">${heroFace(h)}<span class="x" aria-hidden="true">×</span><span class="sr">Remove ${esc(h.name)}</span></button>`
      : `<span class="enemy open" aria-hidden="true"></span>`);
  }
  $('enemy-slots').innerHTML = slots.join('');
  $('enemy-count').textContent = `${state.enemies.length}/6`;
}

function renderGrid() {
  const f = state.filter.toLowerCase();
  $('hero-grid').innerHTML = state.heroes
    .filter((h) => !f || h.name.toLowerCase().includes(f))
    .map((h) => {
      const isMe = h.id === state.me;
      const isEnemy = state.enemies.includes(h.id);
      return `<button class="hero ${isMe ? 'is-me' : ''} ${isEnemy ? 'is-enemy' : ''}" data-hero="${h.id}" aria-pressed="${state.mode === 'me' ? isMe : isEnemy}">
        ${heroFace(h)}<span>${esc(h.name)}</span></button>`;
    }).join('') || '<p class="hint">No hero matches that name.</p>';
}

function renderThreats() {
  const enemies = state.enemies.map((id) => state.heroById.get(id)).filter(Boolean);
  $('threat-panel').hidden = enemies.length === 0;
  $('threat-list').innerHTML = enemies.map((h) => {
    const on = new Set(tagsFor(h.id));
    return `<div class="threat-row">${heroFace(h)}<b>${esc(h.name)}</b>
      <div class="tags">${Object.entries(TAGS).map(([k, t]) =>
        `<button class="tag t-${k} ${on.has(k) ? 'on' : ''}" data-hero="${h.id}" data-tag="${k}" aria-pressed="${on.has(k)}">${t.short}</button>`).join('')}</div></div>`;
  }).join('');
  const prof = threatProfile(enemies.map((h) => ({ name: h.name, tags: tagsFor(h.id) })));
  const sorted = Object.entries(prof).sort((a, b) => b[1].count - a[1].count);
  $('threat-sum').innerHTML = sorted.length
    ? sorted.map(([k, v]) => `<span class="sum t-${k}"><b>${v.count}</b> ${TAGS[k].label}</span>`).join('')
    : '';
}

const pct = (x) => (x == null ? '—' : (x * 100).toFixed(1) + '%');
const slotName = { weapon: 'Weapon', vitality: 'Vitality', spirit: 'Spirit' };

function itemCard(s) {
  const it = s.item;
  const why = s.reasons.length
    ? `<span class="why">vs ${esc([...new Set(s.reasons.flatMap((r) => r.names))].join(', '))}</span>` : '';
  return `<li class="item s-${esc(it.slot)}" data-item="${it.id}" tabindex="0">
    ${it.img ? `<img src="${esc(it.img)}" alt="" loading="lazy">` : '<span class="noimg"></span>'}
    <div class="it-body">
      <span class="it-name">${esc(it.name)}</span>
      <span class="it-sub">${slotName[it.slot] || ''} · T${it.tier} · ${it.cost ? it.cost.toLocaleString() + ' souls' : ''}</span>
      ${why}
    </div>
    <div class="it-num" title="${s.matches ? s.matches.toLocaleString() + ' games with this item' : 'Not enough games on this hero yet'}">
      <b>${pct(s.wr)}</b><span>${s.matches ? 'win rate' : 'counter pick'}</span>
    </div>
  </li>`;
}

let buildToken = 0;
async function renderBuild() {
  const me = state.heroById.get(state.me);
  const el = $('build');
  if (!me) {
    el.innerHTML = '<p class="empty-note">Pick your hero above, or find your live match, and your build shows up here.</p>';
    $('build-meta').textContent = '';
    return;
  }
  const token = ++buildToken;
  el.classList.add('loading');
  $('build-meta').textContent = `Loading ${me.name} item stats…`;

  let stats = [], statsError = null;
  try { stats = await loadItemStats(me.id); } catch (e) { statsError = e; }
  if (token !== buildToken) return;
  el.classList.remove('loading');

  const enemies = state.enemies.map((id) => state.heroById.get(id)).filter(Boolean)
    .map((h) => ({ name: h.name, tags: tagsFor(h.id) }));
  const build = computeBuild({ stats, items: state.items, threats: threatProfile(enemies), style: state.style });

  $('build-meta').textContent = build.hasStats
    ? `${build.sample.toLocaleString()} recent ${me.name} games · leans ${build.heroLean === 'spirit' ? 'spirit' : 'gun'} · ${build.cost.toLocaleString()} souls total`
    : '';

  const stage = (title, sub, list) => list.length ? `
    <div class="stage"><h3>${title}<small>${sub}</small></h3><ol class="items">${list.map(itemCard).join('')}</ol></div>` : '';

  const pathRow = (s, i) => {
    const it = s.item;
    const notes = [];
    if (s.into) notes.push(`<span class="up">upgrades into ${esc(s.into.name)}</span>`);
    if (s.upgradesFrom?.length) notes.push(`<span class="up">from ${esc(s.upgradesFrom.map((c) => c.name).join(' + '))}</span>`);
    if (s.reasons?.length) notes.push(`<span class="why">vs ${esc([...new Set(s.reasons.flatMap((r) => r.names))].join(', '))}</span>`);
    return `<li class="step s-${esc(it.slot)}" data-at="${s.at ?? ''}" data-item="${it.id}" tabindex="0">
      <span class="n">${i + 1}</span>
      ${it.img ? `<img src="${esc(it.img)}" alt="" loading="lazy">` : '<span class="noimg"></span>'}
      <span class="st-body"><span class="it-name">${esc(it.name)}</span>${notes.join('')}</span>
      <span class="st-num"><b>${s.pay.toLocaleString()}</b><small>${s.running.toLocaleString()} total${s.at != null ? ` · ~${fmtClock(s.at)}` : ''}</small></span>
    </li>`;
  };
  const pathHtml = build.path.length ? `
    <div class="stage path"><h3>Build order<small>${state.style === 'balanced' ? 'Tank + damage · ' : ''}Buy top to bottom · ${build.final.length} slots when done</small></h3>
    <ol class="steps">${build.path.map(pathRow).join('')}</ol>
    <p class="hint">Times are when players usually buy each item. With the match timer running, your next buy is highlighted.</p></div>` : '';

  el.innerHTML = (statsError ? `<p class="warn">Couldn't load item stats (${esc(statsError.message)}). Showing counter items only. Try again in a minute.</p>` : '')
    + (!statsError && !build.hasStats ? `<p class="warn">No recent games for ${esc(me.name)} with these filters. Try Ranked + unranked.</p>` : '')
    + pathHtml
    + (build.path.length ? '<h3 class="more-h">Other strong items</h3>' : '')
    + stage('Early', 'Tier 1 and 2 · lane', build.stages.early)
    + stage('Core', 'Tier 3 · mid game', build.stages.core)
    + stage('Late', 'Tier 4 · when you have the souls', build.stages.late)
    + (build.situational.length ? stage('Swap in if needed', 'Other answers to this lineup', build.situational) : '');

  renderMatchups();
}

async function renderMatchups() {
  const panel = $('mu-panel');
  if (!state.me || !state.enemies.length) { panel.hidden = true; return; }
  let rows;
  try { rows = await loadCounters(); } catch { panel.hidden = true; return; }
  const list = state.enemies.map((eid) => {
    const r = (rows || []).find((x) => x.hero_id === state.me && x.enemy_hero_id === eid);
    const m = r ? Number(r.matches_played ?? r.matches) || 0 : 0;
    return { h: state.heroById.get(eid), wr: m ? r.wins / m : null, m };
  }).filter((x) => x.h);
  if (!list.some((x) => x.m)) { panel.hidden = true; return; }
  panel.hidden = false;
  $('matchups').innerHTML = `<ul class="mu">${list.map((x) => {
    const cls = x.wr == null ? '' : x.wr >= 0.52 ? 'good' : x.wr <= 0.48 ? 'bad' : 'even';
    const w = x.wr == null ? 0 : Math.round(x.wr * 100);
    return `<li class="${cls}">${heroFace(x.h)}<span class="mu-name">${esc(x.h.name)}</span>
      <span class="bar" aria-hidden="true"><i style="width:${w}%"></i><em></em></span>
      <b>${x.wr == null ? '—' : pct(x.wr)}</b></li>`;
  }).join('')}</ul><p class="hint">Your hero's win rate in games against each enemy hero. The tick marks 50%.</p>`;
}

function renderAll() { renderLineup(); renderGrid(); renderThreats(); renderBuild(); }

// ---------- actions ----------
function setMode(m) {
  state.mode = m;
  $('mode-me').setAttribute('aria-selected', m === 'me');
  $('mode-enemy').setAttribute('aria-selected', m === 'enemy');
  renderGrid();
}

function pickHero(id) {
  if (state.mode === 'me') {
    state.me = id;
    state.enemies = state.enemies.filter((e) => e !== id);
    store.set('me', id);
    setMode('enemy');
  } else {
    if (id === state.me) return;
    if (state.enemies.includes(id)) state.enemies = state.enemies.filter((e) => e !== id);
    else if (state.enemies.length < 6) state.enemies.push(id);
  }
  renderAll();
}

async function findLiveMatch(ev) {
  ev.preventDefault();
  const raw = $('steam').value;
  const acc = parseSteam(raw);
  const status = $('live-status');
  if (!acc) { status.textContent = 'Paste your Steam profile link (steamcommunity.com/profiles/7656…) or the long number in it.'; status.className = 'status bad'; return; }
  store.set('steam', raw.trim());
  status.textContent = 'Looking for your match…'; status.className = 'status';
  $('live-btn').disabled = true;
  try {
    const data = await getJSON(`${API}/v1/matches/active?account_id=${acc}`);
    const matches = Array.isArray(data) ? data : data?.matches || [];
    let me = null, match = null;
    for (const m of matches) {
      const p = (m.players || []).find((x) => Number(x.account_id) === acc);
      if (p) { me = p; match = m; break; }
    }
    if (!me) {
      status.textContent = "No live match found. The live feed only covers some games, so pick the enemy heroes below instead.";
      status.className = 'status bad';
      setMode(state.me ? 'enemy' : 'me');
      return;
    }
    const myTeam = teamKey(me.team);
    state.me = Number(me.hero_id); store.set('me', state.me);
    state.enemies = match.players.filter((p) => teamKey(p.team) !== myTeam).map((p) => Number(p.hero_id)).filter((id) => state.heroById.has(id)).slice(0, 6);
    status.textContent = `Found it. You're on ${state.heroById.get(state.me)?.name || 'your hero'} against ${state.enemies.length} enemies.`;
    status.className = 'status good';
    setMode('enemy');
    renderAll();
  } catch (e) {
    status.textContent = `Couldn't reach the match service (${e.message}). Pick the enemy heroes below instead.`;
    status.className = 'status bad';
  } finally {
    $('live-btn').disabled = false;
  }
}

function syncFilters() {
  const ranked = state.matchMode === 'Ranked';
  $('rank').disabled = !ranked;
  const note = $('filter-note');
  if (!ranked) {
    note.hidden = false;
    note.textContent = 'Unranked games have no rank, so all ranks are included. Pick Ranked to filter by rank.';
  } else note.hidden = true;
}

async function showMyStats() {
  const acc = parseSteam($('steam').value || store.get('steam', ''));
  if (!acc) { $('me-body').innerHTML = '<p class="warn">Paste your Steam profile link or ID in the Live match box first.</p>'; return; }
  $('me-btn').disabled = true;
  try {
    await loadMyStats(acc, {
      heroById: state.heroById, face: (h) => heroFace(h), el: $('me-body'),
      onPickHero: (id) => { state.mode = 'me'; pickHero(id); document.getElementById('build-h').scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    });
    $('me-btn').textContent = 'Refresh';
  } finally { $('me-btn').disabled = false; }
}

// ---------- wiring ----------
function wire() {
  $('steam').value = store.get('steam', '');
  const steamSaved = () => {
    const v = store.get('steam', '');
    if (v && parseSteam(v)) { $('live-status').textContent = 'Steam ID saved on this device. Tap Find my match once the game starts.'; $('live-status').className = 'status good'; }
  };
  $('steam').addEventListener('change', () => {
    const v = $('steam').value.trim();
    if (!v) { store.set('steam', ''); return; }
    if (parseSteam(v)) { store.set('steam', v); steamSaved(); }
  });
  steamSaved();
  $('me-btn').addEventListener('click', showMyStats);
  $('rank').value = state.rank;
  $('mode').value = state.matchMode;
  $('style').value = state.style;
  $('style').addEventListener('change', (e) => { state.style = e.target.value; store.set('style', state.style); renderBuild(); });
  $('rank').addEventListener('change', (e) => { state.rank = e.target.value; store.set('rank', state.rank); syncFilters(); renderBuild(); });
  $('mode').addEventListener('change', (e) => { state.matchMode = e.target.value; store.set('matchMode', state.matchMode); syncFilters(); renderBuild(); });
  syncFilters();
  $('live-form').addEventListener('submit', findLiveMatch);
  $('mode-me').addEventListener('click', () => setMode('me'));
  $('mode-enemy').addEventListener('click', () => setMode('enemy'));
  $('hero-search').addEventListener('input', (e) => { state.filter = e.target.value; renderGrid(); });
  $('hero-grid').addEventListener('click', (e) => { const b = e.target.closest('[data-hero]'); if (b) pickHero(Number(b.dataset.hero)); });
  $('enemy-slots').addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove]');
    if (b) { state.enemies = state.enemies.filter((x) => x !== Number(b.dataset.remove)); renderAll(); }
  });
  $('threat-list').addEventListener('click', (e) => { const b = e.target.closest('[data-tag]'); if (b) toggleTag(Number(b.dataset.hero), b.dataset.tag); });
}

async function boot() {
  try { ['cb.c.items', 'cb.c.heroes'].forEach((k) => localStorage.removeItem(k)); } catch {} // old cache copies
  initTimer();
  wire();
  $('build').innerHTML = '<p class="empty-note">Loading heroes and items…</p>';
  try {
    await loadAssets();
  } catch (e) {
    $('build').innerHTML = `<p class="warn">Couldn't load the hero and item list (${esc(e.message)}). Check your connection and reload.</p>`;
    return;
  }
  if (state.me && !state.heroById.has(state.me)) state.me = null;
  setMode(state.me ? 'enemy' : 'me');
  renderAll();
  if (parseSteam(store.get('steam', ''))) showMyStats();
}

// ---------- hover card ----------
const tip = document.createElement('div');
tip.className = 'tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true;
document.body.appendChild(tip);
let tipFor = null;

function tipHtml(it) {
  const info = it.info || {};
  const kind = { weapon: 'Weapon', vitality: 'Vitality', spirit: 'Spirit' }[it.slot] || '';
  const s = state.stats.get(`${state.me}|${filterKey()}`)?.find?.((r) => Number(r.item_id) === it.id);
  const m = s ? Number(s.matches ?? (Number(s.wins) + Number(s.losses))) : 0;
  return `<div class="tip-head s-${esc(it.slot)}">
      ${it.img ? `<img src="${esc(it.img)}" alt="">` : ''}
      <div><b>${esc(it.name)}</b><span>${kind} · Tier ${it.tier} · ${it.cost.toLocaleString()} souls</span></div>
    </div>
    <div class="tip-tags"><span>${info.active ? 'Active' : 'Passive'}</span>${info.cooldown ? `<span>Cooldown ${esc(info.cooldown)}</span>` : ''}
      ${m ? `<span>${(s.wins / m * 100).toFixed(1)}% win rate · ${m.toLocaleString()} games</span>` : ''}</div>
    ${info.stats?.length ? `<dl class="tip-stats">${info.stats.map((x) => `<dt>${esc(x.label)}</dt><dd>${esc(x.value)}</dd>`).join('')}</dl>` : ''}
    ${info.desc ? `<p class="tip-desc">${esc(info.desc)}</p>` : ''}
    ${!info.stats?.length && !info.desc ? '<p class="tip-desc">No details in the game data for this item.</p>' : ''}`;
}

function showTip(el) {
  const it = state.items.get(Number(el.dataset.item));
  if (!it) return;
  tipFor = el;
  tip.innerHTML = tipHtml(it);
  tip.hidden = false;
  const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  let left = Math.min(Math.max(8, r.left + 12), vw - w - 8);
  let top = r.bottom + 6;
  if (top + h > vh - 8) top = Math.max(8, r.top - h - 6);
  tip.style.left = left + 'px'; tip.style.top = top + 'px';
}
function hideTip() { tip.hidden = true; tipFor = null; }

document.addEventListener('pointerover', (e) => {
  if (e.pointerType === 'touch') return;
  const el = e.target.closest('[data-item]');
  if (el && el !== tipFor) showTip(el);
  else if (!el && !e.target.closest('.tip')) hideTip();
});
document.addEventListener('click', (e) => { // tap on phones
  const el = e.target.closest('[data-item]');
  if (el) { el === tipFor && !tip.hidden ? hideTip() : showTip(el); }
  else if (!e.target.closest('.tip')) hideTip();
});
document.addEventListener('focusin', (e) => { const el = e.target.closest?.('[data-item]'); if (el) showTip(el); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });
document.addEventListener('scroll', hideTip, true);

// Highlight the next thing to buy, following the match timer.
setInterval(() => {
  const now = clock();
  const rows = [...document.querySelectorAll('.step[data-at]')].filter((r) => r.dataset.at !== '');
  let marked = false;
  for (const r of rows) {
    const at = Number(r.dataset.at);
    const done = now > 0 && at < now - 90;
    r.classList.toggle('past', done);
    const next = now > 0 && !done && !marked;
    r.classList.toggle('next', next);
    if (next) marked = true;
  }
}, 1000);

boot();

if ('serviceWorker' in navigator) {
  // When a new version installs, reload once so you see it right away.
  let reloaded = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => { reg.update(); document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update(); }); })
    .catch(() => {}));
}
