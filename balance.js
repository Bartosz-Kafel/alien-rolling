"use strict";

/**
 * Authoritative tuning for AFK Alien Dice.  Browser code receives calculated
 * values from this module; it never duplicates prices, rates or probabilities.
 *
 * Luck is a multiplier, not a literal probability multiplier. A roll applies
 * `weight ^ rarityExponent`, where rarityExponent is
 * max(0.025, luck ^ -0.55). This increasingly favours scarce signals, but
 * rapidly diminishing exponent changes and a hard floor keep Paradox signals
 * exceptional. Base chances remain immutable catalog data.
 */
const MAX_DICE = 12;
const AUTO_ROLL_INCOME_MULTIPLIER = 0.8;
const BASE_ROLL_ANIMATION_MS = 1950;

const RARITIES = Object.freeze([
  { maxLog: 4.35, name: "Common", color: "hsl(205 16% 72%)" },
  { maxLog: 5.25, name: "Uncommon", color: "hsl(145 62% 56%)" },
  { maxLog: 6.4, name: "Rare", color: "hsl(210 84% 64%)" },
  { maxLog: 8.0, name: "Epic", color: "hsl(271 82% 70%)" },
  { maxLog: 10.2, name: "Legendary", color: "hsl(36 92% 65%)" },
  { maxLog: 13.2, name: "Mythical", color: "hsl(324 86% 68%)" },
  { maxLog: 17.3, name: "Celestial", color: "hsl(4 88% 68%)" },
  { maxLog: 23.0, name: "Cosmic", color: "hsl(185 91% 70%)" },
  { maxLog: 31.0, name: "Transcendent", color: "hsl(287 86% 78%)" },
  { maxLog: Infinity, name: "Paradox", color: "hsl(51 100% 78%)" }
]);

const UPGRADE_DEFINITIONS = Object.freeze({
  luck: { id: "luck", label: "Luck Lattice", icon: "🍀", description: "Permanently bends future rolls toward scarce signals.", baseCost: 180, growth: 1.165 },
  speed: { id: "speed", label: "Roll Drive", icon: "⚡", description: "Shortens roll recovery with a safe diminishing cap.", baseCost: 240, growth: 1.195 },
  coin: { id: "coin", label: "Coin Reactor", icon: "✹", description: "Amplifies income from your equipped alien team.", baseCost: 220, growth: 1.18 }
});

function roundGame(value) {
  const safe = Math.max(0, Number(value) || 0);
  if (safe < 1e9) return Math.round(safe * 10_000) / 10_000;
  return Number(safe.toPrecision(12));
}

function upgradeCost(key, level) {
  const definition = UPGRADE_DEFINITIONS[key];
  if (!definition || !Number.isSafeInteger(level) || level < 0) return Infinity;
  return roundGame(definition.baseCost * (definition.growth ** level) * ((level + 2) ** 0.42));
}

function luckMultiplier(level) {
  // A super-linear early curve makes upgrades tactile; the probability
  // transform below prevents this display number from becoming runaway power.
  return roundGame(1 + 0.28 * (((Math.max(0, level) + 1) ** 0.93) - 1));
}

function coinMultiplier(level) {
  return roundGame(1 + 0.18 * (((Math.max(0, level) + 1) ** 0.78) - 1));
}

function speedReduction(level) {
  return 0.56 * (1 - Math.exp(-Math.max(0, level) / 12));
}

function rollAnimationDuration(speedLevel) {
  return Math.max(650, Math.round(BASE_ROLL_ANIMATION_MS * (1 - speedReduction(speedLevel))));
}

function diceCost(currentDice) {
  if (!Number.isSafeInteger(currentDice) || currentDice < 1 || currentDice >= MAX_DICE) return Infinity;
  // Each die is intentionally a major economy sink. It rises much faster than
  // the three research tracks and is assessed by the simulation script.
  return roundGame(6_000 * (18 ** (currentDice - 1)) * (currentDice ** 1.18));
}

function luckExponent(luck) {
  return Math.max(0.025, Math.max(1, Number(luck) || 1) ** -0.55);
}

function rarityForLog(baseChanceLog) {
  return RARITIES.find((rarity) => baseChanceLog < rarity.maxLog) || RARITIES.at(-1);
}

function sacrificeLuck(alien, plusLevel = 0) {
  const log = Math.max(1, Number(alien?.baseChanceLog) || 1);
  const shinyMultiplier = 1 + Math.max(0, Math.min(3, plusLevel)) * 0.8;
  return roundGame(Math.max(0.2, 0.032 * (log ** 3)) * shinyMultiplier);
}

function alienPower(alien, plusLevel = 0) {
  const rarityPower = Math.max(1, Number(alien?.baseChanceLog) || 1);
  return roundGame(rarityPower * (1 + Math.max(0, Math.min(3, plusLevel)) * 0.28));
}

function incomeFor(alien, plusLevel, coinLevel) {
  const base = Number(alien?.baseIncome) || 0;
  return roundGame(base * (1.72 ** Math.max(0, Math.min(3, plusLevel))) * coinMultiplier(coinLevel));
}

function upgradeSnapshot(key, level) {
  const definition = UPGRADE_DEFINITIONS[key];
  if (!definition) return null;
  const current = key === "luck" ? luckMultiplier(level) : key === "coin" ? coinMultiplier(level) : speedReduction(level);
  const next = key === "luck" ? luckMultiplier(level + 1) : key === "coin" ? coinMultiplier(level + 1) : speedReduction(level + 1);
  return { ...definition, level, cost: upgradeCost(key, level), current, next };
}

module.exports = Object.freeze({
  AUTO_ROLL_INCOME_MULTIPLIER, BASE_ROLL_ANIMATION_MS, MAX_DICE, RARITIES, UPGRADE_DEFINITIONS,
  alienPower, coinMultiplier, diceCost, incomeFor, luckExponent, luckMultiplier, rarityForLog,
  rollAnimationDuration, roundGame, sacrificeLuck, speedReduction, upgradeCost, upgradeSnapshot
});
