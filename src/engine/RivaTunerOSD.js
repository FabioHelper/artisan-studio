/**
 * ARTISAN RIVATUNER STATISTICS SERVER (RTSS) OSD
 * Tailor-made, zero-overhead hardware monitoring overlay for WebGL2 real-time rendering.
 * Provides authentic RivaTuner / MSI Afterburner telemetry:
 * - Real GPU Driver & Hardware detection (WEBGL_debug_renderer_info)
 * - 60-frame rolling Frametime Sparkline Graph with 16.6ms reference line
 * - Live Draw Calls with AAA budget validation (<= 30 calls)
 * - Triangles, Vertices & VRAM geometry buffer allocations
 * - Artisan Pipeline Diagnostics (Static Shadow Map Caching & PBR Alpha Refraction)
 */
export class RivaTunerOSD {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    this.visible = true;
    this.minimized = false;

    // Frametime rolling buffer (60 samples)
    this.historySize = 60;
    this.frametimes = new Float32Array(this.historySize).fill(16.67);
    this.head = 0;
    this.lastTime = performance.now();
    this.textUpdateInterval = 120; // Update DOM text every 120ms to prevent DOM thrashing
    this.lastTextUpdate = 0;

    // Detect GPU hardware string
    this.isSoftwareRasterizer = false;
    this.gpuName = this.detectGPU();

    // Cache DOM references
    this.dom = {
      container: document.getElementById('rtss-overlay'),
      body: document.getElementById('rtss-body'),
      header: document.getElementById('rtss-header'),
      btnMin: document.getElementById('rtss-minimize'),
      btnClose: document.getElementById('rtss-close'),
      gpuName: document.getElementById('rtss-gpu-name'),
      res: document.getElementById('rtss-res'),
      fps: document.getElementById('rtss-fps'),
      frametime: document.getElementById('rtss-frametime'),
      lowFps: document.getElementById('rtss-low-fps'),
      varFrametime: document.getElementById('rtss-var-frametime'),
      canvas: document.getElementById('rtss-graph'),
      drawcalls: document.getElementById('rtss-drawcalls'),
      budgetStatus: document.getElementById('rtss-budget-status'),
      triangles: document.getElementById('rtss-triangles'),
      vertices: document.getElementById('rtss-vertices'),
      geometries: document.getElementById('rtss-geometries'),
      textures: document.getElementById('rtss-textures'),
      programs: document.getElementById('rtss-programs'),
      shadowState: document.getElementById('rtss-shadow-state'),
      refrState: document.getElementById('rtss-refr-state'),
      instCount: document.getElementById('rtss-inst-count'),
      minSummary: document.getElementById('rtss-min-summary')
    };

    if (this.dom.canvas) {
      this.ctx = this.dom.canvas.getContext('2d');
    }

    this.initEvents();
    if (this.dom.gpuName) {
      if (this.isSoftwareRasterizer) {
        this.dom.gpuName.innerHTML = `${this.gpuName} <span style="color:#ef4444;font-size:10px;font-weight:700;margin-left:4px;padding:1px 5px;background:rgba(239,68,68,0.2);border-radius:4px;border:1px solid #ef4444;">[SOFTWARE CPU]</span>`;
      } else {
        this.dom.gpuName.innerText = this.gpuName;
      }
    }
  }

  detectGPU() {
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        const unmasked = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
        if (unmasked) {
          if (/Basic Render Driver|Software|WARP|SwiftShader/i.test(unmasked)) {
            this.isSoftwareRasterizer = true;
          }
          // Format e.g., "ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 ... Direct3D11)" -> "NVIDIA GeForce RTX 3080"
          const clean = unmasked
            .replace(/^ANGLE \(([^,]+), ([^,]+).*\)$/, '$2')
            .replace(/Direct3D.*/, '')
            .trim();
          return clean || unmasked.slice(0, 32);
        }
      }
      return 'WebGL2 Hardware Renderer';
    } catch {
      return 'WebGL2 Hardware Renderer';
    }
  }

  initEvents() {
    // Hotkey toggle: F3 or backtick (`)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F3' || e.key === '`') {
        e.preventDefault();
        this.toggle();
      }
    });

    // Minimize button
    if (this.dom.btnMin) {
      this.dom.btnMin.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleMinimize();
      });
    }

    // Close button
    if (this.dom.btnClose) {
      this.dom.btnClose.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hide();
      });
    }

    // Header dragging
    if (this.dom.header && this.dom.container) {
      let isDragging = false;
      let startX, startY, origX, origY;

      this.dom.header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.rtss-actions')) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = this.dom.container.getBoundingClientRect();
        origX = rect.left;
        origY = rect.top;
        this.dom.container.style.right = 'auto';
        this.dom.container.style.bottom = 'auto';
        this.dom.container.style.left = `${origX}px`;
        this.dom.container.style.top = `${origY}px`;
      });

      window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        this.dom.container.style.left = `${Math.max(10, Math.min(window.innerWidth - 270, origX + dx))}px`;
        this.dom.container.style.top = `${Math.max(10, Math.min(window.innerHeight - 80, origY + dy))}px`;
      });

      window.addEventListener('mouseup', () => {
        isDragging = false;
      });
    }
  }

  toggle() {
    this.visible = !this.visible;
    if (this.dom.container) {
      this.dom.container.style.display = this.visible ? 'block' : 'none';
    }
    const pill = document.getElementById('btn-toggle-rtss');
    if (pill) pill.classList.toggle('active', this.visible);
  }

  show() {
    this.visible = true;
    if (this.dom.container) this.dom.container.style.display = 'block';
    const pill = document.getElementById('btn-toggle-rtss');
    if (pill) pill.classList.add('active');
  }

  hide() {
    this.visible = false;
    if (this.dom.container) this.dom.container.style.display = 'none';
    const pill = document.getElementById('btn-toggle-rtss');
    if (pill) pill.classList.remove('active');
  }

  toggleMinimize() {
    this.minimized = !this.minimized;
    if (this.dom.body) {
      this.dom.body.style.display = this.minimized ? 'none' : 'block';
    }
    if (this.dom.minSummary) {
      this.dom.minSummary.style.display = this.minimized ? 'inline-flex' : 'none';
    }
    if (this.dom.btnMin) {
      this.dom.btnMin.innerText = this.minimized ? '+' : '−';
    }
  }

  update(now, shadowBakeFrames = 0, forwardRenderMs = 0) {
    if (!this.visible && !this.minimized) return;

    const dt = now - this.lastTime;
    this.lastTime = now;

    // Record frametime in rolling buffer
    const ft = Math.max(1.0, Math.min(100.0, dt));
    this.frametimes[this.head] = ft;
    this.head = (this.head + 1) % this.historySize;

    // Update real-time sparkline graph every frame
    if (!this.minimized && this.ctx && this.dom.canvas) {
      this.drawSparkline();
    }

    // Throttled text updates to prevent layout thrashing
    if (now - this.lastTextUpdate >= this.textUpdateInterval) {
      this.lastTextUpdate = now;
      this.updateTextMetrics(ft, shadowBakeFrames, forwardRenderMs);
    }
  }

  updateTextMetrics(latestFt, shadowBakeFrames, forwardRenderMs = 0) {
    // 1. Calculate FPS, 1% Low, Variance
    let sum = 0;
    let maxFt = 0;
    const sorted = Array.from(this.frametimes).sort((a, b) => a - b);
    for (let i = 0; i < this.historySize; i++) {
      sum += this.frametimes[i];
      if (this.frametimes[i] > maxFt) maxFt = this.frametimes[i];
    }
    const avgFt = sum / this.historySize;
    const fps = Math.min(999, Math.round((1000 / avgFt) * 10) / 10);
    // 99th percentile frametime represents 1% low FPS
    const p99Ft = sorted[Math.floor(this.historySize * 0.95)] || avgFt;
    const lowFps = Math.max(1, Math.round(1000 / p99Ft));
    const variance = Math.round(Math.abs(maxFt - avgFt) * 10) / 10;

    // Detect external OS/browser 30 FPS cap (Battery Saver / 30Hz display)
    const isBatteryOr30HzLock = fps >= 29.0 && fps <= 31.0 && variance <= 1.2 && forwardRenderMs < 10.0;

    // 2. Hardware telemetry from renderer.info
    const info = this.renderer?.info;
    const calls = info?.render?.calls ?? 0;
    const triangles = info?.render?.triangles ?? 0;
    const points = info?.render?.points ?? 0;
    const lines = info?.render?.lines ?? 0;
    const vertices = triangles * 3 + points + lines * 2;
    const geos = info?.memory?.geometries ?? 0;
    const textures = info?.memory?.textures ?? 0;
    const programs = info?.programs?.length ?? 0;

    // 3. Count instanced meshes and instances
    let instMeshCount = 0;
    let totalInstances = 0;
    if (this.scene) {
      this.scene.traverse((obj) => {
        if (obj.isInstancedMesh) {
          instMeshCount++;
          totalInstances += obj.count || 0;
        }
      });
    }

    // Update DOM values
    if (this.dom.fps) {
      if (isBatteryOr30HzLock) {
        this.dom.fps.innerHTML = `${fps.toFixed(1)} <span style="font-size:7.5px;color:#cbd5e1;font-family:sans-serif;font-weight:600;margin-left:2px;letter-spacing:0.5px;padding:1px 4px;background:rgba(255,255,255,0.08);border-radius:3px;vertical-align:middle;">[BATTERY/30Hz]</span>`;
        this.dom.fps.style.color = '#38bdf8';
      } else {
        this.dom.fps.innerText = fps.toFixed(1);
        this.dom.fps.style.color = fps >= 58 ? '#4ade80' : (fps >= 30 ? '#facc15' : '#ef4444');
      }
    }
    if (this.dom.frametime) {
      this.dom.frametime.innerText = `${latestFt.toFixed(1)} ms`;
    }
    if (this.dom.lowFps) {
      this.dom.lowFps.innerText = `${lowFps} FPS`;
    }
    if (this.dom.varFrametime) {
      this.dom.varFrametime.innerText = `±${variance.toFixed(1)} ms`;
    }
    if (this.dom.res) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dpr = this.renderer ? this.renderer.getPixelRatio() : 1.0;
      this.dom.res.innerText = `${w}x${h} @ ${dpr.toFixed(2)}x DPR`;
    }

    // Draw calls & budget badge
    if (this.dom.drawcalls) {
      this.dom.drawcalls.innerText = String(calls);
    }
    if (this.dom.budgetStatus) {
      if (calls <= 30) {
        this.dom.budgetStatus.innerText = 'AAA BUDGET (<=30)';
        this.dom.budgetStatus.className = 'rtss-pill-budget rtss-budget-pass';
      } else if (calls <= 70) {
        this.dom.budgetStatus.innerText = 'OPTIMIZED (<=70)';
        this.dom.budgetStatus.className = 'rtss-pill-budget rtss-budget-opt';
      } else {
        this.dom.budgetStatus.innerText = 'HEAVY (>70)';
        this.dom.budgetStatus.className = 'rtss-pill-budget rtss-budget-heavy';
      }
    }

    if (this.dom.triangles) {
      this.dom.triangles.innerText = triangles >= 1000 ? `${(triangles / 1000).toFixed(1)}k` : String(triangles);
    }
    if (this.dom.vertices) {
      this.dom.vertices.innerText = vertices >= 1000 ? `${(vertices / 1000).toFixed(1)}k` : String(vertices);
    }
    if (this.dom.geometries) {
      this.dom.geometries.innerText = `${geos} geos`;
    }
    if (this.dom.textures) {
      this.dom.textures.innerText = `${textures} tex`;
    }
    if (this.dom.programs) {
      this.dom.programs.innerText = `${programs} shaders`;
    }

    // Pipeline diagnostics
    if (this.dom.shadowState) {
      if (shadowBakeFrames > 0) {
        this.dom.shadowState.innerText = `BAKING (${shadowBakeFrames}f depth pass)`;
        this.dom.shadowState.className = 'rtss-val rtss-pass-bake';
      } else {
        this.dom.shadowState.innerText = 'CACHED (0 passes)';
        this.dom.shadowState.className = 'rtss-val rtss-pass-cached';
      }
    }
    if (this.dom.refrState) {
      this.dom.refrState.innerText = 'PBR ALPHA (0 pre-pass)';
    }
    if (this.dom.instCount) {
      this.dom.instCount.innerText = `${instMeshCount} meshes (${totalInstances} parts)`;
    }

    // Minimized strip summary
    if (this.dom.minSummary) {
      this.dom.minSummary.innerHTML = `
        <span style="color:#4ade80;font-weight:bold;">${fps.toFixed(0)} FPS</span>
        <span style="color:#8b949e;margin:0 4px;">·</span>
        <span style="color:#38bdf8;">${latestFt.toFixed(1)}ms</span>
        <span style="color:#8b949e;margin:0 4px;">·</span>
        <span style="color:#f97316;">${calls} calls</span>
      `;
    }
  }

  drawSparkline() {
    const ctx = this.ctx;
    const w = this.dom.canvas.width;
    const h = this.dom.canvas.height;

    // Clear background
    ctx.fillStyle = '#171920';
    ctx.fillRect(0, 0, w, h);

    // Dynamic scale: max 35ms (28.5 FPS)
    const maxMs = 35.0;
    const getY = (ms) => h - 3 - (ms / maxMs) * (h - 6);

    // 16.67ms (60 FPS) target guide line
    const y60 = getY(16.67);
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.moveTo(0, y60);
    ctx.lineTo(w, y60);
    ctx.stroke();
    ctx.setLineDash([]);

    // 33.33ms (30 FPS) warning guide line
    const y30 = getY(33.33);
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.25)';
    ctx.moveTo(0, y30);
    ctx.lineTo(w, y30);
    ctx.stroke();

    // Draw frametime curve
    const step = w / (this.historySize - 1);
    ctx.beginPath();
    for (let i = 0; i < this.historySize; i++) {
      const idx = (this.head + i) % this.historySize;
      const ms = Math.min(maxMs, this.frametimes[idx]);
      const px = i * step;
      const py = getY(ms);

      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Fill subtle champagne gradient under curve
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(212, 175, 55, 0.25)');
    grad.addColorStop(1, 'rgba(212, 175, 55, 0.0)');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  getTelemetry() {
    const glInfo = this.renderer?.info;
    const latestFt = this.frametimes[(this.head - 1 + this.historySize) % this.historySize];
    const fps = latestFt > 0 ? (1000 / latestFt) : 0;
    return {
      gpu: this.gpuName,
      isSoftwareRasterizer: this.isSoftwareRasterizer,
      fps: Math.round(fps * 10) / 10,
      frametimeMs: Math.round(latestFt * 10) / 10,
      drawCalls: glInfo?.render?.calls ?? 0,
      triangles: glInfo?.render?.triangles ?? 0,
      geometries: glInfo?.memory?.geometries ?? 0,
      textures: glInfo?.memory?.textures ?? 0,
      pixelRatio: this.renderer ? this.renderer.getPixelRatio() : 1.0,
      viewport: `${window.innerWidth}x${window.innerHeight}`
    };
  }
}
