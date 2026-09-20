// Package/host integration proof. Uses only synthetic credentials and isolated state.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const [hostArg, artifactArg] = process.argv.slice(2);
assert.ok(hostArg && artifactArg, 'Usage: node scripts/verify-install.mjs <openclaw.mjs> <package.tgz>');
const host = resolve(hostArg);
const artifact = resolve(artifactArg);
const state = mkdtempSync(join(tmpdir(), 'katafit-install-proof-'));
const home = join(state, 'home');
mkdirSync(home);
const configPath = join(state, 'openclaw.json');
const env = {
  HOME: home,
  USER: 'katafit-test',
  LANG: 'C.UTF-8',
  PATH: `${dirname(process.execPath)}:${process.env.PATH ?? '/usr/bin:/bin'}`,
  OPENCLAW_STATE_DIR: state,
  OPENCLAW_CONFIG_PATH: configPath,
};
function cli(args, input) {
  return execFileSync(process.execPath, [host, ...args], {
    env, encoding: 'utf8', input, timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
try {
  assert.match(cli(['--version']), /2026\.9\.5/);
  cli(['plugins', 'install', `npm-pack:${artifact}`, '--force', '--accept-capabilities']);
  const inspection = JSON.parse(cli(['plugins', 'inspect', 'katafit-coach', '--runtime', '--json']));
  assert.equal(inspection.plugin.status, 'loaded');
  assert.equal(inspection.plugin.dependencyStatus.requiredInstalled, true);
  assert.equal(inspection.diagnostics.length, 0);
  const help = cli(['katafit', '--help']);
  assert.match(help, /auth/);
  assert.match(help, /status/);
  const token = 'synthetic-install-proof-credential';
  const tokenFile = join(state, 'private', 'coach-token');
  const output = cli(['katafit', 'auth', tokenFile], `${token}\n`);
  assert.ok(!output.includes(token));
  assert.equal(readFileSync(tokenFile, 'utf8').trim(), token);
  assert.equal(statSync(tokenFile).mode & 0o777, 0o600);
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.plugins.entries['katafit-coach'].config = { tokenFile };
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  const status = cli(['katafit', 'status']);
  assert.match(status, /does not verify live authorization/);
  assert.ok(!status.includes(token));
  console.log('PASS: packed plugin installed and loaded in OpenClaw 2026.9.5; native CLI auth/status verified with synthetic credential. No gateway/model/production round trip is claimed by this script.');
} finally {
  rmSync(state, { recursive: true, force: true });
}
