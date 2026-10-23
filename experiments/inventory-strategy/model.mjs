import { createHash } from 'node:crypto';

// Freeze before running evaluation. Units: cents, contracts, USD as named.
export const CONFIG = Object.freeze({
  version: 1, steps: 60, quoteSize: 3, maxAbsInventory: 30,
  baseBid: 45, maxSkew: 15, candidates: [0.25, 0.5, 1],
  developmentSeeds: 6, evaluationSeeds: 16,
  inventoryPenaltyUsd: 0.02, bootstrapReplicates: 2000,
  regimes: ['balanced', 'directional', 'informed-shift'],
});
export function rng(seed) {
  let x = seed >>> 0;
  return () => {
    x += 0x6D2B79F5;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function makePath(regime, seed, steps = CONFIG.steps) {
  if (!CONFIG.regimes.includes(regime)) throw Error('Unknown regime');
  const random = rng(seed), terminalRandom = rng(seed ^ 0x5A17C9E3);
  const direction = random() < 0.5 ? -1 : 1;
  const flow = [];
  for (let t = 0; t < steps; t++) {
    const shifted = regime === 'informed-shift' && t >= Math.floor(steps / 2);
    const probabilityCents = shifted ? 50 + direction * 15 : 50;
    const yesChance = regime === 'directional' || shifted ? (direction > 0 ? 0.8 : 0.2) : 0.5;
    const outcome = random() < yesChance ? 'yes' : 'no';
    const reference = outcome === 'yes' ? probabilityCents : 100 - probabilityCents;
    const limit = clamp(reference + Math.floor(random() * 21) - 8, 1, 99);
    const quantity = 1 + Math.floor(random() * 5);
    flow.push({ t, outcome, limit, quantity, probabilityCents });
  }
  const finalProbabilityCents = flow.at(-1).probabilityCents;
  const terminalYes = terminalRandom() < finalProbabilityCents / 100 ? 1 : 0;
  const data = { regime, seed, direction, flow, finalProbabilityCents, terminalYes };
  return { ...data, pathHash: hash(data) };
}

// Only current holdings enter the policy. No path, next order, reference value,
// terminal probability or outcome is provided to the quoting function.
export function quotes(yesQuantity, noQuantity, skewPerContract) {
  const inventory = yesQuantity - noQuantity;
  const skew = clamp(Math.sign(inventory) * Math.round(Math.abs(inventory) * skewPerContract), -CONFIG.maxSkew, CONFIG.maxSkew);
  return [
    { outcome: 'yes', price: CONFIG.baseBid - skew, quantity: Math.max(0, Math.min(CONFIG.quoteSize, CONFIG.maxAbsInventory - inventory)) },
    { outcome: 'no', price: CONFIG.baseBid + skew, quantity: Math.max(0, Math.min(CONFIG.quoteSize, CONFIG.maxAbsInventory + inventory)) },
  ];
}

export function valuation(yes, no, principalUnits, feeUnits, probabilityCents, terminalYes) {
  const cost = (principalUnits + feeUnits) / 40000;
  return {
    referencePnlUsd: (yes * probabilityCents + no * (100 - probabilityCents)) / 100 - cost,
    terminalPnlUsd: yes * terminalYes + no * (1 - terminalYes) - cost,
    pnlIfYesUsd: yes - cost,
    pnlIfNoUsd: no - cost,
    worstOutcomePnlUsd: Math.min(yes, no) - cost,
  };
}

export function selectCandidate(rows) {
  if (!rows.length || rows.some(r => r.split !== 'development')) throw Error('Selection accepts development rows only');
  const ranking = CONFIG.candidates.map(k => {
    const r = rows.filter(x => x.skewPerContract === k);
    if (!r.length) throw Error('Missing candidate');
    return { skewPerContract: k, episodes: r.length,
      score: mean(r.map(x => x.referencePnlUsd - CONFIG.inventoryPenaltyUsd * x.meanAbsInventory)),
      referencePnlUsd: mean(r.map(x => x.referencePnlUsd)), meanAbsInventory: mean(r.map(x => x.meanAbsInventory)) };
  }).sort((a, b) => b.score - a.score || a.skewPerContract - b.skewPerContract);
  return { selected: ranking[0].skewPerContract, ranking };
}

export function pairedInterval(differences, seed = 90123) {
  if (!differences.length) throw Error('No pairs');
  const random = rng(seed), samples = [];
  for (let i = 0; i < CONFIG.bootstrapReplicates; i++) {
    let sum = 0;
    for (let j = 0; j < differences.length; j++) sum += differences[Math.floor(random() * differences.length)];
    samples.push(sum / differences.length);
  }
  samples.sort((a, b) => a - b);
  return { mean: mean(differences), low: samples[Math.floor(samples.length * 0.025)], high: samples[Math.floor(samples.length * 0.975)] };
}
