// Pure build logic: no DOM, no network. Easy to test with sample data.
import { HERO_TAGS, TYPE_TAGS, COUNTERS } from './rules.js';

export const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function defaultTags(hero) {
  if (!hero) return [];
  const byName = HERO_TAGS[String(hero.name || '').toLowerCase()];
  if (byName) return [...byName];
  const byType = TYPE_TAGS[String(hero.type || '').toLowerCase()];
  return byType ? [...byType] : [];
}

// enemies: [{ id, name, tags: [...] }] -> { heal: { count, names: [] }, ... }
export function threatProfile(enemies) {
  const out = {};
  for (const e of enemies) {
    for (const t of e.tags || []) {
      out[t] ??= { count: 0, names: [] };
      out[t].count += 1;
      out[t].names.push(e.name);
    }
  }
  return out;
}

const PER_TIER = { 1: 3, 2: 3, 3: 4, 4: 4 };
const PRIOR = 150; // matches of "average" evidence each item starts with

/**
 * stats: [{ item_id, wins, losses?, matches? }]
 * items: Map(id -> { id, name, tier, slot, cost, img })
 * threats: output of threatProfile
 */
export function computeBuild({ stats, items, threats }) {
  const rows = [];
  for (const s of stats || []) {
    const it = items.get(Number(s.item_id));
    if (!it || !it.tier) continue;
    const wins = Number(s.wins) || 0;
    const matches = Number(s.matches ?? (wins + (Number(s.losses) || 0))) || 0;
    if (matches <= 0) continue;
    rows.push({ item: it, wins, matches });
  }

  const heroTotal = Math.max(1, ...rows.map((r) => r.matches));
  const minMatches = Math.max(20, Math.round(heroTotal * 0.004));

  // Late items win more just because people who reach them are ahead, so each item
  // is judged against the average of its own tier.
  const tierAvg = {};
  for (const t of [1, 2, 3, 4]) {
    const tr = rows.filter((r) => r.item.tier === t);
    const w = tr.reduce((a, r) => a + r.wins, 0);
    const m = tr.reduce((a, r) => a + r.matches, 0);
    tierAvg[t] = m ? w / m : 0.5;
  }

  const scored = new Map();
  for (const r of rows) {
    if (r.matches < minMatches) continue;
    const avg = tierAvg[r.item.tier];
    const smoothed = (r.wins + PRIOR * avg) / (r.matches + PRIOR);
    const delta = (smoothed - avg) * 100; // win-rate points above tier average
    const buyRate = r.matches / heroTotal;
    const popularity = Math.log10(1 + buyRate * 100); // 0..~2, a small nudge toward proven items
    scored.set(r.item.id, {
      item: r.item, wr: r.wins / r.matches, matches: r.matches, buyRate,
      base: delta + popularity, bonus: 0, reasons: [],
    });
  }

  // Does this hero lean gun or spirit? Weighs counter picks toward items that fit.
  const top = [...scored.values()].sort((a, b) => b.base - a.base).slice(0, 14);
  const lean = { weapon: 0, spirit: 0, vitality: 0 };
  for (const s of top) lean[s.item.slot] = (lean[s.item.slot] || 0) + 1;
  const heroLean = lean.spirit > lean.weapon ? 'spirit' : 'weapon';

  // Counter items with no stats for this hero still get considered, at a neutral base.
  const byName = new Map([...items.values()].map((it) => [norm(it.name), it]));
  for (const [tag, info] of Object.entries(threats)) {
    const rule = COUNTERS[tag];
    if (!rule) continue;
    for (const name of rule.items) {
      const it = byName.get(norm(name));
      if (!it || !it.tier) continue;
      let s = scored.get(it.id);
      if (!s) {
        s = { item: it, wr: null, matches: 0, buyRate: 0, base: -0.5, bonus: 0, reasons: [] };
        scored.set(it.id, s);
      }
      let add = rule.weight * Math.min(info.count, 3);
      const offLean = (it.slot === 'weapon' && heroLean === 'spirit') || (it.slot === 'spirit' && heroLean === 'weapon');
      if (offLean && tag !== 'spirit' && tag !== 'gun') add *= 0.5;
      s.bonus += add;
      s.reasons.push({ tag, names: info.names });
    }
  }

  const all = [...scored.values()].map((s) => ({ ...s, score: s.base + s.bonus }));
  const stages = { early: [], core: [], late: [] };
  const picked = new Set();
  for (const t of [1, 2, 3, 4]) {
    const pool = all.filter((s) => s.item.tier === t).sort((a, b) => b.score - a.score);
    const chosen = pool.slice(0, PER_TIER[t]);
    chosen.forEach((c) => picked.add(c.item.id));
    const stage = t <= 2 ? 'early' : t === 3 ? 'core' : 'late';
    stages[stage].push(...chosen);
  }
  const situational = all
    .filter((s) => s.bonus > 0 && !picked.has(s.item.id))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const cost = [...stages.early, ...stages.core, ...stages.late].reduce((a, s) => a + (s.item.cost || 0), 0);
  return { stages, situational, heroLean, cost, sample: heroTotal, hasStats: rows.length > 0 };
}

// Steam profile number, profile link or account id -> 32-bit account id.
export function parseSteam(input) {
  const s = String(input || '').trim();
  const m = s.match(/(\d{5,20})/);
  if (!m) return null;
  const n = BigInt(m[1]);
  const base = 76561197960265728n;
  return Number(n > base ? n - base : n);
}

export function teamKey(t) {
  const d = String(t ?? '').match(/(\d)(?!.*\d)/);
  return d ? d[1] : String(t);
}
