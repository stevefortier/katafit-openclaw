import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture } from './helpers/fixture.js';
import { createWorker } from '../src/worker.js';

const good = { text: 'Safe answer', execution: { mode: 'isolated-agent-runtime', owner: { kind: 'harness', id: 'synthetic' } } };

for (const scenario of ['empty', 'unavailable']) {
  test(`idle queue does not invoke model: ${scenario}`, async t => {
    const f = await fixture(t, { [scenario]: true });
    const worker = createWorker({ ...f.options, complete: async () => { assert.fail('idle inference'); } });
    await worker.pollOnce();
    await worker.stop();
    assert.equal(f.calls.some(c => c.name === 'coach_read_context'), false);
  });
}

test('polling loop backs off safely and stops all future polls', async t => {
  const f = await fixture(t, { toolError: 'coach_list_requests' });
  const logs = [];
  const worker = createWorker({ ...f.options, onError: error => logs.push(error.message), complete: async () => assert.fail('idle inference') });
  assert.equal(typeof worker.start, 'function');
  worker.start();
  worker.start();
  await delay(210);
  await worker.stop();
  const count = f.calls.length;
  assert.ok(count >= 2 && count <= 6, `bounded poll count ${count}`);
  await delay(100);
  assert.equal(f.calls.length, count);
  assert.ok(logs.length > 0);
  assert.equal(logs.some(log => /private|synthetic-test-token/.test(log)), false);
});

for (const scenario of ['timeout', 'expired', 'provider-failure', 'wrong-runtime', 'oversized']) {
  test(`bounded leased execution: ${scenario}`, async t => {
    const f = await fixture(t, scenario === 'expired' ? { leaseMs: -1 } : {});
    let count = 0;
    const worker = createWorker({ ...f.options, modelTimeoutMs: 30, complete: async ({ signal }) => {
      count++;
      if (scenario === 'timeout') await delay(5000, null, { signal });
      if (scenario === 'provider-failure') throw new Error('PRIVATE synthetic-test-token');
      if (scenario === 'wrong-runtime') return { ...good, execution: { mode: 'direct-provider', owner: { kind: 'provider', id: 'bad' } } };
      if (scenario === 'oversized') return { ...good, text: 'x'.repeat(8001) };
      return good;
    } });
    const started = Date.now();
    await assert.rejects(worker.pollOnce(), error => !error.message.includes('PRIVATE') && !error.message.includes('synthetic-test-token'));
    assert.ok(Date.now() - started < 2000, 'bounded time');
    assert.equal(f.calls.some(c => c.name === 'coach_respond'), false);
    if (scenario === 'expired') assert.equal(count, 0);
    else {
      const failure = f.calls.filter(c => c.name === 'coach_fail_request');
      assert.equal(failure.length, 1);
      assert.equal(failure[0].args.lease_generation, 4);
      assert.equal(JSON.stringify(failure).includes('PRIVATE'), false);
    }
    await worker.stop();
  });
}

test('claim lets server select eligible work, not a busy first list entry', async t => {
  const f = await fixture(t);
  const worker = createWorker({ ...f.options, complete: async () => good });
  await worker.pollOnce();
  assert.deepEqual(f.calls.find(c => c.name === 'coach_claim_request').args, { lease_seconds: 60 });
  await worker.stop();
});

test('mismatched requester context fails before inference', async t => {
  const f = await fixture(t, { mismatchedContext: true });
  let count = 0;
  const worker = createWorker({ ...f.options, complete: async () => { count++; return good; } });
  await assert.rejects(worker.pollOnce(), /CONTEXT_REJECTED/);
  assert.equal(count, 0);
  await worker.stop();
});

test('oversized instructions are rejected before claim', async t => {
  const f = await fixture(t, { instruction: '# Kata.fit external Coach agent v1\n' + 'x'.repeat(100000) });
  const worker = createWorker({ ...f.options, complete: async () => good });
  await assert.rejects(worker.pollOnce());
  assert.equal(f.calls.some(c => c.name === 'coach_claim_request'), false);
  await worker.stop();
});

test('stalled MCP calls time out without inference or private error output', async t => {
  const f = await fixture(t, { onCall: name => name === 'coach_list_requests' ? new Promise(() => {}) : undefined });
  const worker = createWorker({ ...f.options, httpTimeoutMs: 80, complete: async () => assert.fail('no inference') });
  const started = Date.now();
  await assert.rejects(worker.pollOnce(), /WORKER_TIMEOUT|COACH_WORKER_FAILED/);
  assert.ok(Date.now() - started < 1500);
  await worker.stop();
});

test('model budget reserves delivery time before lease expiry', async t => {
  const f = await fixture(t, { leaseMs: 500 });
  let budget;
  const worker = createWorker({ ...f.options, httpTimeoutMs: 100, modelTimeoutMs: 1000, complete: async params => { budget = params.execution.timeoutMs; return good; } });
  await worker.pollOnce();
  assert.ok(budget > 0 && budget <= 380, `lease-capped budget ${budget}`);
  await worker.stop();
});

test('ambiguous response errors never send contradictory fail', async t => {
  const f = await fixture(t, { toolError: 'coach_respond' });
  const worker = createWorker({ ...f.options, complete: async () => good });
  await assert.rejects(worker.pollOnce(), /MCP_TOOL_FAILED/);
  assert.equal(f.calls.filter(c => c.name === 'coach_respond').length, 1);
  assert.equal(f.calls.some(c => c.name === 'coach_fail_request'), false);
  await worker.stop();
});

test('health recovers after a transient safe failure', async t => {
  const scenario = { toolError: 'coach_list_requests', empty: true };
  const f = await fixture(t, scenario);
  let recovered = 0;
  const worker = createWorker({ ...f.options,
    onError: () => { scenario.toolError = undefined; },
    onHealthy: () => { recovered++; }, complete: async () => assert.fail('idle inference') });
  worker.start();
  await delay(150);
  await worker.stop();
  assert.ok(recovered > 0);
});

test('stop suppresses a late completion even when the model ignores abort', async t => {
  const f = await fixture(t);
  let resolveModel;
  let signalReady;
  const ready = new Promise(resolve => { signalReady = resolve; });
  const worker = createWorker({ ...f.options, complete: async () => {
    signalReady();
    return new Promise(resolve => { resolveModel = resolve; });
  } });
  const running = worker.pollOnce();
  await ready;
  await worker.stop();
  await assert.rejects(running, /WORKER_STOPPED/);
  resolveModel(good);
  await delay(30);
  assert.equal(f.calls.some(c => c.name === 'coach_respond'), false);
});

test('concurrent polls are single-flight and stop aborts active model work', async t => {
  const f = await fixture(t);
  let calls = 0;
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const worker = createWorker({ ...f.options, complete: async ({ signal }) => {
    calls++;
    entered();
    await delay(5000, null, { signal });
    return good;
  } });
  const first = worker.pollOnce();
  const second = worker.pollOnce();
  await ready;
  await worker.stop();
  await Promise.allSettled([first, second]);
  assert.equal(calls, 1);
  assert.equal(f.calls.some(c => c.name === 'coach_respond'), false);
  await worker.pollOnce();
  assert.equal(calls, 1, 'stopped worker cannot restart implicitly');
});

test('authoritative leading version wins over a historical v1 heading', async t => {
  const f = await fixture(t, { instruction: '# Kata.fit external Coach agent v2\nNew protocol\n# Kata.fit external Coach agent v1\nHistorical reference only' });
  const worker = createWorker({ ...f.options, complete: async () => assert.fail('unsupported contract inference') });
  await assert.rejects(worker.pollOnce(), /CONTRACT_UNSUPPORTED/);
  assert.equal(f.calls.some(c => c.name === 'coach_claim_request'), false);
  await worker.stop();
});

test('incompatible live instructions fail closed before claim or inference', async t => {
  const f = await fixture(t, { instruction: '# Kata.fit external Coach agent v2\nNew protocol' });
  let count = 0;
  const worker = createWorker({ ...f.options, complete: async () => { count++; return good; } });
  await assert.rejects(worker.pollOnce(), /CONTRACT_UNSUPPORTED/);
  assert.equal(count, 0);
  assert.equal(f.calls.some(c => c.name === 'coach_claim_request'), false);
  await worker.stop();
});
