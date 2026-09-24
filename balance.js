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
const BASE_ROLL_ANIMATION_MS = 2000;
const MIN_ROLL_ANIMATION_MS = 500;
const BASE_ROLL_COOLDOWN_MS = 720;
const MIN_ROLL_COOLDOWN_MS = 600;
const SACRIFICE_LUCK_EFFECT_MULTIPLIER = 1250;
/* Temporary (pending) Luck converts into a guaranteed rarity floor for the
 * next roll instead of merely nudging weights. Sacrificed mass raises the
 * floor logarithmically: log10(1 + pending) - 1.5, but the floor only exists
 * once it can actually bind (at or above the catalog's mildest rarity, log
 * 2.7). A single common alien produces no guarantee at all, roughly 100
 * commons guarantee ~1/790, and roughly 1,000 commons guarantee ~1/7,900.
 * The cap stays far below endgame rarities. */
const MAX_PENDING_RARITY_LOG = 20;
const PENDING_FLOOR_OFFSET = 1.5;
const MIN_BINDING_RARITY_LOG = 2.7;

function pendingLuckFloor(pendingLuck) {
  const safe = Math.max(0, Number(pendingLuck) || 0);
  if (safe <= 0) return 0;
  const floor = Math.min(MAX_PENDING_RARITY_LOG, roundGame(Math.log10(1 + safe) - PENDING_FLOOR_OFFSET));
  // A floor below the catalog's mildest entry can never change a roll, so it
  // is not a guarantee and must not be displayed as one.
  return floor >= MIN_BINDING_RARITY_LOG ? floor : 0;
}

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
  luck: { id: "luck", label: "Luck Lattice", icon: "🍀", description: "Permanently bends future rolls toward scarce signals.", baseCost: 50, growth: 1.15 },
  speed: { id: "speed", label: "Roll Drive", icon: "⚡", description: "Shortens roll recovery with a safe diminishing cap.", baseCost: 100, growth: 1.2 },
  coin: { id: "coin", label: "Coin Reactor", icon: "✹", description: "Amplifies income from your equipped alien team.", baseCost: 50, growth: 1.3 }
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
  return roundGame(1.2 ** Math.max(0, level));
}

function coinMultiplier(level) {
  return roundGame(1.18 ** Math.max(0, level));
}

function speedReduction(level) {
  return 0.56 * (1 - Math.exp(-Math.max(0, level) / 12));
}

/* Roll Drive: the reveal runs 2.0s at level 0 and decays exponentially
 * toward the 0.5s floor, effectively reaching it around level 100. */
function rollAnimationDuration(speedLevel) {
  const eased = Math.exp(-Math.max(0, speedLevel) / 20);
  return Math.max(MIN_ROLL_ANIMATION_MS, Math.round(MIN_ROLL_ANIMATION_MS + (BASE_ROLL_ANIMATION_MS - MIN_ROLL_ANIMATION_MS) * eased));
}

// Gameplay recovery is intentionally separate from visual reveal duration.
// The lower bound stays below the roll rate limit, leaving headroom for normal
// player requests without turning the limiter into the timing mechanism.
function rollCooldownDuration(speedLevel) {
  return Math.max(MIN_ROLL_COOLDOWN_MS, Math.round(BASE_ROLL_COOLDOWN_MS * (1 - speedReduction(speedLevel))));
}

function diceCost(currentDice) {
  if (!Number.isSafeInteger(currentDice) || currentDice < 1 || currentDice >= MAX_DICE) return Infinity;
  // Each die is intentionally a major economy sink. It rises much faster than
  // the three research tracks and is assessed by the simulation script.
  return roundGame(6_000 * (18 ** (currentDice - 1)) * (currentDice ** 1.18));
}

function luckExponent(luck) {
  const safeLuck = Math.max(1, Number(luck) || 1);

  // Luck grows exponentially in the shop, but its effect on rarity
  // grows logarithmically so extreme Luck does not destroy rarity.
  const rarityPressure = Math.log10(safeLuck);

  return 1 / (1 + rarityPressure / 10);
}

function rarityForLog(baseChanceLog) {
  return RARITIES.find((rarity) => baseChanceLog < rarity.maxLog) || RARITIES.at(-1);
}

function sacrificeLuck(alien, plusLevel = 0) {
  const log = Math.max(1, Number(alien?.baseChanceLog) || 1);
  const shinyMultiplier = 1 + Math.max(0, Math.min(3, plusLevel)) * 0.8;
  return roundGame(Math.max(0.2, 0.032 * (log ** 3)) * shinyMultiplier * SACRIFICE_LUCK_EFFECT_MULTIPLIER);
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
  AUTO_ROLL_INCOME_MULTIPLIER, BASE_ROLL_ANIMATION_MS, BASE_ROLL_COOLDOWN_MS, MAX_PENDING_RARITY_LOG, MIN_ROLL_ANIMATION_MS, MIN_ROLL_COOLDOWN_MS, MAX_DICE, RARITIES, SACRIFICE_LUCK_EFFECT_MULTIPLIER, UPGRADE_DEFINITIONS,
  alienPower, coinMultiplier, diceCost, incomeFor, luckExponent, luckMultiplier, pendingLuckFloor, rarityForLog,
  rollAnimationDuration, rollCooldownDuration, roundGame, sacrificeLuck, speedReduction, upgradeCost, upgradeSnapshot
});
