// Núcleo do cliente MCP — sem dependência de Electron, pra ser testável via Node.
// O @modelcontextprotocol/sdk envia build CJS, então usamos require() direto.
const crypto = require('crypto');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');

const mcpConns = new Map(); // connId -> { client, transport, info }

function mcpClient(connId) {
  const c = mcpConns.get(connId);
  if (!c) throw new Error('Conexão MCP não encontrada: ' + connId);
  return c.client;
}

async function mcpConnect({ transport, command, args, env, url, headers } = {}, hooks = {}) {
  const client = new Client({ name: 'carcara-code', version: '0.1.0' }, { capabilities: {} });

  let tp;
  if (transport === 'stdio') {
    if (!command) throw new Error('Comando obrigatório para stdio.');
    tp = new StdioClientTransport({
      command,
      args: Array.isArray(args) ? args : [],
      env: { ...process.env, ...(env || {}) },
      stderr: 'pipe',
    });
    if (tp.stderr && hooks.onLog) tp.stderr.on('data', (b) => hooks.onLog(String(b)));
    await client.connect(tp);
  } else {
    if (!url) throw new Error('URL obrigatória para HTTP.');
    const reqInit = headers && Object.keys(headers).length ? { requestInit: { headers } } : undefined;
    try {
      tp = new StreamableHTTPClientTransport(new URL(url), reqInit);
      await client.connect(tp);
    } catch (e) {
      // Servidor legado: cai pra SSE.
      tp = new SSEClientTransport(new URL(url), reqInit);
      await client.connect(tp);
    }
  }

  const connId = crypto.randomUUID();
  const info = { serverInfo: client.getServerVersion(), capabilities: client.getServerCapabilities() };
  if (hooks.onClose) client.onclose = () => { if (mcpConns.has(connId)) { mcpConns.delete(connId); hooks.onClose(connId); } };
  mcpConns.set(connId, { client, transport: tp, info });
  return { connId, serverInfo: info.serverInfo, capabilities: info.capabilities };
}

async function mcpDisconnect(connId) {
  const c = mcpConns.get(connId);
  if (!c) return;
  mcpConns.delete(connId);
  try { await c.client.close(); } catch {}
}

function mcpDisconnectAll() {
  for (const id of [...mcpConns.keys()]) mcpDisconnect(id);
}

module.exports = { mcpConns, mcpClient, mcpConnect, mcpDisconnect, mcpDisconnectAll };
