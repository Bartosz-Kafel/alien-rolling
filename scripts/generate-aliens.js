"use strict";

/* Generates immutable, checked-in catalog data. Re-run only to append a new
 * range; it refuses to rewrite an existing alien definition. */
const fs = require("fs");
const path = require("path");
const { rarityForLog } = require("../balance");

const output = path.join(__dirname, "..", "data", "alien-registry.json");
const TARGET_COUNT = Number.parseInt(process.argv[2] || "2500", 10);
const force = process.argv.includes("--force");
const prefixes = ["Aether", "Amber", "Arc", "Astral", "Aurora", "Binary", "Blazing", "Hard", "Cipher", 
  "Prism", "Holy", "Quantum", "Radiant", "Rift", "Rune", "Solar", "Spectral", "Stellar", "Tempest", "Umbra", 
  "Velvet", "Void", "Zenith", "Gossamer", "Chrome", "Pedro", "Wild", "Maria", "Gravity", "Saffron", 
  "Iridescent", "Molten", "Charlie", "Shinning", "Clockwork", "Hollow", "Cobalt", "Bramble", "Neon", "Static", 
  "Opaline", "Murmuring", "Jeffrey", "Emberglass", "Signal", "Dusk", "Twilight", "Coral", "Enormus", "Feral", 
  "Glimmering", "Turtle", "Horny", "Storm", "Irene", "Golden", "Ultra", "Child" ];

const species = [
  "Puffer", "Lobster", "Bat", "Sanchez", "Koala", "Axolotl", "Warden", "Nomad", "Ballsack", "Harvester", "Jacinta", 
  "Sentry", "Prowler", "Leaper", "Lurker", "Montero", "Drifter", "Titan", "Voyager", "Beacon", "Catalyst", "Chimera", "Cock",
  "Sphinx", "Alien", "Raven", "Bison", "Predator", "Pangolin", "Lynx", "Carp", "Pup", "Guppy", "Epstein", "Pussy", "Manta", 
  "Kangaroo", "Centipede", "Capybara", "Chameleon", "Nigger", "Llama", "Possum", "Raccoon", "Cricket", "Poodle", 
  "Guppy", "Tarsier", "Swan", "Quokka", "Viper", "Panda", "Moose", "Seahorse", "Corgi", "Mongoose", "Iguana", "Rabbit", 
  "Toucan", "Lizard" ];

const emojis = ["👾", "👽", "🛸", "🤖", "🪼", "🦑", "🐙", "🦠", "🧬", "🔮", "🪐", "🌌", "☄️", "🛰️", "🌠", "⚛️", 
  "💠", "🌀", "🦎", "🦋", "🐸", "🦀", "🐛", "🐝", "🦑", "🦕", "🐉", "🐡", "🦜", "🐙", "🫧", "🪲", "🐌", "🦇", 
  "🦚", "🦝", "🦦", "🪿", "🐢", "🦈", "🔫", "🥵", "🔴", "🐢"];

function hash(value, salt) { let h = 2166136261; for (const c of `${salt}:${value}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function pick(list, id, salt) { return list[hash(id, salt) % list.length]; }
function idFor(number) { return `alien_${String(number).padStart(6, "0")}`; }
function chanceFromLog(log) {
  const exponent = Math.floor(log);
  const significand = Math.round((10 ** (log - exponent)) * 1_000_000);
  if (exponent < 6) return BigInt(Math.max(1, Math.round(10 ** log))).toString();
  return (BigInt(significand) * (10n ** BigInt(exponent - 6))).toString();
}

fs.mkdirSync(path.dirname(output), { recursive: true });
const existing = !force && fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, "utf8")) : [];
const byId = new Map(existing.map((alien) => [alien.id, alien]));
const names = new Set(existing.map((alien) => alien.name));
// This initial normalization gives each stored 1 / N its real base roll
// probability. Later runs append only and intentionally never alter it.
let rawTotal = 0;
for (let number = 1; number <= TARGET_COUNT; number += 1) {
  const progress = (number - 1) / Math.max(1, TARGET_COUNT - 1);
  rawTotal += 10 ** (-(3.28 + 43.9 * (progress ** 1.61)));
}
const normalizationLog = Math.log10(rawTotal);
for (let number = 1; number <= TARGET_COUNT; number += 1) {
  const id = idFor(number);
  if (byId.has(id)) continue;
  const progress = (number - 1) / Math.max(1, TARGET_COUNT - 1);
  // The final catalog reaches around 1 / 10^47. The catalog itself is static;
  // future appends leave all previous entries untouched.
  const baseChanceLog = 2.7 + 44.3 * progress + normalizationLog;
  const baseChance = chanceFromLog(baseChanceLog);
  const prefix = pick(prefixes, id, "prefix");
  const speciesName = pick(species, id, "species");
  let name = `${prefix} ${speciesName}`;
  if (names.has(name)) name = `${name} of Signal ${number}`;
  names.add(name);
  const rarity = rarityForLog(baseChanceLog);
  byId.set(id, { id, name, prefix, species: speciesName, emoji: pick(emojis, id, "emoji"), rarity: rarity.name, color: rarity.color, baseChance, baseChanceLog: Number(baseChanceLog.toFixed(6)), baseIncome: Number((2 * (10 ** ((baseChanceLog - 2.7) * 0.30))).toPrecision(10)) });
}
const catalog = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync(output, JSON.stringify(catalog, null, 2));
console.log(`Wrote ${catalog.length.toLocaleString()} immutable alien definitions to ${output}`);
