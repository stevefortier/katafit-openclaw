import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/fixture.js';
import * as workerModule from '../src/worker.js';

test('real MCP lifecycle uses one isolated, requester-scoped completion', async t => {
  assert.equal(typeof workerModule.createWorker, 'function', 'worker must exist');
  const f = await fixture(t);
  const completions = [];
  const worker = workerModule.createWorker({ ...f.options, complete: async params => {
    completions.push(params);
    return { text: 'A synthetic answer', execution: { mode: 'isolated-agent-runtime', owner: { kind: 'harness', id: 'synthetic' } } };
  } });
  await worker.pollOnce();
  assert.deepEqual(f.calls.map(c => c.name), ['coach_list_requests', 'coach_claim_request', 'coach_start_request', 'coach_read_context', 'coach_respond']);
  assert.deepEqual(f.calls.at(-1).args, { request_id: 'request-a', lease_generation: 4, text: 'A synthetic answer' });
  assert.equal(completions.length, 1);
  const p = completions[0];
  assert.equal(p.execution.mode, 'isolated-agent-runtime');
  assert.equal(p.messages.length, 1);
  assert.equal(p.messages[0].role, 'user');
  assert.match(p.messages[0].content, /Only this requester/);
  assert.match(p.systemPrompt, /Synthetic coaching instructions/);
  assert.equal(p.messages[0].content.includes('synthetic-test-token'), false);
  assert.equal('sessionKey' in p, false);
  assert.equal('agentId' in p, false);
  await worker.stop();
});
