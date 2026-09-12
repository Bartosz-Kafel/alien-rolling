"use strict";

const assert = require("assert");
const { ALIENS, ALIEN_BY_ID } = require("../aliens");
const balance = require("../balance");
const { compareStacks, stackKey } = require("../server");

assert.equal(ALIENS.length, 10_000, "catalog must contain 10,000 actual entries");
assert.equal(ALIEN_BY_ID.size, 10_000, "alien IDs must be unique");
assert.equal(ALIENS[0].id, "alien_000001");
assert.equal(ALIENS.at(-1).id, "alien_010000");
assert.ok(BigInt(ALIENS.at(-1).baseChance) > 1_000_000_000_000_000_000n, "endgame chance must exceed quintillions");
assert.ok(balance.diceCost(4) / balance.diceCost(3) > 18, "dice cost must rise aggressively");
assert.ok(balance.luckExponent(1000) > 0 && balance.luckExponent(1000) < balance.luckExponent(10), "luck must have diminishing rarity transformation");
assert.ok(balance.sacrificeLuck(ALIENS.at(-1), 3) > balance.sacrificeLuck(ALIENS[0], 0) * 100, "rare sacrifice must matter");
assert.equal(stackKey("alien_004821", 2), "alien_004821|2");
assert.ok(compareStacks({ id: "a", power: 7, plusLevel: 0, baseChanceLog: 7 }, { id: "b", power: 4, plusLevel: 3, baseChanceLog: 4 }) < 0, "best-stack comparison must rank higher power first");
console.log("Self-test passed: registry, rarity range, economy curves, stack identity, and ranking logic.");
