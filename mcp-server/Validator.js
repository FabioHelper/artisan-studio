import {
  ARCHETYPE_CATALOG,
  MATERIAL_CATALOG,
  LIGHTING_PRESETS,
  RELATIONSHIP_TYPES,
  SUPPORT_RELATIONSHIPS,
  SELF_SUPPORTING_CATEGORIES,
  GROUND_TARGET_PATTERN,
  LIMITS,
  isKnownArchetype,
  isKnownMaterial
} from '../src/contracts/artisanContract.js';

const ID_RE = new RegExp(LIMITS.idPattern);
const GROUND_RE = new RegExp(GROUND_TARGET_PATTERN);

const issue = (code, path, message) => ({ code, path, message });

export function isFiniteVec3(v) {
  return Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n));
}

export function checkId(value, path, errors) {
  if (typeof value !== 'string' || !ID_RE.test(value)) {
    errors.push(issue('INVALID_ID', path, `${path} must match ${LIMITS.idPattern}`));
    return false;
  }
  return true;
}

export function checkPosition(v, path, errors) {
  if (!isFiniteVec3(v)) {
    errors.push(issue('INVALID_VECTOR', path, `${path} must be 3 finite numbers [x,y,z]`));
    return;
  }
  v.forEach((n, i) => {
    if (n < LIMITS.positionMinM[i] || n > LIMITS.positionMaxM[i]) {
      errors.push(issue('OUT_OF_BOUNDS', `${path}[${i}]`, `${path}[${i}]=${n} outside [${LIMITS.positionMinM[i]}, ${LIMITS.positionMaxM[i]}] m`));
    }
  });
}

export function checkRotation(v, path, errors) {
  if (!isFiniteVec3(v)) {
    errors.push(issue('INVALID_VECTOR', path, `${path} must be 3 finite numbers [pitch,yaw,roll] in degrees`));
    return;
  }
  if (v.some(n => Math.abs(n) > LIMITS.rotationAbsMaxDeg)) {
    errors.push(issue('OUT_OF_BOUNDS', path, `${path} components must be within ±${LIMITS.rotationAbsMaxDeg}°`));
  }
}

export function checkScale(v, path, errors) {
  if (!isFiniteVec3(v)) {
    errors.push(issue('INVALID_VECTOR', path, `${path} must be 3 finite numbers`));
    return;
  }
  v.forEach((s, i) => {
    if (s < LIMITS.scaleMin || s > LIMITS.scaleMax) {
      errors.push(issue('OUT_OF_BOUNDS', `${path}[${i}]`, `scale ${s} out of bounds [${LIMITS.scaleMin}, ${LIMITS.scaleMax}]`));
    }
  });
}

export function checkMaterials(refs, path, errors) {
  if (!Array.isArray(refs) || refs.length > LIMITS.maxMaterialRefs) {
    errors.push(issue('INVALID_MATERIALS', path, `${path} must be an array of at most ${LIMITS.maxMaterialRefs} material ids`));
    return;
  }
  refs.forEach((m, i) => {
    if (!isKnownMaterial(m)) {
      errors.push(issue('UNKNOWN_MATERIAL', `${path}[${i}]`, `Unknown material '${m}'. Read artisan://catalog/materials.`));
    }
  });
}

export function checkSeed(seed, path, errors) {
  if (!Number.isInteger(seed) || seed < 0 || seed > LIMITS.seedMax) {
    errors.push(issue('INVALID_SEED', path, `${path} must be an integer in [0, ${LIMITS.seedMax}]`));
  }
}

export function checkLighting(preset, path, errors) {
  if (!LIGHTING_PRESETS.includes(preset)) {
    errors.push(issue('INVALID_LIGHTING', path, `${path} must be one of ${LIGHTING_PRESETS.join(', ')}`));
  }
}

export function checkArchetype(ref, path, errors) {
  if (!isKnownArchetype(ref)) {
    errors.push(issue('UNKNOWN_ARCHETYPE', path, `Unknown archetype '${ref}'. Unknown archetypes are rejected (never degraded to a primitive). Read artisan://catalog/archetypes.`));
    return false;
  }
  return true;
}

/**
 * Validates a full world manifest against the canonical contract.
 * errors = hard contract violations (block compile); warnings = spatial advisories.
 */
export function validateWorld(manifest) {
  const errors = [];
  const warnings = [];
  const stats = { entityCount: 0, supportedCount: 0, unsupportedCount: 0, unknownArchetypes: 0, unknownMaterials: 0 };
  const done = () => ({ valid: errors.length === 0, errors, warnings, stats });

  if (!manifest || typeof manifest !== 'object') {
    errors.push(issue('INVALID_MANIFEST', '$', 'Manifest must be an object'));
    return done();
  }
  checkId(manifest.worldId, 'worldId', errors);
  if (manifest.lighting !== undefined) checkLighting(manifest.lighting, 'lighting', errors);
  if (!Array.isArray(manifest.entities)) {
    errors.push(issue('INVALID_MANIFEST', 'entities', 'entities must be an array'));
    return done();
  }
  if (manifest.entities.length > LIMITS.maxEntities) {
    errors.push(issue('TOO_MANY_ENTITIES', 'entities', `At most ${LIMITS.maxEntities} entities`));
  }

  stats.entityCount = manifest.entities.length;
  const ids = new Set();
  const dupes = new Set();
  for (const e of manifest.entities) {
    if (e && typeof e.id === 'string') {
      if (ids.has(e.id)) dupes.add(e.id);
      ids.add(e.id);
    }
  }
  dupes.forEach(id => errors.push(issue('DUPLICATE_ID', 'entities', `Duplicate entity id '${id}'`)));

  manifest.entities.forEach((entity, index) => {
    const p = `entities[${index}]`;
    if (!entity || typeof entity !== 'object') {
      errors.push(issue('INVALID_ENTITY', p, 'Entity must be an object'));
      return;
    }
    const label = entity.id || p;
    checkId(entity.id, `${p}.id`, errors);

    const knownArchetype = entity.kind === 'room' && entity.assetRef === undefined
      ? true
      : checkArchetype(entity.assetRef, `${p}.assetRef`, errors);
    if (!knownArchetype) stats.unknownArchetypes++;

    const t = entity.transform;
    if (!t || typeof t !== 'object') {
      errors.push(issue('INVALID_TRANSFORM', `${p}.transform`, 'transform.positionM is required'));
    } else {
      checkPosition(t.positionM, `${p}.transform.positionM`, errors);
      if (t.rotationDeg !== undefined) checkRotation(t.rotationDeg, `${p}.transform.rotationDeg`, errors);
      if (t.scale !== undefined) checkScale(t.scale, `${p}.transform.scale`, errors);
      if (isFiniteVec3(t.positionM)) {
        const y = t.positionM[1];
        if (y > LIMITS.floatWarnY) warnings.push(issue('FLOATING', `${p}.transform.positionM[1]`, `${label} is unexpectedly high (y=${y}). May be floating.`));
        else if (y < LIMITS.buriedWarnY) warnings.push(issue('BURIED', `${p}.transform.positionM[1]`, `${label} is unexpectedly low (y=${y}). May be buried.`));
      }
    }

    if (entity.materialRefs !== undefined) {
      const before = errors.length;
      checkMaterials(entity.materialRefs, `${p}.materialRefs`, errors);
      stats.unknownMaterials += errors.slice(before).filter(e => e.code === 'UNKNOWN_MATERIAL').length;
    }
    if (entity.seed !== undefined) checkSeed(entity.seed, `${p}.seed`, errors);

    // Relationships: canonical array of {type, target, anchor?}
    let rels = [];
    if (entity.relationships !== undefined) {
      if (!Array.isArray(entity.relationships)) {
        errors.push(issue('INVALID_RELATIONSHIPS', `${p}.relationships`, 'relationships must be an array of {type, target, anchor?}'));
      } else {
        rels = entity.relationships;
        rels.forEach((r, j) => {
          const rp = `${p}.relationships[${j}]`;
          if (!r || typeof r !== 'object' || !RELATIONSHIP_TYPES.includes(r.type) || typeof r.target !== 'string') {
            errors.push(issue('INVALID_RELATIONSHIP', rp, `Relationship must be {type: ${RELATIONSHIP_TYPES.join('|')}, target, anchor?}`));
            return;
          }
          if (!GROUND_RE.test(r.target) && !ids.has(r.target)) {
            errors.push(issue('UNKNOWN_TARGET', `${rp}.target`, `Target '${r.target}' is neither ground.* nor an entity in this world`));
          }
          if (r.target === entity.id) errors.push(issue('SELF_REFERENCE', `${rp}.target`, 'Entity cannot relate to itself'));
          if (r.anchor !== undefined) {
            const targetEntity = manifest.entities.find(e => e && e.id === r.target);
            const anchors = targetEntity && ARCHETYPE_CATALOG[targetEntity.assetRef]?.anchors;
            if (typeof r.anchor !== 'string' || (anchors && !anchors.includes(r.anchor))) {
              errors.push(issue('UNKNOWN_ANCHOR', `${rp}.anchor`, `Anchor '${r.anchor}' not declared on '${r.target}'${anchors ? ` (available: ${anchors.join(', ') || 'none'})` : ''}`));
            }
          }
        });
      }
    }

    // Law A (support) — advisory for self-supporting categories
    const category = ARCHETYPE_CATALOG[entity.assetRef]?.category;
    if (knownArchetype && category && !SELF_SUPPORTING_CATEGORIES.includes(category)) {
      if (rels.some(r => r && SUPPORT_RELATIONSHIPS.includes(r.type))) stats.supportedCount++;
      else {
        stats.unsupportedCount++;
        warnings.push(issue('LAW_A_UNSUPPORTED', `${p}.relationships`, `${label} lacks a supported_by/attached_to relationship. May float.`));
      }
    }
  });

  return done();
}

/** Human one-liner for an issue list. */
export function formatIssues(list) {
  return list.map(i => `${i.code} @ ${i.path}: ${i.message}`);
}

export { MATERIAL_CATALOG, ARCHETYPE_CATALOG };
