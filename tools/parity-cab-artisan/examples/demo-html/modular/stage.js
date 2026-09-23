// modular — faithful extraction of the monolith's inline <script>.
export const TAU = 6.2832;

export class Stage {
  constructor(el) { this.el = el; this.n = 0; }
  tick() {
    const step = TAU / 60;
    this.n += step;
    return this.n;
  }
}

export function boot(id) {
  const el = document.getElementById(id);
  const stage = new Stage(el);
  return stage;
}
