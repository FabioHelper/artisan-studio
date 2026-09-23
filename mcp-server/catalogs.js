// Thin re-export: the canonical contract lives in src/contracts/artisanContract.js.
// Do not add catalog entries here — edit the contract so the MCP, browser compiler,
// skill resources and drift check stay in agreement.
export {
  MATERIAL_CATALOG,
  ARCHETYPE_CATALOG,
  LIGHTING_PRESETS,
  COORDINATE_SYSTEM,
  PERFORMANCE_PROFILES
} from '../src/contracts/artisanContract.js';
