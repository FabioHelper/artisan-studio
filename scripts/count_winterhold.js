import { MaterialFoundry } from './src/engine/MaterialFoundry.js';
import { WorldCompiler } from './src/engine/WorldCompiler.js';
import { ManifestWinterholdCollege } from './src/presets/manifests.js';

const materials = new MaterialFoundry();
const compiler = new WorldCompiler(materials);
const result = compiler.compile(ManifestWinterholdCollege);

let meshCount = 0;
let pointCount = 0;
let totalTris = 0;
const entityStats = {};

result.group.children.forEach(child => {
  let count = 0;
  child.traverse(node => {
    if (node.isMesh || node.isPoints) {
      count++;
      if (node.isMesh) meshCount++;
      if (node.isPoints) pointCount++;
      const geo = node.geometry;
      if (geo) {
        const index = geo.getIndex();
        const pos = geo.getAttribute('position');
        const tris = index ? index.count / 3 : (pos ? pos.count / 3 : 0);
        totalTris += Math.round(tris);
      }
    }
  });
  entityStats[child.name || 'unnamed'] = count;
});

console.log('=== WINTERHOLD COLLEGE COMPILED STATS ===');
console.log('Total Meshes/Points (Draw Calls):', meshCount + pointCount);
console.log('Total Triangles:', totalTris);
console.log('Per-Entity Mesh Breakdown:', JSON.stringify(entityStats, null, 2));
