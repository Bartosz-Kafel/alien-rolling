"use strict";

/* AFK Alien Dice server
 * All permanent economy changes pass through one short mutation queue and a
 * PostgreSQL transaction. The browser only asks for actions; it never submits
 * balances, probabilities, costs, rewards, luck values, or equipment states.
 */
const crypto = require("crypto");
const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const { ALIENS, ALIEN_BY_ID, CATALOG_SIZE, REGISTRY_VERSION } = require("./aliens");
const balance = require("./balance");

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false });
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const SESSION_COOKIE = "afk_session";
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_OFFLINE_SECONDS = 12 * 60 * 60;
const MAX_INVENTORY_STACK = Number.MAX_SAFE_INTEGER - 1;
const MAX_MONEY = 1e96;
const TEAM_SLOT_COUNT = 3;
const RATE_LIMITS = { login: [10, 60_000], roll: [90, 60_000], buy: [30, 60_000], inventory: [50, 60_000], trade: [40, 60_000] };

const state = { users: {}, sessions: new Map(), tradeRooms: new Map(), queue: [], busy: false, requests: new Map(), distributionCache: new Map() };

function number(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function integer(value, fallback = 0) { const n = Number(value); return Number.isSafeInteger(n) ? n : fallback; }
function bounded(value, low, high) { return Math.min(high, Math.max(low, value)); }
function mutationId(value) { return typeof value === "string" && /^[a-zA-Z0-9_-]{12,100}$/.test(value) ? value : null; }
function stackKey(alienId, plusLevel = 0) { return `${alienId}|${plusLevel}`; }
function parseStackKey(key) {
  const [alienId, rawPlus] = String(key).split("|");
  const plusLevel = integer(rawPlus, 0);
  return ALIEN_BY_ID.has(alienId) && plusLevel >= 0 && plusLevel <= 3 ? { alienId, plusLevel } : null;
}
function hashToken(token) { return crypto.createHash("sha256").update(token).digest("base64url"); }
function onceId() { return crypto.randomUUID().replaceAll("-", ""); }
function publicAlien(alien) {
  if (!alien) return null;
  return { id: alien.id, name: alien.name, emoji: alien.emoji, rarity: alien.rarity, color: alien.color, baseChance: alien.baseChance, baseChanceLog: alien.baseChanceLog, baseIncome: alien.baseIncome };
}
function publicStack(alienId, plusLevel, count, coinLevel = 0) {
  const alien = ALIEN_BY_ID.get(alienId);
  if (!alien) return null;
  return { ...publicAlien(alien), plusLevel, stackKey: stackKey(alienId, plusLevel), count, income: balance.incomeFor(alien, plusLevel, coinLevel), power: balance.alienPower(alien, plusLevel), sacrificeLuck: balance.sacrificeLuck(alien, plusLevel) };
}

function normalizeInventory(input) {
  const inventory = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return inventory;
  for (const [rawKey, rawCount] of Object.entries(input)) {
    // Old saves used an alien ID directly; preserve it as a base stack.
    const parsed = parseStackKey(rawKey) || (ALIEN_BY_ID.has(rawKey) ? { alienId: rawKey, plusLevel: 0 } : null);
    const count = integer(rawCount);
    if (!parsed || count < 1 || count > MAX_INVENTORY_STACK) continue;
    inventory[stackKey(parsed.alienId, parsed.plusLevel)] = count;
  }
  return inventory;
}
function normalizePlaced(input, now) {
  const source = Array.isArray(input) ? input : [];
  const normalized = source.slice(0, 12).map((slot) => {
    const id = slot?.alien_id || slot?.alienId;
    const plusLevel = bounded(integer(slot?.plus_level ?? slot?.plusLevel, 0), 0, 3);
    return ALIEN_BY_ID.has(id) ? { alienId: id, plusLevel, lastCollected: bounded(number(slot?.last_collected ?? slot?.lastCollected, now), 0, now) } : null;
  });
  while (normalized.length < TEAM_SLOT_COUNT) normalized.push(null);
  return normalized;
}
function normalizeDiscovered(input, inventory, placed) {
  const found = {};
  const source = Array.isArray(input) ? input : input && typeof input === "object" ? Object.keys(input) : [];
  for (const id of source) if (ALIEN_BY_ID.has(id)) found[id] = true;
  for (const key of Object.keys(inventory)) { const parsed = parseStackKey(key); if (parsed) found[parsed.alienId] = true; }
  for (const slot of placed) if (slot) found[slot.alienId] = true;
  return found;
}
function normalizeSettings(input) {
  return { rollingAnimation: input?.rollingAnimation !== false, fullDiscovery: input?.fullDiscovery !== false };
}
function normalizePlayer(source, now = Date.now()) {
  if (!source || typeof source.name !== "string" || typeof source.password !== "string") return null;
  const inventory = normalizeInventory(source.inventory);
  const placedAliens = normalizePlaced(source.placed_aliens ?? source.placedAliens, now);
  const discoveredAlienIds = normalizeDiscovered(source.discovered_aliens ?? source.discoveredAlienIds, inventory, placedAliens);
  const upgrades = source.upgrades || source.shop_purchases || {};
  const stats = source.stats || {};
  return {
    name: source.name.trim().replace(/\s+/g, " "), password: source.password,
    money: bounded(balance.roundGame(number(source.money)), 0, MAX_MONEY), totalRolls: Math.max(0, integer(source.total_rolls ?? source.totalRolls)),
    upgrades: { luck: Math.max(0, integer(upgrades.luck ?? upgrades.luck_boost)), speed: Math.max(0, integer(upgrades.speed ?? upgrades.rolling_speed)), coin: Math.max(0, integer(upgrades.coin ?? upgrades.money_increase)) },
    diceCount: bounded(integer(source.dice_count ?? source.diceCount, 1), 1, balance.MAX_DICE),
    pendingLuck: bounded(number(source.pending_luck ?? source.pendingLuck ?? source.temporary_luck), 0, 1e12),
    inventory, placedAliens, discoveredAlienIds,
    avatarAlienId: ALIEN_BY_ID.has(source.avatar_alien_id ?? source.avatarAlienId) ? (source.avatar_alien_id ?? source.avatarAlienId) : Object.keys(discoveredAlienIds)[0] || null,
    autoRollActive: Boolean(source.auto_roll_active ?? source.autoRollActive), autoRollTouchedAt: number(source.auto_roll_touched_at ?? source.autoRollTouchedAt), lastRollAt: number(source.last_roll_at ?? source.lastRollAt), lastSeenAt: bounded(number(source.last_seen_at ?? source.lastSeenAt, now), 0, now),
    settings: normalizeSettings(source.game_settings ?? source.settings), activeSessionId: typeof (source.active_session_id ?? source.activeSessionId) === "string" ? (source.active_session_id ?? source.activeSessionId) : null,
    mutationVersion: Math.max(0, integer(source.mutation_version ?? source.mutationVersion)), lastMutationId: typeof (source.last_mutation_id ?? source.lastMutationId) === "string" ? (source.last_mutation_id ?? source.lastMutationId) : null,
    lastMutationResponse: source.last_mutation_response ?? source.lastMutationResponse ?? null,
    stats: { createdAt: bounded(number(stats.created_at ?? stats.createdAt, now), 0, now), playtimeSeconds: Math.max(0, number(stats.playtime_seconds ?? stats.playtimeSeconds)), totalMoneyEarned: Math.max(0, balance.roundGame(number(stats.total_money_earned ?? stats.totalMoneyEarned))) }
  };
}
function newPlayer(name, password) {
  const now = Date.now();
  return normalizePlayer({ name, password, money: 650, upgrades: {}, diceCount: 1, inventory: {}, placedAliens: Array(TEAM_SLOT_COUNT).fill(null), discoveredAlienIds: {}, pendingLuck: 0, autoRollActive: false, lastSeenAt: now, settings: {}, stats: { createdAt: now } }, now);
}
function writePlayer(client, id, player) {
  return client.query(`INSERT INTO users (id, name, password, money, total_rolls, shop_purchases, inventory, placed_aliens, discovered_aliens, avatar_alien_id, next_roll_luck_multiplier, auto_roll_active, auto_roll_touched_at, last_roll_at, last_seen_at, stats, pending_luck, dice_count, game_settings, active_session_id, mutation_version, last_mutation_id, last_mutation_response)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,1,$11,$12,$13,$14,$15::jsonb,$16,$17,$18::jsonb,$19,$20,$21,$22::jsonb)
    ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,password=EXCLUDED.password,money=EXCLUDED.money,total_rolls=EXCLUDED.total_rolls,shop_purchases=EXCLUDED.shop_purchases,inventory=EXCLUDED.inventory,placed_aliens=EXCLUDED.placed_aliens,discovered_aliens=EXCLUDED.discovered_aliens,avatar_alien_id=EXCLUDED.avatar_alien_id,auto_roll_active=EXCLUDED.auto_roll_active,auto_roll_touched_at=EXCLUDED.auto_roll_touched_at,last_roll_at=EXCLUDED.last_roll_at,last_seen_at=EXCLUDED.last_seen_at,stats=EXCLUDED.stats,pending_luck=EXCLUDED.pending_luck,dice_count=EXCLUDED.dice_count,game_settings=EXCLUDED.game_settings,active_session_id=EXCLUDED.active_session_id,mutation_version=EXCLUDED.mutation_version,last_mutation_id=EXCLUDED.last_mutation_id,last_mutation_response=EXCLUDED.last_mutation_response`,
  [id, player.name, player.password, player.money, player.totalRolls, JSON.stringify(player.upgrades), JSON.stringify(player.inventory), JSON.stringify(player.placedAliens), JSON.stringify(player.discoveredAlienIds), player.avatarAlienId, player.autoRollActive, player.autoRollTouchedAt, player.lastRollAt, player.lastSeenAt, JSON.stringify({ created_at: player.stats.createdAt, playtime_seconds: player.stats.playtimeSeconds, total_money_earned: player.stats.totalMoneyEarned }), player.pendingLuck, player.diceCount, JSON.stringify(player.settings), player.activeSessionId, player.mutationVersion, player.lastMutationId, JSON.stringify(player.lastMutationResponse)]);
}
async function persistPlayers(ids, deleteTradeRoomId = null) {
  const unique = [...new Set(ids)].filter((id) => state.users[id]);
  if (!unique.length) return;
  const client = await pool.connect();
  try { await client.query("BEGIN"); for (const id of unique) await writePlayer(client, id, state.users[id]); if (deleteTradeRoomId) await client.query("DELETE FROM trade_rooms WHERE id=$1", [deleteTradeRoomId]); await client.query("COMMIT"); }
  catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
async function persistTradeRoom(room) {
  await pool.query(`INSERT INTO trade_rooms (id,inviter_id,members,status,offers,confirmed,expires_at) VALUES ($1,$2,$3::jsonb,$4,$5::jsonb,$6::jsonb,$7)
    ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,offers=EXCLUDED.offers,confirmed=EXCLUDED.confirmed,expires_at=EXCLUDED.expires_at`, [room.id, room.inviterId, JSON.stringify(room.members), room.status, JSON.stringify(room.offers), JSON.stringify(room.confirmed), room.expiresAt]);
}
async function removeTradeRoom(id) { await pool.query("DELETE FROM trade_rooms WHERE id=$1", [id]); }
async function initializeDatabase() {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, password TEXT NOT NULL, money NUMERIC NOT NULL, total_rolls BIGINT NOT NULL, shop_purchases JSONB NOT NULL, inventory JSONB NOT NULL, placed_aliens JSONB NOT NULL, discovered_aliens JSONB NOT NULL DEFAULT '{}'::jsonb, avatar_alien_id TEXT, next_roll_luck_multiplier NUMERIC NOT NULL DEFAULT 1, auto_roll_active BOOLEAN NOT NULL DEFAULT FALSE, auto_roll_touched_at NUMERIC NOT NULL DEFAULT 0, last_roll_at NUMERIC NOT NULL DEFAULT 0, last_seen_at NUMERIC NOT NULL DEFAULT 0, stats JSONB NOT NULL DEFAULT '{}'::jsonb)`);
  for (const column of ["pending_luck NUMERIC NOT NULL DEFAULT 0", "dice_count INTEGER NOT NULL DEFAULT 1", "game_settings JSONB NOT NULL DEFAULT '{\"rollingAnimation\":true,\"fullDiscovery\":true}'::jsonb", "active_session_id TEXT", "mutation_version BIGINT NOT NULL DEFAULT 0", "last_mutation_id TEXT", "last_mutation_response JSONB"]) await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${column}`);
  await pool.query(`CREATE TABLE IF NOT EXISTS game_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, csrf_token TEXT NOT NULL, expires_at BIGINT NOT NULL, created_at BIGINT NOT NULL)`);
  await pool.query("CREATE INDEX IF NOT EXISTS game_sessions_user_id_idx ON game_sessions(user_id)");
  await pool.query(`CREATE TABLE IF NOT EXISTS trade_rooms (id TEXT PRIMARY KEY, inviter_id TEXT NOT NULL, members JSONB NOT NULL, status TEXT NOT NULL, offers JSONB NOT NULL DEFAULT '{}'::jsonb, confirmed JSONB NOT NULL DEFAULT '[]'::jsonb, expires_at BIGINT NOT NULL)`);
  const result = await pool.query("SELECT * FROM users");
  state.users = {};
  for (const row of result.rows) { const player = normalizePlayer(row); if (player) state.users[row.id] = player; }
  await pool.query("DELETE FROM game_sessions WHERE expires_at < $1", [Date.now()]);
  await pool.query("DELETE FROM trade_rooms WHERE expires_at < $1 OR status='completed'", [Date.now()]);
  const rooms = await pool.query("SELECT * FROM trade_rooms WHERE expires_at >= $1 AND status IN ('invited','accepted')", [Date.now()]);
  for (const row of rooms.rows) {
    const members = Array.isArray(row.members) ? row.members : [];
    if (members.length === 2 && members.every((id) => state.users[id])) state.tradeRooms.set(row.id, { id: row.id, inviterId: row.inviter_id, members, status: row.status, offers: row.offers || {}, confirmed: Array.isArray(row.confirmed) ? row.confirmed : [], expiresAt: number(row.expires_at) });
  }
  console.log(`Game database ready: ${Object.keys(state.users).length} player(s), ${CATALOG_SIZE.toLocaleString()} catalog entries.`);
}

function withLock(work) { return new Promise((resolve, reject) => { state.queue.push({ work, resolve, reject }); drainLock(); }); }
async function drainLock() { if (state.busy || !state.queue.length) return; state.busy = true; const job = state.queue.shift(); try { job.resolve(await job.work()); } catch (error) { job.reject(error); } finally { state.busy = false; queueMicrotask(drainLock); } }
function passwordHash(password, salt = crypto.randomBytes(16).toString("base64url")) { return `${salt}:${crypto.scryptSync(password, salt, 64).toString("base64url")}`; }
function passwordMatches(password, stored) { const [salt, digest] = String(stored).split(":"); if (!salt || !digest) return false; const a = crypto.scryptSync(password, salt, 64); const b = Buffer.from(digest, "base64url"); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function parseCookies(header = "") { return Object.fromEntries(header.split(";").map((part) => { const index = part.indexOf("="); return index < 0 ? [] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())]; }).filter(Boolean)); }
function setCookie(response, token) { response.cookie(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", maxAge: SESSION_TTL_MS, path: "/" }); }
function clearCookie(response) { response.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/" }); }
async function issueSession(userId) {
  const player = state.users[userId]; const token = crypto.randomBytes(32).toString("base64url"); const session = { id: crypto.randomUUID(), userId, tokenHash: hashToken(token), csrfToken: crypto.randomBytes(24).toString("base64url"), expiresAt: Date.now() + SESSION_TTL_MS };
  const client = await pool.connect();
  try { await client.query("BEGIN"); player.activeSessionId = session.id; await writePlayer(client, userId, player); await client.query("DELETE FROM game_sessions WHERE user_id=$1", [userId]); await client.query("INSERT INTO game_sessions (id,user_id,token_hash,csrf_token,expires_at,created_at) VALUES ($1,$2,$3,$4,$5,$6)", [session.id, userId, session.tokenHash, session.csrfToken, session.expiresAt, Date.now()]); await client.query("COMMIT"); }
  catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  for (const [oldToken, old] of state.sessions) if (old.userId === userId) state.sessions.delete(oldToken);
  state.sessions.set(token, session); return { token, session };
}
async function requireSession(request, response, next) {
  try {
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE]; if (!token) return response.status(401).json({ error: "Your session has expired. Please sign in again." });
    let session = state.sessions.get(token);
    if (!session) {
      const result = await pool.query("SELECT id,user_id,token_hash,csrf_token,expires_at FROM game_sessions WHERE token_hash=$1", [hashToken(token)]);
      const row = result.rows[0]; if (row && number(row.expires_at) > Date.now()) { session = { id: row.id, userId: row.user_id, tokenHash: row.token_hash, csrfToken: row.csrf_token, expiresAt: number(row.expires_at) }; state.sessions.set(token, session); }
    }
    const player = session && state.users[session.userId];
    if (!session || !player || session.expiresAt < Date.now() || player.activeSessionId !== session.id) { state.sessions.delete(token); return response.status(401).json({ error: "Your session has expired. Please sign in again." }); }
    request.userId = session.userId; request.sessionToken = token; request.session = session; return next();
  } catch (error) { return next(error); }
}
function requireSameOrigin(request, response, next) { const origin = request.get("origin"); if (!origin) return next(); try { if (new URL(origin).host !== request.get("host")) return response.status(403).json({ error: "Cross-site requests are not allowed." }); } catch { return response.status(403).json({ error: "Invalid request origin." }); } return next(); }
function requireJson(request, response, next) { return request.is("application/json") ? next() : response.status(415).json({ error: "Requests must use application/json." }); }
function requireCsrf(request, response, next) { const supplied = request.get("x-csrf-token"); const expected = request.session?.csrfToken; if (!supplied || !expected) return response.status(403).json({ error: "Security token is missing. Refresh and try again." }); const a = Buffer.from(supplied); const b = Buffer.from(expected); return a.length === b.length && crypto.timingSafeEqual(a, b) ? next() : response.status(403).json({ error: "Security token is invalid. Refresh and try again." }); }
function withinRate(bucket, userId) { const [maximum, windowMs] = RATE_LIMITS[bucket] || [30, 60_000]; const key = `${bucket}:${userId}`; const now = Date.now(); const list = (state.requests.get(key) || []).filter((stamp) => stamp > now - windowMs); if (list.length >= maximum) return false; list.push(now); state.requests.set(key, list); return true; }
function rate(bucket) { return (request, response, next) => withinRate(bucket, request.userId) ? next() : response.status(429).json({ error: "Too many requests. Wait a moment and try again." }); }

function activeAutoRoll(player, now = Date.now()) { if (!player.autoRollActive) return false; if (now - player.autoRollTouchedAt < 65_000) return true; player.autoRollActive = false; return false; }
function permanentLuck(player) { return balance.luckMultiplier(player.upgrades.luck); }
function effectiveLuck(player) { return balance.roundGame(permanentLuck(player) * (1 + player.pendingLuck)); }
function totalIncome(player, now = Date.now()) { const income = player.placedAliens.reduce((sum, slot) => sum + (slot ? balance.incomeFor(ALIEN_BY_ID.get(slot.alienId), slot.plusLevel, player.upgrades.coin) : 0), 0); return balance.roundGame(income * (activeAutoRoll(player, now) ? balance.AUTO_ROLL_INCOME_MULTIPLIER : 1)); }
function applyIncome(player, now = Date.now()) { const seconds = bounded((now - player.lastSeenAt) / 1000, 0, MAX_OFFLINE_SECONDS); player.lastSeenAt = now; if (!seconds) return 0; const earned = Math.min(MAX_MONEY - player.money, totalIncome(player, now) * seconds); player.money = balance.roundGame(player.money + earned); player.stats.totalMoneyEarned = balance.roundGame(player.stats.totalMoneyEarned + earned); player.stats.playtimeSeconds = balance.roundGame(player.stats.playtimeSeconds + Math.min(seconds, 90)); return earned; }
function addStack(player, alienId, plusLevel = 0, amount = 1) { const key = stackKey(alienId, plusLevel); const before = integer(player.inventory[key]); if (!ALIEN_BY_ID.has(alienId) || before < 0 || amount < 1 || before > MAX_INVENTORY_STACK - amount) return false; player.inventory[key] = before + amount; return true; }
function removeStack(player, alienId, plusLevel, amount) { const key = stackKey(alienId, plusLevel); const before = integer(player.inventory[key]); if (before < amount || amount < 1) return false; if (before === amount) delete player.inventory[key]; else player.inventory[key] = before - amount; return true; }
function inventoryStacks(player) { return Object.entries(player.inventory).map(([key, count]) => { const parsed = parseStackKey(key); return parsed && publicStack(parsed.alienId, parsed.plusLevel, count, player.upgrades.coin); }).filter(Boolean).sort(compareStacks); }
function topAlien(player) { return Object.keys(player.discoveredAlienIds).map((id) => ALIEN_BY_ID.get(id)).filter(Boolean).sort((a, b) => b.baseChanceLog - a.baseChanceLog)[0] || null; }
function statsFor(player) { const rarest = topAlien(player); return { rolls: player.totalRolls, bestRarity: rarest?.rarity || "—", rarestAlien: publicAlien(rarest), coinsEarned: player.stats.totalMoneyEarned, currentLuck: effectiveLuck(player), permanentLuck: permanentLuck(player), collection: Object.keys(player.discoveredAlienIds).length, collectionTotal: CATALOG_SIZE, playtimeSeconds: player.stats.playtimeSeconds }; }
function gameStateFor(userId) { const player = state.users[userId]; const now = Date.now(); const upgrades = Object.fromEntries(Object.keys(balance.UPGRADE_DEFINITIONS).map((key) => [key, balance.upgradeSnapshot(key, player.upgrades[key]) ])); return { catalogVersion: REGISTRY_VERSION, player: { name: player.name, money: player.money, totalRolls: player.totalRolls, diceCount: player.diceCount, teamSlots: player.placedAliens.length, placedAliens: player.placedAliens.map((slot) => slot && publicStack(slot.alienId, slot.plusLevel, 1, player.upgrades.coin)), incomePerSecond: totalIncome(player, now), autoRollActive: activeAutoRoll(player, now), rollAnimationMs: balance.rollAnimationDuration(player.upgrades.speed), pendingLuck: player.pendingLuck, currentLuck: effectiveLuck(player), permanentLuck: permanentLuck(player), settings: player.settings, upgrades, diceCost: balance.diceCost(player.diceCount), stats: statsFor(player) } }; }
function recordMutation(player, id, payload) { if (!id) return; player.lastMutationId = id; player.lastMutationResponse = payload; player.mutationVersion += 1; }
async function mutate(userId, id, work) { return withLock(async () => { const player = state.users[userId]; if (!player) throw new Error("Player record disappeared."); if (id && player.lastMutationId === id && player.lastMutationResponse) return player.lastMutationResponse; applyIncome(player); const payload = await work(player); recordMutation(player, id, payload); await persistPlayers([userId]); return payload; }); }

function distributionFor(luck) {
  const exponent = balance.luckExponent(luck); const key = exponent.toFixed(6); const existing = state.distributionCache.get(key); if (existing) return existing;
  const prefix = new Float64Array(ALIENS.length); let total = 0;
  for (let i = 0; i < ALIENS.length; i += 1) { total += 10 ** (-ALIENS[i].baseChanceLog * exponent); prefix[i] = total; }
  const distribution = { prefix, total, exponent }; if (state.distributionCache.size > 120) state.distributionCache.delete(state.distributionCache.keys().next().value); state.distributionCache.set(key, distribution); return distribution;
}
function pickAlien(luck) { const distribution = distributionFor(luck); const target = crypto.randomInt(1_000_000_000) / 1_000_000_000 * distribution.total; let low = 0; let high = ALIENS.length - 1; while (low < high) { const mid = (low + high) >> 1; if (target < distribution.prefix[mid]) high = mid; else low = mid + 1; } return ALIENS[low]; }
function compareStacks(left, right) { return right.power - left.power || right.plusLevel - left.plusLevel || right.baseChanceLog - left.baseChanceLog || left.id.localeCompare(right.id); }

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb", strict: true }));
app.use((request, response, next) => { response.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "Permissions-Policy": "camera=(), microphone=(), geolocation=()", "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'self'; frame-ancestors 'none'" }); next(); });

app.post("/api/login", requireSameOrigin, requireJson, async (request, response, next) => {
  try {
    if (!withinRate("login", request.ip)) return response.status(429).json({ error: "Too many login attempts. Wait a moment and try again." });
    const username = typeof request.body?.username === "string" ? request.body.username.trim().replace(/\s+/g, " ") : ""; const password = typeof request.body?.password === "string" ? request.body.password : "";
    if (username.length < 3 || username.length > 24 || /[\x00-\x1f]/.test(username) || password.length < 4 || password.length > 128) return response.status(400).json({ error: "Use a 3–24 character pilot name and a 4–128 character passcode." });
    const login = await withLock(async () => { const found = Object.entries(state.users).find(([, player]) => player.name.toLocaleLowerCase() === username.toLocaleLowerCase()); let userId; let created = false; if (found) { [userId] = found; if (!passwordMatches(password, state.users[userId].password)) return { error: "Incorrect pilot name or passcode.", status: 401 }; applyIncome(state.users[userId]); } else { userId = crypto.randomUUID(); state.users[userId] = newPlayer(username, passwordHash(password)); created = true; } const issued = await issueSession(userId); return { userId, created, issued }; });
    if (login.error) return response.status(login.status).json({ error: login.error }); setCookie(response, login.issued.token); return response.status(login.created ? 201 : 200).json({ ...gameStateFor(login.userId), csrfToken: login.issued.session.csrfToken, created: login.created });
  } catch (error) { return next(error); }
});
app.get("/api/game-state", requireSession, async (request, response, next) => { try { const payload = await withLock(async () => { applyIncome(state.users[request.userId]); await persistPlayers([request.userId]); return gameStateFor(request.userId); }); response.json({ ...payload, csrfToken: request.session.csrfToken }); } catch (error) { next(error); } });
app.get("/api/catalog", requireSession, (request, response) => { const offset = bounded(integer(request.query.offset), 0, CATALOG_SIZE); const limit = bounded(integer(request.query.limit, 80), 1, 120); const search = String(request.query.search || "").trim().toLowerCase(); const rarity = String(request.query.rarity || ""); const found = new Set(Object.keys(state.users[request.userId].discoveredAlienIds)); const filtered = ALIENS.filter((alien) => (!search || alien.name.toLowerCase().includes(search)) && (!rarity || alien.rarity === rarity)); const entries = filtered.slice(offset, offset + limit).map((alien) => ({ ...publicAlien(alien), discovered: found.has(alien.id) })); response.json({ entries, offset, nextOffset: offset + entries.length < filtered.length ? offset + entries.length : null, total: filtered.length, catalogTotal: CATALOG_SIZE }); });
app.get("/api/inventory", requireSession, (request, response) => { const offset = bounded(integer(request.query.offset), 0, Number.MAX_SAFE_INTEGER); const limit = bounded(integer(request.query.limit, 60), 1, 100); const search = String(request.query.search || "").trim().toLowerCase(); const rarity = String(request.query.rarity || ""); const all = inventoryStacks(state.users[request.userId]).filter((entry) => (!search || entry.name.toLowerCase().includes(search)) && (!rarity || entry.rarity === rarity)); const entries = all.slice(offset, offset + limit); response.json({ entries, offset, nextOffset: offset + entries.length < all.length ? offset + entries.length : null, totalStacks: all.length, totalCopies: all.reduce((sum, entry) => sum + entry.count, 0) }); });

app.post("/api/roll", requireSession, requireSameOrigin, requireJson, requireCsrf, rate("roll"), async (request, response, next) => {
  try { const result = await mutate(request.userId, mutationId(request.body?.mutationId), (player) => { const now = Date.now(); const cooldown = Math.max(720, Math.round(balance.rollAnimationDuration(player.upgrades.speed) * 0.36)); if (now - player.lastRollAt < cooldown) return { ok: false, error: "Roll drive is still stabilizing.", state: gameStateFor(request.userId) }; const luck = effectiveLuck(player); const results = []; const discoveries = []; for (let die = 0; die < player.diceCount; die += 1) { const alien = pickAlien(luck); if (!addStack(player, alien.id, 0)) throw new Error("Inventory stack reached its safe maximum."); const isNew = !player.discoveredAlienIds[alien.id]; player.discoveredAlienIds[alien.id] = true; if (isNew) discoveries.push(publicAlien(alien)); results.push(publicAlien(alien)); } player.lastRollAt = now; if (player.autoRollActive) player.autoRollTouchedAt = now; player.totalRolls += player.diceCount; player.pendingLuck = 0; if (!player.avatarAlienId) player.avatarAlienId = results[0].id; const featured = [...results].sort((a, b) => b.baseChanceLog - a.baseChanceLog)[0]; const discovery = [...discoveries].sort((a, b) => b.baseChanceLog - a.baseChanceLog)[0] || null; return { ok: true, featured, results, discovery, newDiscoveries: discoveries, usedLuck: luck, state: gameStateFor(request.userId) }; }); return response.status(result.ok ? 200 : 429).json(result); } catch (error) { return next(error); }
});
app.post("/api/buy-upgrade", requireSession, requireSameOrigin, requireJson, requireCsrf, rate("buy"), async (request, response, next) => { try { const key = request.body?.upgrade; if (!balance.UPGRADE_DEFINITIONS[key]) return response.status(400).json({ error: "Unknown upgrade." }); const result = await mutate(request.userId, mutationId(request.body?.mutationId), (player) => { const cost = balance.upgradeCost(key, player.upgrades[key]); if (player.money < cost) return { ok: false, error: "Not enough coins for that upgrade.", state: gameStateFor(request.userId) }; player.money = balance.roundGame(player.money - cost); player.upgrades[key] += 1; return { ok: true, state: gameStateFor(request.userId) }; }); response.status(result.ok ? 200 : 400).json(result); } catch (error) { next(error); } });
app.post("/api/buy-dice", requireSession, requireSameOrigin, requireJson, requireCsrf, rate("buy"), async (request, response, next) => { try { const result = await mutate(request.userId, mutationId(request.body?.mutationId), (player) => { const cost = balance.diceCost(player.diceCount); if (!Number.isFinite(cost)) return { ok: false, error: "Your dice array is at its safe limit.", state: gameStateFor(request.userId) }; if (player.money < cost) return { ok: false, error: "Save more coins for this major milestone.", state: gameStateFor(request.userId) }; player.money = balance.roundGame(player.money - cost); player.diceCount += 1; return { ok: true, state: gameStateFor(request.userId) }; }); response.status(result.ok ? 200 : 400).json(result); } catch (error) { next(error); } });
app.post("/api/sacrifice", requireSession, requireSameOrigin, requireJson, requireCsrf, rate("inventory"), async (request, response, next) => { try { const items = Array.isArray(request.body?.items) ? request.body.items : []; if (!items.length || items.length > 60) return response.status(400).json({ error: "Select one to sixty valid inventory stacks." }); const result = await mutate(request.userId, mutationId(request.body?.mutationId), (player) => { const normalized = []; const seen = new Set(); for (const item of items) { const alienId = item?.alienId; const plusLevel = integer(item?.plusLevel); const quantity = integer(item?.quantity); const key = stackKey(alienId, plusLevel); if (!ALIEN_BY_ID.has(alienId) || plusLevel < 0 || plusLevel > 3 || quantity < 1 || quantity > MAX_INVENTORY_STACK || seen.has(key) || integer(player.inventory[key]) < quantity) return { ok: false, error: "Your sacrifice selection is no longer available.", state: gameStateFor(request.userId) }; seen.add(key); normalized.push({ alienId, plusLevel, quantity }); }
      let gained = 0; for (const item of normalized) gained += balance.sacrificeLuck(ALIEN_BY_ID.get(item.alienId), item.plusLevel) * item.quantity; for (const item of normalized) removeStack(player, item.alienId, item.plusLevel, item.quantity); player.pendingLuck = bounded(balance.roundGame(player.pendingLuck + gained), 0, 1e12); return { ok: true, gained: balance.roundGame(gained), state: gameStateFor(request.userId) }; }); response.status(result.ok ? 200 : 409).json(result); } catch (error) { next(error); } });
app.post("/api/merge", requireSession, requireSameOrigin, requireJson, requireCsrf, rate("inventory"), async (request, response, next) => { try { const alienId = request.body?.alienId; const plusLevel = integer(request.body?.plusLevel); if (!ALIEN_BY_ID.has(alienId) || plusLevel < 0 || plusLevel >= 3) return response.status(400).json({ error: "That alien cannot be merged." }); const result = await mutate(request.userId, mutationId(request.body?.mutationId), (player) => { if (!removeStack(player, alienId, plusLevel, 3)) return { ok: false, error: "You need exactly three matching copies in storage.", state: gameStateFor(request.userId) }; if (!addStack(player, alienId, plusLevel + 1)) throw new Error("Could not create shiny stack."); return { ok: true, merged: publicStack(alienId, plusLevel + 1, player.inventory[stackKey(alienId, plusLevel + 1)], player.upgrades.coin), state: gameStateFor(request.userId) }; }); response.status(result.ok ? 200 : 409).json(result); } catch (error) { next(error); } });
app.post("/api/equip-best", requireSession, requireSameOrigin, requireJson, requireCsrf, rate("inventory"), async (request, response, next) => { try { const result = await mutate(request.userId, mutationId(request.body?.mutationId), (player) => { const existing = player.placedAliens.filter(Boolean); for (const slot of existing) addStack(player, slot.alienId, slot.plusLevel); const candidates = inventoryStacks(player); const selected = []; const usedIds = new Set(); for (const candidate of candidates) { if (selected.length >= player.placedAliens.length) break; if (usedIds.has(candidate.id)) continue; selected.push(candidate); usedIds.add(candidate.id); removeStack(player, candidate.id, candidate.plusLevel, 1); }
      const before = existing.map((slot) => stackKey(slot.alienId, slot.plusLevel)).sort().join(","); const after = selected.map((slot) => stackKey(slot.id, slot.plusLevel)).sort().join(","); player.placedAliens = Array.from({ length: player.placedAliens.length }, (_, index) => selected[index] ? { alienId: selected[index].id, plusLevel: selected[index].plusLevel, lastCollected: Date.now() } : null); return { ok: true, changed: before !== after, state: gameStateFor(request.userId) }; }); response.json(result); } catch (error) { next(error); } });
app.post("/api/place-alien", requireSession, requireSameOrigin, requireJson, requireCsrf, rate("inventory"), async (request, response, next) => { try { const { alienId } = request.body || {}; const plusLevel = integer(request.body?.plusLevel); const slotIndex = integer(request.body?.slotIndex, -1); if (!ALIEN_BY_ID.has(alienId) || plusLevel < 0 || plusLevel > 3 || slotIndex < 0 || slotIndex >= TEAM_SLOT_COUNT) return response.status(400).json({ error: "Invalid deployment request." }); const result = await mutate(request.userId, mutationId(request.body?.mutationId), (player) => { if (player.placedAliens[slotIndex]) return { ok: false, error: "Recall the current alien first.", state: gameStateFor(request.userId) }; if (!removeStack(player, alienId, plusLevel, 1)) return { ok: false, error: "That alien is no longer in storage.", state: gameStateFor(request.userId) }; player.placedAliens[slotIndex] = { alienId, plusLevel, lastCollected: Date.now() }; return { ok: true, state: gameStateFor(request.userId) }; }); response.status(result.ok ? 200 : 409).json(result); } catch (error) { next(error); } });
app.post("/api/remove-alien", requireSession, requireSameOrigin, requireJson, requireCsrf, rate("inventory"), async (request, response, next) => { try { const slotIndex = integer(request.body?.slotIndex, -1); const result = await mutate(request.userId, mutationId(request.body?.mutationId), (player) => { const slot = player.placedAliens[slotIndex]; if (!slot) return { ok: false, error: "That team slot is already empty.", state: gameStateFor(request.userId) }; if (!addStack(player, slot.alienId, slot.plusLevel)) throw new Error("Inventory stack reached its safe maximum."); player.placedAliens[slotIndex] = null; return { ok: true, state: gameStateFor(request.userId) }; }); response.status(result.ok ? 200 : 409).json(result); } catch (error) { next(error); } });
app.post("/api/auto-roll", requireSession, requireSameOrigin, requireJson, requireCsrf, rate("roll"), async (request, response, next) => { try { if (typeof request.body?.enabled !== "boolean") return response.status(400).json({ error: "Auto Roll must be on or off." }); const result = await mutate(request.userId, mutationId(request.body?.mutationId), (player) => { player.autoRollActive = request.body.enabled; player.autoRollTouchedAt = Date.now(); return { ok: true, state: gameStateFor(request.userId) }; }); response.json(result); } catch (error) { next(error); } });
app.post("/api/settings", requireSession, requireSameOrigin, requireJson, requireCsrf, rate("inventory"), async (request, response, next) => { try { const patch = request.body?.settings; if (!patch || typeof patch !== "object") return response.status(400).json({ error: "Invalid settings." }); const result = await mutate(request.userId, mutationId(request.body?.mutationId), (player) => { for (const key of ["rollingAnimation", "fullDiscovery"]) if (typeof patch[key] === "boolean") player.settings[key] = patch[key]; return { ok: true, state: gameStateFor(request.userId) }; }); response.json(result); } catch (error) { next(error); } });
app.post("/api/profile/avatar", requireSession, requireSameOrigin, requireJson, requireCsrf, rate("inventory"), async (request, response, next) => { try { const alienId = request.body?.alienId; const result = await mutate(request.userId, mutationId(request.body?.mutationId), (player) => { if (!ALIEN_BY_ID.has(alienId) || !player.discoveredAlienIds[alienId]) return { ok: false, error: "Choose an alien you have discovered.", state: gameStateFor(request.userId) }; player.avatarAlienId = alienId; return { ok: true, state: gameStateFor(request.userId) }; }); response.status(result.ok ? 200 : 409).json(result); } catch (error) { next(error); } });

// Trade rooms intentionally remain tiny, server-owned records. Offers refer to
// an exact permanent alien ID plus its stored shiny level, never a display name.
function roomFor(id, userId) { const room = state.tradeRooms.get(id); return room && room.members.includes(userId) && room.expiresAt > Date.now() ? room : null; }
function roomPublic(room, userId) { const partnerId = room.members.find((id) => id !== userId); const offer = (id) => { const item = room.offers[id]; return item ? publicStack(item.alienId, item.plusLevel, item.quantity) : null; }; return { id: room.id, status: room.status, partner: state.users[partnerId]?.name || "Unknown", invitedByMe: room.inviterId === userId, expiresAt: room.expiresAt, myOffer: offer(userId), partnerOffer: offer(partnerId), myConfirmed: room.confirmed.includes(userId), partnerConfirmed: room.confirmed.includes(partnerId) }; }
app.get("/api/trade-rooms", requireSession, (request, response) => response.json({ rooms: [...state.tradeRooms.values()].filter((room) => room.members.includes(request.userId) && room.expiresAt > Date.now()).map((room) => roomPublic(room, request.userId)) }));
app.post("/api/trade-rooms", requireSession, requireSameOrigin, requireJson, requireCsrf, rate("trade"), async (request, response, next) => { try { const recipient = String(request.body?.recipient || "").trim(); const result = await withLock(async () => { const found = Object.entries(state.users).find(([, player]) => player.name.toLowerCase() === recipient.toLowerCase()); if (!found || found[0] === request.userId) return { ok: false, error: "Choose another existing pilot." }; const [partnerId] = found; const duplicate = [...state.tradeRooms.values()].some((room) => room.status !== "completed" && room.members.includes(request.userId) && room.members.includes(partnerId) && room.expiresAt > Date.now()); if (duplicate) return { ok: false, error: "You already have an active room with that pilot." }; const room = { id: crypto.randomUUID(), inviterId: request.userId, members: [request.userId, partnerId], status: "invited", offers: {}, confirmed: [], expiresAt: Date.now() + 5 * 60_000 }; state.tradeRooms.set(room.id, room); await persistTradeRoom(room); return { ok: true, room: roomPublic(room, request.userId) }; }); response.status(result.ok ? 201 : 409).json(result); } catch (error) { next(error); } });
app.post("/api/trade-rooms/:roomId/accept", requireSession, requireSameOrigin, requireJson, requireCsrf, rate("trade"), async (request, response, next) => { try { const result = await withLock(async () => { const room = roomFor(request.params.roomId, request.userId); if (!room || room.inviterId === request.userId || room.status !== "invited") return { ok: false, error: "This invitation is no longer available." }; room.status = "accepted"; room.expiresAt = Date.now() + 10 * 60_000; await persistTradeRoom(room); return { ok: true, room: roomPublic(room, request.userId) }; }); response.status(result.ok ? 200 : 409).json(result); } catch (error) { next(error); } });
app.post("/api/trade-rooms/:roomId/offer", requireSession, requireSameOrigin, requireJson, requireCsrf, rate("trade"), async (request, response, next) => { try { const alienId = request.body?.alienId; const plusLevel = integer(request.body?.plusLevel); const quantity = integer(request.body?.quantity); const result = await withLock(async () => { const room = roomFor(request.params.roomId, request.userId); const player = state.users[request.userId]; if (!room || room.status !== "accepted" || !ALIEN_BY_ID.has(alienId) || plusLevel < 0 || plusLevel > 3 || quantity < 1 || integer(player.inventory[stackKey(alienId, plusLevel)]) < quantity) return { ok: false, error: "That offer is not available." }; room.offers[request.userId] = { alienId, plusLevel, quantity }; room.confirmed = []; await persistTradeRoom(room); return { ok: true, room: roomPublic(room, request.userId) }; }); response.status(result.ok ? 200 : 409).json(result); } catch (error) { next(error); } });
app.post("/api/trade-rooms/:roomId/confirm", requireSession, requireSameOrigin, requireJson, requireCsrf, rate("trade"), async (request, response, next) => { try { const result = await withLock(async () => { const room = roomFor(request.params.roomId, request.userId); if (!room || room.status !== "accepted") return { ok: false, error: "Trade room is unavailable." }; const [aId, bId] = room.members; const aOffer = room.offers[aId]; const bOffer = room.offers[bId]; if (!aOffer || !bOffer) return { ok: false, error: "Both pilots must place an offer." }; if (!room.confirmed.includes(request.userId)) room.confirmed.push(request.userId); if (room.confirmed.length < 2) { await persistTradeRoom(room); return { ok: true, settled: false, room: roomPublic(room, request.userId) }; } const a = state.users[aId]; const b = state.users[bId]; if (integer(a.inventory[stackKey(aOffer.alienId, aOffer.plusLevel)]) < aOffer.quantity || integer(b.inventory[stackKey(bOffer.alienId, bOffer.plusLevel)]) < bOffer.quantity) { room.confirmed = []; await persistTradeRoom(room); return { ok: false, error: "An offered stack changed; confirmations were cleared." }; } removeStack(a, aOffer.alienId, aOffer.plusLevel, aOffer.quantity); removeStack(b, bOffer.alienId, bOffer.plusLevel, bOffer.quantity); addStack(a, bOffer.alienId, bOffer.plusLevel, bOffer.quantity); addStack(b, aOffer.alienId, aOffer.plusLevel, aOffer.quantity); a.discoveredAlienIds[bOffer.alienId] = true; b.discoveredAlienIds[aOffer.alienId] = true; room.status = "completed"; await persistPlayers([aId, bId], room.id); state.tradeRooms.delete(room.id); return { ok: true, settled: true, state: gameStateFor(request.userId) }; }); response.status(result.ok ? 200 : 409).json(result); } catch (error) { next(error); } });
app.post("/api/trade-rooms/:roomId/cancel", requireSession, requireSameOrigin, requireJson, requireCsrf, rate("trade"), async (request, response, next) => { try { const result = await withLock(async () => { const room = roomFor(request.params.roomId, request.userId); if (!room) return false; state.tradeRooms.delete(room.id); await removeTradeRoom(room.id); return true; }); return result ? response.status(204).end() : response.status(404).json({ error: "Trade room is unavailable." }); } catch (error) { return next(error); } });
app.get("/api/ranks", requireSession, (request, response) => { const rows = Object.entries(state.users).map(([id, player]) => ({ id, name: player.name, rolls: player.totalRolls, top: publicAlien(topAlien(player)), rarityScore: topAlien(player)?.baseChanceLog || 0 })).sort((a, b) => b.rarityScore - a.rarityScore || b.rolls - a.rolls || a.name.localeCompare(b.name)); const rank = rows.findIndex((row) => row.id === request.userId) + 1; response.json({ rank, rows: rows.slice(0, 25).map((row, index) => ({ ...row, rank: index + 1, isCurrentPlayer: row.id === request.userId })), stats: statsFor(state.users[request.userId]) }); });
app.get("/api/profiles/:id", requireSession, (request, response) => { const player = state.users[request.params.id]; if (!player) return response.status(404).json({ error: "Pilot not found." }); response.json({ profile: { name: player.name, avatar: publicAlien(ALIEN_BY_ID.get(player.avatarAlienId)), activeTeam: player.placedAliens.filter(Boolean).map((slot) => publicStack(slot.alienId, slot.plusLevel, 1, player.upgrades.coin)), stats: statsFor(player) } }); });
app.post("/api/logout", requireSession, requireSameOrigin, requireJson, requireCsrf, async (request, response, next) => { try { await pool.query("DELETE FROM game_sessions WHERE id=$1", [request.session.id]); state.sessions.delete(request.sessionToken); const player = state.users[request.userId]; player.autoRollActive = false; player.activeSessionId = null; await persistPlayers([request.userId]); clearCookie(response); response.status(204).end(); } catch (error) { next(error); } });
// Development-only test hook. It is never registered on production hosts.
if (process.env.NODE_ENV !== "production" && process.env.DEBUG_GAME === "true") app.post("/api/debug/grant", requireSession, requireSameOrigin, requireJson, requireCsrf, async (request, response, next) => { try { const amount = bounded(number(request.body?.coins), 0, 1e12); const result = await mutate(request.userId, mutationId(request.body?.mutationId), (player) => { player.money = balance.roundGame(player.money + amount); return { ok: true, state: gameStateFor(request.userId) }; }); response.json(result); } catch (error) { next(error); } });

app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"], index: "index.html", maxAge: "1h" }));
app.use((error, request, response, next) => { if (error instanceof SyntaxError && "body" in error) return response.status(400).json({ error: "Request body must be valid JSON." }); console.error(error); return response.status(500).json({ error: "The game server encountered an unexpected error." }); });
setInterval(() => { const now = Date.now(); for (const [token, session] of state.sessions) if (session.expiresAt < now) state.sessions.delete(token); for (const [key, stamps] of state.requests) { const fresh = stamps.filter((stamp) => stamp > now - 15 * 60_000); if (fresh.length) state.requests.set(key, fresh); else state.requests.delete(key); } for (const [id, room] of state.tradeRooms) if (room.expiresAt < now || room.status === "completed") state.tradeRooms.delete(id); }, 60_000).unref();
if (require.main === module) initializeDatabase().then(() => app.listen(Number.isFinite(PORT) ? PORT : 3000, "0.0.0.0", () => console.log(`AFK Alien Dice is running on ${PORT}`))).catch((error) => { console.error("Failed to initialize PostgreSQL:", error); process.exit(1); });

module.exports = { app, ALIENS, balance, compareStacks, pickAlien, stackKey };
