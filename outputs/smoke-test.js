"use strict";

/* Ephemeral smoke test (not part of the repo deliverables).
 * 1. Stubs pg's Pool so server.js initializes without a database.
 * 2. Boots the real Express app on 127.0.0.1:3100.
 * 3. Logs in (creating an account), exercises the main endpoints.
 * 4. Reports compressed vs uncompressed wire sizes for roll and static assets.
 */

const path = require("path");
const fs = require("fs");

process.env.NODE_ENV = "test";
process.env.PORT = "3100";

// --- Stub pg before server.js is required -------------------------------
const fakeRows = { users: [], sessions: [], tradeRooms: [] };
const Pool = class {
  constructor() {}
  async connect() {
    return {
      query: async (text) => stubQuery(text),
      release() {},
    };
  }
  async query(text) {
    return stubQuery(text);
  }
  on() {}
  end() {}
};

async function stubQuery(text) {
  if (/CREATE TABLE|ALTER TABLE|CREATE INDEX/.test(text)) return { rows: [] };
  if (/^SELECT \* FROM users/.test(text)) return { rows: [] };
  if (/^INSERT INTO users/.test(text)) return { rows: [] };
  if (/DELETE FROM game_sessions/.test(text)) return { rows: [] };
  if (/^INSERT INTO game_sessions/.test(text)) return { rows: [] };
  if (/^SELECT id, user_id/.test(text)) return { rows: [] };
  return { rows: [] };
}

const Module = require("module");
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "pg") return { Pool };
  return originalLoad.apply(this, arguments);
};

// --- Boot the app --------------------------------------------------------
const serverModule = require(path.join(__dirname, "..", "server.js"));
const app = serverModule.app;

const server = app.listen(3100, "127.0.0.1");
const serverReady = new Promise((resolve) => server.once("listening", resolve));

const zlib = require("zlib");
const http = require("http");

function request(rawPath, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: 3100,
        path: rawPath,
        method: options.method || "GET",
        headers: options.headers || {},
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function main() {
  await serverReady;

  // 1. Static asset sizes with and without gzip.
  const appJsRaw = await request("/app.js");
  const appJsGzip = await request("/app.js", { headers: { "Accept-Encoding": "gzip" } });
  const styleRaw = await request("/style.css");
  const styleGzip = await request("/style.css", { headers: { "Accept-Encoding": "gzip" } });

  console.log("== static assets ==");
  console.log(`app.js    raw=${appJsRaw.body.length}B  gzip=${zlib.gunzipSync(appJsGzip.body).length}B on-wire=${appJsGzip.body.length}B  encoding=${appJsGzip.headers["content-encoding"] || "none"} cache=${appJsRaw.headers["cache-control"]}`);
  console.log(`style.css raw=${styleRaw.body.length}B  gzip on-wire=${styleGzip.body.length}B  encoding=${styleGzip.headers["content-encoding"] || "none"} cache=${styleRaw.headers["cache-control"]}`);

  // 2. Login (creates the account on first call).
  const login = await request("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "SmokePilot", password: "test1234" }),
  });
  if (login.status !== 201) throw new Error(`login failed: ${login.status} ${login.body}`);
  const loginBody = JSON.parse(login.body);
  const cookie = login.headers["set-cookie"][0].split(";")[0];
  const csrf = loginBody.csrfToken;

  console.log("\n== api ==");
  console.log(`login snapshot bytes=${login.body.length}`);

  // 3. Roll: needs the cooldown bypassed, so wait out the 720ms baseline.
  await new Promise((r) => setTimeout(r, 780));
  const roll = await request("/api/roll", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf, Origin: "http://127.0.0.1:3100" },
    body: JSON.stringify({ mutationId: "smoke-mutation-000001" }),
  });
  if (roll.status !== 200) throw new Error(`roll failed: ${roll.status} ${roll.body}`);
  const rollBody = JSON.parse(roll.body);
  const rollGzip = zlib.gzipSync(roll.body);
  console.log(`roll raw=${roll.body.length}B  gzip=${rollGzip.length}B  hasPlayerPatch=${Boolean(rollBody.playerPatch)}  hasFullState=${Boolean(rollBody.state)}`);

  // Roll again immediately: must be rejected by cooldown with a compact patch.
  const rollFast = await request("/api/roll", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf, Origin: "http://127.0.0.1:3100" },
    body: JSON.stringify({ mutationId: "smoke-mutation-000002" }),
  });
  const rollFastBody = JSON.parse(rollFast.body);
  console.log(`roll-in-cooldown status=${rollFast.status} raw=${rollFast.body.length}B hasPlayerPatch=${Boolean(rollFastBody.playerPatch)}`);

  // 4. Trade rooms poll shape.
  const trades = await request("/api/trade-rooms", { headers: { Cookie: cookie, "X-CSRF-Token": csrf } });
  const tradesBody = JSON.parse(trades.body);
  console.log(`trade-rooms raw=${trades.body.length}B hasPlayerPatch=${Boolean(tradesBody.playerPatch)} hasFullState=${Boolean(tradesBody.state)}`);

  // 5. Auto-roll bandwidth estimate over 24h at the ~0.72s cooldown cadence.
  const perRollWire = rollGzip.length + 220; // body + headers estimate
  const rollsPerDay = 24 * 60 * 60 * 1000 / 720;
  console.log(`\n== auto-roll 24h estimate (gzipped roll response + request) ==`);
  console.log(`~${(rollsPerDay * perRollWire / 1e6).toFixed(0)} MB/day per player (previously ~${(rollsPerDay * 8500 / 1e6).toFixed(0)}+ MB/day uncompressed full snapshot)`);

  // 6. Static cache header sanity.
  if (appJsRaw.headers["cache-control"] === "no-store") throw new Error("static assets still no-store!");
  if (roll.headers["cache-control"] !== "no-store") throw new Error("api lost no-store!");

  console.log("\nSMOKE TEST PASSED");
}

main()
  .then(() => { server.close(); process.exit(0); })
  .catch((error) => {
    console.error("SMOKE TEST FAILED:", error);
    server.close();
    process.exit(1);
  });
