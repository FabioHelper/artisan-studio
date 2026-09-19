import { MATERIAL_CATALOG, ARCHETYPE_CATALOG } from './catalogs.js';

/**
 * Validates a world manifest.
 * @param {Object} manifest 
 * @returns {Object} Validation report
 */
export function validateWorld(manifest) {
  const report = {
    valid: true,
    errors: [],
    warnings: [],
    stats: {
      entityCount: 0,
      supportedCount: 0,
      unsupportedCount: 0,
      unknownArchetypes: 0,
      unknownMaterials: 0
    }
  };

  if (!manifest || typeof manifest !== 'object') {
    report.valid = false;
    report.errors.push('Manifest must be an object');
    return report;
  }

  if (!manifest.worldId || typeof manifest.worldId !== 'string') {
    report.valid = false;
    report.errors.push('worldId must be a non-empty string');
  }

  if (!Array.isArray(manifest.entities)) {
    report.valid = false;
    report.errors.push('entities must be an array');
    return report;
  }

  report.stats.entityCount = manifest.entities.length;
  const seenIds = new Set();

  manifest.entities.forEach((entity, index) => {
    // 3. Basic Entity Shape
    if (!entity.id || typeof entity.id !== 'string') {
      report.valid = false;
      report.errors.push(`Entity at index ${index} missing valid 'id'`);
    } else {
      // 7. Duplicate ID check
      if (seenIds.has(entity.id)) {
        report.valid = false;
        report.errors.push(`Duplicate entity ID found: ${entity.id}`);
      }
      seenIds.add(entity.id);
    }

    if (!entity.assetRef) {
      report.valid = false;
      report.errors.push(`Entity ${entity.id || index} missing 'assetRef'`);
    } else if (!ARCHETYPE_CATALOG[entity.assetRef]) {
      report.warnings.push(`Entity ${entity.id} uses unknown assetRef: ${entity.assetRef}`);
      report.stats.unknownArchetypes++;
    }

    if (!entity.transform || !Array.isArray(entity.transform.positionM) || entity.transform.positionM.length !== 3) {
      report.valid = false;
      report.errors.push(`Entity ${entity.id || index} missing valid transform.positionM`);
    } else {
      // 8. Y-position sanity
      const yPos = entity.transform.positionM[1];
      if (yPos > 4.0) {
        report.warnings.push(`Entity ${entity.id} is unexpectedly high (y=${yPos}). May be floating.`);
      } else if (yPos < -0.5) {
        report.warnings.push(`Entity ${entity.id} is unexpectedly low (y=${yPos}). May be buried.`);
      }
    }

    // 4. Material vocabulary check
    if (entity.materialRefs && Array.isArray(entity.materialRefs)) {
      entity.materialRefs.forEach(mat => {
        if (!MATERIAL_CATALOG[mat]) {
          report.warnings.push(`Entity ${entity.id} uses unknown materialRef: ${mat}`);
          report.stats.unknownMaterials++;
        }
      });
    }

    // 5. Law A (Support)
    const isArchitecture = entity.assetRef && ARCHETYPE_CATALOG[entity.assetRef]?.category === 'architecture';
    const isLighting = entity.assetRef && ARCHETYPE_CATALOG[entity.assetRef]?.category === 'lighting';
    if (!isArchitecture && !isLighting) {
      // It's a prop or furniture, check for relationships
      const hasSupport = entity.relationships && 
                         (entity.relationships.supported_by || entity.relationships.attached_to);
      if (hasSupport) {
        report.stats.supportedCount++;
      } else {
        report.warnings.push(`Entity ${entity.id} lacks 'supported_by' or 'attached_to' relationship. May be floating.`);
        report.stats.unsupportedCount++;
      }
    }

    // 6. Law D (Scale)
    if (entity.transform && Array.isArray(entity.transform.scale)) {
      entity.transform.scale.forEach(s => {
        if (typeof s !== 'number' || s < 0.1 || s > 10.0) {
          report.valid = false;
          report.errors.push(`Entity ${entity.id} scale value ${s} out of bounds [0.1, 10.0]`);
        }
      });
    }
  });

  return report;
}
