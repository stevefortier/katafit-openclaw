import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('configure chooses a private credential and merges host config without losing existing keys', async t => {
  const { configure } = await import('../src/onboarding.js');
  const stateDir = await mkdtemp(join(tmpdir(), 'katafit-configure-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const config = { gateway: { mode: 'local' }, plugins: { allow: ['other'], entries: { other: { enabled: true }, 'katafit-coach': { config: { pollIntervalMs: 1000, tokenEnv: 'OLD_TOKEN' } } } } };
  let afterWrite;
  const api = { runtime: { config: { async mutateConfigFile(params) { afterWrite = params.afterWrite; await params.mutate(config); } } } };
  let output = '';
  await configure(api, { stateDir, input: async () => 'synthetic-configure-token', observe: async () => undefined, output: text => { output += text; } });
  assert.deepEqual(config.plugins.allow, ['other', 'katafit-coach']);
  assert.deepEqual(config.gateway, { mode: 'local' });
  assert.deepEqual(config.plugins.entries.other, { enabled: true });
  const entry = config.plugins.entries['katafit-coach'];
  assert.equal(entry.enabled, true);
  assert.equal(entry.config.pollIntervalMs, 1000);
  assert.equal(entry.config.tokenEnv, undefined);
  assert.equal((await readFile(entry.config.tokenFile, 'utf8')).trim(), 'synthetic-configure-token');
  assert.equal((await stat(entry.config.tokenFile)).mode & 0o777, 0o600);
  assert.equal((await stat(join(stateDir, 'katafit-coach-private'))).mode & 0o777, 0o700);
  assert.deepEqual(afterWrite, { mode: 'auto' });
  assert.ok(!JSON.stringify(config).includes('synthetic-configure-token'));
  assert.ok(!output.includes('synthetic-configure-token'));
  assert.match(output, /Worker startup: unknown/);
  assert.match(output, /main Coach/);
});

for (const unsafe of ['symlink', 'public-directory']) test(`configure refuses ${unsafe} without changing config`, async t => {
  const { configure } = await import('../src/onboarding.js');
  const { symlink, mkdir, readdir } = await import('node:fs/promises');
  const stateDir = await mkdtemp(join(tmpdir(), 'katafit-unsafe-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const dir = join(stateDir, 'katafit-coach-private');
  if (unsafe === 'symlink') await symlink(stateDir, dir);
  else await mkdir(dir, { mode: 0o755 });
  await assert.rejects(configure({ runtime: { config: { mutateConfigFile() { assert.fail('no mutation'); } } } }, { stateDir, input: async () => 'synthetic-test-token' }), /Setup could not finish/);
  assert.deepEqual(await readdir(stateDir), ['katafit-coach-private']);
});

test('cancelled hidden input and empty stdin cannot write host configuration', async t => {
  const { configure } = await import('../src/onboarding.js');
  const { readdir } = await import('node:fs/promises');
  const stateDir = await mkdtemp(join(tmpdir(), 'katafit-cancel-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const api = { runtime: { config: { mutateConfigFile() { assert.fail('no mutation'); } } } };
  await assert.rejects(configure(api, { stateDir, input: async () => { throw new Error('cancelled'); } }), /Setup cancelled/);
  assert.deepEqual(await readdir(stateDir), []);
  await assert.rejects(configure(api, { stateDir, input: async () => '' }), /Setup could not finish/);
});

test('reconfiguration uses a new private file, preserves old credentials, and does not duplicate allowlist', async t => {
  const { configure } = await import('../src/onboarding.js');
  const stateDir = await mkdtemp(join(tmpdir(), 'katafit-reconfigure-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const config = { plugins: { allow: ['other', 'katafit-coach'], entries: {} } };
  const api = { runtime: { config: { async mutateConfigFile(p) { await p.mutate(config); } } } };
  const opts = { stateDir, observe: async () => undefined, output() {} };
  await configure(api, { ...opts, input: async () => 'synthetic-first-token' });
  const first = config.plugins.entries['katafit-coach'].config.tokenFile;
  await configure(api, { ...opts, input: async () => 'synthetic-second-token' });
  const second = config.plugins.entries['katafit-coach'].config.tokenFile;
  assert.notEqual(first, second);
  assert.equal((await readFile(first, 'utf8')).trim(), 'synthetic-first-token');
  assert.equal((await readFile(second, 'utf8')).trim(), 'synthetic-second-token');
  assert.deepEqual(config.plugins.allow, ['other', 'katafit-coach']);
});

test('configure preserves an unrestricted absent allowlist instead of disabling unrelated plugins', async t => {
  const { configure } = await import('../src/onboarding.js');
  const stateDir = await mkdtemp(join(tmpdir(), 'katafit-unrestricted-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const config = { plugins: { entries: { other: { enabled: true } } } };
  const api = { runtime: { config: { async mutateConfigFile(p) { p.mutate(config); } } } };
  await configure(api, { stateDir, input: async () => 'synthetic-test-token', observe: async () => undefined, output() {} });
  assert.equal(config.plugins.allow, undefined);
  assert.equal(config.plugins.entries.other.enabled, true);
});
