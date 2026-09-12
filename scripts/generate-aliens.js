"use strict";

/* Generates immutable, checked-in catalog data. Re-run only to append a new
 * range; it refuses to rewrite an existing alien definition. */
const fs = require("fs");
const path = require("path");
const { rarityForLog } = require("../balance");

const output = path.join(__dirname, "..", "data", "alien-registry.json");
const TARGET_COUNT = Number.parseInt(process.argv[2] || "10000", 10);
const force = process.argv.includes("--force");
const prefixes = ["Aether", "Amber", "Arc", "Astral", "Aurora", "Binary", "Blazing", "Cinder", "Cipher", "Comet", "Corona", "Cosmic", "Crimson", "Crystal", "Dawn", "Deep", "Drift", "Echo", "Eclipse", "Ember", "Ether", "Feral", "Flux", "Frost", "Galactic", "Glimmer", "Halo", "Helio", "Horizon", "Ion", "Jade", "Lumen", "Lunar", "Meteor", "Midnight", "Nebula", "Nova", "Obsidian", "Omega", "Orbit", "Photon", "Plasma", "Prism", "Pulse", "Quantum", "Radiant", "Rift", "Rune", "Solar", "Spectral", "Stellar", "Tempest", "Umbra", "Velvet", "Void", "Zenith", "Gossamer", "Chrome", "Tidal", "Wild", "Velour", "Gravity", "Saffron", "Iridescent", "Molten", "Sapphire", "Moss", "Clockwork", "Hollow", "Cobalt", "Bramble", "Neon", "Static", "Opaline", "Murmuring", "Glacier", "Emberglass", "Signal", "Dusk", "Twilight", "Coral", "Solaris", "Feral", "Ozone", "Magnetic", "Apex", "Wandering", "Velvet", "Mirror", "Celestial", "Pollen", "Fathom", "Rainbow", "Glimmering", "Liminal", "Rogue", "Phantom", "Verdant", "Elder", "Bright", "Shifting", "Turbulent", "Paper", "Whispering", "Kinetic", "Singing", "Lava", "Dreaming", "Astro", "Mosaic", "Voidborn", "Nectar", "Storm", "Crescent", "Golden", "Blue" ];
const species = ["Frog", "Blob", "Mantis", "Squid", "Moth", "Gecko", "Orb", "Crab", "Jelly", "Beetle", "Wisp", "Slime", "Golem", "Ray", "Kestrel", "Crawler", "Bloom", "Sprite", "Eel", "Toad", "Fox", "Owl", "Mimic", "Snail", "Puffer", "Lobster", "Bat", "Mole", "Koala", "Axolotl", "Warden", "Nomad", "Oracle", "Harvester", "Navigator", "Sentry", "Prowler", "Leaper", "Lurker", "Shaper", "Drifter", "Titan", "Voyager", "Beacon", "Catalyst", "Chimera", "Flock", "Forager", "Gazer", "Guardian", "Hive", "Monarch", "Ranger", "Shade", "Skimmer", "Stalker", "Amalgam", "Envoy", "Fathom", "Glider", "Mushroom", "Prawn", "Serpent", "Badger", "Lemur", "Sparrow", "Cobra", "Kite", "Droid", "Sphinx", "Turtle", "Raven", "Bison", "Otter", "Pangolin", "Lynx", "Carp", "Pup", "Guppy", "Weevil", "Wombat", "Manta", "Dove", "Newt", "Koi", "Dragon", "Mole", "Yak", "Shark", "Ferret", "Pigeon", "Sailfish", "Bumblebee", "Worm", "Cicada", "Kangaroo", "Centipede", "Capybara", "Chameleon", "Cuttlefish", "Llama", "Possum", "Raccoon", "Cricket", "Poodle", "Guppy", "Tarsier", "Swan", "Quokka", "Viper", "Panda", "Moose", "Seahorse", "Corgi", "Mongoose", "Iguana", "Rabbit", "Toucan", "Lizard" ];
const epithets = ["of the Neon Reef", "from Starfall", "of Quiet Orbits", "from the Glass Moon", "of the Velvet Rift", "from Far Aurora", "of Tiny Suns", "from the Last Comet", "of the Sky Garden", "from Echo Bay", "of the Static Sea", "from Shimmer Station", "of the Lost Arcade", "from Orbit Nine", "of the Sapphire Dunes", "from Cloud Sector", "of the Soft Void", "from Lunar Market", "of the Singing Crater", "from the Cobalt Trail", "of the Moonlit Relay", "from the Golden Nebula", "of the Deep Signal", "from Starling Fields", "of the Bright Machine", "from Violet Harbour", "of the Ringed Planet", "from the Silver Current", "of the Secret Garden", "from the Candy Comet", "of the Gentle Storm", "from Hologram Hill", "of the Ocean Planet", "from the Distant Bell", "of the Paper Galaxy", "from the Spiral Orchard", "of the Sunny Asteroid", "from Quiet Gravity", "of the Mirror Moon", "from the Prism Cloud"];
const emojis = ["👾", "👽", "🛸", "🤖", "🪼", "🦑", "🐙", "🦠", "🧬", "🔮", "🪐", "🌌", "☄️", "🛰️", "🌠", "⚛️", "💠", "🌀", "🦎", "🦋", "🐸", "🦀", "🐛", "🐝", "🦑", "🦕", "🐉", "🐡", "🦜", "🐙", "🫧", "🪲", "🐌", "🦇", "🦚", "🦝", "🦦", "🪿", "🐢", "🦈"];

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
  const baseChanceLog = 3.28 + 43.9 * (progress ** 1.61) + normalizationLog;
  const baseChance = chanceFromLog(baseChanceLog);
  const prefix = pick(prefixes, id, "prefix");
  const speciesName = pick(species, id, "species");
  let name = hash(id, "pattern") % 3 === 0 ? `${prefix} ${speciesName} ${pick(["Prime", "Echo", "Nova", "Unit", "Bloom", "Scout", "Drift", "Kind"], id, "tag")}` : hash(id, "pattern") % 3 === 1 ? `${prefix} ${speciesName} ${pick(epithets, id, "epithet")}` : `${prefix} ${speciesName}`;
  if (names.has(name)) name = `${name} of Signal ${number}`;
  names.add(name);
  const rarity = rarityForLog(baseChanceLog);
  byId.set(id, { id, name, prefix, species: speciesName, emoji: pick(emojis, id, "emoji"), rarity: rarity.name, color: rarity.color, baseChance, baseChanceLog: Number(baseChanceLog.toFixed(6)), baseIncome: Number((0.09 * (10 ** ((baseChanceLog - 2.7) * 0.22))).toPrecision(10)) });
}
const catalog = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync(output, JSON.stringify(catalog));
console.log(`Wrote ${catalog.length.toLocaleString()} immutable alien definitions to ${output}`);
