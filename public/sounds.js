"use strict";

// One replaceable procedural sound bus. Replace a recipe here with an audio
// asset later without touching gameplay, UI, or animation code.
(() => {
  let context; let master;
  function start() {
    if (!context) {
      context = new (window.AudioContext || window.webkitAudioContext)();
      const compressor = context.createDynamicsCompressor(); master = context.createGain();
      compressor.threshold.value = -20; compressor.knee.value = 18; compressor.ratio.value = 9; master.gain.value = 0.15;
      master.connect(compressor).connect(context.destination);
    }
    if (context.state === "suspended") context.resume();
  }
  function tone(frequency, duration, { end, delay = 0, type = "triangle", volume = 0.1 } = {}) {
    try { start(); const at = context.currentTime + delay; const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, at); if (end) oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, end), at + duration); gain.gain.setValueAtTime(0.0001, at); gain.gain.exponentialRampToValueAtTime(volume, at + 0.015); gain.gain.exponentialRampToValueAtTime(0.0001, at + duration); oscillator.connect(gain).connect(master); oscillator.start(at); oscillator.stop(at + duration + .03); } catch { /* Audio needs a browser gesture. */ }
  }
  const recipes = Object.freeze({
    rollStart: () => tone(160, .22, { end: 370, volume: .1 }),
    rollTick: () => tone(310, .06, { end: 470, volume: .045 }),
    rollReveal: () => { tone(440, .24, { end: 790, volume: .11 }); tone(690, .19, { end: 1000, delay: .1, volume: .06 }); },
    rareReveal: () => { tone(250, .5, { end: 1120, type: "sine", volume: .13 }); tone(760, .36, { end: 1500, delay: .14, volume: .07 }); },
    purchase: () => tone(560, .14, { end: 870, volume: .09 }),
    discovery: () => { tone(330, .42, { end: 990, type: "sine", volume: .12 }); tone(660, .32, { end: 1320, delay: .14, volume: .065 }); },
    merge: () => { tone(240, .18, { end: 450, volume: .08 }); tone(520, .28, { end: 920, delay: .12, volume: .1 }); },
    equip: () => tone(460, .13, { end: 730, volume: .08 }),
    alienMoney: () => tone(720, .09, { end: 940, volume: .045 }),
    autoOn: () => tone(380, .18, { end: 670, volume: .07 }),
    menu: () => tone(410, .09, { end: 560, volume: .05 }),
    error: () => tone(160, .2, { end: 85, type: "sawtooth", volume: .06 })
  });
  window.playSound = (name) => recipes[name]?.();
})();
