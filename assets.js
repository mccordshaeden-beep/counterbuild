// Heroes and shop items from the Deadlock data service, shared by every page.
export const API = 'https://api.deadlock-api.com';
const ASSETS = 'https://assets.deadlock-api.com';

export const store = {
  get(k, d) { try { const v = localStorage.getItem('cb.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('cb.' + k, JSON.stringify(v)); } catch {} },
};

export async function getJSON(url, ms = 20000) {
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
  for (const u of urls) { try { return await getJSON(u); } catch (e) { last = e; } }
  throw last;
}

export async function cached(key, hours, loader) {
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

export function itemInfo(i) {
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

// -> { heroes: [...sorted], heroById: Map, items: Map(id -> item) }
export async function loadAssets() {
  try { ['cb.c.items', 'cb.c.heroes'].forEach((k) => localStorage.removeItem(k)); } catch {} // old cache copies
  const [heroesRaw, itemsRaw] = await Promise.all([
    cached('heroes2', 6, () => firstOk([`${API}/v1/assets/heroes`, `${ASSETS}/v2/heroes`])),
    cached('items2', 12, () => firstOk([`${API}/v1/assets/items/by-type/upgrade`, `${ASSETS}/v2/items/by-type/upgrade`, `${API}/v1/assets/items`, `${ASSETS}/v2/items`])),
  ]);

  const heroes = (heroesRaw || [])
    // Only hide heroes the data says you can't pick. "In development" can still mean released.
    .filter((h) => h.player_selectable !== false && !h.disabled && h.name)
    .map((h) => ({
      id: h.id, name: h.name, type: h.hero_type,
      img: pickImg(h.images, ['icon_hero_card_webp', 'icon_hero_card', 'icon_image_small_webp', 'icon_image_small', 'minimap_image_webp', 'minimap_image']),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const items = new Map();
  for (const i of itemsRaw || []) {
    if (i.type && i.type !== 'upgrade') continue;
    if (i.shopable === false || i.disabled) continue;
    items.set(Number(i.id), {
      id: Number(i.id), name: i.name, tier: Number(i.item_tier) || 0,
      slot: i.item_slot_type, cost: Number(i.cost) || 0,
      img: pickImg(i, ['shop_image_small_webp', 'shop_image_small', 'shop_image_webp', 'shop_image', 'image_webp', 'image']),
      cls: i.class_name, rawComponents: i.component_items || i.components || [],
      info: itemInfo(i),
    });
  }
  // Upgrade parts arrive as class names or ids; turn them into item ids.
  const byClass = new Map([...items.values()].filter((it) => it.cls).map((it) => [it.cls, it.id]));
  for (const it of items.values()) {
    it.components = (Array.isArray(it.rawComponents) ? it.rawComponents : [])
      .map((c) => (typeof c === 'number' ? c : byClass.get(c) ?? (Number(c) || null)))
      .filter((id) => id && id !== it.id && items.has(id));
    delete it.rawComponents;
  }
  return { heroes, heroById: new Map(heroes.map((h) => [h.id, h])), items };
}
