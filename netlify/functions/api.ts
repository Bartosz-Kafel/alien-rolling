import crypto from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "../../db/index.js";
import { sessions, users, type Inventory, type PlacedAlien, type ShopPurchases } from "../../db/schema.js";

const SESSION_COOKIE = "afk_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const MAX_MONEY = 1_000_000_000_000_000;
const BASE_ROLL_ANIMATION_MS = 2200;

const PREFIXES = ["Space", "Nebula", "Chrono", "Stellar", "Void", "Quantum", "Lunar", "Solar", "Plasma", "Astral", "Eclipse"];
const SPECIES = ["Slime", "Titan", "Voyager", "Mantis", "Oracle", "Warden", "Drifter", "Leviathan", "Sprite", "Monarch"];
const ALIEN_NAMES = PREFIXES.flatMap((prefix) => SPECIES.map((species) => `${prefix} ${species}`)).slice(0, 101);
const ALIEN_ICONS = ["👾", "🛸", "👽", "🪼", "🦑", "🦠", "🐙", "🪐", "🌌", "☄️", "🔮", "🛰️", "🌠", "🧬", "⚛️", "🦕"];
const TIER_BY_INDEX: [string, number][] = [
  ["Common", 8], ["Uncommon", 23], ["Rare", 43], ["Epic", 61],
  ["Legendary", 76], ["Mythic", 89], ["Divine", 96], ["Ancient", 100],
];
const rawWeights = ALIEN_NAMES.map((_, index) => Math.exp(-index * 0.15));
const totalWeight = rawWeights.reduce((sum, weight) => sum + weight, 0);
const roundFinancial = (value: number) => Math.round(value * 10_000) / 10_000;
const getTier = (index: number) => TIER_BY_INDEX.find(([, maxIndex]) => index <= maxIndex)?.[0] ?? "Ancient";
const ALIENS = ALIEN_NAMES.map((name, index) => {
  const chance = rawWeights[index] / totalWeight;
  return Object.freeze({
    id: `alien_${String(index + 1).padStart(3, "0")}`,
    name,
    tier: getTier(index),
    icon: ALIEN_ICONS[index % ALIEN_ICONS.length],
    color: `hsl(${(index * 37 + 165) % 360} 85% 63%)`,
    rarity: chance,
    money_per_sec: roundFinancial(0.05 / chance),
  });
});
const ALIEN_BY_ID = new Map<string, (typeof ALIENS)[number]>(ALIENS.map((alien) => [alien.id, alien]));

const UPGRADE_CONFIG = {
  luck_boost: { label: "Luck Boost", description: "Tilts the roll table toward rarer aliens.", baseBonus: 0.10, unit: "luck" },
  rolling_speed: { label: "Rolling Speed", description: "Shortens the dice materialization animation.", baseBonus: 0.08, unit: "speed" },
  money_increase: { label: "Money Increase", description: "Raises earnings from every placed alien.", baseBonus: 0.10, unit: "yield" },
} as const;

type UpgradeKey = keyof typeof UPGRADE_CONFIG;
type User = typeof users.$inferSelect;

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      ...headers,
    },
  });
}

function parseCookies(header: string | null) {
  return Object.fromEntries((header ?? "").split(";").map((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return ["", ""];
    return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }).filter(([key]) => key));
}

function tokenHash(token: string) {
  return crypto.createHash("sha256").update(token).digest("base64url");
}

function sessionCookie(token: string, maxAge = Math.floor(SESSION_TTL_MS / 1000)) {
  const secure = process.env.CONTEXT !== "dev" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function passwordHash(password: string, salt = crypto.randomBytes(16).toString("base64url")) {
  const digest = crypto.scryptSync(password, salt, 64).toString("base64url");
  return `${salt}:${digest}`;
}

function passwordMatches(password: string, stored: string) {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  const expected = Buffer.from(digest, "base64url");
  const actual = crypto.scryptSync(password, salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function getAuthenticatedUser(request: Request) {
  const token = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
  if (!token) return null;
  const [result] = await db.select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return result?.user ?? null;
}

function getSlotCount(player: User) {
  return Math.max(1, player.placedAliens.length);
}

function upgradeCost(level: number) {
  return roundFinancial(100 * (1.5 ** level));
}

function nextUpgradeBonus(key: UpgradeKey, level: number) {
  return UPGRADE_CONFIG[key].baseBonus * (1.1 ** level);
}

function totalUpgradeBonus(key: UpgradeKey, level: number) {
  let total = 0;
  for (let index = 0; index < level; index += 1) total += nextUpgradeBonus(key, index);
  return total;
}

function effectiveAlienRate(player: User, alien: (typeof ALIENS)[number]) {
  const yieldBonus = totalUpgradeBonus("money_increase", player.shopPurchases.money_increase);
  return roundFinancial(alien.money_per_sec * (1 + yieldBonus));
}

function totalMoneyPerSecond(player: User) {
  return roundFinancial(player.placedAliens.reduce((sum, slot) => {
    const alien = slot && ALIEN_BY_ID.get(slot.alien_id);
    return sum + (alien ? effectiveAlienRate(player, alien) : 0);
  }, 0));
}

function rollAnimationDuration(player: User) {
  const speedBonus = totalUpgradeBonus("rolling_speed", player.shopPurchases.rolling_speed);
  return Math.max(500, Math.round(BASE_ROLL_ANIMATION_MS * (1 - Math.min(0.77, speedBonus))));
}

function applyPassiveIncome(player: User, now = Date.now()) {
  let generated = 0;
  for (const slot of player.placedAliens) {
    if (!slot || !ALIEN_BY_ID.has(slot.alien_id)) continue;
    const previous = Number(slot.last_collected);
    slot.last_collected = now;
    if (!Number.isFinite(previous) || previous > now) continue;
    generated += ((now - previous) / 1000) * effectiveAlienRate(player, ALIEN_BY_ID.get(slot.alien_id)!);
  }
  if (generated > 0) player.money = Math.min(MAX_MONEY, roundFinancial(player.money + generated));
}

function pickAlien(player: User) {
  const luck = totalUpgradeBonus("luck_boost", player.shopPurchases.luck_boost);
  const weights = ALIENS.map((_, index) => rawWeights[index] * (1 + luck * 2 * ((index / (ALIENS.length - 1)) ** 1.6)));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = crypto.randomInt(0, 1_000_000_000) / 1_000_000_000 * weightTotal;
  for (let index = 0; index < ALIENS.length; index += 1) {
    roll -= weights[index];
    if (roll <= 0 || index === ALIENS.length - 1) return { alien: ALIENS[index], chance: weights[index] / weightTotal };
  }
  return { alien: ALIENS[0], chance: weights[0] / weightTotal };
}

async function savePlayer(player: User) {
  player.updatedAt = new Date();
  await db.update(users).set({
    money: player.money,
    totalRolls: player.totalRolls,
    shopPurchases: player.shopPurchases,
    inventory: player.inventory,
    placedAliens: player.placedAliens,
    updatedAt: player.updatedAt,
  }).where(eq(users.id, player.id));
}

async function gameStateFor(player: User) {
  const slots = getSlotCount(player);
  const placedAliens = Array.from({ length: slots }, (_, index) => {
    const slot = player.placedAliens[index];
    const alien = slot && ALIEN_BY_ID.get(slot.alien_id);
    return alien ? { ...alien, money_per_sec: effectiveAlienRate(player, alien) } : null;
  });
  const upgrades = Object.fromEntries((Object.keys(UPGRADE_CONFIG) as UpgradeKey[]).map((key) => {
    const level = player.shopPurchases[key];
    return [key, { ...UPGRADE_CONFIG[key], level, cost: upgradeCost(level), nextBonus: nextUpgradeBonus(key, level), totalBonus: totalUpgradeBonus(key, level) }];
  }));
  const leaderboardUsers = await db.select({ id: users.id, name: users.name, money: users.money, totalRolls: users.totalRolls })
    .from(users)
    .orderBy(desc(users.money), desc(users.totalRolls), users.name);
  const activeRank = leaderboardUsers.findIndex((row) => row.id === player.id) + 1;
  const leaderboardRows = leaderboardUsers.slice(0, 10).map((row, index) => ({ name: row.name, money: roundFinancial(row.money), total_rolls: row.totalRolls, rank: index + 1 }));
  const active = leaderboardUsers[activeRank - 1];
  if (activeRank > 10 && active) leaderboardRows.push({ name: active.name, money: roundFinancial(active.money), total_rolls: active.totalRolls, rank: activeRank });
  return {
    player: {
      name: player.name,
      money: roundFinancial(player.money),
      total_rolls: player.totalRolls,
      inventory: player.inventory,
      placed_aliens: placedAliens,
      slots,
      nextSlotCost: 500 * (2 ** slots),
      moneyPerSecond: totalMoneyPerSecond(player),
      rollAnimationMs: rollAnimationDuration(player),
      upgrades,
    },
    catalog: ALIENS,
    leaderboard: { rows: leaderboardRows, activeRank },
  };
}

async function parseBody(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) return {};
  return request.json() as Promise<Record<string, unknown>>;
}

async function login(request: Request) {
  const body = await parseBody(request);
  const username = typeof body.username === "string" ? body.username.trim().replace(/\s+/g, " ") : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (username.length < 3 || username.length > 24 || /[\x00-\x1f]/.test(username)) return json({ error: "Username must be 3–24 printable characters." }, 400);
  if (password.length < 4 || password.length > 128) return json({ error: "Password must be 4–128 characters." }, 400);
  const usernameKey = username.toLocaleLowerCase();
  let [player] = await db.select().from(users).where(eq(users.usernameKey, usernameKey)).limit(1);
  let created = false;
  if (player) {
    if (!passwordMatches(password, player.password)) return json({ error: "Incorrect username or password." }, 401);
    applyPassiveIncome(player);
    await savePlayer(player);
  } else {
    created = true;
    [player] = await db.insert(users).values({
      name: username,
      usernameKey,
      password: passwordHash(password),
      money: 50,
      totalRolls: 0,
      shopPurchases: { luck_boost: 0, rolling_speed: 0, money_increase: 0 },
      inventory: {},
      placedAliens: [],
    }).returning();
  }
  const token = crypto.randomBytes(32).toString("base64url");
  await db.insert(sessions).values({ tokenHash: tokenHash(token), userId: player.id, expiresAt: new Date(Date.now() + SESSION_TTL_MS) });
  return json({ ...await gameStateFor(player), created }, created ? 201 : 200, { "Set-Cookie": sessionCookie(token) });
}

async function mutatePlayer(request: Request, action: (player: User, body: Record<string, unknown>) => string | null | { rolled: unknown }) {
  const player = await getAuthenticatedUser(request);
  if (!player) return json({ error: "Your session has expired. Please sign in again." }, 401);
  const body = await parseBody(request);
  applyPassiveIncome(player);
  const result = action(player, body);
  if (typeof result === "string") {
    await savePlayer(player);
    return json({ error: result, state: await gameStateFor(player) }, 400);
  }
  await savePlayer(player);
  return json({ ...(result ?? {}), state: await gameStateFor(player) });
}

async function route(request: Request) {
  if (!requireSameOrigin(request)) return json({ error: "Cross-site requests are not allowed." }, 403);
  const routeName = new URL(request.url).pathname.split("/").filter(Boolean).at(-1) ?? "";
  if (routeName === "login" && request.method === "POST") return login(request);
  if (routeName === "game-state" && request.method === "GET") {
    const player = await getAuthenticatedUser(request);
    if (!player) return json({ error: "Your session has expired. Please sign in again." }, 401);
    applyPassiveIncome(player);
    await savePlayer(player);
    return json(await gameStateFor(player));
  }
  if (routeName === "roll" && request.method === "POST") return mutatePlayer(request, (player) => {
    const result = pickAlien(player);
    player.inventory[result.alien.id] = (Number(player.inventory[result.alien.id]) || 0) + 1;
    player.totalRolls += 1;
    return { rolled: { ...result.alien, rarity: result.chance } };
  });
  if (routeName === "buy-shop" && request.method === "POST") return mutatePlayer(request, (player, body) => {
    const upgrade = body.upgrade;
    if (typeof upgrade !== "string" || !(upgrade in UPGRADE_CONFIG)) return "Unknown shop upgrade.";
    const key = upgrade as UpgradeKey;
    const level = player.shopPurchases[key];
    const cost = upgradeCost(level);
    if (player.money + 0.00001 < cost) return "Not enough credits for that upgrade.";
    player.money = roundFinancial(player.money - cost);
    player.shopPurchases[key] += 1;
    return null;
  });
  if (routeName === "buy-slot" && request.method === "POST") return mutatePlayer(request, (player) => {
    const slots = getSlotCount(player);
    const cost = 500 * (2 ** slots);
    if (!Number.isSafeInteger(cost) || player.money + 0.00001 < cost) return "Not enough credits for a new container.";
    player.money = roundFinancial(player.money - cost);
    if (player.placedAliens.length === 0) player.placedAliens.push(null, null);
    else player.placedAliens.push(null);
    return null;
  });
  if (routeName === "remove-alien" && request.method === "POST") return mutatePlayer(request, (player, body) => {
    const slotIndex = body.slotIndex;
    if (!Number.isInteger(slotIndex) || Number(slotIndex) < 0 || Number(slotIndex) > 1000) return "Invalid container selection.";
    const slot = player.placedAliens[Number(slotIndex)];
    if (!slot || !ALIEN_BY_ID.has(slot.alien_id)) return "That container is already empty.";
    const quantity = Number(player.inventory[slot.alien_id]) || 0;
    if (!Number.isSafeInteger(quantity) || quantity >= Number.MAX_SAFE_INTEGER - 1) return "Inventory stack is at its safe maximum.";
    player.inventory[slot.alien_id] = quantity + 1;
    player.placedAliens[Number(slotIndex)] = null;
    return null;
  });
  if (routeName === "place-alien" && request.method === "POST") return mutatePlayer(request, (player, body) => {
    const alienId = body.alienId;
    const slotIndex = body.slotIndex;
    if (typeof alienId !== "string" || !ALIEN_BY_ID.has(alienId) || !Number.isInteger(slotIndex) || Number(slotIndex) < 0 || Number(slotIndex) > 1000) return "Invalid alien placement request.";
    const index = Number(slotIndex);
    if (index >= getSlotCount(player)) return "That container is not unlocked.";
    if ((Number(player.inventory[alienId]) || 0) < 1) return "That alien is not in your inventory.";
    if (player.placedAliens[index]) return "Choose an empty container.";
    player.inventory[alienId] -= 1;
    if (player.inventory[alienId] === 0) delete player.inventory[alienId];
    const placement: PlacedAlien = { alien_id: alienId, last_collected: Date.now() };
    if (player.placedAliens.length === 0) player.placedAliens.push(placement);
    else player.placedAliens[index] = placement;
    return null;
  });
  if (routeName === "logout" && request.method === "POST") {
    const token = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
    if (token) await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash(token)));
    return new Response(null, { status: 204, headers: { "Set-Cookie": sessionCookie("", 0), "Cache-Control": "no-store" } });
  }
  return json({ error: "API route not found." }, 404);
}

export default async (request: Request) => {
  try {
    return await route(request);
  } catch (error) {
    console.error("API request failed", error);
    return json({ error: "The game server encountered an unexpected error." }, 500);
  }
};
