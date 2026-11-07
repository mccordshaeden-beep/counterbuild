// Your own saved builds, kept on this device. Pure helpers plus storage.
import { store } from './assets.js';
import { COUNTERS, TAGS } from './rules.js';
import { norm } from './engine.js';

// { [heroId]: [{ id, name, items: [itemId...], updated }] }
export const loadBuilds = () => store.get('builds', {}) || {};
export const saveBuilds = (all) => store.set('builds', all);
export const buildsFor = (heroId) => loadBuilds()[heroId] || [];
export const newId = () => Math.random().toString(36).slice(2, 10);

export function upsertBuild(heroId, build) {
  const all = loadBuilds();
  const list = all[heroId] || [];
  const i = list.findIndex((b) => b.id === build.id);
  const next = { ...build, updated: Date.now() };
  if (i >= 0) list[i] = next; else list.push(next);
  all[heroId] = list;
  saveBuilds(all);
  return next;
}

export function deleteBuild(heroId, id) {
  const all = loadBuilds();
  all[heroId] = (all[heroId] || []).filter((b) => b.id !== id);
  if (!all[heroId].length) delete all[heroId];
  saveBuilds(all);
}

/**
 * Walks a build in buy order. A part bought earlier and later upgraded into a bigger item
 * frees its slot, and the upgrade only costs the difference.
 * -> { steps: [{ item, pay, running, into, upgradesFrom }], slots, total, counts }
 */
export function walkBuild(ids, items) {
  const list = ids.map((id) => items.get(id)).filter(Boolean);
  const owned = [];
  const steps = [];
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    const parts = (it.components || []).map((c) => owned.find((o) => o.id === c)).filter(Boolean);
    for (const p of parts) owned.splice(owned.indexOf(p), 1);
    const pay = Math.max(0, it.cost - parts.reduce((a, p) => a + p.cost, 0));
    total += pay;
    owned.push(it);
    const later = list.slice(i + 1).find((x) => (x.components || []).includes(it.id));
    steps.push({ item: it, pay, running: total, into: later || null, upgradesFrom: parts });
  }
  const counts = { weapon: 0, vitality: 0, spirit: 0 };
  for (const o of owned) counts[o.slot] = (counts[o.slot] || 0) + 1;
  return { steps, slots: owned.length, total, counts, final: owned };
}

// Threats from 2+ enemies with no answer in this build -> [{ tag, label, names, suggest: [names] }]
export function missingCounters(ids, threats, items) {
  const have = new Set(ids.map((id) => norm(items.get(id)?.name)));
  const byName = new Map([...items.values()].map((it) => [norm(it.name), it]));
  const out = [];
  for (const [tag, info] of Object.entries(threats)) {
    if (info.count < 2 || !COUNTERS[tag]) continue;
    const answers = COUNTERS[tag].items.filter((n) => byName.has(norm(n)));
    if (!answers.length || answers.some((n) => have.has(norm(n)))) continue;
    out.push({ tag, label: TAGS[tag]?.label || tag, names: info.names, suggest: answers.slice(0, 3) });
  }
  return out;
}
