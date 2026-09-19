#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { WebSocketServer } from 'ws';
import { WorldSession } from './WorldSession.js';
import { validateWorld } from './Validator.js';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { MATERIAL_CATALOG, ARCHETYPE_CATALOG, LIGHTING_PRESETS } from './catalogs.js';
import { runHeadlessAudit, captureHeadlessScreenshot, getHeadlessTelemetry, ARTIFACTS_DIR } from './HeadlessRunner.js';

// Setup HTTP Server & WebSocket Bridge on port 9900
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Artisan 3D Bridge (Port 9900)</title>
  <meta http-equiv="refresh" content="3; url=http://localhost:5173/">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0e1117; color: #e6edf3; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: rgba(22, 27, 34, 0.92); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 16px; padding: 36px 44px; max-width: 500px; box-shadow: 0 12px 36px rgba(0,0,0,0.65); text-align: center; }
    .badge { display: inline-block; background: #10b981; color: #fff; font-size: 11px; font-weight: 700; padding: 4px 14px; border-radius: 20px; text-transform: uppercase; margin-bottom: 18px; letter-spacing: 0.8px; }
    h2 { margin: 0 0 12px; font-size: 22px; color: #fff; }
    p { color: #8b949e; line-height: 1.6; margin-bottom: 24px; font-size: 14px; }
    code { background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px; color: #ffbe76; font-size: 13px; }
    .btn { display: inline-block; background: #e58e3e; color: #fff; text-decoration: none; padding: 12px 26px; border-radius: 10px; font-weight: 600; font-size: 14px; box-shadow: 0 4px 14px rgba(229,142,62,0.4); transition: transform 0.15s, background 0.15s; }
    .btn:hover { background: #f59e0b; transform: translateY(-1px); }
    .sub { font-size: 12px; color: #64748b; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">● WebSocket Active</div>
    <h2>Artisan 3D Studio Bridge</h2>
    <p>Port <code>9900</code> is the active WebSocket bridge (<code>ws://localhost:9900</code>) for live MCP preview sync.<br><br>The visual 3D studio application runs on port <code>5173</code>.</p>
    <a class="btn" href="http://localhost:5173/">Open Artisan 3D Studio (Port 5173) &rarr;</a>
    <div class="sub">Redirecting automatically in 3 seconds...</div>
  </div>
</body>
</html>`);
});

let requestIdCounter = 1;
const pendingRequests = new Map();

export function sendWsCommand(type, payload = {}, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    let targetClient = null;
    for (const client of wss.clients) {
      if (client.readyState === 1) { // OPEN
        targetClient = client;
        break;
      }
    }
    if (!targetClient) {
      return reject(new Error('NO_CLIENT_CONNECTED'));
    }

    const id = `req_${Date.now()}_${requestIdCounter++}`;
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`WebSocket command '${type}' timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    pendingRequests.set(id, { resolve, reject, timer });
    targetClient.send(JSON.stringify({ type, id, ...payload }));
  });
}

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('[WS/HTTP] Port 9900 already occupied by active daemon. Continuing on stdio.');
  } else {
    console.error('[WS/HTTP] HTTP Server error:', err);
  }
});

const wss = new WebSocketServer({ server: httpServer });
wss.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // Handled by httpServer error listener
  } else {
    console.error('[WSS] WebSocket error:', err);
  }
});
try {
  httpServer.listen(9900, () => {
    console.error('[WS/HTTP] Artisan Bridge listening on port 9900');
  });
} catch (e) {
  console.error('[WS/HTTP] Listen error:', e);
}

wss.on('connection', (ws) => {
  console.error('[WS] Client connected to preview bridge');
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.id && pendingRequests.has(msg.id)) {
        const { resolve, timer } = pendingRequests.get(msg.id);
        clearTimeout(timer);
        pendingRequests.delete(msg.id);
        resolve(msg);
      }
    } catch (e) {
      console.error('[WS] Error handling message:', e);
    }
  });
  ws.on('close', () => console.error('[WS] Client disconnected'));
});

function broadcastManifest(manifest) {
  const data = JSON.stringify(manifest);
  for (const client of wss.clients) {
    if (client.readyState === 1) { // OPEN
      client.send(data);
    }
  }
}

const session = new WorldSession();

const server = new Server({
  name: "artisan-3d",
  version: "1.0.0"
}, {
  capabilities: {
    tools: {},
    resources: {},
    prompts: {}
  }
});

// Resources
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    { uri: "materials://catalog", name: "Material Catalog" },
    { uri: "archetypes://catalog", name: "Archetype Catalog" },
    { uri: "schemas://world", name: "World Manifest Schema" }
  ]
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params?.uri;
  if (uri === "materials://catalog") {
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(MATERIAL_CATALOG, null, 2) }] };
  } else if (uri === "archetypes://catalog") {
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(ARCHETYPE_CATALOG, null, 2) }] };
  } else if (uri === "schemas://world") {
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ description: "World Manifest Template", type: "object" }, null, 2) }] };
  }
  throw new Error(`Resource not found: ${uri}`);
});

// Prompts
server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    { name: "authoring-manual", description: "Authoring instruction set for the LLM" },
    { name: "scene-template", description: "Pre-filled create_world + add_entity sequence", arguments: [{ name: "theme", required: true }] }
  ]
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const name = request.params?.name;
  const args = request.params?.arguments;
  if (name === "authoring-manual") {
    return {
      messages: [{ role: "system", content: { type: "text", text: "Artisan 3D Authoring Manual (Studio AAA Standard)\n\n1. Inversion of control: Output pure JSON representations (.world.json). Never write raw Three.js code.\n2. Prohibit Primitive Reductionism: Standalone box/cylinder shortcuts are prohibited. Always reference compound archetypes.\n3. Observe the 5-Tier Compounding Law: Base/Plinth, Structural Core, Articulation/Fasteners, Narrative Clutter/Patina, and Calibrated Photometrics.\n4. Spatial Invariants: Use right-handed coordinates (+Y up, +X east, +Z south, units in meters). Every prop must declare support relationships ('supported_by', 'anchored_to').\n5. Performance Invariants: Draw calls <= 30, triangles <= 15k, 60 FPS locked." } }]
    };
  } else if (name === "scene-template") {
    const theme = args?.theme || 'default';
    return {
      messages: [{ role: "user", content: { type: "text", text: `Initialize a ${theme} scene.` } }]
    };
  }
  throw new Error(`Prompt not found: ${name}`);
});

// Tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "create_world", description: "Create a new 3D world. Call this FIRST before adding entities. Sets up the world ID, optional room dimensions [width, height, depth] in meters, and lighting mood.", inputSchema: { type: "object", properties: { worldId: { type: "string", description: "Semantic world ID, e.g. 'medieval_tavern_01'" }, roomSize: { type: "array", items: { type: "number" }, description: "[width, height, depth] in meters, e.g. [8, 3, 6]" }, lighting: { type: "string", enum: ["dusk", "hearth", "day"], description: "Lighting mood preset. 'dusk' = balanced warm/cool, 'hearth' = dramatic fire-lit, 'day' = bright studio" } }, required: ["worldId"] } },
    { name: "add_entity", description: "Add an artisan-grade 3D entity to the world. Uses the archetype catalog for procedural geometry — you do NOT need to write any 3D code. Supported archetypes: forge.stone_chimney_family, arch.fireplace, arch.hearth, arch.floor, arch.wall, furniture.table, furniture.bench, furniture.bookshelf, furniture.desk, anvil.forged_iron_01, bellows.leather_iron_01, workshop.weapon_rack, kitchen.cauldron, storage.chest, storage.barrel, storage.crate, lighting.lantern, decor.woven_rug, painting.sun_mountain_01. Materials: wood.dark_oak, wood.weathered_oak, stone.rough_local, metal.forged_iron, metal.polished_iron, leather.worn, ember, etc.", inputSchema: { type: "object", properties: { entityId: { type: "string", description: "Semantic entity ID, e.g. 'prop.table.oak.001'" }, assetRef: { type: "string", description: "Archetype from the catalog, e.g. 'furniture.table'" }, position: { type: "array", items: { type: "number" }, description: "[x, y, z] in meters. +X=east, +Y=up, +Z=south. Floor is y=0." }, rotation: { type: "array", items: { type: "number" }, description: "[pitch, yaw, roll] in degrees" }, scale: { type: "array", items: { type: "number" }, description: "[sx, sy, sz] scale factors, default [1,1,1]" }, materialRefs: { type: "array", items: { type: "string" }, description: "Canonical material family names" }, parent: { type: "string", description: "Parent entity ID for anchor snapping" }, anchor: { type: "string", description: "Anchor point on parent, e.g. 'anchor.surface.top'" }, authorship: { type: "object", description: "Authorship metadata: {maker, ageYears, care, wealth, seed}", properties: { maker: { type: "string" }, ageYears: { type: "number" }, care: { type: "number" }, wealth: { type: "number" }, seed: { type: "integer" } } } }, required: ["entityId", "assetRef"] } },
    { name: "move_entity", description: "Move or rotate an existing entity in the world. Provide new position and/or rotation.", inputSchema: { type: "object", properties: { entityId: { type: "string", description: "The entity ID to move" }, position: { type: "array", items: { type: "number" }, description: "[x, y, z] new position in meters" }, rotation: { type: "array", items: { type: "number" }, description: "[pitch, yaw, roll] new rotation in degrees" } }, required: ["entityId"] } },
    { name: "remove_entity", description: "Remove an entity from the world by its ID.", inputSchema: { type: "object", properties: { entityId: { type: "string", description: "The entity ID to remove" } }, required: ["entityId"] } },
    { name: "replace_material", description: "Change an entity's material families. Use canonical material names from the catalog.", inputSchema: { type: "object", properties: { entityId: { type: "string", description: "The entity ID" }, materialRefs: { type: "array", items: { type: "string" }, description: "New material family names, e.g. ['wood.dark_oak', 'metal.forged_iron']" } }, required: ["entityId", "materialRefs"] } },
    { name: "validate_scene", description: "Run spatial law validation on the current world. Checks: support relationships, scale bounds, duplicate IDs, material vocabulary, Y-position sanity. Returns errors and warnings.", inputSchema: { type: "object", properties: {} } },
    { name: "compile_preview", description: "Validate the world and push it to the live browser preview via WebSocket. The browser will compile the manifest into a Three.js scene graph and render it in real-time. Returns validation report and entity count.", inputSchema: { type: "object", properties: {} } },
    { name: "set_lighting", description: "Change the lighting mood preset. 'dusk' = balanced warm/cool twilight, 'hearth' = dramatic fire-lit night, 'day' = bright high-visibility daylight.", inputSchema: { type: "object", properties: { preset: { type: "string", enum: LIGHTING_PRESETS, description: "Lighting preset name" } }, required: ["preset"] } },
    { name: "get_telemetry", description: "Get current world statistics: entity count, archetype breakdown, material usage, and validation status.", inputSchema: { type: "object", properties: {} } },
    { name: "run_performance_audit", description: "Executes the 7-Point Smoking Gun Empirical Performance Audit on the Artisan 3D engine. Tests baseline frametime, shadow rebake penalty, PMREM envMap cost, fill-rate scaling (DPR 2.0 vs 1.0), and per-entity bisection deltas. Writes report to conversation artifacts (perf_audit_report.json / .md) and returns zero-trust empirical metrics.", inputSchema: { type: "object", properties: { scene: { type: "string", enum: ["tokyo", "winterhold", "trio", "tavern", "alchemist", "armory", "library"], description: "Optional scene to audit, defaults to currently active scene" } } } },
    { name: "capture_viewport_screenshot", description: "Captures a high-resolution PNG screenshot of the live 3D viewport (including RTSS hardware OSD, telemetry badges, and lighting). Writes directly to the conversation artifacts directory and returns the absolute markdown link.", inputSchema: { type: "object", properties: { filename: { type: "string", description: "Target PNG filename, e.g. 'tokyo_osd_verified.png'" }, angle: { type: "string", enum: ["hero", "workstation", "skyline", "enchanter", "shelf", "aurora"], description: "Optional camera angle preset" }, scene: { type: "string", enum: ["tokyo", "winterhold", "trio", "tavern", "alchemist", "armory", "library"], description: "Optional scene preset" } } } },
    { name: "get_engine_telemetry", description: "Queries real-time hardware telemetry: GPU driver string (detects hardware vs Microsoft Basic Render Driver software fallback), FPS, 1% low, frametime, draw calls, triangles, active geometries, textures, and DPR.", inputSchema: { type: "object", properties: {} } },
    { name: "import_telemetry_logs", description: "Extracts current hardware telemetry, profiler history, and scene hierarchy stats into persistent JSON and Markdown artifacts in the conversation brain directory.", inputSchema: { type: "object", properties: {} } }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const name = request.params?.name;
    const args = request.params?.arguments || {};
    
    if (name === "create_world") {
      const { worldId, roomSize, lighting } = args;
      const manifest = session.createWorld(worldId, roomSize, lighting);
      broadcastManifest(manifest);
      return { content: [{ type: "text", text: `World created: ${worldId}` }] };
    } 
    else if (name === "add_entity") {
      const archetype = ARCHETYPE_CATALOG[args.assetRef];
      const kind = archetype?.category || 'prop';
      
      // Build relationships — auto-add ground support if no parent specified
      const relationships = {};
      if (args.parent) {
        if (args.anchor) {
          relationships.attached_to = { parent: args.parent, anchor: args.anchor };
        } else {
          relationships.supported_by = args.parent;
        }
      } else if (kind !== 'architecture' && kind !== 'decor') {
        // Auto-support: props and furniture rest on ground by default
        relationships.supported_by = 'ground.stone';
      }
      
      const entity = {
        id: args.entityId,
        assetRef: args.assetRef,
        kind,
        transform: {
          positionM: args.position || [0, 0, 0],
          rotationDeg: args.rotation || [0, 0, 0],
          scale: args.scale || [1, 1, 1]
        },
        materialRefs: args.materialRefs || (archetype ? [] : []),
        relationships,
        seed: args.authorship?.seed || Math.floor(Math.random() * 999),
        authorship: args.authorship || {}
      };
      
      session.addEntity(entity);
      broadcastManifest(session.getManifest());
      
      const validation = validateWorld(session.getManifest());
      const warnings = validation.warnings.length > 0 ? `\nWarnings: ${validation.warnings.join(', ')}` : '';
      const dims = archetype ? ` (${archetype.dimensions[0]}×${archetype.dimensions[1]}×${archetype.dimensions[2]}m)` : '';
      return { content: [{ type: "text", text: `✓ Added ${kind}: ${args.entityId} [${args.assetRef}]${dims}${warnings}` }] };
    }
    else if (name === "move_entity") {
      session.moveEntity(args.entityId, args.position, args.rotation);
      broadcastManifest(session.getManifest());
      return { content: [{ type: "text", text: `Moved entity: ${args.entityId}` }] };
    }
    else if (name === "remove_entity") {
      session.removeEntity(args.entityId);
      broadcastManifest(session.getManifest());
      return { content: [{ type: "text", text: `Removed entity: ${args.entityId}` }] };
    }
    else if (name === "replace_material") {
      session.replaceMaterial(args.entityId, args.materialRefs);
      broadcastManifest(session.getManifest());
      return { content: [{ type: "text", text: `Updated materials for: ${args.entityId}` }] };
    }
    else if (name === "validate_scene") {
      const report = validateWorld(session.getManifest());
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    }
    else if (name === "compile_preview") {
      const manifest = session.getManifest();
      const report = validateWorld(manifest);
      broadcastManifest(manifest);
      
      const status = report.valid ? '✓ VALID' : '✗ INVALID';
      const summary = [
        `Preview ${report.valid ? 'updated' : 'pushed with errors'}. ${status}`,
        `Entities: ${report.stats.entityCount} | Supported: ${report.stats.supportedCount} | Unsupported: ${report.stats.unsupportedCount}`,
        `Unknown archetypes: ${report.stats.unknownArchetypes} | Unknown materials: ${report.stats.unknownMaterials}`,
      ];
      if (report.errors.length > 0) summary.push(`\nErrors:\n${report.errors.map(e => `  ✗ ${e}`).join('\n')}`);
      if (report.warnings.length > 0) summary.push(`\nWarnings:\n${report.warnings.map(w => `  ⚠ ${w}`).join('\n')}`);
      summary.push(`\nPreview URL: http://localhost:5173/ (connect WebSocket to ws://localhost:9900)`);
      
      return { content: [{ type: "text", text: summary.join('\n') }] };
    }
    else if (name === "set_lighting") {
      session.setLighting(args.preset);
      broadcastManifest(session.getManifest());
      return { content: [{ type: "text", text: `✓ Lighting set to: ${args.preset}` }] };
    }
    else if (name === "get_telemetry") {
      const manifest = session.getManifest();
      const report = validateWorld(manifest);
      
      // Archetype breakdown
      const archetypeCounts = {};
      const materialUsage = new Set();
      for (const entity of manifest.entities) {
        const ref = entity.assetRef || 'unknown';
        archetypeCounts[ref] = (archetypeCounts[ref] || 0) + 1;
        if (entity.materialRefs) entity.materialRefs.forEach(m => materialUsage.add(m));
      }
      
      const lines = [
        `World: ${manifest.worldId} (v${manifest.version})`,
        `Lighting: ${manifest.lighting}`,
        `Entities: ${manifest.entities.length}`,
        `Validation: ${report.valid ? '✓ VALID' : '✗ INVALID'} (${report.errors.length} errors, ${report.warnings.length} warnings)`,
        `\nArchetype breakdown:`,
        ...Object.entries(archetypeCounts).map(([ref, count]) => `  ${ref}: ${count}`),
        `\nMaterials in use (${materialUsage.size}):`,
        `  ${[...materialUsage].join(', ') || 'none'}`
      ];
      
      return { content: [{ type: "text", text: lines.join('\n') }] };
    }
    else if (name === "run_performance_audit") {
      let report = null;
      let md = '';
      const sceneToAudit = args.scene;

      let hasLiveClient = false;
      for (const client of wss.clients) {
        if (client.readyState === 1) { hasLiveClient = true; break; }
      }

      if (hasLiveClient) {
        if (sceneToAudit) {
          await sendWsCommand('SET_SCENE', { scene: sceneToAudit }, 5000);
          await new Promise(r => setTimeout(r, 800));
        }
        const res = await sendWsCommand('RUN_AUDIT', {}, 45000);
        report = res.report;
        md = [
          `# Artisan 3D Studio — Empirical Performance Audit Report`,
          `**Timestamp**: \`${report.timestamp}\``,
          `**Verdict**: \`${report.verdict}\``,
          ``,
          `## 1. Environment & Hardware Context`,
          `- **Renderer**: \`${report.device?.gpuRenderer || 'Unknown'}\``,
          `- **Device Pixel Ratio**: \`${report.device?.pixelRatio || '1.0'}\``,
          `- **Resolution**: \`${report.device?.viewport || 'Unknown'}\``,
          ``,
          `## 2. Hard Empirical Metrics`,
          `| Metric | Value | Delta vs Baseline |`,
          `| :--- | :--- | :--- |`,
          `| **Baseline Frametime** | \`${report.telemetry?.baselineFrametime?.toFixed(2)} ms\` | \`0.00 ms\` |`,
          `| **Baseline p99 Frametime** | \`${report.telemetry?.baselineP99?.toFixed(2)} ms\` | - |`,
          `| **Baseline Jitter (&sigma;)** | \`${report.telemetry?.baselineJitter?.toFixed(2)} ms\` | - |`,
          `| **Shadow Continuous Rebake** | \`${((report.telemetry?.baselineFrametime || 0) + (report.telemetry?.shadowRebakePenaltyMs || 0)).toFixed(2)} ms\` | \`+${(report.telemetry?.shadowRebakePenaltyMs || 0).toFixed(2)} ms\` |`,
          `| **PMREM EnvMap Cost** | \`${Math.abs(report.telemetry?.envMapCostMs || 0).toFixed(2)} ms\` | - |`,
          `| **Fill Rate (DPR 2.0 vs 1.0)** | \`${report.telemetry?.dprCostMs?.toFixed(2)} ms\` | - |`,
          ``,
          `## 3. Identified Smoking Guns`,
          ...(report.smokingGuns?.length > 0 
            ? report.smokingGuns.map(sg => `### ${sg.severity}: ${sg.culprit}\n- **Mathematical Impact**: \`+${sg.impactMs?.toFixed(2)} ms\`\n- **Root Cause**: ${sg.rootCause}\n- **Corrective Action**: ${sg.actionTaken}\n- **Status**: \`${sg.status}\`\n`)
            : [`*No critical bottlenecks detected. Engine is fully optimized.*`])
        ].join('\n');

        if (!fs.existsSync(ARTIFACTS_DIR)) {
          fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
        }
        fs.writeFileSync(path.join(ARTIFACTS_DIR, 'perf_audit_report.json'), JSON.stringify(report, null, 2), 'utf-8');
        fs.writeFileSync(path.join(ARTIFACTS_DIR, 'perf_audit_report.md'), md, 'utf-8');
      } else {
        const result = await runHeadlessAudit(sceneToAudit || 'tokyo');
        report = result.report;
        md = result.md;
      }

      return {
        content: [
          { type: "text", text: `✓ Empirical Performance Audit Complete!\n\n${md}\n\nArtifacts updated in brain:\n- perf_audit_report.json\n- perf_audit_report.md` }
        ]
      };
    }
    else if (name === "capture_viewport_screenshot") {
      const filename = args.filename || `artisan_capture_${Date.now()}.png`;
      const angle = args.angle || null;
      const scene = args.scene || null;

      const result = await captureHeadlessScreenshot({ filename, angle, scene });
      const normPath = result.filePath.replace(/\\/g, '/');

      return {
        content: [
          {
            type: "text",
            text: `✓ Screenshot captured successfully!\nTarget: ${normPath}\nHardware: ${result.telemetry?.gpu || 'Unknown'}\nFPS: ${result.telemetry?.fps ?? 'N/A'}\nDraw Calls: ${result.telemetry?.drawCalls ?? 'N/A'}\nTriangles: ${result.telemetry?.triangles ?? 'N/A'}\n\n![${filename}](${result.filePath})`
          }
        ]
      };
    }
    else if (name === "get_engine_telemetry") {
      let hasLiveClient = false;
      for (const client of wss.clients) {
        if (client.readyState === 1) { hasLiveClient = true; break; }
      }

      let telemetry = null;
      if (hasLiveClient) {
        try {
          const res = await sendWsCommand('GET_TELEMETRY', {}, 5000);
          telemetry = res.telemetry;
        } catch {
          telemetry = await getHeadlessTelemetry();
        }
      } else {
        telemetry = await getHeadlessTelemetry();
      }

      const lines = [
        `=== LIVE ARTISAN ENGINE TELEMETRY ===`,
        `GPU Hardware: ${telemetry.gpu || 'Unknown'}`,
        `Software Rasterizer: ${telemetry.isSoftwareRasterizer ? '⚠️ YES (Microsoft Basic Render Driver CPU Fallback)' : '✓ NO (Hardware GPU Acceleration Active)'}`,
        `FPS: ${telemetry.fps} FPS (${telemetry.frametimeMs} ms)`,
        `Draw Calls: ${telemetry.drawCalls} (AAA Budget: <= 30)`,
        `Triangles: ${telemetry.triangles}`,
        `Geometries: ${telemetry.geometries} | Textures: ${telemetry.textures}`,
        `DPR: ${telemetry.pixelRatio}x | Viewport: ${telemetry.viewport}`
      ];

      return { content: [{ type: "text", text: lines.join('\n') }] };
    }
    else if (name === "import_telemetry_logs") {
      let telemetry = null;
      try {
        const res = await sendWsCommand('GET_TELEMETRY', {}, 5000);
        telemetry = res.telemetry;
      } catch {
        telemetry = await getHeadlessTelemetry();
      }

      const timestamp = new Date().toISOString();
      const logData = {
        timestamp,
        telemetry,
        manifest: session.getManifest()
      };

      if (!fs.existsSync(ARTIFACTS_DIR)) {
        fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
      }
      const logFilename = `telemetry_import_${Date.now()}.json`;
      const logFile = path.join(ARTIFACTS_DIR, logFilename);
      fs.writeFileSync(logFile, JSON.stringify(logData, null, 2), 'utf-8');

      return {
        content: [{ type: "text", text: `✓ Telemetry imported to artifacts:\n${logFile}\nJSON Log: ${logFilename}` }]
      };
    }
    
    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Artisan 3D MCP Server running on stdio");
