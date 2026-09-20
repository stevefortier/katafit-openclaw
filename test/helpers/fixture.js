import assert from 'node:assert/strict';
import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
const instruction = '# Kata.fit external Coach agent v1\nSynthetic coaching instructions.';

async function fixture(t, options = {}) {
  const calls = [];
  const request = (id = 'request-a', requester = 'requester-a') => ({ id, requester_id: requester, scope: 'dojo', message: 'Advice please', attachment_count: 0, lease_generation: 4, lease_expires_at: new Date(Date.now() + (options.leaseMs ?? 60000)).toISOString(), timeout_at: new Date(Date.now() + 90000).toISOString() });
  const server = http.createServer(async (req, res) => {
    if (req.url === '/instructions') { res.end(options.instruction ?? instruction); return; }
    assert.equal(req.headers.authorization, 'Bearer synthetic-test-token');
    const mcp = new McpServer({ name: 'synthetic-coach', version: '1.0.0' });
    const schema = { request_id: z.string().optional(), lease_generation: z.number().optional(), lease_seconds: z.number().optional(), text: z.string().optional(), code: z.string().optional(), message: z.string().optional(), limit: z.number().optional() };
    for (const name of ['coach_list_requests', 'coach_claim_request', 'coach_start_request', 'coach_read_context', 'coach_respond', 'coach_fail_request']) {
      mcp.registerTool(name, { inputSchema: schema }, async args => {
        calls.push({ name, args });
        await options.onCall?.(name, args);
        let value;
        if (name === 'coach_list_requests') value = { requests: options.empty ? [] : [request()] };
        else if (name === 'coach_claim_request') value = { request: options.unavailable ? null : request() };
        else if (name === 'coach_read_context') value = { request: options.mismatchedContext ? request('other-request', 'other-requester') : request(), profile: { display_name: 'Synthetic requester' }, conversation: [{ text: 'Only this requester' }], boundaries: { requester_only: true, direct_mutations_forbidden: true } };
        else value = { request: request(), idempotent: false };
        if (options.toolError === name) return { isError: true, content: [{ type: 'text', text: 'private server details synthetic-test-token' }] };
        return { content: [{ type: 'text', text: JSON.stringify(value) }] };
      });
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close().catch(() => {}); mcp.close().catch(() => {}); });
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { calls, options: { endpoint: `${base}/mcp`, instructionsUrl: `${base}/instructions`, token: 'synthetic-test-token', httpTimeoutMs: 1000, modelTimeoutMs: 1000, pollIntervalMs: 20, maxBackoffMs: 80, leaseSeconds: 60, safetyMarginMs: 20 } };
}

export { fixture };
