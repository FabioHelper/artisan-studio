import crypto from 'crypto';
import { AXIS, CONTRACT_VERSION, canonicalJson } from '../src/contracts/artisanContract.js';
import { authoredSceneReference } from '../src/contracts/sceneIdentityContract.js';
import { RENDERER_HASH } from '../src/contracts/sceneIdentityManifest.generated.js';

/**
 * Manages the mutable world state and undo stack.
 * Mutations are applied to a candidate copy first so callers can validate before committing.
 */
export class WorldSession {
  constructor() {
    this.manifest = this._getDefaultManifest();
    this.undoStack = [];
    this.MAX_UNDO = 50;
  }

  _getDefaultManifest() {
    return {
      worldId: 'untitled_world',
      version: 1,
      contractVersion: CONTRACT_VERSION,
      units: 'meter',
      axis: { ...AXIS },
      lighting: 'dusk',
      entities: []
    };
  }

  _saveUndoPoint() {
    this.undoStack.push(this.getManifest());
    if (this.undoStack.length > this.MAX_UNDO) this.undoStack.shift();
  }

  /** Returns a candidate manifest produced by `mutate(draft)` without committing it. */
  preview(mutate) {
    const draft = this.getManifest();
    mutate(draft);
    return draft;
  }

  /** Commits a candidate manifest (already validated by the caller). */
  commit(candidate, { bumpVersion = true } = {}) {
    this._saveUndoPoint();
    this.manifest = JSON.parse(JSON.stringify(candidate));
    if (bumpVersion) this.manifest.version += 1;
    return this.getManifest();
  }

  createWorldManifest(worldId, roomSize, lighting = 'dusk') {
    const m = this._getDefaultManifest();
    m.worldId = worldId;
    m.lighting = lighting;
    if (roomSize) m.roomSize = roomSize;
    return m;
  }

  getManifest() {
    return JSON.parse(JSON.stringify(this.manifest));
  }

  /** Full content hash; the compact identity below remains byte-compatible with P0.5. */
  sourceManifestHash(manifest = this.manifest) {
    return 'sha256:' + crypto.createHash('sha256').update(canonicalJson(manifest)).digest('hex');
  }

  sceneReference(manifest = this.manifest) {
    return authoredSceneReference({
      worldId: manifest.worldId,
      version: manifest.version,
      sourceManifestHash: this.sourceManifestHash(manifest),
      rendererHash: RENDERER_HASH
    });
  }

  /** Stable compact content hash of the manifest: same authored request => same P0.5 identity. */
  sceneIdentity(manifest = this.manifest) {
    return this.sceneReference(manifest).sceneIdentity;
  }

  undo() {
    if (this.undoStack.length === 0) return false;
    this.manifest = this.undoStack.pop();
    return true;
  }

  getEntityCount() {
    return this.manifest.entities.length;
  }

  findEntity(id) {
    return this.manifest.entities.find(e => e.id === id);
  }
}
