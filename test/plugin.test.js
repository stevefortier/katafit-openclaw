import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from './helpers/fixture.js';
import { Command } from 'commander';
const plugin = (await import('../index.js').catch(() => ({}))).default;

test('manifest explicitly activates the service at gateway startup', async () => {
  const manifest = JSON.parse(await readFile(new URL('../openclaw.plugin.json', import.meta.url), 'utf8'));
  assert.equal(manifest.activation?.onStartup, true);
  assert.ok(manifest.cliCommands.some(c => c.name === 'katafit'));
});

test('native katafit auth command is discoverable without starting a worker', async () => {
  const program = new Command();
  let registrar;
  let descriptors;
  plugin.register({ registrationMode: 'discovery', registerCli(fn, options) { registrar = fn; descriptors = options.descriptors; }, registerService() { assert.fail('discovery worker'); } });
  assert.equal(typeof registrar, 'function');
  assert.equal(descriptors[0].name, 'katafit');
  await registrar({ program });
  const command = program.commands.find(c => c.name() === 'katafit');
  assert.ok(command);
  assert.deepEqual(command.commands.map(c => c.name()).sort(), ['auth', 'status']);
  assert.equal(command.commands.find(c => c.name() === 'auth').registeredArguments.length, 1);
});

test('entry only registers service in full mode and invokes supported host runtime', async t => {
  assert.equal(typeof plugin?.register, 'function');
  const f = await fixture(t, { empty: true });
  let service;
  let modelCalls = 0;
  process.env.KATAFIT_SYNTHETIC_TOKEN = 'synthetic-test-token';
  t.after(() => { delete process.env.KATAFIT_SYNTHETIC_TOKEN; });
  const api = {
    registrationMode: 'discovery',
    registerCli() {},
    pluginConfig: { endpoint: f.options.endpoint, instructionsUrl: f.options.instructionsUrl, allowInsecureLoopback: true, tokenEnv: 'KATAFIT_SYNTHETIC_TOKEN', pollIntervalMs: 1000 },
    runtime: { version: '2026.9.5', llm: { complete: async () => { modelCalls++; } } },
    registerService(value) { service = value; },
  };
  plugin.register(api);
  assert.equal(service, undefined);
  api.registrationMode = 'full';
  plugin.register(api);
  assert.equal(service.id, 'katafit-coach');
  assert.equal(f.calls.length, 0, 'registration itself starts no network work');
  await service.start({ logger: { warn() {} } });
  await delay(100);
  await service.stop();
  assert.ok(f.calls.length > 0);
  assert.equal(modelCalls, 0);
});

test('stop during asynchronous startup cannot leave an orphan worker', async t => {
  const f = await fixture(t, { empty: true });
  let service;
  process.env.KATAFIT_STARTUP_TOKEN = 'synthetic-test-token';
  t.after(() => { delete process.env.KATAFIT_STARTUP_TOKEN; });
  plugin.register({ registrationMode: 'full', registerCli() {}, registerService(s) { service = s; },
    pluginConfig: { endpoint: f.options.endpoint, instructionsUrl: f.options.instructionsUrl, allowInsecureLoopback: true, tokenEnv: 'KATAFIT_STARTUP_TOKEN' },
    runtime: { version: '2026.9.5', llm: { complete: async () => assert.fail('idle inference') } },
  });
  t.after(() => service.stop());
  const starting = service.start({ logger: { warn() {} } });
  await service.stop();
  await starting;
  await delay(50);
  assert.equal(f.calls.length, 0);
});

test('credential CLI accepts stdin without placing the secret in output', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'katafit-cli-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'credential');
  const proc = spawn(process.execPath, ['bin/auth.js', file], { cwd: new URL('..', import.meta.url), stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  proc.stdout.on('data', b => { output += b; });
  proc.stderr.on('data', b => { output += b; });
  proc.stdin.end('synthetic-test-token\n');
  const code = await new Promise(resolve => proc.on('close', resolve));
  assert.equal(code, 0, output);
  assert.equal(output.includes('synthetic-test-token'), false);
  assert.equal((await readFile(file, 'utf8')).trim(), 'synthetic-test-token');
});
