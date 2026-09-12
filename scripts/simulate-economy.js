"use strict";

/* Deterministic balance report. It evaluates the catalog distribution rather
 * than a lucky finite sample. Run after changing balance.js or the generator. */
const { ALIENS } = require("../aliens");
const balance = require("../balance");

function distribution(luck) {
  const exponent = balance.luckExponent(luck);
  const weights = ALIENS.map((alien) => 10 ** (-alien.baseChanceLog * exponent));
  const total = weights.reduce((sum, value) => sum + value, 0);
  const expectedLog = weights.reduce((sum, value, index) => sum + value / total * ALIENS[index].baseChanceLog, 0);
  const expectedIncome = weights.reduce((sum, value, index) => sum + value / total * ALIENS[index].baseIncome, 0);
  const thresholds = [6, 10, 17, 30, 42].map((log) => weights.reduce((sum, value, index) => sum + (ALIENS[index].baseChanceLog >= log ? value : 0), 0) / total);
  return { exponent, expectedLog, expectedIncome, thresholds };
}
const stages = [
  { stage: "Early", luckLevel: 0, coinLevel: 0, speedLevel: 0, dice: 1 },
  { stage: "Mid", luckLevel: 15, coinLevel: 12, speedLevel: 8, dice: 2 },
  { stage: "High Luck", luckLevel: 75, coinLevel: 50, speedLevel: 24, dice: 4 },
  { stage: "High Dice", luckLevel: 110, coinLevel: 82, speedLevel: 36, dice: 6 },
  { stage: "Extreme", luckLevel: 210, coinLevel: 165, speedLevel: 60, dice: 9 }
];

console.table(stages.map((entry) => {
  const luck = balance.luckMultiplier(entry.luckLevel);
  const roll = distribution(luck);
  const sample = ALIENS[Math.min(ALIENS.length - 1, Math.round((ALIENS.length - 1) * Math.min(.999, roll.expectedLog / 48)))];
  return {
    stage: entry.stage, luck: `x${luck}`, dice: entry.dice, "roll presentation": `${balance.rollAnimationDuration(entry.speedLevel)}ms`, "coin multiplier": `x${balance.coinMultiplier(entry.coinLevel)}`,
    "expected chance log": roll.expectedLog.toFixed(2), "≈ expected signal": `1 / 10^${roll.expectedLog.toFixed(1)}`,
    "1/1M+": `${(roll.thresholds[0] * 100).toFixed(2)}%`, "1/10B+": `${(roll.thresholds[1] * 100).toFixed(3)}%`, "1/10Qa+": `${(roll.thresholds[2] * 100).toFixed(4)}%`,
    "expected alien value": roll.expectedIncome.toFixed(3), "3-slot coins/sec": (roll.expectedIncome * 3 * balance.coinMultiplier(entry.coinLevel)).toFixed(3),
    "next die cost": Number.isFinite(balance.diceCost(entry.dice)) ? balance.diceCost(entry.dice).toLocaleString() : "MAX", "sample income": balance.incomeFor(sample, 0, entry.coinLevel).toLocaleString()
  };
}));

console.table([1, 2, 3, 4, 5, 6].map((dice) => ({ dice, nextDieCost: balance.diceCost(dice).toLocaleString(), ratioToPrevious: dice === 1 ? "—" : (balance.diceCost(dice) / balance.diceCost(dice - 1)).toFixed(1) + "×" })));
console.table([0, 1, 2, 3].map((plusLevel) => ({ plus: "+".repeat(plusLevel) || "Base", "common sacrifice": balance.sacrificeLuck(ALIENS[0], plusLevel).toFixed(2), "paradox sacrifice": balance.sacrificeLuck(ALIENS.at(-1), plusLevel).toFixed(2) })));
