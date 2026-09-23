// modular core — faithful extraction of the monolith's non-UI logic.
const TAU = 6.2832;

export function ring(r) { return TAU * r; }

export function badge(on) { return on ? "● Live" : "○ Off"; }

export const Counter = (() => {
  let n = 0;
  return { hit() { n++; }, val() { return n; } };
})();
