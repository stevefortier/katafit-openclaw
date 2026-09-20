// Real packed-host proof; synthetic credentials, isolated HOME, no service manager.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture } from '../test/helpers/fixture.js';

const [hostArg, artifactArg] = process.argv.slice(2);
assert.ok(hostArg && artifactArg, 'Usage: node scripts/verify-install.mjs <openclaw.mjs> <package.tgz>');
const host = resolve(hostArg);
const artifact = resolve(artifactArg);
const state = mkdtempSync(join(tmpdir(), 'katafit-install-proof-'));
const home = join(state, 'home');
mkdirSync(home);
const configPath = join(state, 'openclaw.json');
const env = {
  HOME: home, USER: 'katafit-test', LANG: 'C.UTF-8',
  PATH: `${dirname(process.execPath)}:${process.env.PATH ?? '/usr/bin:/bin'}`,
  OPENCLAW_STATE_DIR: state, OPENCLAW_CONFIG_PATH: configPath,
  OPENCLAW_GATEWAY_TOKEN: 'synthetic-gateway-auth-not-katafit',
};
async function cli(args, input) {
  const promise = promisify(execFile)(process.execPath, [host, ...args], {
    env, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
  });
  promise.child.stdin.end(input);
  const result = await promise;
  assert.ok(!`${result.stdout}${result.stderr}`.includes('synthetic-test-token'), 'credential redaction');
  return result.stdout;
}
let gateway;
let gatewayLog = '';
const cleanup = [];
async function runtimeStatus() {
  try { return JSON.parse(await cli(['gateway', 'call', 'katafit.status', '--json'])); }
  catch { return undefined; }
}
try {
  assert.match(await cli(['--version']), /2026\.9\.5/);
  const installed = await cli(['plugins', 'install', `npm-pack:${artifact}`, '--force', '--accept-capabilities']);
  assert.doesNotMatch(installed, /CREDENTIAL_UNAVAILABLE/);
  const inspection = JSON.parse(await cli(['plugins', 'inspect', 'katafit-coach', '--runtime', '--json']));
  assert.equal(inspection.plugin.status, 'loaded');
  assert.equal(inspection.plugin.dependencyStatus.requiredInstalled, true);
  assert.equal(inspection.diagnostics.length, 0);
  assert.match(await cli(['katafit', '--help']), /configure/);
  assert.match(await cli(['katafit', 'status']), /Installed — setup required/);

  // No running gateway: configure must not fabricate startup or invoke a system service.
  const token = 'synthetic-test-token';
  const output = await cli(['katafit', 'configure'], `${token}\n`);
  assert.match(output, /Worker startup: unknown/);
  assert.match(output, /openclaw gateway restart/);
  const before = JSON.parse(readFileSync(configPath, 'utf8'));
  const firstFile = before.plugins.entries['katafit-coach'].config.tokenFile;
  assert.equal(readFileSync(firstFile, 'utf8').trim(), token);
  assert.equal(statSync(firstFile).mode & 0o777, 0o600);
  assert.equal(statSync(dirname(firstFile)).mode & 0o777, 0o700);
  assert.ok(!readFileSync(configPath, 'utf8').includes(token));
  assert.match(await cli(['katafit', 'status']), /Credential configured/);

  // Start only our foreground process, on a reserved random loopback port.
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const f = await fixture({ after(fn) { cleanup.push(fn); } }, { empty: true });
  before.gateway = { mode: 'local', port, bind: 'loopback', auth: { mode: 'token' } };
  before.logging = { file: join(state, 'gateway.log') };
  before.plugins.allow = [...new Set([...(before.plugins.allow ?? []), 'katafit-coach', 'memory-core'])];
  before.plugins.entries['memory-core'] = { enabled: true };
  before.plugins.entries['katafit-coach'].config = {
    endpoint: f.options.endpoint, instructionsUrl: f.options.instructionsUrl,
    allowInsecureLoopback: true, pollIntervalMs: 1000,
  };
  writeFileSync(configPath, JSON.stringify(before), { mode: 0o600 });
  gateway = spawn(process.execPath, [host, 'gateway', 'run'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  gateway.stdout.on('data', b => { gatewayLog += b; });
  gateway.stderr.on('data', b => { gatewayLog += b; });
  let observed;
  for (let i = 0; i < 20; i++) {
    observed = await runtimeStatus();
    if (observed?.state === 'setup-required') break;
    if (gateway.exitCode !== null) throw new Error(`isolated gateway exited: ${gatewayLog}`);
    await delay(250);
  }
  assert.equal(observed?.state, 'setup-required', gatewayLog);
  assert.equal(observed.running, false);
  assert.match(gatewayLog, /Installed — setup required/);
  assert.doesNotMatch(gatewayLog, /CREDENTIAL_UNAVAILABLE/);
  const configuredOutput = await cli(['katafit', 'configure'], `${token}\n`);
  assert.match(configuredOutput, /Worker startup: running/, JSON.stringify({ current: await runtimeStatus(), gatewayLog }));
  let current;
  for (let i = 0; i < 10; i++) {
    current = await runtimeStatus();
    if (current?.state === 'idle') break;
    await delay(250);
  }
  assert.equal(current?.state, 'idle');
  assert.equal(current.running, true);
  const after = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.deepEqual(after.gateway, before.gateway);
  assert.deepEqual(after.plugins.allow, before.plugins.allow);
  assert.deepEqual(after.plugins.entries['memory-core'], before.plugins.entries['memory-core']);
  assert.deepEqual(after.logging, before.logging);
  assert.equal(after.plugins.entries['katafit-coach'].config.endpoint, f.options.endpoint);
  assert.notEqual(after.plugins.entries['katafit-coach'].config.tokenFile, firstFile);
  assert.equal(current.credentialFile, after.plugins.entries['katafit-coach'].config.tokenFile);
  const status = await cli(['katafit', 'status']);
  assert.match(status, /Waiting for requests/);
  assert.match(status, /does not prove end-to-end success/);
  assert.ok(f.calls.some(c => c.name === 'coach_list_requests'));
  assert.ok(!gatewayLog.includes(token));
  const unchanged = readFileSync(configPath, 'utf8');
  const cancelled = await promisify(execFile)('python3', ['scripts/verify-hidden-prompt.py', process.execPath, host, 'cancel'], { env, timeout: 70000 });
  assert.equal(readFileSync(configPath, 'utf8'), unchanged, 'Ctrl-C must preserve host config');
  const hidden = await promisify(execFile)('python3', ['scripts/verify-hidden-prompt.py', process.execPath, host, 'configure'], { env, timeout: 70000 });
  console.log(cancelled.stdout.trim());
  console.log(hidden.stdout.trim());
  console.log('PASS: OpenClaw 2026.9.5 managed packed install; setup-required without failure; native configure/status; private file modes; preserving config writer; absent-gateway unknown; live automatic service reload; authenticated synthetic idle queue. No model or real app reply claimed.');
} finally {
  if (gateway && gateway.exitCode === null) {
    gateway.kill('SIGTERM');
    await Promise.race([new Promise(resolve => gateway.once('close', resolve)), delay(5000)]);
    if (gateway.exitCode === null) { gateway.kill('SIGKILL'); await new Promise(resolve => gateway.once('close', resolve)); }
  }
  for (const close of cleanup.reverse()) await close();
  rmSync(state, { recursive: true, force: true });
}
