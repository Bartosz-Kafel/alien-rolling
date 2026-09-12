"use strict";

const $ = (selector) => document.querySelector(selector);
const dom = Object.fromEntries([
  "app", "loginModal", "loginForm", "loginError", "username", "password", "toast", "pilotName", "headerAvatar", "moneyDisplay", "incomeDisplay", "settingsButton", "logoutButton",
  "rollingMain", "rollFx", "rollFlash", "rollButton", "dice", "luckValue", "pendingLuck", "diceCount", "rollHint", "resultBox", "resultIcon", "resultState", "resultName", "resultInfo", "previousResult", "nextResult", "autoRollButton", "autoRollLabel",
  "inventorySearch", "inventoryCount", "teamIncome", "teamGrid", "inventoryGrid", "inventoryMoreButton", "mergeButton", "equipBestButton", "placementModal", "placementChoices", "shopGrid",
  "openSacrifice", "sacrificeModal", "sacrificeChoices", "sacrificeCount", "sacrificeGain", "sacrificeNext", "sacrificeSearch", "sacrificeStatus", "sacrificeMoreButton", "cancelSacrifice", "confirmSacrifice",
  "mergeModal", "mergeChoices", "mergePreview", "confirmMerge", "settingsModal", "animationSetting", "discoverySetting", "discoveryModal", "discoveryCard", "discoveryIcon", "discoveryName", "discoveryRarity", "discoveryChance", "minimizeDiscovery", "closeDiscovery", "discoveryMini",
  "rankBadge", "progressStats", "indexProgress", "catalogSearch", "catalogGrid", "catalogMoreButton", "rankRows",
  "tradeRecipient", "tradeInvite", "tradeRooms", "tradeControls", "tradePartner", "tradeChoices", "tradeMinus", "tradePlus", "tradeQuantity", "tradeOffer", "tradeConfirm"
].map((id) => [id, $("#" + id)]));
const N = window.gameNumbers;
const state = {
  game: null, csrfToken: "", activeView: "rolling", rolling: false, estimatedMoney: 0, lastMoneyTick: performance.now(), toastTimer: null, autoTimer: null, syncBusy: false, rollFxGeneration: 0,
  inventory: { entries: [], nextOffset: null, totalCopies: 0, totalStacks: 0, loading: false, search: "" },
  catalog: { entries: [], nextOffset: null, total: 0, loading: false, search: "" }, ranks: null, placementSlot: null, sacrifice: new Map(), sacrificeInventory: { entries: [], nextOffset: 0, totalStacks: 0, loading: false, search: "" }, sacrificeSubmitting: false, merge: null, lastResult: null,
  trades: [], selectedTrade: null, tradeStack: null, tradeQuantity: 1
};
const RARITIES = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythical", "Celestial", "Cosmic", "Transcendent", "Paradox"];

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
function acceptGameState(payload) {
  const game = payload?.state || payload;
  if (!game?.player) return false;
  state.game = game; if (typeof payload.csrfToken === "string") state.csrfToken = payload.csrfToken;
  state.estimatedMoney = Number(game.player.money) || 0; state.lastMoneyTick = performance.now();
  renderShell(); scheduleAutoRoll(); return true;
}
async function act(path, body, success, options = {}) {
  try {
    const payload = await api(path, { method: "POST", body: JSON.stringify({ ...body, mutationId: requestId() }) });
    if (payload?.state) acceptGameState(payload);
    if (payload.ok === false) { playSound("error"); showToast(payload.error || "That action could not be completed.", "error"); return null; }
    if (success) { playSound(options.sound || "purchase"); showToast(success); }
    return payload;
  } catch (error) {
    if (error.payload?.state) acceptGameState(error.payload);
    if (error.status === 401) return showLogin();
    playSound("error"); showToast(error.message, "error"); return null;
  }
}

function renderShell() {
  const p = player(); if (!p) return;
  dom.pilotName.textContent = p.name; dom.moneyDisplay.textContent = N.coins(state.estimatedMoney); dom.incomeDisplay.textContent = `+${N.coins(p.incomePerSecond)} / sec`;
  dom.headerAvatar.textContent = state.lastResult?.emoji || "👾";
  dom.luckValue.textContent = N.luck(p.currentLuck); dom.pendingLuck.textContent = p.pendingLuck > 0 ? `Charged +${N.luck(p.pendingLuck)}` : "No pending boost";
  dom.diceCount.textContent = `${p.diceCount} ${p.diceCount === 1 ? "DIE" : "DICE"}`;
  dom.autoRollButton.classList.toggle("is-active", p.autoRollActive); dom.autoRollLabel.textContent = p.autoRollActive ? "AUTO ROLL · ON" : "AUTO ROLL";
  dom.rollButton.disabled = state.rolling; dom.rollHint.textContent = state.rolling ? "The dice are drawing a server-authorized signal…" : `${p.diceCount} independent server roll${p.diceCount === 1 ? "" : "s"} per throw.`;
  [dom.animationSetting, dom.discoverySetting].forEach((button) => button.classList.remove("is-on"));
  dom.animationSetting.classList.toggle("is-on", p.settings.rollingAnimation); dom.discoverySetting.classList.toggle("is-on", p.settings.fullDiscovery);
  renderView(state.activeView);
}
function setView(view) {
  state.activeView = view;
  document.querySelectorAll(".view").forEach((element) => { element.hidden = element.id !== `${view}View`; });
  document.querySelectorAll(".nav-tab").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
  renderView(view); playSound("menu"); window.scrollTo({ top: 0, behavior: "smooth" });
}
function renderView(view) { if (view === "inventory") { renderInventory(); refreshInventoryIfNeeded(); } else if (view === "shop") renderShop(); else if (view === "ranks") { renderRanks(); refreshRanks(); refreshCatalogIfNeeded(); } else if (view === "trading") { renderTrades(); refreshTrades(); } }

function card(entry, action = "", compact = false) {
  const shiny = plusLabel(entry.plusLevel);
  return `<article class="alien-card ${compact ? "compact" : ""}" style="--alien-color:${escapeHtml(entry.color)}"><span class="count-badge">×${N.number(entry.count || 1)}</span><div class="alien-top"><span class="alien-portrait">${escapeHtml(entry.emoji)}</span><div><h3>${escapeHtml(entry.name)}${shiny}</h3><strong>${escapeHtml(entry.rarity).toUpperCase()}</strong></div></div><p class="chance-line" title="1 / ${escapeHtml(entry.baseChance)}">${N.chance(entry.baseChance)}</p>${entry.income !== undefined ? `<p class="income-line">+${N.coins(entry.income)} <small>/ sec</small></p>` : ""}${action}</article>`;
}
function renderInventory() {
  const p = player(); if (!p) return; const inv = state.inventory;
  dom.inventoryCount.textContent = `${N.number(inv.totalCopies)} stored · ${N.number(p.stats.collection)} indexed`;
  dom.teamIncome.textContent = `+${N.coins(p.incomePerSecond)} / sec`;
  dom.teamGrid.innerHTML = p.placedAliens.map((entry, index) => entry ? `<div class="team-slot populated">${card(entry, `<button class="card-action" type="button" data-recall="${index}">RECALL</button>`, true)}</div>` : `<button class="team-slot empty" type="button" data-slot="${index}"><span>◈</span><b>EMPTY BOX</b><small>Deploy an alien</small></button>`).join("");
  dom.inventoryGrid.innerHTML = inv.entries.length ? inv.entries.map((entry) => card(entry, `<button class="card-action" type="button" data-deploy="${escapeHtml(entry.stackKey)}">DEPLOY</button>`)).join("") : `<div class="empty-state">No stored aliens yet. The dice are waiting.</div>`;
  dom.inventoryMoreButton.hidden = inv.nextOffset === null;
}
async function refreshInventory(reset = false) {
  if (!player() || state.inventory.loading) return; const inv = state.inventory; inv.loading = true;
  const offset = reset ? 0 : (inv.nextOffset ?? 0); const search = encodeURIComponent(inv.search);
  try { const data = await api(`/api/inventory?offset=${offset}&limit=60&search=${search}`); inv.entries = reset ? data.entries : [...inv.entries, ...data.entries]; inv.nextOffset = data.nextOffset; inv.totalCopies = data.totalCopies; inv.totalStacks = data.totalStacks; if (state.activeView === "inventory") renderInventory(); }
  catch (error) { if (error.status === 401) showLogin(); } finally { inv.loading = false; }
}
function refreshInventoryIfNeeded() { if (!state.inventory.entries.length && !state.inventory.loading) refreshInventory(true); }
function renderShop() {
  const p = player(); if (!p) return;
  const labels = { luck: (upgrade) => `NOW ${N.luck(upgrade.current)} · NEXT ${N.luck(upgrade.next)}`, speed: (upgrade) => `NOW ${Math.round(upgrade.current * 100)}% faster · NEXT ${Math.round(upgrade.next * 100)}%`, coin: (upgrade) => `NOW x${N.number(upgrade.current)} income · NEXT x${N.number(upgrade.next)}` };
  dom.shopGrid.innerHTML = Object.entries(p.upgrades).map(([key, upgrade]) => `<article class="shop-card"><span class="shop-icon">${escapeHtml(upgrade.icon)}</span><p class="eyebrow">LEVEL ${upgrade.level}</p><h3>${escapeHtml(upgrade.label)}</h3><p>${escapeHtml(upgrade.description)}</p><strong class="upgrade-readout">${labels[key](upgrade)}</strong><button class="primary-button compact-button" type="button" data-upgrade="${key}" ${p.money < upgrade.cost ? "disabled" : ""}>UPGRADE <span>${N.coins(upgrade.cost)}</span></button></article>`).join("") + `<article class="shop-card dice-card"><span class="shop-icon">🎲</span><p class="eyebrow">MAJOR MILESTONE</p><h3>Dice Quantity</h3><p>One additional die means one more independently-authorized reward per roll. Its curve is intentionally severe.</p><strong class="upgrade-readout">${p.diceCount} dice → ${p.diceCount + 1}</strong><button id="buyDice" class="primary-button compact-button" type="button" ${!Number.isFinite(p.diceCost) || p.money < p.diceCost ? "disabled" : ""}>ADD A DIE <span>${Number.isFinite(p.diceCost) ? N.coins(p.diceCost) : "MAX"}</span></button></article>`;
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

function renderResult(alien, rollCount = 1) {
  if (!alien) return; const previous = currentResultTitle(); state.lastResult = alien; dom.resultBox.classList.remove("is-scanning", "is-near-reveal"); dom.resultBox.classList.add("is-revealed"); dom.resultIcon.textContent = alien.emoji; dom.resultState.textContent = alien.rarity.toUpperCase(); dom.resultName.textContent = `${alien.name}${plusLabel(alien.plusLevel)}`; dom.resultInfo.textContent = `${N.chance(alien.baseChance)} · ${rollCount > 1 ? `${rollCount} dice resolved` : "Signal acquired"}`; dom.previousResult.textContent = previous; dom.nextResult.textContent = "LOCKED";
}
const SCAN_MESSAGES = ["Charging the probability lattice", "Signals crossing the roll core", "Reading a volatile frequency", "Stabilizing the unknown", "One outcome is taking shape"];
function scanFrame(label, detail = "The outcome is still unknown…") { dom.resultBox.classList.add("is-scanning"); dom.resultBox.classList.remove("is-revealed"); dom.resultState.textContent = "SIGNAL SCAN"; dom.resultName.textContent = label; dom.resultInfo.textContent = detail; dom.nextResult.textContent = "UNRESOLVED"; }
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
function beginRollPresentation() {
  const presentation = { scanner: null, generation: ++state.rollFxGeneration }; const duration = Math.max(900, Number(player()?.rollAnimationMs) || 900);
  document.body.classList.add("is-rolling"); dom.rollingMain.classList.remove("is-payoff", "is-near-reveal", "is-result-known"); dom.rollingMain.classList.add("is-rolling", "is-searching"); dom.resultBox.classList.remove("is-revealed", "is-payoff", "is-near-reveal"); dom.resultBox.classList.add("roll-energy"); dom.resultBox.style.setProperty("--roll-color", "var(--mint)"); dom.dice.style.setProperty("--roll-duration", `${duration}ms`); dom.dice.classList.add("is-rolling"); makeRollParticles(13, "var(--mint)"); scanFrame(SCAN_MESSAGES[0], "Dice committed · server is drawing the result"); playSound("rollStart");
  let frame = 1; presentation.scanner = window.setInterval(() => { scanFrame(SCAN_MESSAGES[frame % SCAN_MESSAGES.length]); if (frame % 2 === 0) playSound("rollTick"); frame += 1; }, 170); return presentation;
}
function finishRollPresentation(presentation, payoff = false) {
  if (presentation?.scanner) window.clearInterval(presentation.scanner); dom.dice.classList.remove("is-rolling"); dom.dice.style.removeProperty("--roll-duration"); dom.resultBox.classList.remove("roll-energy", "is-near-reveal");
  const clear = () => { if (presentation && presentation.generation !== state.rollFxGeneration) return; document.body.classList.remove("is-rolling"); dom.rollingMain.classList.remove("is-rolling", "is-searching", "is-result-known", "is-near-reveal", "is-payoff"); dom.resultBox.classList.remove("is-payoff"); dom.rollFx.replaceChildren(); };
  if (payoff && !reducedMotion()) window.setTimeout(clear, 820); else clear();
}
async function animateRoll(result, presentation) {
  const p = player(); const full = p.settings.rollingAnimation && !reducedMotion(); const tier = rollTier(result.featured); const color = result.featured.color || "var(--mint)";
  if (presentation?.scanner) window.clearInterval(presentation.scanner); dom.resultBox.style.setProperty("--roll-color", color); dom.rollingMain.style.setProperty("--roll-color", color); dom.rollingMain.dataset.rollTier = String(tier); dom.rollingMain.classList.add("is-result-known"); makeRollParticles(14 + tier * 5, color);
  if (!full) { renderResult(result.featured, result.results.length); flashRoll(tier >= 3 ? "rare" : "pulse"); makeRollParticles(14 + tier * 5, color, true); playSound("rollReveal"); if (tier >= 3) playSound("rareReveal"); finishRollPresentation(presentation, true); return; }
  const beats = 3 + tier; const crescendoMs = Math.max(720, Math.min(1450, Math.round(p.rollAnimationMs * (.37 + tier * .06))));
  for (let beat = 0; beat < beats; beat += 1) { const nearReveal = beat === beats - 1; if (nearReveal) { dom.rollingMain.classList.add("is-near-reveal"); dom.resultBox.classList.add("is-near-reveal"); flashRoll(tier >= 3 ? "rare" : "pulse"); } else if (beat > 0 && tier >= 2) flashRoll("pulse"); scanFrame(nearReveal ? "SIGNAL LOCKED — REVEALING" : SCAN_MESSAGES[(beat + 1) % SCAN_MESSAGES.length], nearReveal ? "Do not blink." : `${Math.round(((beat + 1) / beats) * 100)}% probability lock`); playSound("rollTick"); await delay(Math.max(95, Math.round(crescendoMs / beats))); }
  dom.resultBox.classList.remove("is-scanning"); dom.resultBox.classList.add("is-payoff"); dom.rollingMain.classList.add("is-payoff"); flashRoll(tier >= 3 ? "rare" : "reveal"); makeRollParticles(20 + tier * 7, color, true); renderResult(result.featured, result.results.length); playSound("rollReveal"); if (tier >= 3) playSound("rareReveal"); finishRollPresentation(presentation, true);
}
async function rollDice() {
  if (state.rolling || !player()) return; state.rolling = true; renderShell(); const presentation = beginRollPresentation();
  try { const result = await api("/api/roll", { method: "POST", body: JSON.stringify({ mutationId: requestId() }) }); if (!result.ok) { finishRollPresentation(presentation); acceptGameState(result); showToast(result.error, "error"); return; } await animateRoll(result, presentation); acceptGameState(result); state.inventory.entries = []; if (state.activeView === "inventory") refreshInventory(true); if (result.discovery) showDiscovery(result.discovery); else showToast(`${result.featured.name} joined your inventory.`); }
  catch (error) { finishRollPresentation(presentation); if (error.payload?.state) acceptGameState(error.payload); if (error.status === 401) showLogin(); else { playSound("error"); showToast(error.message, "error"); } }
  finally { state.rolling = false; renderShell(); scheduleAutoRoll(); }
}
function scheduleAutoRoll() { clearTimeout(state.autoTimer); const p = player(); if (!p?.autoRollActive || state.rolling) return; const pause = p.settings.rollingAnimation ? Math.max(900, Math.round(p.rollAnimationMs * .5)) : 900; state.autoTimer = setTimeout(() => { if (player()?.autoRollActive && document.visibilityState === "visible") rollDice(); }, pause); }
function showDiscovery(alien) { playSound("discovery"); state.lastDiscovery = alien; dom.discoveryIcon.textContent = alien.emoji; dom.discoveryName.textContent = alien.name; dom.discoveryRarity.textContent = alien.rarity.toUpperCase(); dom.discoveryChance.textContent = N.chance(alien.baseChance); dom.discoveryCard.style.setProperty("--alien-color", alien.color); if (player().settings.fullDiscovery) { dom.discoveryModal.classList.add("is-open"); dom.discoveryModal.setAttribute("aria-hidden", "false"); } else minimizeDiscovery(); }
function minimizeDiscovery() { const alien = state.lastDiscovery; dom.discoveryModal.classList.remove("is-open"); dom.discoveryModal.setAttribute("aria-hidden", "true"); if (!alien) return; dom.discoveryMini.innerHTML = `<span>${escapeHtml(alien.emoji)}</span> NEW: ${escapeHtml(alien.name)}`; dom.discoveryMini.hidden = false; }

function deployStack(key) { const entry = state.inventory.entries.find((item) => item.stackKey === key); if (!entry) return; const slot = player().placedAliens.findIndex((item) => !item); if (slot < 0) return showToast("Recall a team alien before deploying.", "error"); state.placementSlot = slot; dom.placementChoices.innerHTML = card(entry, `<button class="card-action" type="button" data-place="${escapeHtml(key)}">PLACE IN SLOT ${slot + 1}</button>`); openModal(dom.placementModal); }
function openPlacement(slot) { state.placementSlot = slot; dom.placementChoices.innerHTML = state.inventory.entries.map((entry) => card(entry, `<button class="card-action" type="button" data-place="${escapeHtml(entry.stackKey)}">DEPLOY</button>`)).join(""); openModal(dom.placementModal); }
function stackFromKey(key) { const [alienId, plus] = String(key).split("|"); return { alienId, plusLevel: Number(plus) }; }
function sacrificeQuantity(key) { return state.sacrifice.get(key)?.quantity || 0; }
function setSacrificeQuantity(entry, value) { const quantity = Math.max(0, Math.min(Number(entry.count) || 0, Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0)); if (quantity && !state.sacrifice.has(entry.stackKey) && state.sacrifice.size >= 60) { showToast("A sacrifice can contain up to 60 different stacks.", "error"); return; } if (quantity) state.sacrifice.set(entry.stackKey, { quantity, luck: Number(entry.sacrificeLuck) || 0 }); else state.sacrifice.delete(entry.stackKey); }
async function refreshSacrificeInventory(reset = false) {
  const source = state.sacrificeInventory; if (!player() || (!reset && (source.loading || source.nextOffset === null))) return; if (reset) { source.entries = []; source.nextOffset = 0; source.totalStacks = 0; source.generation = (source.generation || 0) + 1; }
  const generation = source.generation || 0; const offset = reset ? 0 : source.nextOffset; source.loading = true; renderSacrifice();
  try { const data = await api(`/api/inventory?offset=${offset}&limit=100&search=${encodeURIComponent(source.search)}`); if (generation !== (source.generation || 0)) return; source.entries = reset ? data.entries : [...source.entries, ...data.entries]; source.nextOffset = data.nextOffset; source.totalStacks = data.totalStacks; }
  catch (error) { if (error.status === 401) showLogin(); else showToast("Could not load sacrifice inventory.", "error"); }
  finally { if (generation === (source.generation || 0)) { source.loading = false; renderSacrifice(); } }
}
function openSacrifice() { const source = state.sacrificeInventory; state.sacrifice.clear(); state.sacrificeSubmitting = false; source.search = ""; source.entries = []; source.nextOffset = 0; source.totalStacks = 0; dom.sacrificeSearch.value = ""; openModal(dom.sacrificeModal); renderSacrifice(); refreshSacrificeInventory(true); }
function renderSacrifice() {
  const source = state.sacrificeInventory; const entries = source.entries; let count = 0; let gain = 0; for (const selection of state.sacrifice.values()) { count += selection.quantity; gain += selection.quantity * selection.luck; }
  const p = player(); dom.sacrificeCount.textContent = N.number(count); dom.sacrificeGain.textContent = N.luck(gain); dom.sacrificeNext.textContent = N.luck(p.permanentLuck * (1 + p.pendingLuck + gain));
  dom.sacrificeStatus.textContent = source.loading ? "Loading owned aliens…" : entries.length ? `${N.number(entries.length)} of ${N.number(source.totalStacks)} stacks loaded` : source.search ? "No owned aliens match that search." : "No stored aliens available.";
  dom.sacrificeChoices.innerHTML = entries.length ? entries.map((entry) => { const quantity = sacrificeQuantity(entry.stackKey); return `<article class="selection-card ${quantity ? "selected" : ""}" style="--alien-color:${escapeHtml(entry.color)}"><span>${escapeHtml(entry.emoji)}</span><div><b>${escapeHtml(entry.name)}${plusLabel(entry.plusLevel)}</b><small>${escapeHtml(entry.rarity).toUpperCase()} · ${N.chance(entry.baseChance)}</small><em>Owned: ${N.number(entry.count)} · Selected: ${N.number(quantity)} · ${N.luck(entry.sacrificeLuck)} each</em></div><div class="quantity-stepper"><button type="button" data-sac-minus="${escapeHtml(entry.stackKey)}" ${quantity ? "" : "disabled"} aria-label="Remove one ${escapeHtml(entry.name)}">−</button><input type="number" inputmode="numeric" min="0" max="${Number(entry.count)}" value="${quantity}" data-sac-quantity="${escapeHtml(entry.stackKey)}" aria-label="Sacrifice quantity for ${escapeHtml(entry.name)}"><button type="button" data-sac-plus="${escapeHtml(entry.stackKey)}" ${quantity >= entry.count ? "disabled" : ""} aria-label="Add one ${escapeHtml(entry.name)}">+</button></div></article>`; }).join("") : `<div class="empty-state">${source.loading ? "Scanning your stored aliens…" : "Roll an alien before making this decision."}</div>`;
  dom.sacrificeMoreButton.hidden = source.loading || source.nextOffset === null; dom.confirmSacrifice.disabled = !count || state.sacrificeSubmitting;
}
async function confirmSacrifice() { if (state.sacrificeSubmitting || !state.sacrifice.size) return; state.sacrificeSubmitting = true; renderSacrifice(); const items = [...state.sacrifice.entries()].map(([key, selection]) => ({ ...stackFromKey(key), quantity: selection.quantity })); try { const result = await act("/api/sacrifice", { items }, "Temporary Luck charged for your next roll.", { sound: "purchase" }); if (result) { closeModal(dom.sacrificeModal); state.sacrifice.clear(); state.inventory.entries = []; refreshInventory(true); } } finally { state.sacrificeSubmitting = false; renderSacrifice(); } }
function openMerge() { state.merge = null; renderMerge(); openModal(dom.mergeModal); }
function renderMerge() { const choices = state.inventory.entries.filter((entry) => entry.count >= 3 && entry.plusLevel < 3); const selected = state.merge; dom.mergePreview.innerHTML = selected ? `<span>${escapeHtml(selected.emoji)} ${escapeHtml(selected.name)}${plusLabel(selected.plusLevel)} ×3</span><b>→ ${escapeHtml(selected.emoji)} ${escapeHtml(selected.name)}${plusLabel(selected.plusLevel + 1)}</b><small>Consumes 3; creates one permanent +${selected.plusLevel + 1} stack.</small>` : "Choose an eligible stack below."; dom.mergeChoices.innerHTML = choices.length ? choices.map((entry) => `<button class="merge-choice ${selected?.stackKey === entry.stackKey ? "selected" : ""}" type="button" data-merge-choice="${escapeHtml(entry.stackKey)}"><span>${escapeHtml(entry.emoji)}</span><b>${escapeHtml(entry.name)}${plusLabel(entry.plusLevel)}</b><small>${N.number(entry.count)} copies · ${N.chance(entry.baseChance)}</small></button>`).join("") : `<div class="empty-state">No matching stacks of three yet.</div>`; dom.confirmMerge.disabled = !selected; }

function renderTrades() { const selected = state.trades.find((room) => room.id === state.selectedTrade) || state.trades.find((room) => room.status === "accepted") || null; if (selected) state.selectedTrade = selected.id; dom.tradeRooms.innerHTML = state.trades.length ? state.trades.map((room) => `<article class="trade-room ${room.id === selected?.id ? "selected" : ""}"><div><small>${escapeHtml(room.status).toUpperCase()}</small><b>${escapeHtml(room.partner)}</b><span>You: ${room.myOffer ? `${escapeHtml(room.myOffer.emoji)} ${escapeHtml(room.myOffer.name)} ×${room.myOffer.count}` : "—"} · Pilot: ${room.partnerOffer ? `${escapeHtml(room.partnerOffer.emoji)} ${escapeHtml(room.partnerOffer.name)} ×${room.partnerOffer.count}` : "—"}</span></div><div>${room.status === "invited" && !room.invitedByMe ? `<button data-accept-trade="${room.id}" type="button">ACCEPT</button>` : ""}<button data-open-trade="${room.id}" type="button">OPEN</button></div></article>`).join("") : `<div class="empty-state">No active trade rooms.</div>`; dom.tradeControls.hidden = !selected || selected.status !== "accepted"; if (!selected || selected.status !== "accepted") return; dom.tradePartner.textContent = `Trade with ${selected.partner}`; const selectedStack = state.tradeStack || state.inventory.entries[0]; if (selectedStack) state.tradeStack = selectedStack; dom.tradeChoices.innerHTML = state.inventory.entries.map((entry) => `<button class="merge-choice ${state.tradeStack?.stackKey === entry.stackKey ? "selected" : ""}" data-trade-stack="${escapeHtml(entry.stackKey)}" type="button"><span>${escapeHtml(entry.emoji)}</span><b>${escapeHtml(entry.name)}${plusLabel(entry.plusLevel)}</b><small>${N.number(entry.count)} owned · ${N.chance(entry.baseChance)}</small></button>`).join(""); state.tradeQuantity = Math.max(1, Math.min(state.tradeQuantity, state.tradeStack?.count || 1)); dom.tradeQuantity.textContent = state.tradeQuantity; dom.tradeConfirm.disabled = !selected.myOffer || !selected.partnerOffer || selected.myConfirmed; }
async function refreshTrades() { if (!player()) return; try { const data = await api("/api/trade-rooms"); state.trades = data.rooms || []; if (state.activeView === "trading") renderTrades(); } catch (error) { if (error.status === 401) showLogin(); } }

function showLogin() { clearTimeout(state.autoTimer); state.game = null; state.csrfToken = ""; state.rolling = false; dom.app.setAttribute("aria-hidden", "true"); openModal(dom.loginModal); }
function showGame() { closeModal(dom.loginModal); dom.app.setAttribute("aria-hidden", "false"); setView("rolling"); }
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
dom.inventorySearch.addEventListener("input", () => { state.inventory.search = dom.inventorySearch.value.trim(); state.inventory.entries = []; state.inventory.nextOffset = 0; refreshInventory(true); }); dom.inventoryMoreButton.addEventListener("click", () => refreshInventory());
dom.inventoryGrid.addEventListener("click", (event) => { const button = event.target.closest("[data-deploy]"); if (button) deployStack(button.dataset.deploy); }); dom.teamGrid.addEventListener("click", (event) => { const recall = event.target.closest("[data-recall]"); const slot = event.target.closest("[data-slot]"); if (recall) act("/api/remove-alien", { slotIndex: Number(recall.dataset.recall) }, "Alien returned to storage.").then((result) => { if (result) refreshInventory(true); }); if (slot) openPlacement(Number(slot.dataset.slot)); });
dom.placementChoices.addEventListener("click", (event) => { const button = event.target.closest("[data-place]"); if (!button) return; const item = stackFromKey(button.dataset.place); act("/api/place-alien", { ...item, slotIndex: state.placementSlot }, "Alien deployed to your active team.").then((result) => { if (result) { closeModal(dom.placementModal); refreshInventory(true); } }); });
dom.mergeButton.addEventListener("click", openMerge); dom.mergeChoices.addEventListener("click", (event) => { const button = event.target.closest("[data-merge-choice]"); if (!button) return; state.merge = state.inventory.entries.find((entry) => entry.stackKey === button.dataset.mergeChoice) || null; renderMerge(); playSound("menu"); }); dom.confirmMerge.addEventListener("click", () => { if (!state.merge) return; act("/api/merge", { alienId: state.merge.id, plusLevel: state.merge.plusLevel }, "Shiny alien forged.", { sound: "merge" }).then((result) => { if (result) { state.merge = null; refreshInventory(true); renderMerge(); } }); });
dom.equipBestButton.addEventListener("click", () => { dom.teamGrid.classList.add("is-replacing"); act("/api/equip-best", {}, null, { sound: "equip" }).then((result) => { setTimeout(() => dom.teamGrid.classList.remove("is-replacing"), 520); if (result) { showToast(result.changed ? "Best team equipped." : "Your team is already optimal."); refreshInventory(true); } }); });
dom.openSacrifice.addEventListener("click", openSacrifice); dom.sacrificeSearch.addEventListener("input", () => { state.sacrificeInventory.search = dom.sacrificeSearch.value.trim(); refreshSacrificeInventory(true); }); dom.sacrificeMoreButton.addEventListener("click", () => refreshSacrificeInventory()); dom.sacrificeChoices.addEventListener("click", (event) => { const plus = event.target.closest("[data-sac-plus]"); const minus = event.target.closest("[data-sac-minus]"); const key = plus?.dataset.sacPlus || minus?.dataset.sacMinus; if (!key) return; const entry = state.sacrificeInventory.entries.find((item) => item.stackKey === key); if (!entry) return; setSacrificeQuantity(entry, sacrificeQuantity(key) + (plus ? 1 : -1)); renderSacrifice(); playSound("menu"); }); dom.sacrificeChoices.addEventListener("change", (event) => { const input = event.target.closest("[data-sac-quantity]"); if (!input) return; const entry = state.sacrificeInventory.entries.find((item) => item.stackKey === input.dataset.sacQuantity); if (!entry) return; setSacrificeQuantity(entry, input.value); renderSacrifice(); }); dom.cancelSacrifice.addEventListener("click", () => { state.sacrifice.clear(); closeModal(dom.sacrificeModal); }); dom.confirmSacrifice.addEventListener("click", confirmSacrifice);
dom.shopGrid.addEventListener("click", (event) => { const upgrade = event.target.closest("[data-upgrade]"); if (upgrade) act("/api/buy-upgrade", { upgrade: upgrade.dataset.upgrade }, "Research upgraded.").then((result) => { if (result) renderShop(); }); if (event.target.closest("#buyDice")) act("/api/buy-dice", {}, "A new die joined the array.", { sound: "rareReveal" }).then((result) => { if (result) renderShop(); }); });
dom.catalogSearch.addEventListener("input", () => { state.catalog.search = dom.catalogSearch.value.trim(); state.catalog.entries = []; state.catalog.nextOffset = 0; refreshCatalog(true); }); dom.catalogMoreButton.addEventListener("click", () => refreshCatalog()); dom.rankRows.addEventListener("click", (event) => { const button = event.target.closest("[data-profile]"); if (button) showToast("Public pilot profile opens in a future station update."); });
dom.tradeInvite.addEventListener("click", () => act("/api/trade-rooms", { recipient: dom.tradeRecipient.value.trim() }, "Trade invitation sent.").then((result) => { if (result) { dom.tradeRecipient.value = ""; refreshTrades(); } })); dom.tradeRooms.addEventListener("click", (event) => { const open = event.target.closest("[data-open-trade]"); const accept = event.target.closest("[data-accept-trade]"); if (open) { state.selectedTrade = open.dataset.openTrade; renderTrades(); } if (accept) act(`/api/trade-rooms/${encodeURIComponent(accept.dataset.acceptTrade)}/accept`, {}, "Trade terminal linked.").then((result) => { if (result) { state.selectedTrade = accept.dataset.acceptTrade; refreshTrades(); } }); }); dom.tradeChoices.addEventListener("click", (event) => { const button = event.target.closest("[data-trade-stack]"); if (!button) return; state.tradeStack = state.inventory.entries.find((entry) => entry.stackKey === button.dataset.tradeStack); state.tradeQuantity = 1; renderTrades(); }); dom.tradeMinus.addEventListener("click", () => { state.tradeQuantity = Math.max(1, state.tradeQuantity - 1); renderTrades(); }); dom.tradePlus.addEventListener("click", () => { state.tradeQuantity = Math.min(state.tradeStack?.count || 1, state.tradeQuantity + 1); renderTrades(); }); dom.tradeOffer.addEventListener("click", () => { const room = state.trades.find((item) => item.id === state.selectedTrade); if (!room || !state.tradeStack) return; act(`/api/trade-rooms/${encodeURIComponent(room.id)}/offer`, { alienId: state.tradeStack.id, plusLevel: state.tradeStack.plusLevel, quantity: state.tradeQuantity }, "Offer updated.").then((result) => { if (result) refreshTrades(); }); }); dom.tradeConfirm.addEventListener("click", () => { const room = state.trades.find((item) => item.id === state.selectedTrade); if (!room) return; act(`/api/trade-rooms/${encodeURIComponent(room.id)}/confirm`, {}, null, { sound: "equip" }).then((result) => { if (result) { showToast(result.settled ? "Trade settled securely." : "Confirmation locked; awaiting the other pilot."); refreshTrades(); refreshInventory(true); } }); });
document.querySelectorAll(".nav-tab").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { syncGame(); scheduleAutoRoll(); } else clearTimeout(state.autoTimer); });
async function syncGame() { if (!player() || state.syncBusy || document.visibilityState !== "visible") return; state.syncBusy = true; try { acceptGameState(await api("/api/game-state")); } catch (error) { if (error.status === 401) showLogin(); } finally { state.syncBusy = false; } }
async function restoreSession() {
  try {
    const payload = await api("/api/game-state");
    if (acceptGameState(payload)) showGame();
  } catch (error) {
    if (error.status !== 401) showToast("Could not restore the station connection.", "error");
  }
}
window.setInterval(() => { if (!player()) return; const elapsed = (performance.now() - state.lastMoneyTick) / 1000; dom.moneyDisplay.textContent = N.coins(state.estimatedMoney + elapsed * (Number(player().incomePerSecond) || 0)); }, 250);
window.setInterval(syncGame, 25_000);
window.setInterval(pulseAlienBox, 3600);
restoreSession();
