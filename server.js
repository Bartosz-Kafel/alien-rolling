
const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const DATA_FILE = path.join(__dirname, "data.json");
const SESSION_COOKIE = "afk_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const MAX_MONEY = 1_000_000_000_000_000;
const BASE_ROLL_ANIMATION_MS = 2200;

// Expanded by 10x (111 prefixes)
const PREFIXES = [
  "Space", "Nebula", "Chrono", "Stellar", "Void", "Quantum", "Lunar", "Solar", "Plasma", "Astral", "Eclipse",
  "Cosmic", "Galactic", "Orion", "Andromeda", "Nova", "Supernova", "Hyper", "Cyber", "Bio", "Geo", "Pyro",
  "Cryo", "Hydro", "Aero", "Electro", "Pedro", "Abyssal", "Aether", "Nether", "Spectral", "Phantom", "Shadow",
  "Light", "Dark", "Deep", "High", "Low", "Prime", "Apex", "Omega", "Alpha", "Beta", "Gamma",
  "Delta", "Epsilon", "Zeta", "Sigma", "Matrix", "Vector", "Helix", "Nexus", "Vortex", "Singularity", "Horizon",
  "Infinity", "Eternal", "Ancient", "Primal", "Prismatic", "Spectral", "Radiant", "Luminous", "Glimmer", "Twilight", "Obsidian",
  "Meteor", "Comet", "Asteroid", "Titanium", "Carbon", "Child", "Iron", "Gold", "Quantum", "Nano", "Mega",
  "Giga", "Tera", "Peta", "Exo", "Endo", "Meso", "Proto", "LGBQT+", "Neo", "Retro", "Future",
  "Zenith", "Gay", "Pinnacle", "Abyss", "Lesbian", "Rift", "Anomaly", "Paradox", "Enigma", "Mirage", "Echo",
  "Pulse", "Wave", "Ray", "Beam", "Flash", "Spark", "Blaze", "Frost", "Gale", "Quake", "Flux"
];

// Expanded by 10x (100 species)
const SPECIES = [
  "Slime", "Titan", "Voyager", "Mantis", "Oracle", "Warden", "Drifter", "Leviathan", "Sprite", "Monarch",
  "Beast", "Stalker", "Hunter", "Predator", "Scout", "Warrior", "Knight", "Mage", "Sorcerer", "Priest",
  "Shaman", "Druid", "Rogue", "Assassin", "Thief", "Goliath", "Colossus", "Behemoth", "Giant", "Dwarf",
  "Elf", "Orc", "Goblin", "Troll", "Lurdes", "Dragon", "Wyvern", "Drake", "Hydra", "Phoenix",
  "Gryphon", "Pegasus", "Femboy", "Sphinx", "Minotaur", "Centaur", "Cyclops", "Gooner", "Medusa", "Siren",
  "Mermaid", "Merman", "Kraken", "Cthulhu", "Demon", "Devil", "Angel", "Archangel", "Seraph", "Cherub",
  "Ghost", "Spirit", "Phantom", "Specter", "Wraith", "Apparition", "Shade", "Shadow", "Ghouls", "Zombie",
  "Vampire", "Werewolf", "Construct", "Golem", "Robot", "Android", "Cyborg", "Mech", "Machine", "Drone",
  "Automaton", "Engine", "Core", "Matrix", "Network", "Swarm", "Hive", "Sanchez", "Colony", "Nigger",
  "Herd", "Pack", "Pride", "School", "Pod", "Clan", "Tribe", "Guild", "Order", "Faction"
];

// Generates 11,100 unique combinations and takes the first 1,010 (10x your original 101 limit)
const ALIEN_NAMES = PREFIXES.flatMap((prefix) => SPECIES.map((species) => `${prefix} ${species}`)).slice(0, 1010);

// Expanded by over 10x (165 sci-fi, space, alien, and abstract icons)
const ALIEN_ICONS = [
  "👾", "🛸", "👽", "🪼", "🦑", "🦠", "🐙", "🤖", "🤖", "🦿", "🦾", "🧌",
  "🪐", "🌌", "☄️", "🛰️", "🌠", "🚀", "🔭", "📡", "☀️", "🌙", "⭐", "🌟", 
  "✨", "🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘", "🌙", "🌚", "🌛", 
  "🌜", "🌞", "🌍", "🌎", "🌏", "🌀", "🌋", "☄️", "🌌", "🪐", "🌟", "⭐",
  "🔮", "🧬", "⚛️", "⚡", "💥", "🔥", "💎", "🧿", "🌟", "☄️", "📿", "👑",
  "💫", "🔋", "🔌", "🕯️", "💡", "🏮", "💎", "🔮", "🧿", "🌀", "☣️", "☢️",
  "💠", "🌀", "💮", "💮", "🎴", "🔱", "⚜️", "👁️", "🧠", "💀", "☠️", "👻",
  "🍄", "🌵", "🌴", "🌱", "🌿", "☘️", "🍀", "🍁", "🍂", "🍃", "🥀", "🌻", 
  "🌼", "🌽", "🌾", "🌿", "🍄", "🌰", "🌲", "🌳", "🌴", "🌵", "🌶️", "🪨",
  "🦕", "🦖", "🐊", "🐍", "🐢", "🦎", "🦂", "🕷️", "🪳", "🪰", "🪲", "🦗", 
  "🐜", "🐝", "🪱", "🦋", "🐌", "🐛", "🐜", "🐝", "🐞", "🦗", "🕷️", "🦂",
  "🌪️", "🌈", "💧", "🌊", "❄️", "💨", "🌫️", "🌬️", "☄️", "🔥", "💧", "⚡",
  "❄️", "☃️", "⛄", "🌬️", "💨", "🌪️", "🌫️", "🌈", "☔", "⚡", "🌀", "🌊",
  "🛑", "⚙️", "🛠️", "🧪", "🧫", "🔬", "🛡️", "⚔️", "🏹", "🗡️", "🪃", "⛓️",
  "💣", "🗝️", "🔑", "🔒", "🔓", "🔏", "🔐", "⚖️", "🧭", "⏳", "⌛", "🔋",
  "⚙️", "🔧", "🔨", "⚒️", "🛠️", "⛏️", "🔩", "⚙️", "🗜️", "⚖️", "⛓️", "🛡️"
];


// Expanded by 10x (80 progression tiers scaled proportionally up to index 1010)
const TIER_BY_INDEX = [
  ["Garbage", 10], ["Space Junk", 20], ["Bio-Waste", 30], ["Scrap Metal", 40], ["Bottom Feeder", 50], ["Fodder", 60], ["Stray", 70], ["Drifter", 80], ["Rookie", 90], ["Survivor", 100],
  ["Scavenger", 115], ["Marauder", 130], ["Vanguard", 145], ["Enforcer", 160], ["Bio-Hazard", 175], ["Toxic Mutated", 190], ["Cyber-Augmented", 205], ["Apex Stalker", 220], ["Infiltrator", 235], ["Overlord", 250],
  ["Anomaly", 270], ["Glitch", 290], ["Void Walker", 310], ["Abyssal", 330], ["Phantom", 350], ["Specter", 370], ["Chronos-Warped", 390], ["Quantum Shifted", 410], ["Singularity", 430], ["Eon Walker", 450],
  ["World Eater", 470], ["Planet Buster", 490], ["Star Crusher", 510], ["Solar Flare", 530], ["Supernova", 550], ["Event Horizon", 570], ["Cosmic Storm", 590], ["Nebula Spawn", 610], ["Stellar Sovereign", 630], ["Galaxy Tyrant", 650],
  ["Astral Titan", 665], ["Celestial", 680], ["Immortal", 695], ["Eldritch Horror", 710], ["Void Sovereign", 725], ["Nether King", 740], ["Aether Lord", 755], ["Primordial", 770], ["Ancient Terror", 785], ["Doomsday", 800],
  ["Demi-God", 812], ["Godlike", 824], ["Deity", 836], ["Pantheon Elite", 848], ["Reality Warper", 860], ["Time Weaver", 872], ["Space Bender", 884], ["Dimensional Lord", 896], ["Astral Emperor", 908], ["Infinite", 920],
  ["Omnipotent", 927], ["Omnipresent", 934], ["Absolute Zero", 941], ["Eternal Flame", 948], ["Cosmic Blueprint", 955], ["Matrix Core", 962], ["Singularity Alpha", 969], ["Void Omega", 976], ["Grand Architect", 983], ["Universal Constant", 990],
  ["Beyond Existence", 992], ["Timeless", 994], ["Outer God", 996], ["Multiversal", 998], ["Omniversal", 1000], ["The Zenith", 1002], ["Apex Predestined", 1004], ["Final Paradox", 1006], ["The Absolute", 1008], ["True Entity", 1010]
];


const roundFinancial = (value) => Math.round(value * 10_000) / 10_000;

const getTier = (index) =>
  TIER_BY_INDEX.find(([, maxIndex]) => index <= maxIndex)[0];

function rarityDenominator(index) {
  const progress = index / (ALIEN_NAMES.length - 1);

  return Math.max(
    2,
    Math.round(
      2 * Math.pow(50_000_000_000_000 / 2, progress ** 1.35)
    )
  );
}

const ALIENS = ALIEN_NAMES.map((name, index) => {
  const denominator = rarityDenominator(index);
  const rarity = 1 / denominator;

  const moneyPerSec =
    0.15 * Math.pow(denominator, 0.65);

  return Object.freeze({
    id: `alien_${String(index + 1).padStart(3, "0")}`,
    name,
    tier: getTier(index),
    icon: ALIEN_ICONS[index % ALIEN_ICONS.length],
    color: `hsl(${(index * 37 + 165) % 360} 85% 63%)`,
    rarity,
    rarityDenominator: denominator,
    money_per_sec: roundFinancial(moneyPerSec)
  });
});

const ALIEN_BY_ID = new Map(ALIENS.map((alien) => [alien.id, alien]));

const UPGRADE_CONFIG = Object.freeze({
  luck_boost: { label: "Luck Boost", description: "Tilts the roll table toward rarer aliens.", baseBonus: 0.10, unit: "luck" },
  rolling_speed: { label: "Rolling Speed", description: "Shortens the dice materialization animation.", baseBonus: 0.08, unit: "speed" },
  money_increase: { label: "Money Increase", description: "Raises earnings from every placed alien.", baseBonus: 0.10, unit: "yield" }
});

function initialDatabase() {
  return { users: {} };
}

function loadDatabase() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialDatabase(), null, 2), "utf8");
    return initialDatabase();
  }
  const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !parsed.users || typeof parsed.users !== "object" || Array.isArray(parsed.users)) {
    throw new Error("data.json must contain an object with a users object.");
  }
  return parsed;
}

let database = loadDatabase();
let databaseBusy = false;
const databaseQueue = [];

function persistDatabase() {
  const temporaryFile = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(database, null, 2), "utf8");
  fs.renameSync(temporaryFile, DATA_FILE);
}

/* Every database mutation is serialized, and each completed mutation is written atomically. */
function withDatabaseLock(work) {
  return new Promise((resolve, reject) => {
    databaseQueue.push({ work, resolve, reject });
    drainDatabaseQueue();
  });
}

function drainDatabaseQueue() {
  if (databaseBusy || databaseQueue.length === 0) return;
  databaseBusy = true;
  const job = databaseQueue.shift();
  try {
    const result = job.work();
    persistDatabase();
    job.resolve(result);
  } catch (error) {
    job.reject(error);
  } finally {
    databaseBusy = false;
    queueMicrotask(drainDatabaseQueue);
  }
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return ["", ""];
    return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }).filter(([key]) => key));
}

const sessions = new Map();
function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  sessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function setSessionCookie(response, token) {
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS,
    path: "/"
  });
}

function clearSessionCookie(response) {
  response.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "strict", path: "/" });
}

function requireSession(request, response, next) {
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now() || !database.users[session.userId]) {
    if (token) sessions.delete(token);
    return response.status(401).json({ error: "Your session has expired. Please sign in again." });
  }
  request.userId = session.userId;
  request.sessionToken = token;
  return next();
}

function requireSameOrigin(request, response, next) {
  const origin = request.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== request.get("host")) {
        return response.status(403).json({ error: "Cross-site requests are not allowed." });
      }
    } catch {
      return response.status(403).json({ error: "Invalid request origin." });
    }
  }
  return next();
}

function passwordHash(password, salt = crypto.randomBytes(16).toString("base64url")) {
  const digest = crypto.scryptSync(password, salt, 64).toString("base64url");
  return `${salt}:${digest}`;
}

function passwordMatches(password, stored) {
  const [salt, digest] = String(stored).split(":");
  if (!salt || !digest) return false;
  const expected = Buffer.from(digest, "base64url");
  const actual = crypto.scryptSync(password, salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function getSlotCount(player) {
  return Math.max(1, player.placed_aliens.length);
}

function upgradeCost(level) {
  return roundFinancial(100 * (1.5 ** level));
}

function nextUpgradeBonus(key, level) {
  if (key === "rolling_speed") return 1 - (0.96 ** (level + 1));
  return UPGRADE_CONFIG[key].baseBonus * (1.1 ** level);
}

function totalUpgradeBonus(key, level) {
  let total = 0;
  for (let index = 0; index < level; index += 1) total += nextUpgradeBonus(key, index);
  return total;
}

function effectiveAlienRate(player, alien) {
  const yieldBonus = totalUpgradeBonus("money_increase", player.shop_purchases.money_increase);
  return roundFinancial(alien.money_per_sec * (1 + yieldBonus));
}

function totalMoneyPerSecond(player) {
  return roundFinancial(player.placed_aliens.reduce((sum, slot) => {
    const alien = slot && ALIEN_BY_ID.get(slot.alien_id);
    return sum + (alien ? effectiveAlienRate(player, alien) : 0);
  }, 0));
}

function rollAnimationDuration(player) {
  const level = player.shop_purchases.rolling_speed;
  const speedMultiplier = 0.96 ** level;
  return Math.max(100, Math.round(BASE_ROLL_ANIMATION_MS * speedMultiplier));
}

/* Placement records carry their collection timestamp, preserving the required player shape. */
function applyPassiveIncome(player, now = Date.now()) {
  let generated = 0;
  for (const slot of player.placed_aliens) {
    if (!slot || !ALIEN_BY_ID.has(slot.alien_id)) continue;
    const previous = Number(slot.last_collected);
    slot.last_collected = now;
    if (!Number.isFinite(previous) || previous > now) continue;
    generated += ((now - previous) / 1000) * effectiveAlienRate(player, ALIEN_BY_ID.get(slot.alien_id));
  }
  if (generated > 0) player.money = Math.min(MAX_MONEY, roundFinancial(player.money + generated));
  return roundFinancial(generated);
}

function publicCatalog() {
  return ALIENS.map(({
    id,
    name,
    tier,
    icon,
    color,
    rarity,
    rarityDenominator,
    money_per_sec
  }) => ({
    id,
    name,
    tier,
    icon,
    color,
    rarity,
    rarityDenominator,
    money_per_sec
  }));
}

function leaderboardFor(activeUserId) {
  const rows = Object.entries(database.users).map(([id, user]) => ({
    id,
    name: user.name,
    money: roundFinancial(user.money),
    total_rolls: user.total_rolls
  })).sort((a, b) => b.money - a.money || b.total_rolls - a.total_rolls || a.name.localeCompare(b.name));
  const activeRank = rows.findIndex((row) => row.id === activeUserId) + 1;
  const top = rows.slice(0, 10).map((row, index) => ({ ...row, rank: index + 1 }));
  const active = rows[activeRank - 1];
  if (activeRank > 10 && active) top.push({ ...active, rank: activeRank, isCurrentPlayer: true });
  return { rows: top.map(({ id, ...row }) => row), activeRank };
}

function gameStateFor(userId) {
  const player = database.users[userId];
  const slots = getSlotCount(player);
  const placedAliens = Array.from({ length: slots }, (_, index) => {
    const slot = player.placed_aliens[index];
    const alien = slot && ALIEN_BY_ID.get(slot.alien_id);
    return alien ? { ...alien, money_per_sec: effectiveAlienRate(player, alien) } : null;
  });
  const upgrades = Object.fromEntries(Object.keys(UPGRADE_CONFIG).map((key) => {
    const level = player.shop_purchases[key];
    return [key, {
      ...UPGRADE_CONFIG[key],
      level,
      cost: upgradeCost(level),
      nextBonus: nextUpgradeBonus(key, level),
      totalBonus: totalUpgradeBonus(key, level)
    }];
  }));
  return {
    player: {
      name: player.name,
      money: roundFinancial(player.money),
      total_rolls: player.total_rolls,
      inventory: player.inventory,
      placed_aliens: placedAliens,
      slots,
      nextSlotCost: 500 * (2 ** slots),
      moneyPerSecond: totalMoneyPerSecond(player),
      rollAnimationMs: rollAnimationDuration(player),
      upgrades
    },
    catalog: publicCatalog(),
    leaderboard: leaderboardFor(userId)
  };
}

function pickAlien(player) {
  const luck = totalUpgradeBonus(
    "luck_boost",
    player.shop_purchases.luck_boost
  );

  const weights = ALIENS.map((alien, index) => {
    const progress = index / (ALIENS.length - 1);

    const luckMultiplier =
      1 + luck * 2 * (progress ** 1.6);

    return alien.rarity * luckMultiplier;
  });

  const weightTotal = weights.reduce(
    (sum, weight) => sum + weight,
    0
  );

  let roll =
    crypto.randomInt(0, 1_000_000_000) /
    1_000_000_000 *
    weightTotal;

  for (let index = 0; index < ALIENS.length; index += 1) {
    roll -= weights[index];

    if (roll <= 0 || index === ALIENS.length - 1) {
      return {
        alien: ALIENS[index],
        chance: weights[index] / weightTotal
      };
    }
  }

  return {
    alien: ALIENS[0],
    chance: weights[0] / weightTotal
  };
}

function validatePlayer(player) {
  return player && typeof player === "object" && typeof player.name === "string" && typeof player.password === "string" &&
    Number.isFinite(player.money) && player.money >= 0 && Number.isInteger(player.total_rolls) && player.total_rolls >= 0 && player.shop_purchases &&
    Number.isInteger(player.shop_purchases.luck_boost) && player.shop_purchases.luck_boost >= 0 &&
    Number.isInteger(player.shop_purchases.rolling_speed) && player.shop_purchases.rolling_speed >= 0 &&
    Number.isInteger(player.shop_purchases.money_increase) && player.shop_purchases.money_increase >= 0 && player.inventory && typeof player.inventory === "object" && !Array.isArray(player.inventory) &&
    Array.isArray(player.placed_aliens);
}

app.disable("x-powered-by");
app.use(express.json({ limit: "12kb", strict: true }));
app.use((request, response, next) => {
  response.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" });
  next();
});

app.post("/api/login", requireSameOrigin, async (request, response, next) => {
  try {
    const username = typeof request.body?.username === "string" ? request.body.username.trim().replace(/\s+/g, " ") : "";
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    if (username.length < 3 || username.length > 24 || /[\x00-\x1f]/.test(username)) return response.status(400).json({ error: "Username must be 3–24 printable characters." });
    if (password.length < 4 || password.length > 128) return response.status(400).json({ error: "Password must be 4–128 characters." });

    const result = await withDatabaseLock(() => {
      const found = Object.entries(database.users).find(([, user]) => user.name.toLocaleLowerCase() === username.toLocaleLowerCase());
      if (found) {
        const [userId, user] = found;
        if (!validatePlayer(user) || !passwordMatches(password, user.password)) return { ok: false, status: 401, error: "Incorrect username or password." };
        applyPassiveIncome(user);
        return { ok: true, userId, created: false };
      }
      const userId = crypto.randomUUID();
      database.users[userId] = {
        name: username,
        password: passwordHash(password),
        money: 50,
        total_rolls: 0,
        shop_purchases: { luck_boost: 0, rolling_speed: 0, money_increase: 0 },
        inventory: {},
        placed_aliens: []
      };
      return { ok: true, userId, created: true };
    });
    if (!result.ok) return response.status(result.status).json({ error: result.error });
    const token = createSession(result.userId);
    setSessionCookie(response, token);
    return response.status(result.created ? 201 : 200).json({ ...gameStateFor(result.userId), created: result.created });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/game-state", requireSession, async (request, response, next) => {
  try {
    const state = await withDatabaseLock(() => {
      const player = database.users[request.userId];
      if (!validatePlayer(player)) throw new Error("Stored player data has an invalid shape.");
      applyPassiveIncome(player);
      return gameStateFor(request.userId);
    });
    return response.json(state);
  } catch (error) {
    return next(error);
  }
});

app.post("/api/roll", requireSession, requireSameOrigin, async (request, response, next) => {
  try {
    const result = await withDatabaseLock(() => {
      const player = database.users[request.userId];
      if (!validatePlayer(player)) throw new Error("Stored player data has an invalid shape.");
      applyPassiveIncome(player);
      const result = pickAlien(player);
      player.inventory[result.alien.id] = (Number(player.inventory[result.alien.id]) || 0) + 1;
      player.total_rolls += 1;
      return {
        ok: true,
        rolled: result.alien,
        state: gameStateFor(request.userId)
      };
    });
    if (!result.ok) return response.status(result.status).json(result);
    return response.json(result);
  } catch (error) {
    return next(error);
  }
});

app.post("/api/buy-shop", requireSession, requireSameOrigin, async (request, response, next) => {
  try {
    const upgrade = request.body?.upgrade;
    if (typeof upgrade !== "string" || !UPGRADE_CONFIG[upgrade]) return response.status(400).json({ error: "Unknown shop upgrade." });
    const result = await withDatabaseLock(() => {
      const player = database.users[request.userId];
      if (!validatePlayer(player)) throw new Error("Stored player data has an invalid shape.");
      applyPassiveIncome(player);
      const level = player.shop_purchases[upgrade];
      const cost = upgradeCost(level);
      if (player.money + 0.00001 < cost) return { ok: false, status: 400, error: "Not enough credits for that upgrade.", state: gameStateFor(request.userId) };
      player.money = roundFinancial(player.money - cost);
      player.shop_purchases[upgrade] += 1;
      return { ok: true, state: gameStateFor(request.userId) };
    });
    if (!result.ok) return response.status(result.status).json(result);
    return response.json(result);
  } catch (error) {
    return next(error);
  }
});

app.post("/api/buy-slot", requireSession, requireSameOrigin, async (request, response, next) => {
  try {
    const result = await withDatabaseLock(() => {
      const player = database.users[request.userId];
      if (!validatePlayer(player)) throw new Error("Stored player data has an invalid shape.");
      applyPassiveIncome(player);
      const slots = getSlotCount(player);
      const cost = 500 * (2 ** slots);
      if (!Number.isSafeInteger(cost) || player.money + 0.00001 < cost) return { ok: false, status: 400, error: "Not enough credits for a new container.", state: gameStateFor(request.userId) };
      player.money = roundFinancial(player.money - cost);
      if (player.placed_aliens.length === 0) player.placed_aliens.push(null, null);
      else player.placed_aliens.push(null);
      return { ok: true, state: gameStateFor(request.userId) };
    });
    if (!result.ok) return response.status(result.status).json(result);
    return response.json(result);
  } catch (error) {
    return next(error);
  }
});

app.post("/api/remove-alien", requireSession, requireSameOrigin, async (request, response, next) => {
  try {
    const slotIndex = request.body?.slotIndex;
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 1000) {
      return response.status(400).json({ error: "Invalid container selection." });
    }
    const result = await withDatabaseLock(() => {
      const player = database.users[request.userId];
      if (!validatePlayer(player)) throw new Error("Stored player data has an invalid shape.");
      applyPassiveIncome(player);
      const slot = player.placed_aliens[slotIndex];
      if (!slot || !ALIEN_BY_ID.has(slot.alien_id)) return { ok: false, status: 400, error: "That container is already empty.", state: gameStateFor(request.userId) };
      const quantity = Number(player.inventory[slot.alien_id]) || 0;
      if (!Number.isSafeInteger(quantity) || quantity >= Number.MAX_SAFE_INTEGER - 1) {
        return { ok: false, status: 400, error: "Inventory stack is at its safe maximum.", state: gameStateFor(request.userId) };
      }
      player.inventory[slot.alien_id] = quantity + 1;
      player.placed_aliens[slotIndex] = null;
      return { ok: true, state: gameStateFor(request.userId) };
    });
    if (!result.ok) return response.status(result.status).json(result);
    return response.json(result);
  } catch (error) {
    return next(error);
  }
});

app.post("/api/place-alien", requireSession, requireSameOrigin, async (request, response, next) => {
  try {
    const alienId = request.body?.alienId;
    const slotIndex = request.body?.slotIndex;
    if (typeof alienId !== "string" || !ALIEN_BY_ID.has(alienId) || !Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 1000) {
      return response.status(400).json({ error: "Invalid alien placement request." });
    }
    const result = await withDatabaseLock(() => {
      const player = database.users[request.userId];
      if (!validatePlayer(player)) throw new Error("Stored player data has an invalid shape.");
      applyPassiveIncome(player);
      const slots = getSlotCount(player);
      if (slotIndex >= slots) return { ok: false, status: 400, error: "That container is not unlocked." };
      if ((Number(player.inventory[alienId]) || 0) < 1) return { ok: false, status: 400, error: "That alien is not in your inventory." };
      if (player.placed_aliens[slotIndex]) return { ok: false, status: 400, error: "Choose an empty container." };
      player.inventory[alienId] -= 1;
      if (player.inventory[alienId] === 0) delete player.inventory[alienId];
      if (player.placed_aliens.length === 0) player.placed_aliens.push({ alien_id: alienId, last_collected: Date.now() });
      else player.placed_aliens[slotIndex] = { alien_id: alienId, last_collected: Date.now() };
      return { ok: true, state: gameStateFor(request.userId) };
    });
    if (!result.ok) return response.status(result.status).json(result);
    return response.json(result);
  } catch (error) {
    return next(error);
  }
});

app.post("/api/trade", requireSession, requireSameOrigin, async (request, response, next) => {
  try {
    const recipient = typeof request.body?.recipient === "string"
      ? request.body.recipient.trim()
      : "";

    const alienId = request.body?.alienId;
    const quantity = Number(request.body?.quantity);

    if (!recipient || recipient.length > 24) {
      return response.status(400).json({ error: "Invalid recipient username." });
    }

    if (typeof alienId !== "string" || !ALIEN_BY_ID.has(alienId)) {
      return response.status(400).json({ error: "Invalid alien selection." });
    }

    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      return response.status(400).json({ error: "Invalid trade quantity." });
    }

    const result = await withDatabaseLock(() => {
      const sender = database.users[request.userId];

      if (!validatePlayer(sender)) {
        throw new Error("Stored player data has an invalid shape.");
      }

      applyPassiveIncome(sender);

      const recipientEntry = Object.entries(database.users).find(
        ([, player]) => player.name.toLowerCase() === recipient.toLowerCase()
      );

      if (!recipientEntry) {
        return {
          ok: false,
          status: 404,
          error: "That pilot does not exist."
        };
      }

      const [recipientId, receiver] = recipientEntry;

      if (recipientId === request.userId) {
        return {
          ok: false,
          status: 400,
          error: "You cannot trade with yourself."
        };
      }

      const ownedQuantity = Number(sender.inventory[alienId]) || 0;

      if (ownedQuantity < quantity) {
        return {
          ok: false,
          status: 400,
          error: `You only have ${ownedQuantity} of that alien.`
        };
      }

      if (!validatePlayer(receiver)) {
        throw new Error("Stored recipient data has an invalid shape.");
      }

      sender.inventory[alienId] -= quantity;

      if (sender.inventory[alienId] === 0) {
        delete sender.inventory[alienId];
      }

      receiver.inventory[alienId] =
        (Number(receiver.inventory[alienId]) || 0) + quantity;

      return {
        ok: true,
        state: gameStateFor(request.userId)
      };
    });

    if (!result.ok) {
      return response.status(result.status).json(result);
    }

    return response.json(result);
  } catch (error) {
    return next(error);
  }
});

app.post("/api/logout", requireSession, requireSameOrigin, (request, response) => {
  sessions.delete(request.sessionToken);
  clearSessionCookie(response);
  response.status(204).end();
});

app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"], index: "index.html", maxAge: "1h" }));
app.use((error, request, response, next) => { // eslint-disable-line no-unused-vars
  if (error instanceof SyntaxError && "body" in error) return response.status(400).json({ error: "Request body must be valid JSON." });
  console.error(error);
  return response.status(500).json({ error: "The game server encountered an unexpected error." });
});

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) if (session.expiresAt < now) sessions.delete(token);
}, 60 * 60 * 1000).unref();

module.exports = app;