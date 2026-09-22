"use strict";

/* Ephemeral preview server (not part of the repo deliverables).
 * Boots the real Express app with a stubbed pg.Pool so the game runs
 * without PostgreSQL for manual/mobile inspection in the browser preview.
 */

const path = require("path");
const fs = require("fs");

process.env.NODE_ENV = "test";
process.env.PORT = "3100";

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

const serverModule = require(path.join(__dirname, "..", "server.js"));
const app = serverModule.app;
const server = app.listen(3100, "127.0.0.1");

console.log("preview-ready");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
