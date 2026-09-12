"use strict";

// Immutable, generated content. The generator only appends missing IDs, so a
// player's alien identity never depends on array ordering.
const definitions = require("./data/alien-registry.json");

function normalizeDefinition(source) {
  if (!source || typeof source.id !== "string" || typeof source.name !== "string") throw new Error("Invalid alien registry entry.");
  const baseChance = String(source.baseChance);
  if (!/^\d+$/.test(baseChance) || baseChance === "0") throw new Error(`Invalid base chance for ${source.id}.`);
  return Object.freeze({
    id: source.id,
    name: source.name,
    prefix: source.prefix,
    species: source.species,
    emoji: source.emoji,
    rarity: source.rarity,
    color: source.color,
    baseChance,
    baseChanceLog: Number(source.baseChanceLog),
    baseIncome: Number(source.baseIncome)
  });
}

const ALIENS = Object.freeze(definitions.map(normalizeDefinition));
const ALIEN_BY_ID = new Map(ALIENS.map((alien) => [alien.id, alien]));
if (ALIEN_BY_ID.size !== ALIENS.length) throw new Error("Alien registry has duplicate permanent IDs.");

module.exports = Object.freeze({
  ALIENS,
  ALIEN_BY_ID,
  REGISTRY_VERSION: "2026.09.12.2",
  CATALOG_SIZE: ALIENS.length
});
