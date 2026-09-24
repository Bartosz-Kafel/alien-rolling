"use strict";

/* CRITIQUE AGENT — temporary (pending) Luck system.
 *
 * Design goals under review:
 *  G1 Inert at small scale: sacrificing a handful of aliens must not help.
 *  G2 Meaningful at scale: sacrificing ~1,000 commons guarantees better than
 *     1/700 on the roll's best die ("a good alien", not necessarily the best).
 *  G3 Endgame protection: no sacrifice budget may reach Paradox-class rarity;
 *     extreme spending must stay far below endgame odds.
 *  G4 Pacing: an AFK minute of auto-roll without sacrificing must behave
 *     exactly like the base game (no floor, no distribution shift).
 *  G5 Guarantee integrity: when the system promises a floor, the promise must
 *     effectively always hold for the roll's best die.
 *
 * Method: real catalog + real pickAlien from server.js (unmodified), the roll
 * rule replicated from the /api/roll handler (documented duplication), 40k
 * trials per scenario, seeded RNG for reproducibility.
 */

const server = require("../server.js");
const balance = require("../balance.js");
const { ALIENS, pickAlien } = server;

// Seeded RNG so scores are reproducible run-to-run.
let seed = 0x2f6e2b1;
function random() {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return ((seed >>> 0) % 1e6) / 1e6;
}

// Roll rule replicated from the /api/roll handler.
function rollDie(luck, floor) {
  let alien = pickAlien(luck);
  if (alien.baseChanceLog < floor) {
    alien = pickAlien(luck);
    if (alien.baseChanceLog < floor) {
      // Band-uniform fallback replicated from the production rule.
      const band = ALIENS.filter((a) => a.baseChanceLog >= floor && a.baseChanceLog < floor + 1);
      const candidates = band.length ? band : ALIENS.filter((a) => a.baseChanceLog >= floor);
      alien = candidates[random() * candidates.length | 0] || ALIENS[ALIENS.length - 1];
    }
  }
  return alien;
}

function bestOf(diceCount, luck, floor, pinnedIds, countFloored) {
  let best = -Infinity;
  let bestAlien = null;
  for (let die = 0; die < diceCount; die += 1) {
    const alien = rollDie(luck, floor);
    if (alien.baseChanceLog > best) { best = alien.baseChanceLog; bestAlien = alien; }
  }
  // Track which alien "delivered" the floor when the guarantee did work.
  if (floor > 0 && bestAlien && bestAlien.baseChanceLog < floor + 1.05) {
    pinnedIds.set(bestAlien.id, (pinnedIds.get(bestAlien.id) || 0) + 1);
    countFloored();
  }
  return best;
}

function trial(scenario, trials = 40_000) {
  seed = 0x2f6e2b1; // re-seed per scenario so A vs F is a deterministic comparison
  const counts = { kept: 0, violated: 0 };
  let sumLog = 0;
  let aboveTen = 0; // rolls whose best die beat 1/10,000,000,000
  const pinnedIds = new Map(); // variety among floored outcomes
  let flooredRolls = 0;
  for (let i = 0; i < trials; i += 1) {
    const best = bestOf(scenario.dice, scenario.luck, scenario.floor, pinnedIds, () => flooredRolls += 1);
    sumLog += best;
    if (best >= scenario.floor - 1e-9) counts.kept += 1; else counts.violated += 1;
    if (best >= 10) aboveTen += 1;
  }
  const distinct = pinnedIds.size;
  const topPinShare = flooredRolls ? Math.max(...pinnedIds.values()) / flooredRolls : 0;
  return {
    ...scenario,
    keepRate: counts.kept / trials,
    violated: counts.violated,
    meanBestLog: sumLog / trials,
    beatOneIn10B: aboveTen / trials,
    distinctPins: distinct,
    topPinShare,
    flooredRolls
  };
}

const findings = [];
const add = (severity, text) => findings.push({ severity, text });

console.log("== CATALOG SANITY ==");
const logs = ALIENS.map((a) => a.baseChanceLog);
console.log(`entries=${ALIENS.length} minLog=${Math.min(...logs)} maxLog=${Math.max(...logs)}`);
const isSorted = logs.every((log, i) => i === 0 || log >= logs[i - 1]);
console.log(`ordered common→rare: ${isSorted}`);

console.log("\n== FLOOR CURVE (balance.pendingLuckFloor) ==");
const curve = [0, 250, 2_500, 25_000, 250_000, 2_500_000, 2.5e9, 2.5e12];
for (const pending of curve) {
  const floor = balance.pendingLuckFloor(pending);
  const odds = floor > 0 ? `1 / ${Math.round(10 ** Math.min(floor, 15)).toLocaleString()}` : "none";
  console.log(`pending ${pending.toLocaleString().padStart(10)}  →  floor log ${floor.toFixed(2).padStart(6)}  (${odds})`);
}

console.log("\n== MONTE CARLO (40k trials each) ==");
const scenarios = [
  { name: "A baseline, no pending (G4)", pending: 0, dice: 3, luck: 1 },
  { name: "B one common sacrificed (G1)", pending: 250, dice: 3, luck: 1 },
  { name: "C 1,000 commons (G2)", pending: 250_000, dice: 1, luck: 1 },
  { name: "C2 1,000 commons, 3 dice (G2)", pending: 250_000, dice: 3, luck: 1 },
  { name: "D 10,000 commons (G2)", pending: 2_500_000, dice: 3, luck: 1 },
  { name: "E extreme 10M commons (G3)", pending: 2.5e12, dice: 3, luck: 1 },
  { name: "F autoroll minute, no sacrifice (G4)", pending: 0, dice: 3, luck: 1 }
];
const results = scenarios.map((s) => {
  const floor = balance.pendingLuckFloor(s.pending);
  const r = trial({ ...s, floor }, s.name.startsWith("F") ? 20_000 : 40_000);
  console.log(`${r.name.padEnd(38)} floor=${r.floor.toFixed(2).padStart(5)}  keep=${(r.keepRate * 100).toFixed(2).padStart(6)}%  meanBestLog=${r.meanBestLog.toFixed(2)}  P(>1e10)=${(r.beatOneIn10B * 100).toFixed(3)}%  pins: ${r.distinctPins} distinct / top ${(r.topPinShare * 100).toFixed(1)}%`);
  return r;
});

console.log("\n== SCORECARD ==");
let score = 10;
const A = results[0], B = results[1], C = results[2], C2 = results[3], D = results[4], E = results[5], F = results[6];

if (B.floor > 0.01) { score -= 2; add("major", "G1 violated: one common already produces a floor."); }
else console.log("+ G1 ok: a single common sacrifice yields no guarantee.");

const target = Math.log10(7000);
if (C.meanBestLog < target) { score -= 2; add("major", `G2 weak: 1,000 commons average best-die log ${C.meanBestLog.toFixed(2)} < log10(7000)=${target.toFixed(2)}.`); }
else console.log("+ G2 ok: 1,000 commons average better than 1/7,000 (10x the old 1/700 bar).");

if (C2.keepRate < 0.999) { score -= 2.5; add("critical", `G5 violated: with the promise active, ${(100 - C2.keepRate * 100).toFixed(1)}% of 3-dice rolls landed BELOW the promised floor (single-die: ${(100 - C.keepRate * 100).toFixed(1)}%). A guarantee this leaky is not a guarantee.`); }
else console.log("+ G5 ok: the floor held on every roll.");

if (E.meanBestLog >= 31) { score -= 2; add("major", "G3 violated: extreme spending reaches Celestial-class rarity."); }
else console.log("+ G3 ok: extreme spending stays below endgame rarities (cap holds).");

if (Math.abs(F.meanBestLog - A.meanBestLog) > 0.01 || F.beatOneIn10B !== A.beatOneIn10B) { score -= 1.5; add("major", "G4 violated: a no-sacrifice minute shifted the distribution."); }
else console.log("+ G4 ok: no-sacrifice play is statistically identical to baseline.");

// Variety: a guarantee that always lands the identical alien is degenerate.
for (const r of [C, D, E]) {
  if (r.flooredRolls > 1000 && (r.distinctPins < 3 || r.topPinShare > 0.9)) {
    score -= 1.5;
    add("major", `G6 (variety) violated in "${r.name}": ${r.distinctPins} distinct delivering aliens, top one ${(r.topPinShare * 100).toFixed(1)}% of floored rolls — the guarantee collapses into the same alien every time.`);
  } else if (r.flooredRolls > 1000) {
    console.log(`+ G6 ok in "${r.name}": ${r.distinctPins} distinct delivering aliens, top share ${(r.topPinShare * 100).toFixed(1)}%.`);
  }
}

console.log(`\nSCORE: ${Math.max(0, Math.round(score * 10) / 10)}/10`);
console.log("\nFINDINGS:");
for (const f of findings) console.log(`  [${f.severity.toUpperCase()}] ${f.text}`);
console.log("\nRECOMMENDATIONS:");
if (findings.some((f) => f.text.includes("collapses"))) {
  console.log("  1. When the guarantee must fire, pick uniformly among the aliens within one decade above the floor instead of always the mildest one — same promise, real variety.");
}
if (findings.length === 0) console.log("  None. Ship it.");
