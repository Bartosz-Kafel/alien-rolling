"use strict";

const $ = (selector) => document.querySelector(selector);
const elements = {
  app: $("#app"),
  loginModal: $("#loginModal"),
  loginForm: $("#loginForm"),
  loginError: $("#loginError"),
  placementModal: $("#placementModal"),
  placementChoices: $("#placementChoices"),
  closePlacement: $("#closePlacement"),
  toast: $("#toast"),
  pilotName: $("#pilotName"),
  money: $("#moneyDisplay"),
  income: $("#incomeDisplay"),
  inventoryCount: $("#inventoryCount"),
  inventoryGrid: $("#inventoryGrid"),
  slotCount: $("#slotCount"),
  slotGrid: $("#slotGrid"),
  shopGrid: $("#shopGrid"),
  rankBadge: $("#rankBadge"),
  leaderboardRows: $("#leaderboardRows"),
  dice: $("#dice"),
  rollButton: $("#rollButton"),
  alienReel: $("#alienReel"),
  rollResult: $("#rollResult"),
  rollHint: $("#rollHint"),
  cooldown: $("#cooldownDisplay"),
  logoutButton: $("#logoutButton")
};

const appState = {
  game: null,
  catalog: new Map(),
  activeView: "rolling",
  estimatedMoney: 0,
  lastClientTick: performance.now(),
  rolling: false,
  placementSlot: null,
  syncInFlight: false,
  toastTimer: null
};

const SHOP_ICONS = { luck_boost: "☘", rolling_speed: "⚡", money_increase: "✹" };

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[character]));
}

function formatMoney(value) {
  const safe = Number.isFinite(Number(value)) ? Number(value) : 0;
  return `$${safe.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatRate(value) {
  const safe = Number.isFinite(Number(value)) ? Number(value) : 0;
  if (safe >= 1_000_000_000) return `$${(safe / 1_000_000_000).toFixed(2)}B`;
  if (safe >= 1_000_000) return `$${(safe / 1_000_000).toFixed(2)}M`;
  if (safe >= 1_000) return `$${(safe / 1_000).toFixed(2)}K`;
  return `$${safe.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPercent(fraction) {
  const percent = Math.max(0, Number(fraction) || 0) * 100;
  if (percent >= 1) return `${percent.toFixed(2)}%`;
  if (percent >= 0.01) return `${percent.toFixed(4)}%`;
  return `${percent.toFixed(6)}%`;
}

function formatBonus(key, amount) {
  const percentage = `${(amount * 100).toFixed(2)}%`;
  if (key === "luck_boost") return `${percentage} rare-roll bias`;
  if (key === "rolling_speed") return `${percentage} shorter roll animation`;
  return `${percentage} alien income`;
}

function showToast(message, type = "normal") {
  clearTimeout(appState.toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast show${type === "error" ? " error" : ""}`;
  appState.toastTimer = setTimeout(() => { elements.toast.className = "toast"; }, 3600);
}

async function api(path, options = {}) {
  const requestOptions = { credentials: "same-origin", ...options };
  if (requestOptions.body) requestOptions.headers = { "Content-Type": "application/json", ...(requestOptions.headers || {}) };
  const response = await fetch(path, requestOptions);
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { error: "The server returned an unreadable response." }; }
  if (!response.ok) {
    const error = new Error(payload.error || "Request failed.");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function acceptGameState(payload) {
  const game = payload.state || payload;
  if (!game || !game.player || !Array.isArray(game.catalog)) return false;
  appState.game = game;
  appState.catalog = new Map(game.catalog.map((alien) => [alien.id, alien]));
  appState.estimatedMoney = Number(game.player.money) || 0;
  appState.lastClientTick = performance.now();
  renderAll();
  return true;
}

function currentPlayer() {
  return appState.game?.player || null;
}

function inventoryEntries() {
  const inventory = currentPlayer()?.inventory || {};
  return Object.entries(inventory)
    .map(([id, count]) => ({ alien: appState.catalog.get(id), count: Number(count) || 0 }))
    .filter(({ alien, count }) => alien && count > 0)
    .sort((a, b) => b.alien.money_per_sec - a.alien.money_per_sec);
}

function firstEmptySlot() {
  const placed = currentPlayer()?.placed_aliens || [];
  return placed.findIndex((alien) => !alien);
}

function priceClass(cost) {
  return appState.estimatedMoney + 0.00001 >= cost ? "affordable" : "unaffordable";
}

function alienCard(alien, count = null, action = "") {
  return `
    <article class="alien-card" style="--alien-color:${escapeHtml(alien.color)}">
      ${count !== null ? `<span class="count-badge" aria-label="${count} copies">×${count}</span>` : ""}
      <div class="alien-card-top">
        <div class="alien-portrait" aria-hidden="true">${escapeHtml(alien.icon)}</div>
        <div><h3 class="alien-name">${escapeHtml(alien.name)}</h3><span class="tier-label">${escapeHtml(alien.tier)}</span></div>
      </div>
      <p class="alien-rate">${formatRate(alien.money_per_sec)} <small>/ sec</small></p>
      <p class="rarity-line">Rarity: <b>${formatPercent(alien.rarity)}</b></p>
      ${action}
    </article>`;
}

function renderHeader() {
  const player = currentPlayer();
  if (!player) return;
  elements.pilotName.textContent = player.name;
  elements.money.textContent = formatMoney(appState.estimatedMoney);
  elements.income.textContent = `+${formatRate(player.moneyPerSecond)} / sec`;
}

function renderInventory() {
  const entries = inventoryEntries();
  const count = entries.reduce((sum, entry) => sum + entry.count, 0);
  elements.inventoryCount.textContent = `${count} alien${count === 1 ? "" : "s"}`;
  if (!entries.length) {
    elements.inventoryGrid.innerHTML = `<div class="empty-state"><strong>Your hangar is empty.</strong><p>Roll the dice core to discover your first alien.</p></div>`;
    return;
  }
  elements.inventoryGrid.innerHTML = entries.map(({ alien, count }) => alienCard(
    alien,
    count,
    `<button class="card-action" type="button" data-deploy="${escapeHtml(alien.id)}">DEPLOY TO EMPTY SLOT</button>`
  )).join("");
}

function renderSlots() {
  const player = currentPlayer();
  if (!player) return;
  const canDeploy = inventoryEntries().length > 0;
  elements.slotCount.textContent = `${player.slots} container${player.slots === 1 ? "" : "s"}`;
  const cards = player.placed_aliens.map((alien, index) => {
    if (alien) return `<div class="slot-card"><span class="slot-index">CONTAINER ${String(index + 1).padStart(2, "0")}</span>${alienCard(alien, null, `<button class="card-action" type="button" data-recall-slot="${index}">RECALL TO INVENTORY</button>`)}</div>`;
    return `<div class="slot-card"><span class="slot-index">CONTAINER ${String(index + 1).padStart(2, "0")}</span><div class="empty-slot"><div><div class="open-container" aria-hidden="true"></div><p>Awaiting a lifeform</p></div><button type="button" data-empty-slot="${index}" ${canDeploy ? "" : "disabled"}>CHOOSE ALIEN</button></div></div>`;
  });
  const affordable = priceClass(player.nextSlotCost) === "affordable";
  cards.push(`<button class="slot-purchase" type="button" data-buy-slot data-cost="${player.nextSlotCost}" ${affordable ? "" : "disabled"}><span class="plus">+</span><strong>UNLOCK BOX</strong><small class="price ${priceClass(player.nextSlotCost)}">${formatMoney(player.nextSlotCost)}</small></button>`);
  elements.slotGrid.innerHTML = cards.join("");
}

function renderShop() {
  const player = currentPlayer();
  if (!player) return;
  const upgrades = Object.entries(player.upgrades);
  elements.shopGrid.innerHTML = upgrades.map(([key, upgrade]) => {
    const affordable = priceClass(upgrade.cost) === "affordable";
    return `
      <article class="shop-card">
        <div class="shop-icon" aria-hidden="true">${SHOP_ICONS[key]}</div>
        <h3>${escapeHtml(upgrade.label)}</h3>
        <p>${escapeHtml(upgrade.description)}</p>
        <div class="level-line">LEVEL ${upgrade.level}</div>
        <div class="bonus-line">Next: ${formatBonus(key, upgrade.nextBonus)}</div>
        <button class="shop-button" type="button" data-buy-upgrade="${key}" data-cost="${upgrade.cost}" ${affordable ? "" : "disabled"}>BUY <span class="price ${priceClass(upgrade.cost)}">${formatMoney(upgrade.cost)}</span></button>
      </article>`;
  }).join("");
}

function renderLeaderboard() {
  const leaderboard = appState.game?.leaderboard;
  if (!leaderboard) return;
  elements.rankBadge.textContent = `Rank #${leaderboard.activeRank || "—"}`;
  if (!leaderboard.rows.length) {
    elements.leaderboardRows.innerHTML = `<div class="empty-state"><strong>No pilots yet.</strong><p>Be the first name in orbit.</p></div>`;
    return;
  }
  elements.leaderboardRows.innerHTML = leaderboard.rows.map((row) => `
    <div class="leaderboard-row ${row.isCurrentPlayer ? "current" : ""}" role="row">
      <span class="rank-number">#${row.rank}</span>
      <span class="row-name">${escapeHtml(row.name)}${row.isCurrentPlayer ? " (You)" : ""}</span>
      <span class="row-money">${formatMoney(row.money)}</span>
      <span class="row-rolls">${row.total_rolls}</span>
    </div>`).join("");
}

function updateRollStatus() {
  const player = currentPlayer();
  if (!player) return;
  elements.rollButton.disabled = appState.rolling;
  if (appState.rolling) {
    elements.cooldown.textContent = "ROLLING";
    elements.rollHint.textContent = "The quantum core is searching the outer systems…";
  } else {
    elements.cooldown.textContent = "READY";
    elements.rollHint.textContent = `Tap the dice to materialize a new alien. Current roll takes ${(player.rollAnimationMs / 1000).toFixed(2)}s.`;
  }
}

function updateDynamicAffordability() {
  document.querySelectorAll("[data-cost]").forEach((button) => {
    const cost = Number(button.dataset.cost);
    const affordable = Number.isFinite(cost) && appState.estimatedMoney + 0.00001 >= cost;
    button.disabled = !affordable;
    const price = button.querySelector(".price");
    if (price) {
      price.classList.toggle("affordable", affordable);
      price.classList.toggle("unaffordable", !affordable);
    }
  });
}

function renderAll() {
  if (!currentPlayer()) return;
  renderHeader();
  renderInventory();
  renderSlots();
  renderShop();
  renderLeaderboard();
  updateRollStatus();
  updateDynamicAffordability();
  setView(appState.activeView, false);
}

function setView(view, focus = true) {
  if (!currentPlayer()) return;
  appState.activeView = view;
  document.querySelectorAll(".view").forEach((section) => { section.hidden = section.id !== `${view}View`; });
  document.querySelectorAll(".nav-tab").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  if (focus) window.scrollTo({ top: 0, behavior: "smooth" });
}

function openPlacement(slot) {
  const entries = inventoryEntries();
  if (slot < 0 || !entries.length) {
    showToast("Roll an alien before opening a container.", "error");
    return;
  }
  appState.placementSlot = slot;
  elements.placementChoices.innerHTML = entries.map(({ alien, count }) => `
    <button class="choice-button" type="button" data-place-alien="${escapeHtml(alien.id)}">
      <span class="choice-top" style="--alien-color:${escapeHtml(alien.color)}"><span class="alien-portrait" aria-hidden="true">${escapeHtml(alien.icon)}</span><b>${escapeHtml(alien.name)}</b></span>
      <small>${formatRate(alien.money_per_sec)} / sec</small><em>${count} in storage · ${alien.tier}</em>
    </button>`).join("");
  elements.placementModal.classList.add("is-open");
  elements.placementModal.setAttribute("aria-hidden", "false");
}

function closePlacement() {
  appState.placementSlot = null;
  elements.placementModal.classList.remove("is-open");
  elements.placementModal.setAttribute("aria-hidden", "true");
}

async function handleAction(request, successMessage) {
  try {
    const response = await request();
    acceptGameState(response);
    if (successMessage) showToast(successMessage);
    return true;
  } catch (error) {
    if (error.payload?.state) acceptGameState(error.payload);
    if (error.status === 401) return showLogin();
    showToast(error.message, "error");
    return false;
  }
}

function shuffledRollCandidates(finalAlien, duration) {
  const options = [...appState.catalog.values()].filter((alien) => alien.id !== finalAlien.id);
  for (let index = options.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [options[index], options[randomIndex]] = [options[randomIndex], options[index]];
  }
  const frameCount = Math.min(options.length + 1, Math.max(8, Math.round(duration / 95)));
  return [...options.slice(0, frameCount - 1), finalAlien];
}

function renderReelFrame(alien, finalFrame) {
  elements.alienReel.innerHTML = `
    <div class="reel-frame ${finalFrame ? "is-final" : ""}" style="--alien-color:${escapeHtml(alien.color)}">
      <span class="alien-portrait" aria-hidden="true">${escapeHtml(alien.icon)}</span>
      <span><b>${escapeHtml(alien.name)}</b><small>${escapeHtml(alien.tier)} · ${formatPercent(alien.rarity)}</small></span>
      <em>${finalFrame ? "LOCKED" : "SCANNING"}</em>
    </div>`;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function animateAlienReel(finalAlien, duration) {
  const candidates = shuffledRollCandidates(finalAlien, duration);
  const finalHold = Math.min(360, Math.max(130, duration * 0.22));
  const scanDelay = Math.max(35, (duration - finalHold) / Math.max(1, candidates.length - 1));
  elements.alienReel.classList.add("is-active");
  for (let index = 0; index < candidates.length; index += 1) {
    const isFinal = index === candidates.length - 1;
    renderReelFrame(candidates[index], isFinal);
    await wait(isFinal ? finalHold : scanDelay);
  }
  elements.alienReel.classList.remove("is-active");
  elements.alienReel.innerHTML = "";
}

async function rollDice() {
  if (appState.rolling || !currentPlayer()) return;
  const duration = Math.max(500, Number(currentPlayer().rollAnimationMs) || 2200);
  appState.rolling = true;
  elements.dice.style.setProperty("--roll-duration", `${duration}ms`);
  elements.dice.classList.add("is-rolling");
  elements.rollResult.innerHTML = "";
  updateRollStatus();
  try {
    const response = await api("/api/roll", { method: "POST", body: "{}" });
    await animateAlienReel(response.rolled, duration);
    acceptGameState(response);
    const alien = response.rolled;
    elements.rollResult.innerHTML = `
      <div class="result-card" style="--alien-color:${escapeHtml(alien.color)}">
        <div class="alien-portrait" aria-hidden="true">${escapeHtml(alien.icon)}</div>
        <div><span class="tier-label">${escapeHtml(alien.tier)} SIGNAL ACQUIRED</span><h3>${escapeHtml(alien.name)}</h3><p><strong>${formatRate(alien.money_per_sec)} / sec</strong> · Exact rarity ${formatPercent(alien.rarity)}</p></div>
      </div>`;
    showToast(`${alien.name} added to your hangar.`);
  } catch (error) {
    if (error.payload?.state) acceptGameState(error.payload);
    if (error.status === 401) showLogin();
    else showToast(error.message, "error");
  } finally {
    appState.rolling = false;
    elements.dice.classList.remove("is-rolling");
    elements.dice.style.removeProperty("--roll-duration");
    updateRollStatus();
  }
}

async function syncGameState() {
  if (!currentPlayer() || appState.syncInFlight) return;
  appState.syncInFlight = true;
  try {
    acceptGameState(await api("/api/game-state"));
  } catch (error) {
    if (error.status === 401) showLogin();
  } finally {
    appState.syncInFlight = false;
  }
}

function showLogin() {
  appState.game = null;
  appState.catalog.clear();
  appState.rolling = false;
  closePlacement();
  elements.app.setAttribute("aria-hidden", "true");
  elements.loginModal.classList.add("is-open");
  elements.loginModal.setAttribute("aria-hidden", "false");
}

function showGame() {
  elements.loginModal.classList.remove("is-open");
  elements.loginModal.setAttribute("aria-hidden", "true");
  elements.app.setAttribute("aria-hidden", "false");
}

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = elements.loginForm.querySelector("button[type=submit]");
  const form = new FormData(elements.loginForm);
  elements.loginError.textContent = "";
  submit.disabled = true;
  try {
    const response = await api("/api/login", { method: "POST", body: JSON.stringify({ username: form.get("username"), password: form.get("password") }) });
    acceptGameState(response);
    showGame();
    showToast(response.created ? "Pilot profile created. Your first roll is free." : "Welcome back to the station.");
  } catch (error) {
    elements.loginError.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

document.querySelectorAll(".nav-tab").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
elements.rollButton.addEventListener("click", rollDice);
elements.closePlacement.addEventListener("click", closePlacement);
elements.placementModal.addEventListener("click", (event) => { if (event.target === elements.placementModal) closePlacement(); });

elements.inventoryGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-deploy]");
  if (!button) return;
  const slot = firstEmptySlot();
  if (slot < 0) return showToast("All containers are occupied. Unlock another box first.", "error");
  openPlacement(slot);
});

elements.slotGrid.addEventListener("click", (event) => {
  const empty = event.target.closest("[data-empty-slot]");
  if (empty) return openPlacement(Number(empty.dataset.emptySlot));
  const recall = event.target.closest("[data-recall-slot]");
  if (recall) {
    return handleAction(
      () => api("/api/remove-alien", { method: "POST", body: JSON.stringify({ slotIndex: Number(recall.dataset.recallSlot) }) }),
      "Alien recalled to your inventory."
    );
  }
  if (event.target.closest("[data-buy-slot]")) {
    handleAction(() => api("/api/buy-slot", { method: "POST", body: "{}" }), "New alien container unlocked.");
  }
});

elements.shopGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-buy-upgrade]");
  if (!button) return;
  handleAction(() => api("/api/buy-shop", { method: "POST", body: JSON.stringify({ upgrade: button.dataset.buyUpgrade }) }), "Research upgrade installed.");
});

elements.placementChoices.addEventListener("click", (event) => {
  const button = event.target.closest("[data-place-alien]");
  if (!button || appState.placementSlot === null) return;
  const slotIndex = appState.placementSlot;
  handleAction(
    () => api("/api/place-alien", { method: "POST", body: JSON.stringify({ alienId: button.dataset.placeAlien, slotIndex }) }),
    "Alien deployed. Passive credits are now online."
  ).then((success) => { if (success) closePlacement(); });
});

elements.logoutButton.addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST", body: "{}" }); } catch { /* The local view can still safely sign out. */ }
  showLogin();
  elements.loginForm.reset();
  showToast("Signed out of the station.");
});

setInterval(() => {
  const now = performance.now();
  if (currentPlayer()) {
    const seconds = Math.min(2, Math.max(0, now - appState.lastClientTick) / 1000);
    appState.estimatedMoney += currentPlayer().moneyPerSecond * seconds;
    renderHeader();
    updateRollStatus();
    updateDynamicAffordability();
  }
  appState.lastClientTick = now;
}, 250);
setInterval(syncGameState, 5000);

(async () => {
  try {
    const response = await api("/api/game-state");
    acceptGameState(response);
    showGame();
  } catch {
    showLogin();
  }
})();
