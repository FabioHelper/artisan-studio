// modular HUD — PLANTED DIVERGENCES (so the harness has something to catch):
//   1. The "85% Boost Active" dynamic label was silently changed to "Active".
//   2. The "Click · Drag · Scroll" controls hint (<em>) was dropped entirely.
// Stage 09b (jsx-coverage / ast-grep) should flag both as dropped JSX labels —
// the exact "85%/70%/55% silently dropped" class a regex scanner cannot see.
import { Counter } from "./core.js";

export function HUD({ items }) {
  return (
    <div className="hud">
      <h3>Control Deck</h3>
      {items.map(i => <button key={i}>{i}% Quality</button>)}
      <span>{Counter.val() > 0 ? "Active" : "Standby"}</span>
    </div>
  );
}
