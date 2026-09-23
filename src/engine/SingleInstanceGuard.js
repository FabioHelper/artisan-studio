/**
 * SingleInstanceGuard.js — Absolute Mutual Exclusion & Runtime Lifecycle Guard
 * 
 * Guarantees strictly one active game or diorama rendering loop, audio context,
 * and event listener subsystem at any given moment. Prevents concurrent render loops,
 * zombie requestAnimationFrame tasks, WebAudio leaks, and listener collisions.
 */

export class SingleInstanceGuard {
  static instance = null;

  constructor() {
    this.activeMode = 'idle'; // 'idle' | 'diorama' | 'game'
    this.state = 'IDLE';       // 'IDLE' | 'DIORAMA_STARTING' | 'DIORAMA_RUNNING' | 'GAME_STARTING' | 'GAME_RUNNING' | 'TEARING_DOWN'
    this.currentRunId = 0;
    this.activeTeardown = null;
    this.transitionPromise = Promise.resolve();

    if (typeof window !== 'undefined') {
      window.__singleInstanceGuard = this;
    }
  }

  static getInstance() {
    if (!SingleInstanceGuard.instance) {
      SingleInstanceGuard.instance = new SingleInstanceGuard();
    }
    return SingleInstanceGuard.instance;
  }

  /**
   * Atomically acquire execution exclusivity for targetMode ('diorama' | 'game')
   * @param {string} targetMode
   * @param {Function} startFn
   * @param {Function} teardownFn
   * @returns {Promise<boolean>}
   */
  async acquire(targetMode, startFn, teardownFn) {
    if (this.activeMode === targetMode && (this.state === `${targetMode.toUpperCase()}_RUNNING`)) {
      console.log(`[SingleInstanceGuard] Mode '${targetMode}' is already exclusively active.`);
      return true;
    }

    const runId = ++this.currentRunId;

    // Chain onto active transition queue with error isolation to prevent queue bricking
    const nextPromise = this.transitionPromise.catch(() => {}).then(async () => {
      if (runId !== this.currentRunId) {
        console.warn(`[SingleInstanceGuard] Aborting stale transition runId ${runId} (latest is ${this.currentRunId})`);
        return false;
      }

      console.log(`[SingleInstanceGuard] Transitioning: ${this.activeMode} (${this.state}) -> ${targetMode}`);
      this.state = 'TEARING_DOWN';

      // 1. Fully tear down previous active mode
      if (this.activeTeardown) {
        try {
          await Promise.resolve(this.activeTeardown());
        } catch (err) {
          console.error('[SingleInstanceGuard] Error during active teardown:', err);
        }
        this.activeTeardown = null;
      }

      // Check race condition
      if (runId !== this.currentRunId) {
        this.state = 'IDLE';
        this.activeMode = 'idle';
        return false;
      }

      // 2. Set new mode & start
      this.state = `${targetMode.toUpperCase()}_STARTING`;
      this.activeMode = targetMode;
      this.activeTeardown = teardownFn;

      try {
        if (startFn) {
          await Promise.resolve(startFn());
        }
        this.state = `${targetMode.toUpperCase()}_RUNNING`;
        console.log(`[SingleInstanceGuard] Mode '${targetMode}' is now EXCLUSIVELY ACTIVE [runId: ${runId}]`);
        return true;
      } catch (err) {
        console.error(`[SingleInstanceGuard] Failed to boot mode '${targetMode}':`, err);
        this.state = 'IDLE';
        this.activeMode = 'idle';
        this.activeTeardown = null;
        throw err;
      }
    });

    this.transitionPromise = nextPromise;
    return nextPromise;
  }

  /**
   * Release active mode without switching
   */
  async release() {
    this.currentRunId++;
    if (this.activeTeardown) {
      try {
        await Promise.resolve(this.activeTeardown());
      } catch (err) {
        console.error('[SingleInstanceGuard] Error during release:', err);
      }
      this.activeTeardown = null;
    }
    this.state = 'IDLE';
    this.activeMode = 'idle';
  }

  getStatus() {
    return {
      activeMode: this.activeMode,
      state: this.state,
      runId: this.currentRunId,
      hasTeardown: !!this.activeTeardown
    };
  }
}
