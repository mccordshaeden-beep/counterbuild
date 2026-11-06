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
export function computeBuild({ stats, items, threats, style = 'stats' }) {
  const rows = [];
  for (const s of stats || []) {
    const it = items.get(Number(s.item_id));
    if (!it || !it.tier) continue;
    const wins = Number(s.wins) || 0;
    const matches = Number(s.matches ?? (wins + (Number(s.losses) || 0))) || 0;
    if (matches <= 0) continue;
    const buy = Number(s.avg_buy_time_s ?? s.avg_buy_time);
    rows.push({ item: it, wins, matches, buy: Number.isFinite(buy) && buy > 0 ? buy : null });
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
      item: r.item, wr: r.wins / r.matches, matches: r.matches, buyRate, buy: r.buy,
      base: delta + popularity + (style === 'balanced' && r.item.slot === 'vitality' ? 1.5 : 0), bonus: 0, reasons: [],
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
        s = { item: it, wr: null, matches: 0, buyRate: 0, buy: null, base: -0.5, bonus: 0, reasons: [] };
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

  const plan = planBuild(all, threats, items, style === 'balanced' ? { minVitality: 4, minDamage: 6, lean: heroLean } : {});
  return { stages, situational, heroLean, cost: plan.total, sample: heroTotal, hasStats: rows.length > 0, ...plan };
}

// ---------- a full build: final 12 slots plus the order to buy things in ----------
const FINAL = { 4: 3, 3: 5, 2: 3, 1: 1 }; // what a finished 12-slot inventory usually looks like
const MIN_VITALITY = 2;

export function planBuild(all, threats, items, opts = {}) {
  const minVitality = opts.minVitality ?? MIN_VITALITY;
  const usable = all.filter((s) => s.matches > 0 || s.bonus > 0);
  const byScore = (a, b) => b.score - a.score;
  let final = [];
  for (const t of [4, 3, 2, 1]) final.push(...usable.filter((s) => s.item.tier === t).sort(byScore).slice(0, FINAL[t]));
  const inFinal = (s) => final.some((f) => f.item.id === s.item.id);
  const swap = (out, inn) => { final = final.map((f) => (f === out ? inn : f)); };
  const weakest = (tier, keep) => final.filter((f) => f.item.tier === tier && !keep(f)).sort((a, b) => a.score - b.score)[0];

  // 1. The biggest threats (2+ enemies) always get an answer in the final build.
  const bigThreats = Object.entries(threats).filter(([, v]) => v.count >= 2).sort((a, b) => b[1].count - a[1].count);
  for (const [tag] of bigThreats) {
    const answers = usable.filter((s) => s.reasons.some((r) => r.tag === tag)).sort(byScore);
    if (!answers.length || answers.some(inFinal)) continue;
    const best = answers[0];
    const out = weakest(best.item.tier, (f) => f.reasons.length > 0);
    if (out) swap(out, best);
  }

  // 2. Some survivability so you aren't one-shot.
  for (let guard = 0; guard < 6 && final.filter((f) => f.item.slot === 'vitality').length < minVitality; guard++) {
    const best = usable.filter((s) => s.item.slot === 'vitality' && !inFinal(s) && s.item.tier >= 2).sort(byScore)[0];
    if (!best) break;
    const out = weakest(best.item.tier, (f) => f.item.slot === 'vitality' || f.reasons.length > 0);
    if (!out) break;
    swap(out, best);
  }

  // 2b. Tank + damage style: keep enough damage items of the hero's type (gun or spirit).
  if (opts.minDamage && opts.lean) {
    for (let guard = 0; guard < 6 && final.filter((f) => f.item.slot === opts.lean).length < opts.minDamage; guard++) {
      const best = usable.filter((s) => s.item.slot === opts.lean && !inFinal(s) && s.item.tier >= 2).sort(byScore)[0];
      if (!best) break;
      const out = weakest(best.item.tier, (f) => f.item.slot === opts.lean || f.item.slot === 'vitality' || f.reasons.length > 0);
      if (!out) break;
      swap(out, best);
    }
  }

  // 3. Upgrades: a cheaper part bought early turns into the bigger item and doesn't use a second slot.
  const builtFrom = new Map(); // component id -> item it upgrades into
  for (const f of final) for (const cid of f.item.components || []) if (items.get(cid)) builtFrom.set(cid, f);
  const removed = final.filter((f) => builtFrom.has(f.item.id));
  final = final.filter((f) => !builtFrom.has(f.item.id));
  for (const r of removed) { // refill the freed slot from the same tier
    const next = usable.filter((s) => s.item.tier === r.item.tier && !inFinal(s) && !builtFrom.has(s.item.id)).sort(byScore)[0];
    if (next) final.push(next);
  }

  // 4. Order: when players really buy each item, components first.
  const scoreOf = new Map(all.map((s) => [s.item.id, s]));
  const steps = [];
  for (const f of final) {
    for (const cid of f.item.components || []) {
      if (!builtFrom.has(cid) || builtFrom.get(cid).item.id !== f.item.id) continue;
      const c = scoreOf.get(cid) || { item: items.get(cid), buy: null, reasons: [], wr: null, matches: 0 };
      steps.push({ ...c, into: f.item });
    }
    steps.push({ ...f, upgradesFrom: (f.item.components || []).filter((cid) => builtFrom.get(cid)?.item.id === f.item.id).map((cid) => items.get(cid)) });
  }
  const known = steps.filter((s) => s.buy).length >= steps.length / 2;
  const tierTime = {};
  for (const t of [1, 2, 3, 4]) {
    const xs = steps.filter((s) => s.item.tier === t && s.buy).map((s) => s.buy);
    tierTime[t] = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : [0, 240, 720, 1260, 1800][t];
  }
  for (const s of steps) s.at = known ? (s.buy ?? tierTime[s.item.tier]) : null;
  for (const s of steps) if (s.into) { // a part has to come before its upgrade
    const up = steps.find((x) => x.item.id === s.into.id && !x.into);
    if (up && s.at != null && up.at != null && s.at >= up.at) s.at = up.at - 60;
  }
  const key = (s) => (known ? s.at : s.item.tier * 100000 + (s.item.cost || 0)) + (s.into ? -0.5 : 0);
  steps.sort((a, b) => key(a) - key(b));

  // 5. Running soul total. An upgrade only costs the difference once you own its parts.
  let total = 0;
  for (const s of steps) {
    const owned = (s.upgradesFrom || []).reduce((a, c) => a + (c?.cost || 0), 0);
    s.pay = Math.max(0, (s.item.cost || 0) - owned);
    total += s.pay;
    s.running = total;
  }
  return { path: steps, final, total };
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
