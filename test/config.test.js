import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, symlink, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const configModule = await import('../src/config.js').catch(() => ({}));

test('config pins production origin and bounds timing without inline secrets', () => {
  assert.equal(typeof configModule.parseConfig, 'function');
  const c = configModule.parseConfig({ tokenEnv: 'SYNTHETIC_TOKEN' });
  assert.equal(c.endpoint, 'https://kata.fit/api/agents/coach/mcp');
  assert.equal(c.instructionsUrl, 'https://kata.fit/api/agents/coach.md');
  assert.throws(() => configModule.parseConfig({ token: 'private' }));
  assert.throws(() => configModule.parseConfig({ endpoint: 'https://evil.example/mcp' }));
  assert.throws(() => configModule.parseConfig({ pollIntervalMs: 1 }));
  assert.throws(() => configModule.parseConfig({ tokenEnv: 'X', tokenFile: '/tmp/token' }));
  assert.throws(() => configModule.parseConfig({ httpTimeoutMs: NaN }));
  assert.throws(() => configModule.parseConfig({ endpoint: 'invalid-private-url', allowInsecureLoopback: true }), error => error.message === 'CONFIG_INVALID');
});

test('credential reader accepts private owner file, rejects public or symlink files', async t => {
  assert.equal(typeof configModule.readToken, 'function');
  const dir = await mkdtemp(join(tmpdir(), 'katafit-token-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'token');
  await writeFile(file, 'synthetic-test-token\n', { mode: 0o600 });
  assert.equal(await configModule.readToken({ tokenFile: file }), 'synthetic-test-token');
  await chmod(file, 0o644);
  await assert.rejects(configModule.readToken({ tokenFile: file }), /CREDENTIAL_UNAVAILABLE/);
  await chmod(file, 0o600);
  await symlink(file, join(dir, 'link'));
  await assert.rejects(configModule.readToken({ tokenFile: join(dir, 'link') }));
  assert.equal(await configModule.readToken({ tokenEnv: 'SYNTHETIC_TOKEN' }, { SYNTHETIC_TOKEN: 'synthetic-test-token' }), 'synthetic-test-token');
  await assert.rejects(configModule.readToken({ tokenEnv: 'SYNTHETIC_TOKEN' }, {}));
});

test('onboarding stores private credential without overwriting or echoing it', async t => {
  assert.equal(typeof configModule.saveToken, 'function');
  const dir = await mkdtemp(join(tmpdir(), 'katafit-auth-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'private', 'token');
  await configModule.saveToken(file, 'synthetic-test-token');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(await configModule.readToken({ tokenFile: file }), 'synthetic-test-token');
  await assert.rejects(configModule.saveToken(file, 'replacement'));
  const largest = join(dir, 'private', 'maximum-token');
  const maximumToken = 'x'.repeat(4096);
  await configModule.saveToken(largest, maximumToken);
  assert.equal(await configModule.readToken({ tokenFile: largest }), maximumToken);
});
