/**
 * Manages the mutable world state and undo stack.
 */
export class WorldSession {
  constructor() {
    this.manifest = this._getDefaultManifest();
    this.undoStack = [];
    this.MAX_UNDO = 50;
  }

  /**
   * Internal: returns the default world template
   */
  _getDefaultManifest() {
    return {
      worldId: 'untitled_world',
      version: 1,
      units: 'meter',
      axis: { handedness: 'right', up: '+Y', east: '+X', south: '+Z' },
      lighting: 'dusk',
      entities: []
    };
  }

  /**
   * Internal: saves current manifest to undo stack
   */
  _saveUndoPoint() {
    this.undoStack.push(JSON.parse(JSON.stringify(this.manifest)));
    if (this.undoStack.length > this.MAX_UNDO) {
      this.undoStack.shift();
    }
  }

  /**
   * Creates a new world manifest
   * @param {string} worldId
   * @param {number[]} [roomSize]
   * @param {string} [lighting]
   */
  createWorld(worldId, roomSize, lighting = 'dusk') {
    this._saveUndoPoint();
    this.manifest = this._getDefaultManifest();
    this.manifest.worldId = worldId;
    this.manifest.lighting = lighting;
    if (roomSize) {
      this.manifest.roomSize = roomSize;
    }
    return this.getManifest();
  }

  /**
   * Adds an entity to the world
   * @param {Object} entity
   */
  addEntity(entity) {
    this._saveUndoPoint();
    this.manifest.entities.push(entity);
    this.manifest.version += 1;
  }

  /**
   * Moves or rotates an existing entity
   * @param {string} entityId
   * @param {number[]} [position]
   * @param {number[]} [rotation]
   */
  moveEntity(entityId, position, rotation) {
    const entity = this.findEntity(entityId);
    if (!entity) throw new Error(`Entity not found: ${entityId}`);
    
    this._saveUndoPoint();
    if (position) entity.transform.positionM = position;
    if (rotation) entity.transform.rotationDeg = rotation;
    this.manifest.version += 1;
  }

  /**
   * Removes an entity by ID
   * @param {string} entityId
   */
  removeEntity(entityId) {
    const index = this.manifest.entities.findIndex(e => e.id === entityId);
    if (index === -1) throw new Error(`Entity not found: ${entityId}`);
    
    this._saveUndoPoint();
    this.manifest.entities.splice(index, 1);
    this.manifest.version += 1;
  }

  /**
   * Updates an entity's materialRefs
   * @param {string} entityId
   * @param {string[]} materialRefs
   */
  replaceMaterial(entityId, materialRefs) {
    const entity = this.findEntity(entityId);
    if (!entity) throw new Error(`Entity not found: ${entityId}`);
    
    this._saveUndoPoint();
    entity.materialRefs = materialRefs;
    this.manifest.version += 1;
  }

  /**
   * Sets the world lighting preset
   * @param {string} preset
   */
  setLighting(preset) {
    this._saveUndoPoint();
    this.manifest.lighting = preset;
    this.manifest.version += 1;
  }

  /**
   * Returns a deep clone of the current manifest
   */
  getManifest() {
    return JSON.parse(JSON.stringify(this.manifest));
  }

  /**
   * Restores the previous manifest state
   */
  undo() {
    if (this.undoStack.length === 0) return false;
    this.manifest = this.undoStack.pop();
    return true;
  }

  /**
   * Returns the number of entities in the world
   */
  getEntityCount() {
    return this.manifest.entities.length;
  }

  /**
   * Finds an entity by its ID
   * @param {string} id
   */
  findEntity(id) {
    return this.manifest.entities.find(e => e.id === id);
  }
}
