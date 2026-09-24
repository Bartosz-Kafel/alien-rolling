"use strict";

const $ = (selector) => document.querySelector(selector);
const dom = Object.fromEntries([
  "app", "loginModal", "loginForm", "loginError", "username", "password", "toast", "pilotName", "headerAvatar", "moneyDisplay", "incomeDisplay", "settingsButton", "logoutButton",
  "rollingMain", "rollFx", "rollFlash", "rollButton", "dice", "luckValue", "pendingLuck", "diceCount", "rollHint", "resultBox", "resultIcon", "resultState", "resultName", "resultInfo", "previousResult", "nextResult", "autoRollButton", "autoRollLabel",
  "inventorySearch", "inventoryCount", "teamIncome", "teamGrid", "inventoryGrid", "inventoryMoreButton", "mergeButton", "equipBestButton", "placementModal", "placementChoices", "shopGrid",
  "openSacrifice", "sacrificeModal", "sacrificeChoices", "sacrificeCount", "sacrificeGain", "sacrificeNext", "sacrificeGuarantee", "sacrificeSearch", "selectAllSacrifice", "sacrificeStatus", "sacrificeMoreButton", "cancelSacrifice", "confirmSacrifice",
  "settingsModal", "animationSetting", "discoverySetting", "discoveryModal", "discoveryCard", "discoveryIcon", "discoveryName", "discoveryRarity", "discoveryChance", "minimizeDiscovery", "closeDiscovery", "discoveryMini",
  "rankBadge", "progressStats", "indexProgress", "catalogSearch", "catalogGrid", "catalogMoreButton", "rankRows",
  "tradeRecipient", "tradeInvite", "tradeRooms", "tradeControls", "tradePartner", "tradeSearch", "tradeChoices", "tradeMoreButton", "tradeMinus", "tradePlus", "tradeQuantity", "tradeOffer", "tradeConfirm", "tradeCancel"
].map((id) => [id, $("#" + id)]));
const N = window.gameNumbers;
const state = {
  game: null, csrfToken: "", activeView: "rolling", rolling: false, rollRequestBusy: false, rollRetryAt: 0, estimatedMoney: 0, lastMoneyTick: performance.now(), toastTimer: null, autoTimer: null, rollReadyTimer: null, syncBusy: false, rollFxGeneration: 0, activePresentation: null, rollCandidates: { entries: [], loading: false },
  inventory: {
    entries: [],
    nextOffset: 0,
    totalCopies: 0,
    totalStacks: 0,
    loading: false,
    search: "",
    hasMore: true,
    dirty: true,
    generation: 0,
    pendingReset: false
  },
  pendingDiscovery: null, pendingJoinToast: null,
  catalog: { entries: [], nextOffset: null, total: 0, loading: false, search: "" }, ranks: null, placementSlot: null, sacrifice: new Map(), sacrificeInventory: { entries: [], nextOffset: 0, totalStacks: 0, loading: false, search: "" }, sacrificeSubmitting: false, shinyMode: false, shinyConverting: false, lastResult: null,
  trades: [], selectedTrade: null, tradeStack: null, tradeQuantity: 1, tradeTimer: null, tradeRefreshBusy: false, tradeSearchTimer: null, tradeInventory: { entries: [], nextOffset: 0, totalStacks: 0, loading: false, search: "", generation: 0, dirty: true }
};
const RARITIES = [
  { name: "Common",       maxLog: 4 },
  { name: "Uncommon",     maxLog: 6 },
  { name: "Rare",         maxLog: 9 },
  { name: "Epic",         maxLog: 13 },
  { name: "Legendary",    maxLog: 18 },
  { name: "Mythical",     maxLog: 24 },
  { name: "Celestial",    maxLog: 31 },
  { name: "Cosmic",       maxLog: 39 },
  { name: "Transcendent", maxLog: 48 },
  { name: "Paradox",      maxLog: 58 }
];
const ROLL_PREVIEW_RARITIES = ["Common", "Rare", "Epic", "Legendary", "Cosmic", "Paradox"];

function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
function requestId() { return crypto.randomUUID(); }
function showToast(message, type = "normal") { clearTimeout(state.toastTimer); dom.toast.textContent = message; dom.toast.className = `toast show ${type}`; state.toastTimer = setTimeout(() => { dom.toast.className = "toast"; }, 3400); }
function openModal(element) { element.classList.add("is-open"); element.setAttribute("aria-hidden", "false"); playSound("menu"); }
function closeModal(element) { element.classList.remove("is-open"); element.setAttribute("aria-hidden", "true"); }
function player() { return state.game?.player; }
function plusLabel(level) { return "+".repeat(Number(level) || 0); }
function currentResultTitle() { return state.lastResult?.name || "—"; }

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  if (state.csrfToken) headers["X-CSRF-Token"] = state.csrfToken;
  const response = await fetch(path, { credentials: "same-origin", ...options, headers });
  const raw = await response.text(); let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { error: "The station sent an unreadable response." }; }
  if (!response.ok) { const error = new Error(payload.error || "Request failed."); error.status = response.status; error.payload = payload; throw error; }
  return payload;
}
function resetState() {
  // Drop every cache tied to the previous account/session so a login screen
  // never renders or re-sends data belonging to the last pilot.
  clearTimeout(state.autoTimer);
  clearTimeout(state.rollReadyTimer);
  clearTimeout(state.tradeTimer);
  clearTimeout(state.tradeSearchTimer);
  state.game = null;
  state.csrfToken = "";
  state.rolling = false;
  state.rollRequestBusy = false;
  state.rollRetryAt = 0;
  state.estimatedMoney = 0;
  state.lastMoneyTick = performance.now();
  state.lastResult = null;
  state.lastDiscovery = null;
  state.activePresentation = null;
  state.pendingDiscovery = null;
  state.pendingJoinToast = null;
  state.rollCandidates = { entries: [], loading: false };
  state.inventory = { entries: [], nextOffset: 0, totalCopies: 0, totalStacks: 0, loading: false, search: "", hasMore: true, dirty: true, generation: 0, pendingReset: false };
  state.catalog = { entries: [], nextOffset: null, total: 0, loading: false, search: "" };
  state.ranks = null;
  state.sacrifice.clear();
  state.sacrificeInventory = { entries: [], nextOffset: 0, totalStacks: 0, loading: false, search: "" };
  state.shinyMode = false;
  state.trades = [];
  state.selectedTrade = null;
  state.tradeStack = null;
  state.tradeQuantity = 1;
  state.tradeInventory = { entries: [], nextOffset: 0, totalStacks: 0, loading: false, search: "", generation: 0, dirty: true };
}

function acceptGameState(payload) {
  // Full snapshots carry payload.state; compact roll/poll deltas carry
  // playerPatch and are merged into the existing player object. This keeps
  // the ~0.7s auto-roll cycle to a few hundred bytes of transfer.
  if (payload?.playerPatch) {
    if (!state.game?.player) return false;

    const previousInventoryVersion = state.game.player.inventoryVersion;
    Object.assign(state.game.player, payload.playerPatch);

    if (previousInventoryVersion !== undefined && previousInventoryVersion !== state.game.player.inventoryVersion) {
      invalidateInventory();
      state.tradeInventory.dirty = true;
    }
  } else {
    const game = payload?.state || payload;
    if (!game?.player) return false;

    // Compare against the OLD version BEFORE replacing the reference. Reading
    // it from state.game afterwards always saw the new value, so inventory
    // changes were never detected and callers compensated with extra fetches.
    const previousInventoryVersion = state.game?.player?.inventoryVersion;
    state.game = game;

    if (previousInventoryVersion !== undefined && previousInventoryVersion !== game.player.inventoryVersion) {
      invalidateInventory();
      state.tradeInventory.dirty = true;
    }
  }

  if (typeof payload.csrfToken === "string") {
    state.csrfToken = payload.csrfToken;
  }

  state.estimatedMoney = Number(state.game.player.money) || 0;
  state.lastMoneyTick = performance.now();

  renderShell();
  scheduleRollReady();
  scheduleAutoRoll();

  if (state.activeView === "shop" && !state.rolling) {
    renderShop();
  }

  if (state.activeView === "inventory") {
    renderInventory();
    refreshInventoryIfNeeded();
  }

  return true;
}
async function act(path, body, success, options = {}) {
  try {
    const payload = await api(path, {
      method: "POST",
      body: JSON.stringify({
        ...body,
        mutationId: requestId()
      })
    });

    if (payload?.state || payload?.playerPatch) {
      // Mutations bump inventoryVersion on the server; acceptGameState now
      // detects that and invalidates the inventory exactly once.
      acceptGameState(payload);
    }

    if (payload.ok === false) {
      playSound("error");
      showToast(
        payload.error || "That action could not be completed.",
        "error"
      );
      return null;
    }

    if (success) {
      playSound(options.sound || "purchase");
      showToast(success);
    }

    return payload;
  } catch (error) {
    if (error.payload?.state || error.payload?.playerPatch) {
      acceptGameState(error.payload);
    }

    if (error.status === 401) return showLogin();

    playSound("error");
    showToast(error.message, "error");
    return null;
  }
}

function renderShell() {
  const p = player();
  if (!p) return;

  // A compact player patch carries only the mutable fields, so every update
  // below guards against fields the patch did not include.
  if (p.name) dom.pilotName.textContent = p.name;
  dom.moneyDisplay.textContent = N.coins(state.estimatedMoney);
  if (p.incomePerSecond !== undefined) dom.incomeDisplay.textContent = `+${N.coins(p.incomePerSecond)} / sec`;

  dom.headerAvatar.textContent = state.lastResult?.emoji || "👾";

  dom.luckValue.textContent = N.luck(p.currentLuck);
  dom.pendingLuck.textContent =
    p.pendingLuck > 0
      ? `Charged +${N.luck(p.pendingLuck)} · floor 1 / ${N.exactInteger(10 ** Math.min(Number(p.pendingRarityFloor) || 0, 15))}`
      : "No pending boost";

  if (p.diceCount !== undefined) {
    dom.diceCount.textContent =
      `${p.diceCount} ${p.diceCount === 1 ? "DIE" : "DICE"}`;

    dom.rollHint.textContent = state.rolling
      ? "The dice are drawing a server-authorized signal…"
      : `${p.diceCount} independent server roll${p.diceCount === 1 ? "" : "s"} per throw.`;
  }

  if (p.autoRollActive !== undefined) {
    dom.autoRollButton.classList.toggle("is-active", p.autoRollActive);
    dom.autoRollLabel.textContent =
      p.autoRollActive ? "AUTO ROLL · ON" : "AUTO ROLL";
  }

  dom.mergeButton.classList.toggle("is-active", state.shinyMode);
  dom.mergeButton.querySelector("span").textContent = state.shinyMode ? "SHINY: ON" : "SHINY: OFF";

  dom.rollButton.disabled = state.rollRequestBusy || Date.now() < (Number(p.nextRollAt) || 0);

  if (p.settings) {
    [dom.animationSetting, dom.discoverySetting]
      .forEach((button) => button.classList.remove("is-on"));

    dom.animationSetting.classList.toggle(
      "is-on",
      p.settings.rollingAnimation
    );

    dom.discoverySetting.classList.toggle(
      "is-on",
      p.settings.fullDiscovery
    );
  }

  // Do NOT rebuild the active view here.
}
function setView(view) {
  state.activeView = view;
  if (view !== "trading") clearTimeout(state.tradeTimer);
  
  document.querySelectorAll(".view").forEach((element) => { element.hidden = element.id !== `${view}View`; });
  document.querySelectorAll(".nav-tab").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
  renderView(view); playSound("menu"); window.scrollTo({ top: 0, behavior: "smooth" });
}
function renderView(view) { if (view === "inventory") { renderInventory(); refreshInventoryIfNeeded(); } else if (view === "shop") renderShop(); else if (view === "ranks") { renderRanks(); refreshRanks(); refreshCatalogIfNeeded(); } else if (view === "trading") { renderTrades(); refreshTradeInventoryIfNeeded(); refreshTrades(); scheduleTradeUpdates(); } }

function card(entry, action = "", compact = false) {
  const shiny = plusLabel(entry.plusLevel);
  return `<article class="alien-card ${compact ? "compact" : ""}" data-shiny-stack="${escapeHtml(entry.stackKey || "")}" style="--alien-color:${escapeHtml(entry.color)}"><span class="count-badge">×${N.number(entry.count || 1)}</span><div class="alien-top"><span class="alien-portrait">${escapeHtml(entry.emoji)}</span><div><h3>${escapeHtml(entry.name)}${shiny}</h3><strong>${escapeHtml(entry.rarity).toUpperCase()}</strong></div></div><p class="chance-line" title="1 / ${escapeHtml(entry.baseChance)}">${N.chance(entry.baseChance)}</p>${entry.income !== undefined ? `<p class="income-line">+${N.coins(entry.income)} <small>/ sec</small></p>` : ""}${action}</article>`;
}
function preserveScroll(callback) {
  const scrollY = window.scrollY;

  callback();

  requestAnimationFrame(() => {
    window.scrollTo(0, scrollY);
  });
}

function renderInventory() {
  const p = player();
  if (!p) return;

  preserveScroll(() => {
    const inv = state.inventory;

    dom.inventoryCount.textContent =
      `${N.number(inv.totalCopies)} stored · ${N.number(p.stats.collection)} indexed`;

    dom.teamIncome.textContent =
      `+${N.coins(p.incomePerSecond)} / sec`;

    dom.teamGrid.innerHTML = p.placedAliens
      .map((entry, index) =>
        entry
          ? `<div class="team-slot populated">${card(
              entry,
              `<button class="card-action" type="button" data-recall="${index}">RECALL</button>`,
              true
            )}</div>`
          : `<button class="team-slot empty" type="button" data-slot="${index}">
              <span>◈</span>
              <b>EMPTY BOX</b>
              <small>Deploy an alien</small>
            </button>`
      )
      .join("");

    dom.inventoryGrid.innerHTML = inv.entries.length
      ? inv.entries
          .map(
            (entry) =>
              card(
                entry,
                `<button class="card-action" type="button" data-deploy="${escapeHtml(entry.stackKey)}">DEPLOY</button>`
              )
          )
          .join("")
      : `<div class="empty-state">No stored aliens yet. The dice are waiting.</div>`;

    dom.inventoryMoreButton.hidden = !inv.hasMore;
    dom.inventoryMoreButton.disabled = inv.loading;
  });
}
async function refreshInventory(reset = false) {
  if (!player()) return;

  const inv = state.inventory;

  if (inv.loading) {
    // A roll/search can invalidate a page while it is in flight. Queue one
    // reset rather than dropping the update or merging an old page into it.
    if (reset) inv.pendingReset = true;
    return;
  }

  // Never request another page after everything has been loaded.
  if (!reset && !inv.hasMore) return;

  if (reset) {
    inv.generation += 1;
    inv.entries = [];
    inv.nextOffset = 0;
    inv.hasMore = true;
  }

  const generation = inv.generation;
  inv.loading = true;

  const offset = reset ? 0 : inv.nextOffset;
  const search = encodeURIComponent(inv.search);

  try {
    const data = await api(
      `/api/inventory?offset=${offset}&limit=60&search=${search}`
    );

    if (generation !== inv.generation) return;

    if (reset) {
      inv.entries = data.entries || [];
    } else {
      inv.entries.push(...(data.entries || []));
    }

    inv.nextOffset = data.nextOffset ?? null;
    inv.totalCopies = data.totalCopies ?? 0;
    inv.totalStacks = data.totalStacks ?? 0;

    inv.hasMore =
      inv.nextOffset !== null &&
      inv.nextOffset < inv.totalStacks;

    inv.dirty = false;

    // This is the important part.
    // Once the server says there is no next offset, stop loading.

    if (state.activeView === "inventory") {
      renderInventory();
    }
  } catch (error) {
    if (error.status === 401) showLogin();
  } finally {
    if (generation === inv.generation) inv.loading = false;
    if (inv.pendingReset) {
      inv.pendingReset = false;
      refreshInventory(true);
    }
  }
}

function invalidateInventory() {
  state.inventory.dirty = true;
}

function refreshInventoryIfNeeded() {
  if (state.inventory.dirty && !state.inventory.loading) {
    refreshInventory(true);
  }
}

function optimisticUpgrade(upgradeKey) {
  const p = player();
  const upgrade = p?.upgrades?.[upgradeKey];

  if (!upgrade) return null;

  const previous = {
    level: upgrade.level,
    current: upgrade.current,
    next: upgrade.next,
    cost: upgrade.cost
  };

  upgrade.level += 1;
  upgrade.current = upgrade.next;

  // The server normally provides these values, so we only need
  // to temporarily advance the level/current value here.
  //
  // The exact next/cost values will be replaced by the server
  // response immediately after the request finishes.

  renderShop();

  return previous;
}

function renderShop() {
  const p = player();
  if (!p) return;

  const labels = {
    luck: (upgrade) =>
      `NOW ${N.luck(upgrade.current)} · NEXT ${N.luck(upgrade.next)}`,

    speed: (upgrade) =>
      `NOW ${Math.round(upgrade.current * 100)}% faster · NEXT ${Math.round(upgrade.next * 100)}%`,

    coin: (upgrade) =>
      `NOW x${N.number(upgrade.current)} income · NEXT x${N.number(upgrade.next)}`
  };

  dom.shopGrid.innerHTML =
    Object.entries(p.upgrades)
      .map(
        ([key, upgrade]) =>
          `<article class="shop-card">
            <span class="shop-icon">${escapeHtml(upgrade.icon)}</span>
            <p class="eyebrow">LEVEL ${upgrade.level}</p>
            <h3>${escapeHtml(upgrade.label)}</h3>
            <p>${escapeHtml(upgrade.description)}</p>
            <strong class="upgrade-readout">${labels[key](upgrade)}</strong>
            <button class="primary-button compact-button"
              type="button"
              data-upgrade="${key}"
              ${state.estimatedMoney < upgrade.cost ? "disabled" : ""}>
              UPGRADE <span>${N.coins(upgrade.cost)}</span>
            </button>
          </article>`
      )
      .join("") +
    `<article class="shop-card dice-card">
      <span class="shop-icon">🎲</span>
      <p class="eyebrow">MAJOR MILESTONE</p>
      <h3>Dice Quantity</h3>
      <p>One additional die means one more independently-authorized reward per roll. Its curve is intentionally severe.</p>
      <strong class="upgrade-readout">${p.diceCount} dice → ${p.diceCount + 1}</strong>
      <button id="buyDice" class="primary-button compact-button"
        type="button"
        ${!Number.isFinite(p.diceCost) || state.estimatedMoney < p.diceCost ? "disabled" : ""}>
        ADD A DIE <span>${Number.isFinite(p.diceCost) ? N.coins(p.diceCost) : "MAX"}</span>
      </button>
    </article>`;
}
function renderRanks() {
  const p = player(); if (!p) return; const stats = state.ranks?.stats || p.stats;
  dom.rankBadge.textContent = `Rank #${state.ranks?.rank || "—"}`; dom.indexProgress.textContent = `${N.number(stats.collection)} / ${N.number(stats.collectionTotal)}`;
  const cards = [["Rolls", N.number(stats.rolls)], ["Rarest Signal", stats.rarestAlien?.name || "—"], ["Best Chance", stats.rarestAlien ? N.chance(stats.rarestAlien.baseChance) : "—"], ["Coins Earned", N.coins(stats.coinsEarned)], ["Current Luck", N.luck(stats.currentLuck)], ["Playtime", N.duration(stats.playtimeSeconds)]];
  dom.progressStats.innerHTML = cards.map(([label, value]) => `<article><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></article>`).join("");
  dom.catalogGrid.innerHTML = state.catalog.entries.map((entry) => `<article class="index-card ${entry.discovered ? "found" : "locked"}" style="--alien-color:${escapeHtml(entry.color)}"><span>${entry.discovered ? escapeHtml(entry.emoji) : "?"}</span><div><b>${entry.discovered ? escapeHtml(entry.name) : "Unknown Signal"}</b><small>${escapeHtml(entry.rarity).toUpperCase()} · <i title="1 / ${escapeHtml(entry.baseChance)}">${N.chance(entry.baseChance)}</i></small></div></article>`).join("") || `<div class="empty-state">Loading catalog signals…</div>`;
  dom.catalogMoreButton.hidden = state.catalog.nextOffset === null;
  dom.rankRows.innerHTML = state.ranks?.rows?.length ? state.ranks.rows.map((row) => `<button class="rank-row ${row.isCurrentPlayer ? "you" : ""}" type="button" data-profile="${escapeHtml(row.id)}"><b>#${row.rank}</b><span>${escapeHtml(row.name)}${row.isCurrentPlayer ? " (YOU)" : ""}</span><i>${row.top ? `${escapeHtml(row.top.emoji)} ${escapeHtml(row.top.rarity)} · ${N.chance(row.top.baseChance)}` : "No signal"}</i></button>`).join("") : `<div class="empty-state">Loading station ranks…</div>`;
}
async function refreshCatalog(reset = false) { if (!player() || state.catalog.loading) return; const dataState = state.catalog; dataState.loading = true; try { const offset = reset ? 0 : (dataState.nextOffset ?? 0); const result = await api(`/api/catalog?offset=${offset}&limit=80&search=${encodeURIComponent(dataState.search)}`); dataState.entries = reset ? result.entries : [...dataState.entries, ...result.entries]; dataState.nextOffset = result.nextOffset; dataState.total = result.total; if (state.activeView === "ranks") renderRanks(); } catch (error) { if (error.status === 401) showLogin(); } finally { dataState.loading = false; } }
function refreshCatalogIfNeeded() { if (!state.catalog.entries.length && !state.catalog.loading) refreshCatalog(true); }
async function refreshRanks() { if (!player()) return; try { state.ranks = await api("/api/ranks"); if (state.activeView === "ranks") renderRanks(); } catch (error) { if (error.status === 401) showLogin(); } }
async function primeRollCandidates() {
  if (!player() || state.rollCandidates.loading || state.rollCandidates.entries.length) return;
  state.rollCandidates.loading = true;
  try {
    const samples = await Promise.all(ROLL_PREVIEW_RARITIES.map((rarity) => api(`/api/catalog?offset=0&limit=1&rarity=${encodeURIComponent(rarity)}`)));
    state.rollCandidates.entries = samples.flatMap((sample) => sample.entries || []);
  } catch (error) { if (error.status === 401) showLogin(); }
  finally { state.rollCandidates.loading = false; }
}

function renderResult(alien, rollCount = 1) {
  if (!alien) return; const previous = currentResultTitle(); state.lastResult = alien; dom.resultBox.classList.remove("is-scanning", "is-near-reveal"); dom.resultBox.classList.add("is-revealed"); dom.resultIcon.textContent = alien.emoji; dom.resultState.textContent = alien.rarity.toUpperCase(); dom.resultName.textContent = `${alien.name}${plusLabel(alien.plusLevel)}`; dom.resultInfo.textContent = `${N.chance(alien.baseChance)} · ${rollCount > 1 ? `${rollCount} dice resolved` : "Signal acquired"}`; dom.previousResult.textContent = previous; dom.nextResult.textContent = "LOCKED";
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function reducedMotion() { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
function rollTier(alien) { const log = Number(alien?.baseChanceLog) || 0; if (log >= 23) return 5; if (log >= 13.2) return 4; if (log >= 8) return 3; if (log >= 6.4) return 2; if (log >= 5.25) return 1; return 0; }
function restartClass(element, className) { element.classList.remove(className); void element.offsetWidth; element.classList.add(className); }
function flashRoll(kind = "pulse") { dom.rollFlash.dataset.kind = kind; restartClass(dom.rollFlash, "is-active"); }
function makeRollParticles(count, color, payoff = false) {
  dom.rollFx.replaceChildren(); dom.rollFx.style.setProperty("--roll-color", color || "var(--mint)"); const fragment = document.createDocumentFragment();
  for (let index = 0; index < count; index += 1) { const particle = document.createElement("i"); const angle = (Math.PI * 2 * index) / count + Math.random() * .42; const distance = 80 + Math.random() * 175; particle.className = `roll-particle${payoff ? " payoff" : ""}`; particle.style.setProperty("--x", `${Math.cos(angle) * distance}px`); particle.style.setProperty("--y", `${Math.sin(angle) * distance}px`); particle.style.setProperty("--delay", `${Math.random() * .18}s`); particle.style.setProperty("--size", `${3 + Math.random() * 6}px`); fragment.append(particle); }
  dom.rollFx.append(fragment);
}
function nextRollCandidate(presentation, excludedIds = []) {
  const excluded = new Set(excludedIds); const entries = state.rollCandidates.entries.filter((entry) => !excluded.has(entry.id));
  if (!entries.length) return null;
  const candidate = entries[presentation.candidateCursor % entries.length]; presentation.candidateCursor += 1; return candidate;
}
function previewFrame(presentation, options = {}) {
  const current = nextRollCandidate(presentation, options.excludedIds); const upcoming = nextRollCandidate(presentation, [...(options.excludedIds || []), current?.id]);
  dom.resultBox.classList.add("is-scanning"); dom.resultBox.classList.remove("is-revealed"); restartClass(dom.resultBox, "is-previewing");
  dom.previousResult.textContent = presentation.previousName;
  if (!current) {
    const rarity = RARITIES[presentation.fallbackCursor % RARITIES.length]; const nextRarity = RARITIES[(presentation.fallbackCursor + 1) % RARITIES.length]; presentation.fallbackCursor += 1;
    dom.resultIcon.textContent = "?"; dom.resultState.textContent = "POSSIBLE RARITY · NOT LOCKED"; dom.resultName.textContent = `${rarity} signal`; dom.resultInfo.textContent = "A real catalog tier — not awarded"; dom.nextResult.textContent = `${nextRarity.toUpperCase()} SIGNAL`; return;
  }
  dom.resultIcon.textContent = current.emoji; dom.resultState.textContent = options.locking ? "POSSIBLE SIGNAL · NOT LOCKED" : "POSSIBLE SIGNAL"; dom.resultName.textContent = `${current.name}${plusLabel(current.plusLevel)}`;
  dom.resultInfo.textContent = `${N.chance(current.baseChance)} · Prospect only — not awarded`; dom.nextResult.textContent = upcoming ? `${upcoming.emoji} ${upcoming.name}` : "UNKNOWN";
}
function rollBeatDurations(tier, animationMs) {
  const beats = 4 + tier; const target = Math.round(animationMs * (.27 + tier * .065));
  const weights = Array.from({ length: beats }, (_, index) => 1 + index * 1.05); const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => Math.max(68, Math.round(target * weight / totalWeight)));
}
function restoreResultBox() {
  if (state.lastResult) { renderResult(state.lastResult); return; }
  dom.resultBox.classList.remove("is-scanning", "is-revealed"); dom.resultIcon.textContent = "🎲"; dom.resultState.textContent = "READY"; dom.resultName.textContent = "Awaiting signal"; dom.resultInfo.textContent = "The reveal lands here."; dom.previousResult.textContent = "—"; dom.nextResult.textContent = "???";
}
function beginRollPresentation() {
  // The dice spin duration follows the server-issued rollAnimationMs curve
  // (2.0s at Roll Drive level 0, easing to its 0.5s floor near level 100).
  const presentation = { scanner: null, generation: ++state.rollFxGeneration, previousName: currentResultTitle(), candidateCursor: Math.floor(Math.random() * Math.max(1, state.rollCandidates.entries.length)), fallbackCursor: Math.floor(Math.random() * RARITIES.length) }; const duration = Math.max(500, Math.round((Number(player()?.rollAnimationMs) || 2000) * .55));
  document.body.classList.add("is-rolling"); dom.rollingMain.classList.remove("is-payoff", "is-near-reveal", "is-result-known"); dom.rollingMain.classList.add("is-rolling", "is-searching"); dom.resultBox.classList.remove("is-revealed", "is-payoff", "is-near-reveal"); dom.resultBox.classList.add("roll-energy"); dom.resultBox.style.setProperty("--roll-color", "var(--mint)"); dom.dice.style.setProperty("--roll-duration", `${duration}ms`); dom.dice.classList.add("is-rolling"); makeRollParticles(13, "var(--mint)"); previewFrame(presentation); playSound("rollStart");
  let frame = 1; presentation.scanner = window.setInterval(() => { previewFrame(presentation); if (frame % 2 === 0) playSound("rollTick"); frame += 1; }, 105); return presentation;
}
function finishRollPresentation(presentation, payoff = false) {
  if (presentation && presentation.generation !== state.rollFxGeneration) return;
  if (presentation?.scanner) window.clearInterval(presentation.scanner); dom.dice.classList.remove("is-rolling"); dom.dice.style.removeProperty("--roll-duration"); dom.resultBox.classList.remove("roll-energy", "is-near-reveal");
  const clear = () => { if (presentation && presentation.generation !== state.rollFxGeneration) return; document.body.classList.remove("is-rolling"); dom.rollingMain.classList.remove("is-rolling", "is-searching", "is-result-known", "is-near-reveal", "is-payoff"); dom.rollingMain.removeAttribute("data-roll-tier"); dom.rollingMain.style.removeProperty("--roll-color"); dom.resultBox.classList.remove("is-payoff", "is-previewing"); dom.resultBox.style.removeProperty("--roll-color"); dom.rollFx.replaceChildren(); };
  if (payoff && !reducedMotion()) window.setTimeout(clear, 820); else { clear(); restoreResultBox(); }
}
function deliverPendingAnnouncement() {
  const discovery = state.pendingDiscovery;
  const toast = state.pendingJoinToast;
  state.pendingDiscovery = null;
  state.pendingJoinToast = null;
  if (discovery) showDiscovery(discovery);
  else if (toast) showToast(toast);
}

async function animateRoll(result, presentation) {
  const p = player(); const full = p.settings.rollingAnimation && !reducedMotion() && document.visibilityState === "visible"; const tier = rollTier(result.featured); const color = result.featured.color || "var(--mint)";
  if (presentation?.generation !== state.rollFxGeneration) return;
  if (presentation?.scanner) window.clearInterval(presentation.scanner); dom.resultBox.style.setProperty("--roll-color", color); dom.rollingMain.style.setProperty("--roll-color", color); dom.rollingMain.dataset.rollTier = String(tier); dom.rollingMain.classList.add("is-result-known"); makeRollParticles(14 + tier * 5, color);
  if (!full) { renderResult(result.featured, result.results.length); flashRoll(tier >= 3 ? "rare" : "pulse"); makeRollParticles(14 + tier * 5, color, true); playSound("rollReveal"); if (tier >= 3) playSound("rareReveal"); finishRollPresentation(presentation, true); deliverPendingAnnouncement(); return; }
  const beatDurations = rollBeatDurations(tier, p.rollAnimationMs); const excludedIds = result.results.map((entry) => entry.id);
  for (let beat = 0; beat < beatDurations.length; beat += 1) { const nearReveal = beat >= beatDurations.length - 2; if (nearReveal) { dom.rollingMain.classList.add("is-near-reveal"); dom.resultBox.classList.add("is-near-reveal"); flashRoll(tier >= 3 ? "rare" : "pulse"); } else if (beat > 0 && tier >= 2) flashRoll("pulse"); previewFrame(presentation, { excludedIds, locking: nearReveal }); playSound("rollTick"); await delay(beatDurations[beat]); if (presentation.generation !== state.rollFxGeneration) return; }
  dom.resultBox.classList.remove("is-scanning"); dom.resultBox.classList.add("is-payoff"); dom.rollingMain.classList.add("is-payoff"); flashRoll(tier >= 3 ? "rare" : "reveal"); makeRollParticles(20 + tier * 7, color, true); renderResult(result.featured, result.results.length); playSound("rollReveal"); if (tier >= 3) playSound("rareReveal"); finishRollPresentation(presentation, true); deliverPendingAnnouncement();
}
async function rollDice() {
  if (state.rollRequestBusy || !player() || Date.now() < (Number(player().nextRollAt) || 0)) return;
  primeRollCandidates(); state.rollRequestBusy = true; state.rolling = true; renderShell();
  if (state.activePresentation?.scanner) window.clearInterval(state.activePresentation.scanner);
  const presentation = beginRollPresentation(); state.activePresentation = presentation;
  try {
    const result = await api("/api/roll", { method: "POST", body: JSON.stringify({ mutationId: requestId() }) });
    if (!result.ok) { finishRollPresentation(presentation); acceptGameState(result); showToast(result.error, "error"); return; }
    // Timing is accepted as soon as the authoritative roll returns. The reveal
    // may continue independently, so turning it off cannot increase roll rate.
    // The compact patch bumps inventoryVersion, which invalidates the inventory
    // for the next visit instead of fetching a fresh page after every roll.
    acceptGameState(result);
    // Hold the announcement until the reveal finishes: the discovery modal
    // opens at the payoff beat, or the mini-toast appears right after it.
    if (result.discovery) state.pendingDiscovery = result.discovery;
    else state.pendingJoinToast = `${result.featured.name} joined your inventory.`;
    state.rollRequestBusy = false; scheduleAutoRoll();
    await animateRoll(result, presentation);
  }
  catch (error) { finishRollPresentation(presentation); if (error.payload?.state || error.payload?.playerPatch) acceptGameState(error.payload); if (error.status === 429 && !error.payload?.state && !error.payload?.playerPatch) state.rollRetryAt = Date.now() + 60_000; if (error.status === 401) showLogin(); else { playSound("error"); showToast(error.message, "error"); } }
  finally { state.rollRequestBusy = false; if (presentation.generation === state.rollFxGeneration) { state.rolling = false; state.activePresentation = null; renderShell(); } scheduleAutoRoll(); }
}
function scheduleAutoRoll() {
  clearTimeout(state.autoTimer);
  const p = player();

  if (!p?.autoRollActive || state.rollRequestBusy) return;

  // Keep a small margin beyond the server-issued timestamp so normal timer
  // jitter cannot turn a valid next roll into a cooldown 429.
  const targetAt = Math.max(Number(p.nextRollAt) || 0, state.rollRetryAt || 0);
  const delayMs = Math.max(0, targetAt - Date.now()) + 350;
  // Deliberately NOT gated on document.visibilityState: a hidden tab keeps
  // rolling (the silent audio keepalive in sounds.js exempts us from
  // background timer throttling), and the reveal animation simply runs in
  // its instant form until the tab is visible again.
  state.autoTimer = setTimeout(() => {
    if (player()?.autoRollActive) {
      rollDice();
    }
  }, delayMs);
}
function scheduleRollReady() {
  clearTimeout(state.rollReadyTimer);
  const readyAt = Number(player()?.nextRollAt) || 0;
  const wait = readyAt - Date.now();
  if (wait > 0) state.rollReadyTimer = setTimeout(renderShell, wait + 1);
}
function showDiscovery(alien) { playSound("discovery"); state.lastDiscovery = alien; dom.discoveryIcon.textContent = alien.emoji; dom.discoveryName.textContent = alien.name; dom.discoveryRarity.textContent = alien.rarity.toUpperCase(); dom.discoveryChance.textContent = N.chance(alien.baseChance); dom.discoveryCard.style.setProperty("--alien-color", alien.color); if (player().settings.fullDiscovery) { dom.discoveryModal.classList.add("is-open"); dom.discoveryModal.setAttribute("aria-hidden", "false"); } else minimizeDiscovery(); }
function minimizeDiscovery() { const alien = state.lastDiscovery; dom.discoveryModal.classList.remove("is-open"); dom.discoveryModal.setAttribute("aria-hidden", "true"); if (!alien) return; dom.discoveryMini.innerHTML = `<span>${escapeHtml(alien.emoji)}</span> NEW: ${escapeHtml(alien.name)}`; dom.discoveryMini.hidden = false; }

function deployStack(key) { const entry = state.inventory.entries.find((item) => item.stackKey === key); if (!entry) return; const slot = player().placedAliens.findIndex((item) => !item); if (slot < 0) return showToast("Recall a team alien before deploying.", "error"); state.placementSlot = slot; dom.placementChoices.innerHTML = card(entry, `<button class="card-action" type="button" data-place="${escapeHtml(key)}">PLACE IN SLOT ${slot + 1}</button>`); openModal(dom.placementModal); }
function openPlacement(slot) { state.placementSlot = slot; dom.placementChoices.innerHTML = state.inventory.entries.map((entry) => card(entry, `<button class="card-action" type="button" data-place="${escapeHtml(entry.stackKey)}">DEPLOY</button>`)).join(""); openModal(dom.placementModal); }
function stackFromKey(key) { const [alienId, plus] = String(key).split("|"); return { alienId, plusLevel: Number(plus) }; }
function sacrificeQuantity(key) { return state.sacrifice.get(key)?.quantity || 0; }
function setSacrificeQuantity(entry, value) { const quantity = Math.max(0, Math.min(Number(entry.count) || 0, Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0)); if (quantity) state.sacrifice.set(entry.stackKey, { quantity, luck: Number(entry.sacrificeLuck) || 0 }); else state.sacrifice.delete(entry.stackKey); }
async function refreshSacrificeInventory(reset = false) {
  const source = state.sacrificeInventory; if (!player() || (!reset && (source.loading || source.nextOffset === null))) return; if (reset) { source.entries = []; source.nextOffset = 0; source.totalStacks = 0; source.generation = (source.generation || 0) + 1; }
  const generation = source.generation || 0; const offset = reset ? 0 : source.nextOffset; source.loading = true; renderSacrifice();
  try { const data = await api(`/api/inventory?offset=${offset}&limit=100&search=${encodeURIComponent(source.search)}`); if (generation !== (source.generation || 0)) return; source.entries = reset ? data.entries : [...source.entries, ...data.entries]; source.nextOffset = data.nextOffset; source.totalStacks = data.totalStacks; }
  catch (error) { if (error.status === 401) showLogin(); else showToast("Could not load sacrifice inventory.", "error"); }
  finally { if (generation === (source.generation || 0)) { source.loading = false; renderSacrifice(); } }
}
function openSacrifice() { const source = state.sacrificeInventory; state.sacrifice.clear(); state.sacrificeSubmitting = false; source.search = ""; source.entries = []; source.nextOffset = 0; source.totalStacks = 0; dom.sacrificeSearch.value = ""; openModal(dom.sacrificeModal); renderSacrifice(); refreshSacrificeInventory(true); }
async function selectAllSacrifice() {
  if (state.sacrificeSubmitting) return;
  dom.selectAllSacrifice.disabled = true;
  try {
    const data = await api("/api/inventory/sacrifice-all");
    state.sacrifice.clear();
    for (const item of data.items || []) {
      const key = `${item.alienId}|${item.plusLevel}`;
      state.sacrifice.set(key, { quantity: Number(item.quantity) || 0, luck: Number(item.sacrificeLuck) || 0 });
    }
    renderSacrifice();
  } catch (error) {
    if (error.status === 401) showLogin(); else showToast("Could not select all eligible aliens.", "error");
  } finally {
    dom.selectAllSacrifice.disabled = false;
  }
}
function renderSacrifice() {
  const source = state.sacrificeInventory; const entries = source.entries; let count = 0; let gain = 0; for (const selection of state.sacrifice.values()) { count += selection.quantity; gain += selection.quantity * selection.luck; }
  const p = player();
  const nextPending = (Number(p.pendingLuck) || 0) + gain;
  const floor = Number(p.pendingRarityFloor) || 0;
  // Mirrors balance.pendingLuckFloor: log10(1 + pending) - 1.5, capped at
  // log 20, and inert until it can bind above the catalog's mildest rarity.
  const nextFloorRaw = Math.min(20, Math.log10(1 + Math.max(0, nextPending)) - 1.5);
  const nextFloor = nextFloorRaw >= 2.7 ? nextFloorRaw : 0;
  dom.sacrificeCount.textContent = N.number(count); dom.sacrificeGain.textContent = N.luck(gain); dom.sacrificeNext.textContent = N.luck(p.permanentLuck * (1 + nextPending));
  dom.sacrificeStatus.textContent = source.loading ? "Loading owned aliens…" : entries.length ? `${N.number(entries.length)} of ${N.number(source.totalStacks)} stacks loaded` : source.search ? "No owned aliens match that search." : "No stored aliens available.";
  dom.sacrificeGuarantee.textContent = nextFloor > 0.01 ? `Guarantee: at least 1 / ${N.exactInteger(10 ** Math.min(nextFloor, 15))} on your next roll` : "No rarity guaranteed yet — sacrifice more to lock in a floor";
  dom.sacrificeGuarantee.classList.toggle("is-visible", nextFloor > 0.01);
  dom.sacrificeChoices.innerHTML = entries.length ? entries.map((entry) => { const quantity = sacrificeQuantity(entry.stackKey); return `<article class="selection-card ${quantity ? "selected" : ""}" style="--alien-color:${escapeHtml(entry.color)}"><span>${escapeHtml(entry.emoji)}</span><div><b>${escapeHtml(entry.name)}${plusLabel(entry.plusLevel)}</b><small>${escapeHtml(entry.rarity).toUpperCase()} · ${N.chance(entry.baseChance)}</small><em>Owned: ${N.number(entry.count)} · Selected: ${N.number(quantity)} · ${N.luck(entry.sacrificeLuck)} each</em></div><div class="quantity-stepper"><button type="button" data-sac-minus="${escapeHtml(entry.stackKey)}" ${quantity ? "" : "disabled"} aria-label="Remove one ${escapeHtml(entry.name)}">−</button><input type="number" inputmode="numeric" min="0" max="${Number(entry.count)}" value="${quantity}" data-sac-quantity="${escapeHtml(entry.stackKey)}" aria-label="Sacrifice quantity for ${escapeHtml(entry.name)}"><button type="button" data-sac-plus="${escapeHtml(entry.stackKey)}" ${quantity >= entry.count ? "disabled" : ""} aria-label="Add one ${escapeHtml(entry.name)}">+</button></div></article>`; }).join("") : `<div class="empty-state">${source.loading ? "Scanning your stored aliens…" : "Roll an alien before making this decision."}</div>`;
  dom.sacrificeMoreButton.hidden = source.loading || source.nextOffset === null; dom.confirmSacrifice.disabled = !count || state.sacrificeSubmitting;
}
async function confirmSacrifice() { if (state.sacrificeSubmitting || !state.sacrifice.size) return; state.sacrificeSubmitting = true; renderSacrifice(); const items = [...state.sacrifice.entries()].map(([key, selection]) => ({ ...stackFromKey(key), quantity: selection.quantity })); try { const result = await act("/api/sacrifice", { items }, "Temporary Luck charged for your next roll.", { sound: "purchase" }); if (result) { closeModal(dom.sacrificeModal); state.sacrifice.clear(); } } finally { state.sacrificeSubmitting = false; renderSacrifice(); } }
async function forgeShiny(entry) {
  if (!state.shinyMode || state.shinyConverting) return;
  if (entry.plusLevel !== 0) return showToast("Shiny aliens cannot be used to forge another Shiny.", "error");
  if (entry.count < 3) return showToast("You need three normal copies to forge a Shiny.", "error");
  state.shinyConverting = true;
  try {
    await act("/api/merge", { alienId: entry.id, plusLevel: 0 }, "Shiny alien forged.", { sound: "merge" });
    // acceptGameState already bumped the inventory version and will refresh
    // the grid on the next render, so no forced refetch is needed here.
  } finally {
    state.shinyConverting = false;
  }
}

function renderTrades() {
  const selected = state.trades.find((room) => room.id === state.selectedTrade) || state.trades.find((room) => room.status === "accepted") || null;
  if (selected) state.selectedTrade = selected.id;
  dom.tradeRooms.innerHTML = state.trades.length ? state.trades.map((room) => `<article class="trade-room ${room.id === selected?.id ? "selected" : ""}"><div><small>${escapeHtml(room.status).toUpperCase()}</small><b>${escapeHtml(room.partner)}</b><span>You: ${room.myOffer ? `${escapeHtml(room.myOffer.emoji)} ${escapeHtml(room.myOffer.name)} ×${room.myOffer.count}` : "—"} · Pilot: ${room.partnerOffer ? `${escapeHtml(room.partnerOffer.emoji)} ${escapeHtml(room.partnerOffer.name)} ×${room.partnerOffer.count}` : "—"}</span></div><div>${room.status === "invited" && !room.invitedByMe ? `<button data-accept-trade="${room.id}" type="button">ACCEPT</button>` : ""}<button data-open-trade="${room.id}" type="button">OPEN</button></div></article>`).join("") : `<div class="empty-state">No active trade rooms.</div>`;
  dom.tradeControls.hidden = !selected || selected.status !== "accepted";
  if (!selected || selected.status !== "accepted") return;
  dom.tradePartner.textContent = `Trade with ${selected.partner}`;
  const source = state.tradeInventory;
  const selectedStack = source.entries.find((entry) => entry.stackKey === state.tradeStack?.stackKey) || source.entries[0] || null;
  state.tradeStack = selectedStack;
  dom.tradeChoices.innerHTML = source.entries.length ? source.entries.map((entry) => `<button class="merge-choice ${state.tradeStack?.stackKey === entry.stackKey ? "selected" : ""}" data-trade-stack="${escapeHtml(entry.stackKey)}" type="button"><span>${escapeHtml(entry.emoji)}</span><b>${escapeHtml(entry.name)}${plusLabel(entry.plusLevel)}</b><small>${N.number(entry.count)} owned · ${N.chance(entry.baseChance)}</small></button>`).join("") : `<div class="empty-state">${source.loading ? "Loading trade inventory…" : "No stored aliens match this search."}</div>`;
  dom.tradeMoreButton.hidden = source.loading || source.nextOffset === null;
  dom.tradeMoreButton.disabled = source.loading;
  state.tradeQuantity = Math.max(1, Math.min(state.tradeQuantity, state.tradeStack?.count || 1));
  dom.tradeQuantity.textContent = state.tradeQuantity;
  dom.tradeConfirm.disabled = !selected.myOffer || !selected.partnerOffer || selected.myConfirmed;
}
async function refreshTradeInventory(reset = false) {
  const source = state.tradeInventory;
  if (!player() || source.loading || (!reset && source.nextOffset === null)) return;
  if (reset) { source.entries = []; source.nextOffset = 0; source.totalStacks = 0; source.generation += 1; }
  const generation = source.generation; const offset = reset ? 0 : source.nextOffset; source.loading = true;
  if (state.activeView === "trading") renderTrades();
  try {
    const data = await api(`/api/inventory?offset=${offset}&limit=100&search=${encodeURIComponent(source.search)}`);
    if (generation !== source.generation) return;
    source.entries = reset ? (data.entries || []) : [...source.entries, ...(data.entries || [])];
    source.nextOffset = data.nextOffset; source.totalStacks = data.totalStacks; source.dirty = false;
  } catch (error) { if (error.status === 401) showLogin(); }
  finally { if (generation === source.generation) { source.loading = false; if (state.activeView === "trading") renderTrades(); } }
}
function refreshTradeInventoryIfNeeded() { if (state.tradeInventory.dirty && !state.tradeInventory.loading) refreshTradeInventory(true); }
function scheduleTradeUpdates() {
  clearTimeout(state.tradeTimer);
  if (state.activeView !== "trading" || !player() || document.visibilityState !== "visible") return;
  // Poll faster only while a room is actively being negotiated; an idle list
  // has nothing to update, so it sips bandwidth instead of draining it.
  const hasNegotiation = state.trades.some((room) => room.status === "accepted");
  const cadence = hasNegotiation ? 2_000 : 8_000;
  state.tradeTimer = setTimeout(async () => { await refreshTrades(); scheduleTradeUpdates(); }, cadence);
}
async function refreshTrades() {
  if (!player() || state.tradeRefreshBusy) return;
  state.tradeRefreshBusy = true;
  try {
    const data = await api("/api/trade-rooms");
    if (data.state || data.playerPatch) acceptGameState(data);
    state.trades = data.rooms || [];
    refreshTradeInventoryIfNeeded();
    if (state.activeView === "trading") renderTrades();
  } catch (error) { if (error.status === 401) showLogin(); }
  finally { state.tradeRefreshBusy = false; }
}

function showLogin() { resetState(); dom.app.setAttribute("aria-hidden", "true"); openModal(dom.loginModal); }
function showGame() { closeModal(dom.loginModal); dom.app.setAttribute("aria-hidden", "false"); setView("rolling"); primeRollCandidates(); }
function pulseAlienBox() {
  if (state.activeView !== "inventory" || !player()?.incomePerSecond) return;
  const boxes = [...document.querySelectorAll(".team-slot.populated")];
  const box = boxes[Math.floor(Math.random() * boxes.length)];
  if (!box) return;
  box.classList.add("is-earning");
  const spark = document.createElement("span"); spark.className = "cash-spark"; spark.textContent = "◈"; box.append(spark); playSound("alienMoney");
  setTimeout(() => { box.classList.remove("is-earning"); spark.remove(); }, 700);
}

dom.loginForm.addEventListener("submit", async (event) => { event.preventDefault(); dom.loginError.textContent = ""; try { const payload = await api("/api/login", { method: "POST", body: JSON.stringify({ username: dom.username.value, password: dom.password.value }) }); acceptGameState(payload); showGame(); showToast(payload.created ? "Pilot linked. Your first roll is ready." : "Welcome back to the station."); } catch (error) { playSound("error"); dom.loginError.textContent = error.message; } });
dom.logoutButton.addEventListener("click", async () => { try { await api("/api/logout", { method: "POST", body: JSON.stringify({}) }); } finally { showLogin(); } });
dom.rollButton.addEventListener("click", rollDice);
dom.autoRollButton.addEventListener("click", async () => { const enabled = !player().autoRollActive; const result = await act("/api/auto-roll", { enabled }, enabled ? "Auto Roll armed. Income is reduced by 20%." : "Auto Roll disabled.", { sound: "autoOn" }); if (result) scheduleAutoRoll(); });
dom.settingsButton.addEventListener("click", () => openModal(dom.settingsModal));
dom.animationSetting.addEventListener("click", () => act("/api/settings", { settings: { rollingAnimation: !player().settings.rollingAnimation } }, "Roll presentation setting saved.", { sound: "menu" }));
dom.discoverySetting.addEventListener("click", () => act("/api/settings", { settings: { fullDiscovery: !player().settings.fullDiscovery } }, "Discovery setting saved.", { sound: "menu" }));
document.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", () => { if (button.dataset.closeModal === "sacrificeModal") state.sacrifice.clear(); closeModal($("#" + button.dataset.closeModal)); }));
dom.closeDiscovery.addEventListener("click", () => { dom.discoveryMini.hidden = true; dom.discoveryModal.classList.remove("is-open"); }); dom.minimizeDiscovery.addEventListener("click", minimizeDiscovery); dom.discoveryMini.addEventListener("click", () => { dom.discoveryMini.hidden = true; dom.discoveryModal.classList.add("is-open"); });
// Search boxes fetch a full page per keystroke otherwise; a short debounce
// sends one request when typing pauses instead of one per character.
function debounce(callback, wait) {
  let timer;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(callback, wait);
  };
}

dom.inventorySearch.addEventListener("input", debounce(() => {
  state.inventory.search = dom.inventorySearch.value.trim();
  state.inventory.entries = [];
  state.inventory.hasMore = true;
  refreshInventory(true);
}, 250)); dom.inventoryMoreButton.addEventListener("click", () => refreshInventory());
dom.inventoryGrid.addEventListener("click", (event) => { const button = event.target.closest("[data-deploy]"); if (button) return deployStack(button.dataset.deploy); const cardElement = event.target.closest("[data-shiny-stack]"); if (!cardElement || !state.shinyMode) return; const entry = state.inventory.entries.find((item) => item.stackKey === cardElement.dataset.shinyStack); if (entry) forgeShiny(entry); }); dom.teamGrid.addEventListener("click", (event) => { const recall = event.target.closest("[data-recall]"); const slot = event.target.closest("[data-slot]"); if (recall) act("/api/remove-alien", { slotIndex: Number(recall.dataset.recall) }, "Alien returned to storage."); if (slot) openPlacement(Number(slot.dataset.slot)); });
dom.placementChoices.addEventListener("click", (event) => { const button = event.target.closest("[data-place]"); if (!button) return; const item = stackFromKey(button.dataset.place); act("/api/place-alien", { ...item, slotIndex: state.placementSlot }, "Alien deployed to your active team.").then((result) => { if (result) closeModal(dom.placementModal); }); });
dom.mergeButton.addEventListener("click", () => { state.shinyMode = !state.shinyMode; renderShell(); showToast(state.shinyMode ? "Shiny mode on: click a normal alien to forge one Shiny." : "Shiny mode off."); playSound("menu"); });
dom.equipBestButton.addEventListener("click", () => { dom.teamGrid.classList.add("is-replacing"); act("/api/equip-best", {}, null, { sound: "equip" }).then((result) => { setTimeout(() => dom.teamGrid.classList.remove("is-replacing"), 520); if (result) { showToast(result.changed ? "Best team equipped." : "Your team is already optimal."); } }); });
dom.openSacrifice.addEventListener("click", openSacrifice); dom.sacrificeSearch.addEventListener("input", debounce(() => { state.sacrificeInventory.search = dom.sacrificeSearch.value.trim(); refreshSacrificeInventory(true); }, 250)); dom.selectAllSacrifice.addEventListener("click", selectAllSacrifice); dom.sacrificeMoreButton.addEventListener("click", () => refreshSacrificeInventory()); dom.sacrificeChoices.addEventListener("click", (event) => { const plus = event.target.closest("[data-sac-plus]"); const minus = event.target.closest("[data-sac-minus]"); const key = plus?.dataset.sacPlus || minus?.dataset.sacMinus; if (!key) return; const entry = state.sacrificeInventory.entries.find((item) => item.stackKey === key); if (!entry) return; setSacrificeQuantity(entry, sacrificeQuantity(key) + (plus ? 1 : -1)); renderSacrifice(); playSound("menu"); }); dom.sacrificeChoices.addEventListener("change", (event) => { const input = event.target.closest("[data-sac-quantity]"); if (!input) return; const entry = state.sacrificeInventory.entries.find((item) => item.stackKey === input.dataset.sacQuantity); if (!entry) return; setSacrificeQuantity(entry, input.value); renderSacrifice(); }); dom.cancelSacrifice.addEventListener("click", () => { state.sacrifice.clear(); closeModal(dom.sacrificeModal); }); dom.confirmSacrifice.addEventListener("click", confirmSacrifice);
dom.shopGrid.addEventListener("click", (event) => {
  const upgradeButton = event.target.closest("[data-upgrade]");

  if (upgradeButton && !upgradeButton.disabled) {
    const key = upgradeButton.dataset.upgrade;

    act(
      "/api/buy-upgrade",
      { upgrade: key },
      "Research upgraded."
    );

    return;
  }

  const buyDice = event.target.closest("#buyDice");

  if (buyDice && !buyDice.disabled) {
    act(
      "/api/buy-dice",
      {},
      "A new die joined the array.",
      { sound: "rareReveal" }
    );
  }
});
dom.catalogSearch.addEventListener("input", debounce(() => { state.catalog.search = dom.catalogSearch.value.trim(); state.catalog.entries = []; state.catalog.nextOffset = 0; refreshCatalog(true); }, 250)); dom.catalogMoreButton.addEventListener("click", () => refreshCatalog()); dom.rankRows.addEventListener("click", (event) => { const button = event.target.closest("[data-profile]"); if (button) showToast("Public pilot profile opens in a future station update."); });
dom.tradeInvite.addEventListener("click", () => act("/api/trade-rooms", { recipient: dom.tradeRecipient.value.trim() }, "Trade invitation sent.").then((result) => { if (result) { dom.tradeRecipient.value = ""; refreshTrades(); } })); dom.tradeRooms.addEventListener("click", (event) => { const open = event.target.closest("[data-open-trade]"); const accept = event.target.closest("[data-accept-trade]"); if (open) { state.selectedTrade = open.dataset.openTrade; renderTrades(); } if (accept) act(`/api/trade-rooms/${encodeURIComponent(accept.dataset.acceptTrade)}/accept`, {}, "Trade terminal linked.").then((result) => { if (result) { state.selectedTrade = accept.dataset.acceptTrade; state.tradeInventory.dirty = true; refreshTradeInventoryIfNeeded(); refreshTrades(); } }); }); dom.tradeSearch.addEventListener("input", () => { clearTimeout(state.tradeSearchTimer); state.tradeSearchTimer = setTimeout(() => { state.tradeInventory.search = dom.tradeSearch.value.trim(); state.tradeInventory.dirty = true; refreshTradeInventoryIfNeeded(); }, 180); }); dom.tradeMoreButton.addEventListener("click", () => refreshTradeInventory()); dom.tradeChoices.addEventListener("click", (event) => { const button = event.target.closest("[data-trade-stack]"); if (!button) return; state.tradeStack = state.tradeInventory.entries.find((entry) => entry.stackKey === button.dataset.tradeStack); state.tradeQuantity = 1; renderTrades(); }); dom.tradeMinus.addEventListener("click", () => { state.tradeQuantity = Math.max(1, state.tradeQuantity - 1); renderTrades(); }); dom.tradePlus.addEventListener("click", () => { state.tradeQuantity = Math.min(state.tradeStack?.count || 1, state.tradeQuantity + 1); renderTrades(); }); dom.tradeOffer.addEventListener("click", () => { const room = state.trades.find((item) => item.id === state.selectedTrade); if (!room || !state.tradeStack) return; act(`/api/trade-rooms/${encodeURIComponent(room.id)}/offer`, { alienId: state.tradeStack.id, plusLevel: state.tradeStack.plusLevel, quantity: state.tradeQuantity }, "Offer updated.").then((result) => { if (result) refreshTrades(); }); }); dom.tradeConfirm.addEventListener("click", () => { const room = state.trades.find((item) => item.id === state.selectedTrade); if (!room) return; act(`/api/trade-rooms/${encodeURIComponent(room.id)}/confirm`, {}, null, { sound: "equip" }).then((result) => { if (result) { showToast(result.settled ? "Trade settled securely." : "Confirmation locked; awaiting the other pilot."); refreshTrades(); } }); }); dom.tradeCancel.addEventListener("click", () => { const room = state.trades.find((item) => item.id === state.selectedTrade); if (!room) return; act(`/api/trade-rooms/${encodeURIComponent(room.id)}/cancel`, {}, "Trade cancelled.").then((result) => { if (result !== null) { state.selectedTrade = null; refreshTrades(); } }); });
document.querySelectorAll(".nav-tab").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { syncGame(); scheduleAutoRoll(); scheduleTradeUpdates(); } else { clearTimeout(state.tradeTimer); } });
async function syncGame() { if (!player() || state.syncBusy || document.visibilityState !== "visible") return; state.syncBusy = true; try { acceptGameState(await api("/api/game-state?compact=1")); } catch (error) { if (error.status === 401) showLogin(); } finally { state.syncBusy = false; } }
async function restoreSession() {
  try {
    const payload = await api("/api/game-state");
    if (acceptGameState(payload)) showGame();
  } catch (error) {
    if (error.status !== 401) showToast("Could not restore the station connection.", "error");
  }
}
window.setInterval(() => {
  if (!player()) return;

  const now = performance.now();
  const elapsed = (now - state.lastMoneyTick) / 1000;
  const income = Number(player().incomePerSecond) || 0;

  state.estimatedMoney += elapsed * income;
  state.lastMoneyTick = now;

  dom.moneyDisplay.textContent = N.coins(state.estimatedMoney);

  if (state.activeView === "shop") {
    dom.shopGrid.querySelectorAll("[data-upgrade]").forEach((button) => {
      const key = button.dataset.upgrade;
      const upgrade = player().upgrades[key];

      if (!upgrade) return;

      button.disabled = state.estimatedMoney < upgrade.cost;
    });

    const diceButton = document.getElementById("buyDice");
    if (diceButton) {
      diceButton.disabled =
        !Number.isFinite(player().diceCost) ||
        state.estimatedMoney < player().diceCost;
    }
  }
}, 250);
window.setInterval(syncGame, 60_000);
window.setInterval(pulseAlienBox, 1200);
restoreSession();
