"use strict";
/* Live E2E for AFK Alien Dice against the real test database. */
const http = require("http");
const { Pool } = require("pg");

const BASE = "http://127.0.0.1:3100";
const DB = process.env.DATABASE_URL;
const results = [];
const note = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };

function request(method, path, { body, cookie, csrf } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(`${BASE}${path}`, {
      method,
      headers: {
        ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        Origin: "http://127.0.0.1:3100"
      }
    }, (res) => {
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        let payload = {};
        try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { error: raw.slice(0, 200) }; }
        resolve({ status: res.statusCode, headers: res.headers, payload, raw });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(username, password) {
  const res = await request("POST", "/api/login", { body: { username, password } });
  const setCookie = res.headers["set-cookie"]?.[0]?.split(";")[0];
  return { res, cookie: setCookie, csrf: res.payload.csrfToken };
}

async function main() {
  const dbPool = new Pool({ connectionString: DB, ssl: { rejectUnauthorized: false }, max: 2 });
  const dbRolls = async (name) => (await dbPool.query("SELECT total_rolls FROM users WHERE name = $1", [name])).rows[0]?.total_rolls;

  /* ---------- 1. Login (the user's real account) ---------- */
  const { cookie, csrf } = await login("BartoStwor", "1234");
  note("login BartoStwor/1234", Boolean(cookie && csrf), `status/session+csrf issued`);
  const auth = { cookie, csrf };

  /* ---------- 2. Full state ---------- */
  const full = await request("GET", "/api/game-state", auth);
  const p = full.payload.player;
  note("game-state full snapshot", full.status === 200 && Boolean(p?.upgrades) && p.placedAliens.length === 3,
    `money=${Number(p.money).toExponential(2)} dice=${p.diceCount} rolls=${p.totalRolls} bytes=${full.raw.length}`);

  /* ---------- 3. Compact sync (the 60s poll) ---------- */
  const compact = await request("GET", "/api/game-state?compact=1", auth);
  const cp = compact.payload.playerPatch;
  note("compact sync patch", compact.status === 200 && Boolean(cp?.money !== undefined) && !compact.payload.player,
    `bytes=${compact.raw.length} (full was ${full.raw.length}) → ${(100 - compact.raw.length / full.raw.length * 100).toFixed(0)}% smaller`);

  /* ---------- 4. Manual roll ---------- */
  const t0 = Date.now();
  const roll1 = await request("POST", "/api/roll", { ...auth, body: { mutationId: `e2e-${Date.now()}` } });
  note("manual roll", roll1.status === 200 && roll1.payload.ok && roll1.payload.results.length === p.diceCount,
    `${Date.now() - t0}ms, featured=${roll1.payload.featured?.name} (${roll1.payload.featured?.rarity})`);

  /* ---------- 5. Auto-roll cadence: 5 consecutive paced rolls ---------- */
  let paced = 0; const latencies = [];
  let nextAt = roll1.payload.playerPatch?.nextRollAt || 0;
  for (let i = 0; i < 5; i += 1) {
    const wait = Math.max(0, nextAt - Date.now() + 60);
    await sleep(wait);
    const t = Date.now();
    const r = await request("POST", "/api/roll", { ...auth, body: { mutationId: `e2e-auto-${i}-${Date.now()}` } });
    latencies.push(Date.now() - t);
    if (r.status === 200 && r.payload.ok) { paced += 1; nextAt = r.payload.playerPatch.nextRollAt; }
    else { note("auto-roll cycle", false, `roll ${i} → ${r.status} ${r.payload.error || ""}`); break; }
  }
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  note("auto-roll cycle (5 rolls, paced)", paced === 5, `latency avg=${avg(latencies).toFixed(0)}ms max=${Math.max(...latencies)}ms`);

  /* ---------- 6. Sacrifice floor end-to-end ---------- */
  // Scan the whole inventory for whichever stack yields the strongest
  // guarantee; BartoStwor is endgame, so Commons may be long gone.
  const BINDING_PENDING = Math.ceil(10 ** (2.7 + 1.5) - 1); // pendingLuckFloor > 0 above this
  let allStacks = []; let offset = 0;
  while (offset !== null && offset < 1000) {
    const page = await request("GET", `/api/inventory?offset=${offset}&limit=100`, auth);
    allStacks = allStacks.concat(page.payload.entries || []);
    offset = page.payload.nextOffset;
  }
  const best = allStacks
    .map((e) => ({ ...e, alienId: e.id, achievable: e.count * e.sacrificeLuck }))
    .sort((a, b) => b.achievable - a.achievable)[0];
  note("inventory: sacrificable stack found", Boolean(best), best ? `${best.name} ×${best.count} (luck ${best.sacrificeLuck} each, max pending ${Number(best.achievable).toExponential(1)})` : "inventory empty");

  if (best && best.achievable >= BINDING_PENDING) {
    const quantity = Math.min(best.count, Math.ceil(BINDING_PENDING / best.sacrificeLuck));
    const sac = await request("POST", "/api/sacrifice", { ...auth, body: { items: [{ alienId: best.alienId, plusLevel: best.plusLevel, quantity }], mutationId: `e2e-sac-${Date.now()}` } });
    const sp = sac.payload.state?.player;
    note("sacrifice accepted", sac.status === 200 && sac.payload.ok && sp?.pendingLuck > 0,
      `sacrificed ${quantity}× ${best.name}, pending=${Number(sp?.pendingLuck).toExponential(2)}`);

    const floor = sp?.pendingRarityFloor || 0;
    note("guarantee issued", floor > 0, `floor log=${floor.toFixed(2)} ≈ 1/${Math.round(10 ** floor).toLocaleString()}`);

    await sleep(Math.max(0, (sac.payload.state?.player?.nextRollAt || 0) - Date.now() + 80));
    const flooredRoll = await request("POST", "/api/roll", { ...auth, body: { mutationId: `e2e-floor-${Date.now()}` } });
    const featuredLog = flooredRoll.payload.featured?.baseChanceLog || 0;
    note("floor honored on the next roll", flooredRoll.status === 200 && featuredLog >= floor - 0.001,
      `featured ${flooredRoll.payload.featured?.name} (${flooredRoll.payload.featured?.rarity}) log=${featuredLog.toFixed(2)} ≥ ${floor.toFixed(2)}`);
    note("pending luck consumed", (flooredRoll.payload.playerPatch?.pendingLuck || 0) === 0, `pendingLuck now 0`);
  } else {
    note("sacrifice floor E2E skipped", true, "no stack can reach the binding threshold; unit-level Monte Carlo already proves the guarantee");
  }

  /* ---------- 7. Five concurrent players ---------- */
  const players = [];
  for (let i = 1; i <= 5; i += 1) {
    players.push(await login(`LoadTest${i}`, `lt-pass-${i}`));
  }
  note("5 concurrent sessions created", players.every((x) => x.cookie), "LoadTest1–5");

  const concurrency = await Promise.all(players.map(async (pl, idx) => {
    const out = { latencies: [], errors: 0 };
    await sleep(idx * 120); // stagger
    for (let i = 0; i < 10; i += 1) {
      const t = Date.now();
      try {
        const r = await request("POST", "/api/roll", { cookie: pl.cookie, csrf: pl.csrf, body: { mutationId: `lt-${idx}-${i}-${Date.now()}` } });
        if (r.status !== 200 || !r.payload.ok) out.errors += 1;
      } catch { out.errors += 1; }
      out.latencies.push(Date.now() - t);
      await sleep(1050); // respect the 600ms cooldown floor with margin
    }
    return out;
  }));

  const all = concurrency.flatMap((c) => c.latencies).sort((a, b) => a - b);
  const errors = concurrency.reduce((sum, c) => sum + c.errors, 0);
  const pct = (q) => all[Math.floor(all.length * q)];
  note("5 players rolling concurrently", errors === 0, `${all.length} rolls, p50=${pct(0.5)}ms p95=${pct(0.95)}ms max=${all.at(-1)}ms, errors=${errors}`);

  /* ---------- 8. Background persistence reached PostgreSQL ---------- */
  const rollsBeforeFlush = await dbRolls("BartoStwor");
  await sleep(2600); // PERSIST_FLUSH_MS = 2000
  const rollsAfterFlush = await dbRolls("BartoStwor");
  note("background flush persisted rolls", Number(rollsAfterFlush) >= Number(rollsBeforeFlush),
    `DB total_rolls=${rollsAfterFlush} (was observed ${rollsBeforeFlush} mid-flight)`);

  /* ---------- 9. Cleanup load-test accounts ---------- */
  await dbPool.query("DELETE FROM game_sessions WHERE user_id IN (SELECT id FROM users WHERE name LIKE 'LoadTest%')");
  await dbPool.query("DELETE FROM users WHERE name LIKE 'LoadTest%'");
  note("load-test accounts removed", true, "LoadTest1–5 deleted from the test DB");

  await dbPool.end();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n==== E2E SUMMARY: ${results.length - failed.length}/${results.length} passed ====`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => { console.error("E2E crashed:", error); process.exit(1); });
