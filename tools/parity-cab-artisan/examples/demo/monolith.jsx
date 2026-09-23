// DEMO MONOLITH — a tiny single-file "app" used to test the parity-cab harness in
// isolation (does NOT touch any real project). The modular/ folder is its
// "modularized" cutover, with TWO planted divergences the harness should catch.

const TAU = 6.2832;

// exported helper (top-level symbol — Stage 01/03 symbol diff)
export function ring(r) { return TAU * r; }

// closure-scoped helper (Stage 09 coverage tracks non-exported code)
function badge(on) { return on ? "● Live" : "○ Off"; }

// singleton (Stage 08 singleton-scan)
const Counter = (() => {
  let n = 0;
  return { hit() { n++; }, val() { return n; } };
})();

// React HUD with STATIC + DYNAMIC JSX labels (Stage 09b jsx-coverage via ast-grep)
export function HUD({ items }) {
  return (
    <div className="hud">
      <h3>Control Deck</h3>
      {items.map(i => <button key={i}>{i}% Quality</button>)}
      <span>{Counter.val() > 0 ? "85% Boost Active" : "Standby"}</span>
      <em>Click · Drag · Scroll</em>
    </div>
  );
}
