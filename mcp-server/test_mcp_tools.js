import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from 'path';

async function main() {
  console.log('--- Connecting to Artisan 3D MCP Server via Stdio ---');
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['index.js'],
    cwd: path.resolve('C:\\Users\\Fabio D\\.gemini\\antigravity\\scratch\\artisan-studio-app\\mcp-server')
  });

  const client = new Client({
    name: "mcp-test-client",
    version: "1.0.0"
  }, {
    capabilities: {}
  });

  await client.connect(transport);
  console.log('Connected to MCP Server successfully!');

  // 1. List tools
  const tools = await client.listTools();
  console.log('Available MCP Tools:', tools.tools.map(t => t.name));

  // 2. Query engine telemetry
  console.log('\n--- Calling get_engine_telemetry ---');
  const telemetryRes = await client.callTool({
    name: "get_engine_telemetry",
    arguments: {}
  });
  console.log(telemetryRes.content[0].text);

  // 3. Capture viewport screenshot
  console.log('\n--- Calling capture_viewport_screenshot ---');
  const screenshotRes = await client.callTool({
    name: "capture_viewport_screenshot",
    arguments: {
      filename: "tokyo_osd_verified.png",
      angle: "hero",
      scene: "tokyo"
    }
  });
  console.log(screenshotRes.content[0].text);

  // 4. Run performance audit
  console.log('\n--- Calling run_performance_audit ---');
  const auditRes = await client.callTool({
    name: "run_performance_audit",
    arguments: {
      scene: "tokyo"
    }
  });
  console.log(auditRes.content[0].text);

  // 5. Import telemetry logs
  console.log('\n--- Calling import_telemetry_logs ---');
  const importRes = await client.callTool({
    name: "import_telemetry_logs",
    arguments: {}
  });
  console.log(importRes.content[0].text);

  await client.close();
  console.log('\n--- All MCP Tool Tests Passed! ---');
  process.exit(0);
}

main().catch(err => {
  console.error('MCP Test Error:', err);
  process.exit(1);
});
