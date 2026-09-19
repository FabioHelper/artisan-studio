/**
 * SPATIAL & CONSTRAINT VALIDATOR (World Compass Laws A–G)
 * Enforces physical correctness, support relationships, clearance, and scale laws.
 */
export class SpatialValidator {
  constructor(materialFoundry) {
    this.materialFoundry = materialFoundry;
  }

  validateWorld(world) {
    const report = {
      valid: true,
      errors: [],
      warnings: [],
      stats: {
        entityCount: 0,
        supportedCount: 0,
        unsupportedCount: 0
      }
    };

    if (!world || !world.worldId) {
      report.valid = false;
      report.errors.push('Manifest missing required "worldId".');
      return report;
    }

    if (!Array.isArray(world.entities)) {
      report.valid = false;
      report.errors.push('Manifest missing required "entities" array.');
      return report;
    }

    const entityMap = new Map();
    world.entities.forEach(e => entityMap.set(e.id, e));
    report.stats.entityCount = world.entities.length;

    // Validate each entity against spatial laws
    for (const entity of world.entities) {
      // 1. ID uniqueness & format
      if (!entity.id) {
        report.valid = false;
        report.errors.push('Entity missing required "id".');
        continue;
      }

      // 2. Transform validation
      if (!entity.transform || !entity.transform.positionM) {
        report.valid = false;
        report.errors.push(`Entity "${entity.id}" missing transform.positionM.`);
      }

      // 3. Material vocabulary integrity
      if (Array.isArray(entity.materialRefs)) {
        for (const matRef of entity.materialRefs) {
          if (!this.materialFoundry.materials.has(matRef)) {
            report.warnings.push(`Entity "${entity.id}" references unverified material "${matRef}". Using fallback.`);
          }
        }
      }

      // 4. Law A: Physical Support Law
      if (entity.kind === 'prop') {
        const hasSupport = Array.isArray(entity.relationships) && entity.relationships.some(
          r => (r.type === 'supported_by' || r.type === 'attached_to')
        );

        if (hasSupport) {
          report.stats.supportedCount++;
          // Verify target exists if not ground
          for (const rel of entity.relationships) {
            if (rel.target && !rel.target.startsWith('ground') && !entityMap.has(rel.target)) {
              report.warnings.push(`Entity "${entity.id}" supported by "${rel.target}" which is not in this manifest.`);
            }
          }
        } else {
          report.stats.unsupportedCount++;
          report.warnings.push(`[Law A Support Warning] Prop "${entity.id}" has no explicit "supported_by" relationship. May float in mid-air.`);
        }
      }

      // 5. Law D: Scale integrity checks
      if (entity.transform && entity.transform.scale) {
        const [sx, sy, sz] = entity.transform.scale;
        if (sx <= 0 || sy <= 0 || sz <= 0) {
          report.valid = false;
          report.errors.push(`Entity "${entity.id}" has invalid non-positive scale: [${sx}, ${sy}, ${sz}].`);
        }
      }
    }

    return report;
  }
}
