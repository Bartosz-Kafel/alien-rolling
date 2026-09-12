"use strict";

// Presentation-only formatter. Game values stay as numbers / immutable chance
// strings; no gameplay code ever parses the compact strings created here.
(() => {
  const SUFFIXES = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc", "Ud", "Dd", "Td", "Qad", "Qid"];
  const commas = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  function fromIntegerString(value, exactLimit = 6) {
    const raw = String(value || "0").replace(/^0+(?=\d)/, "") || "0";
    if (!/^\d+$/.test(raw)) return "0";
    if (raw.length <= exactLimit) return commas(raw);
    const group = Math.floor((raw.length - 1) / 3);
    const suffix = SUFFIXES[group] || `e${group * 3}`;
    const head = raw.slice(0, raw.length - group * 3);
    const tail = raw.slice(raw.length - group * 3, raw.length - group * 3 + 1);
    return `${head}${tail && tail !== "0" ? `.${tail}` : ""}${suffix}`;
  }
  function number(value, options = {}) {
    const safe = Math.max(0, Number(value) || 0);
    if (safe < 1000) return safe % 1 ? safe.toFixed(options.decimals ?? 1).replace(/\.0$/, "") : String(Math.round(safe));
    const group = Math.min(SUFFIXES.length - 1, Math.floor(Math.log10(safe) / 3));
    const scaled = safe / (10 ** (group * 3));
    return `${scaled.toFixed(scaled < 10 ? 1 : 0).replace(/\.0$/, "")}${SUFFIXES[group]}`;
  }
  function coins(value) { return `${number(value)} ◈`; }
  function chance(value) { return `1 / ${fromIntegerString(value)}`; }
  function luck(value) { return `x${number(value)}`; }
  function duration(value) { const seconds = Math.max(0, Math.floor(Number(value) || 0)); const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); return hours ? `${hours}h ${minutes}m` : `${minutes}m ${seconds % 60}s`; }
  window.gameNumbers = Object.freeze({ number, coins, chance, luck, duration, exactInteger: commas });
})();
