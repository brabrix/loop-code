// Smoke do ciclo MCP fora do Electron. Usa o mesmo mcp-core.cjs do main.
// Uso: node scripts/mcp-smoke.cjs            (stdio: server-everything)
//      node scripts/mcp-smoke.cjs <url>      (HTTP)
const { mcpConnect, mcpDisconnect, mcpClient } = require('../mcp-core.cjs');

async function run() {
  const url = process.argv[2];
  const cfg = url
    ? { transport: 'http', url }
    : { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] };

  const { connId, serverInfo, capabilities } = await mcpConnect(cfg, {
    onLog: (t) => process.stderr.write('[server] ' + t),
  });
  console.log('conectado:', serverInfo, 'caps:', Object.keys(capabilities || {}));

  const c = mcpClient(connId);
  const tools = await c.listTools();
  console.log('tools:', tools.tools.map((t) => t.name).slice(0, 8));

  const resources = await c.listResources().catch(() => ({ resources: [] }));
  const prompts = await c.listPrompts().catch(() => ({ prompts: [] }));
  console.log('resources:', resources.resources.length, 'prompts:', prompts.prompts.length);

  const echo = await c.callTool({ name: 'echo', arguments: { message: 'oi carcara' } });
  console.log('callTool echo:', JSON.stringify(echo.content));

  await mcpDisconnect(connId);
  console.log('desconectado ok');
}
run().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
