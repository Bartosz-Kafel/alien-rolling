"use strict";

const assert = require("assert");
const { ALIENS, ALIEN_BY_ID } = require("../aliens");
const balance = require("../balance");
const { compareStacks, stackKey } = require("../server");

assert.ok(ALIENS.length >= 2000, "catalog must contain at least 2,000 actual entries");
assert.equal(ALIEN_BY_ID.size, ALIENS.length, "alien IDs must be unique");
assert.equal(ALIENS[0].id, "alien_000001");
assert.ok(BigInt(ALIENS.at(-1).baseChance) > 1_000_000_000_000_000n, "endgame chance must exceed quadrillions");
assert.ok(balance.diceCost(4) / balance.diceCost(3) > 18, "dice cost must rise aggressively");
assert.ok(balance.luckExponent(1000) > 0 && balance.luckExponent(1000) < balance.luckExponent(10), "luck must have diminishing rarity transformation");
assert.ok(balance.sacrificeLuck(ALIENS.at(-1), 3) > balance.sacrificeLuck(ALIENS[0], 0) * 100, "rare sacrifice must matter");
assert.equal(stackKey("alien_004821", 2), "alien_004821|2");
assert.ok(compareStacks({ id: "a", income: 7, power: 4, plusLevel: 0, baseChanceLog: 4 }, { id: "b", income: 4, power: 7, plusLevel: 3, baseChanceLog: 7 }) < 0, "inventory comparison must rank higher income first");
assert.equal(balance.rollCooldownDuration(0), 720, "base gameplay cooldown must be authoritative");
assert.ok(balance.rollCooldownDuration(999) >= 600, "gameplay cooldown must remain inside the roll rate budget");
assert.equal(balance.sacrificeLuck(ALIENS[0], 0), balance.roundGame(Math.max(0.2, 0.032 * (Math.max(1, ALIENS[0].baseChanceLog) ** 3)) * balance.SACRIFICE_LUCK_EFFECT_MULTIPLIER), "sacrifice boost multiplier must affect server values");
console.log(`Self-test passed: ${ALIENS.length} registry entries, rarity range, economy curves, stack identity, and ranking logic.`);
