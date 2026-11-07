import { loadAssets, store, getJSON, cached, API } from './assets.js';
import { initItemTips } from './itemtip.js';
import { buildsFor, upsertBuild, deleteBuild, newId, walkBuild } from './mybuilds.js';
import { computeBuild } from './engine.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SLOT = { weapon: 'Weapon', vitality: 'Vitality', spirit: 'Spirit' };

let A = { heroes: [], heroById: new Map(), items: new Map() };
let hero = null;   // hero id
let build = null;  // { id, name, items }
let slot = 'all', query = '';

const face = (h) => (!h ? '<span class="face empty" aria-hidden="true"></span>'
  : h.img ? `<img class="face big" src="${esc(h.img)}" alt="">` : `<span class="face big" aria-hidden="true">${esc(h.name.slice(0, 2))}</span>`);

// ---------- choosing hero and build ----------
function openHero(id) {
  hero = id;
  store.set('me', id);
  const list = buildsFor(id);
  const last = store.get('useBuild', {})[id];
  build = list.find((b) => b.id === last) || list[0] || null;
  if (!build) build = { id: newId(), name: `${A.heroById.get(id)?.name || 'Hero'} build`, items: [] };
  remember();
  render();
}

function remember() { // Build page shows this one too
  const use = store.get('useBuild', {});
  if (buildsFor(hero).some((b) => b.id === build.id)) use[hero] = build.id;
  store.set('useBuild', use);
}

function save(msg = 'Saved.') {
  build = upsertBuild(hero, build);
  remember();
  $('b-status').textContent = msg;
  $('b-status').className = 'status good';
  renderSaved();
}

// ---------- editing ----------
function add(id) {
  const it = A.items.get(id);
  if (!it) return;
  if (build.items.includes(id)) { flash(`${it.name} is already in this build.`); return; }
  build.items.push(id);
  save(`Added ${it.name}.`);
  renderBuild(); renderShop();
}
function move(i, d) {
  const j = i + d;
  if (j < 0 || j >= build.items.length) return;
  [build.items[i], build.items[j]] = [build.items[j], build.items[i]];
  save(); renderBuild();
}
function remove(i) {
  const [id] = build.items.splice(i, 1);
  save(`Removed ${A.items.get(id)?.name || 'item'}.`);
  renderBuild(); renderShop();
}
function flash(text) { $('b-status').textContent = text; $('b-status').className = 'status bad'; }

async function fillSuggested() {
  const b = $('b-suggest');
  b.disabled = true; b.textContent = 'Loading…';
  try {
    const since = Math.floor(Date.now() / 1000) - 30 * 86400;
    const mode = store.get('matchMode', 'Ranked,Unranked');
    const stats = await cached(`is.${hero}|${mode}|all`, 6, () =>
      getJSON(`${API}/v1/analytics/item-stats?hero_id=${hero}&game_mode=normal&match_mode=${encodeURIComponent(mode)}&min_unix_timestamp=${since}`));
    const plan = computeBuild({ stats, items: A.items, threats: {}, style: store.get('style', 'stats') });
    if (!plan.path.length) { flash('No recent games for this hero to build from.'); return; }
    build.items = plan.path.map((s) => s.item.id).filter((id, i, arr) => arr.indexOf(id) === i);
    save('Filled with the suggested build. Change anything you like.');
    renderBuild(); renderShop();
  } catch (e) {
    flash(`Couldn't load item stats (${e.message}). Try again in a minute.`);
  } finally { b.disabled = false; b.textContent = 'Fill with suggested build'; }
}

// ---------- render ----------
function renderSaved() {
  const list = buildsFor(hero);
  const isSaved = list.some((b) => b.id === build.id);
  $('b-saved').innerHTML = `<div class="chips">
    ${list.map((b) => `<button class="chip ${b.id === build.id ? 'on' : ''}" data-open="${esc(b.id)}" aria-pressed="${b.id === build.id}">${esc(b.name)}<small>${b.items.length}</small></button>`).join('')}
    ${!isSaved ? `<span class="chip on draft">${esc(build.name)}<small>new</small></span>` : ''}
    <button class="chip add" id="b-new" type="button">+ New build</button>
  </div>`;
}

function renderBuild() {
  const w = walkBuild(build.items, A.items);
  $('b-name').value = build.name;
  $('b-empty').hidden = build.items.length > 0;
  $('b-meta').textContent = `${w.slots} of 12 slots · ${w.total.toLocaleString()} souls`;
  $('b-meta').className = 'meta' + (w.slots > 12 ? ' over' : '');
  $('b-mix').innerHTML = build.items.length ? '<div class="mix-bar">' + ['weapon', 'vitality', 'spirit'].filter((k) => w.counts[k]).map((k) =>
    `<span class="mix-${k}" style="flex-grow:${w.counts[k]}" title="${SLOT[k]}: ${w.counts[k]}"></span>`).join('') + '</div>'
    + `<p class="mix-key">${['weapon', 'vitality', 'spirit'].map((k) => `<span class="k-${k}">${SLOT[k]} ${w.counts[k] || 0}</span>`).join('')}${w.slots > 12 ? '<span class="bad">Over 12 slots. Sell or remove something.</span>' : ''}</p>` : '';
  $('b-mix').hidden = !build.items.length;

  $('b-steps').innerHTML = w.steps.map((s, i) => {
    const it = s.item;
    const notes = [];
    if (s.into) notes.push(`<span class="up">upgrades into ${esc(s.into.name)}</span>`);
    if (s.upgradesFrom?.length) notes.push(`<span class="up">from ${esc(s.upgradesFrom.map((c) => c.name).join(' + '))}</span>`);
    return `<li class="step s-${esc(it.slot)}" data-item="${it.id}" tabindex="0">
      <span class="n">${i + 1}</span>
      ${it.img ? `<img src="${esc(it.img)}" alt="" loading="lazy">` : '<span class="noimg"></span>'}
      <span class="st-body"><span class="it-name">${esc(it.name)}</span>${notes.join('')}</span>
      <span class="st-num"><b>${s.pay.toLocaleString()}</b><small>${s.running.toLocaleString()} total</small></span>
      <span class="st-ctl">
        <button class="ic" data-up="${i}" aria-label="Move ${esc(it.name)} up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="ic" data-down="${i}" aria-label="Move ${esc(it.name)} down" ${i === w.steps.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="ic x" data-rm="${i}" aria-label="Remove ${esc(it.name)}">×</button>
      </span>
    </li>`;
  }).join('');
}

function renderShop() {
  const q = query.trim().toLowerCase();
  const list = [...A.items.values()]
    .filter((it) => it.tier && (slot === 'all' || it.slot === slot) && (!q || it.name.toLowerCase().includes(q)))
    .sort((a, b) => a.tier - b.tier || ['weapon', 'vitality', 'spirit'].indexOf(a.slot) - ['weapon', 'vitality', 'spirit'].indexOf(b.slot) || a.name.localeCompare(b.name));
  const inBuild = new Set(build.items);
  const tiers = [1, 2, 3, 4].map((t) => {
    const xs = list.filter((it) => it.tier === t);
    if (!xs.length) return '';
    return `<div class="shop-tier"><h3>Tier ${t}<small>${xs[0].cost.toLocaleString()} souls</small></h3>
      <div class="shop-grid">${xs.map((it) => `<div class="shop-item s-${esc(it.slot)} ${inBuild.has(it.id) ? 'have' : ''}">
        <button class="si-add" data-add="${it.id}" data-item="${it.id}" aria-label="Add ${esc(it.name)}">
          ${it.img ? `<img src="${esc(it.img)}" alt="" loading="lazy">` : '<span class="noimg"></span>'}
          <span>${esc(it.name)}</span>
        </button>
        <button class="si-info" data-item="${it.id}" aria-label="Details for ${esc(it.name)}">i</button>
      </div>`).join('')}</div></div>`;
  }).join('');
  $('shop-list').innerHTML = tiers || '<p class="empty-note">No items match.</p>';
}

function render() {
  const h = A.heroById.get(hero);
  $('b-face').innerHTML = face(h);
  $('b-hero').value = String(hero);
  renderSaved(); renderBuild(); renderShop();
  $('b-status').textContent = buildsFor(hero).some((b) => b.id === build.id) ? 'Saves automatically on this device.' : 'New build. It saves when you add the first item.';
  $('b-status').className = 'status';
}

// ---------- wiring ----------
function wire() {
  $('b-hero').addEventListener('change', (e) => openHero(Number(e.target.value)));
  $('b-saved').addEventListener('click', (e) => {
    const o = e.target.closest('[data-open]');
    if (o) { build = buildsFor(hero).find((b) => b.id === o.dataset.open); remember(); render(); return; }
    if (e.target.closest('#b-new')) {
      const n = buildsFor(hero).length + 1;
      build = { id: newId(), name: `${A.heroById.get(hero)?.name || 'Hero'} build ${n}`, items: [] };
      render();
    }
  });
  $('b-name').addEventListener('change', (e) => {
    build.name = e.target.value.trim() || 'Untitled build';
    save('Renamed.');
  });
  $('b-steps').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.up) move(Number(b.dataset.up), -1);
    else if (b.dataset.down) move(Number(b.dataset.down), 1);
    else if (b.dataset.rm) remove(Number(b.dataset.rm));
  });
  $('shop-list').addEventListener('click', (e) => { const b = e.target.closest('[data-add]'); if (b) add(Number(b.dataset.add)); });
  $('f-slot').addEventListener('click', (e) => {
    const b = e.target.closest('[data-slot]'); if (!b) return;
    slot = b.dataset.slot;
    $('f-slot').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    renderShop();
  });
  $('f-search').addEventListener('input', (e) => { query = e.target.value; renderShop(); });
  $('b-suggest').addEventListener('click', fillSuggested);
  $('b-clear').addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (!build.items.length) return;
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Tap again to clear'; setTimeout(() => { b.dataset.confirm = ''; b.textContent = 'Clear items'; }, 3000); return; }
    b.dataset.confirm = ''; b.textContent = 'Clear items';
    build.items = []; save('Cleared.'); renderBuild(); renderShop();
  });
  $('b-dupe').addEventListener('click', () => {
    build = { id: newId(), name: `${build.name} (copy)`.slice(0, 40), items: [...build.items] };
    save('Copied. You are now editing the copy.'); render();
  });
  $('b-delete').addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (!buildsFor(hero).some((x) => x.id === build.id)) { openHero(hero); return; }
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Tap again to delete'; setTimeout(() => { b.dataset.confirm = ''; b.textContent = 'Delete build'; }, 3000); return; }
    b.dataset.confirm = ''; b.textContent = 'Delete build';
    deleteBuild(hero, build.id);
    openHero(hero);
    $('b-status').textContent = 'Deleted.';
  });
}

async function boot() {
  wire();
  $('shop-list').innerHTML = '<p class="empty-note">Loading items…</p>';
  try { A = await loadAssets(); } catch (e) {
    $('shop-list').innerHTML = `<p class="warn">Couldn't load heroes and items (${esc(e.message)}). Check your connection and reload.</p>`;
    return;
  }
  $('b-hero').innerHTML = A.heroes.map((h) => `<option value="${h.id}">${esc(h.name)}</option>`).join('');
  initItemTips({ getItem: (id) => A.items.get(id), tapSelector: '.si-info, .step' });
  const saved = store.get('me', null);
  openHero(A.heroById.has(saved) ? saved : A.heroes[0]?.id);
}
boot();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
