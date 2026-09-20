import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createWorker } from '../src/worker.js';
import { fixture } from './helpers/fixture.js';
import { describeWorker, status } from '../src/onboarding.js';

test('worker emits observed connected and idle states without inference', async t => {
  const f = await fixture(t, { empty: true });
  const states = [];
  const worker = createWorker({ ...f.options, onState: state => states.push(state), complete() { assert.fail('idle inference'); } });
  await worker.pollOnce();
  await worker.stop();
  assert.deepEqual(states, ['connected', 'idle']);
});

for (const code of [401, 403, 500]) test(`HTTP ${code} becomes safe observed ${code === 500 ? 'backoff' : 'rejected-expired'} state`, async t => {
  const server = http.createServer((_req, res) => { res.writeHead(code); res.end('private server message synthetic-test-token'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  let observed;
  const failure = new Promise(resolve => {
    const worker = createWorker({ endpoint: `http://127.0.0.1:${server.address().port}`, token: 'synthetic-test-token', httpTimeoutMs: 100, pollIntervalMs: 1000, maxBackoffMs: 1000, onState: s => { observed = s; }, onError: error => resolve({ error, worker }) });
    worker.start();
  });
  const { error, worker } = await failure;
  await worker.stop();
  assert.equal(observed, code === 500 ? 'backoff' : 'rejected-expired');
  assert.ok(!error.message.includes('synthetic-test-token'));
});

test('status renders missing setup and unknown health without throwing or declaring success', async () => {
  let output = '';
  await status({ plugins: { entries: { 'katafit-coach': { config: { tokenEnv: 'KATAFIT_NEVER_CONFIGURED_TEST' } } } } }, { observe: async () => undefined, output: text => { output += text; } });
  assert.match(output, /Installed — setup required/);
  assert.match(output, /Worker startup: unknown/);
  assert.match(output, /attributed external-agent reply/);
  for (const state of ['running', 'connected', 'idle', 'backoff', 'rejected-expired']) assert.doesNotMatch(describeWorker({ schema: 1, state, running: true }), /Runtime state unknown/);
});

test('status does not attribute a previous credential worker to newly saved configuration', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { saveToken } = await import('../src/config.js');
  const dir = await mkdtemp(join(tmpdir(), 'katafit-stale-status-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const tokenFile = join(dir, 'new');
  await saveToken(tokenFile, 'synthetic-test-token');
  let output = '';
  await status({ plugins: { entries: { 'katafit-coach': { config: { tokenFile } } } } }, { observe: async () => ({ schema: 1, running: true, state: 'idle', credentialFile: join(dir, 'old') }), output: text => { output += text; } });
  assert.match(output, /Credential configured/);
  assert.match(output, /Worker startup: unknown/);
  assert.doesNotMatch(output, /Waiting for requests/);
});
