import { mkdir, lstat } from 'node:fs/promises';
import { join, resolve, parse } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { inputToken } from './auth.js';
import { saveToken, parseConfig, readToken } from './config.js';

export const nextStep = 'Local configuration or connectivity does not prove end-to-end success. Enable external-agent routing in Kata.fit, send a real message in the main Coach chat, and confirm an attributed external-agent reply.\n';
export const setupRequired = 'Installed — setup required. Kata.fit Coach has no readable private credential. Run openclaw katafit configure to finish setup.';

// Reject symlink ancestors before creating anything. Other same-UID processes
// remain inside the OpenClaw in-process trust boundary (not a sandbox).
async function privateDirectory(stateDir) {
  const dir = join(resolve(stateDir), 'katafit-coach-private');
  let current = parse(dir).root;
  for (const part of dir.slice(current.length).split('/')) {
    current = join(current, part);
    try {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('UNSAFE_PATH');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(current, { mode: 0o700 });
    }
  }
  const info = await lstat(dir);
  if ((info.mode & 0o077) || (process.getuid && info.uid !== process.getuid())) throw new Error('UNSAFE_PATH');
  return dir;
}

export async function observeWorker() {
  try {
    const { callGatewayFromCli } = await import('openclaw/plugin-sdk/gateway-runtime');
    return await callGatewayFromCli('katafit.status', { timeout: '1500', json: true }, {}, { progress: false, scopes: ['operator.read'], sharedStateMode: 'read-only' });
  } catch { return undefined; }
}

export function describeWorker(observed) {
  if (!observed || observed.schema !== 1) return 'Worker startup: unknown (no live gateway observation).';
  const labels = { 'setup-required': setupRequired, running: 'Worker running', connected: 'Connected to Kata.fit (last successful MCP handshake)', idle: 'Waiting for requests (last authenticated queue poll was empty)', backoff: 'Temporarily backing off', 'rejected-expired': 'Credential rejected or expired (HTTP 401/403; exact cause unknown)', stopped: 'Worker stopped' };
  return `Worker startup: ${observed.running ? 'running' : 'not running'}. ${labels[observed.state] ?? 'Runtime state unknown'}.`;
}

export async function status(config, { observe = observeWorker, output = text => process.stdout.write(text) } = {}) {
  let configured = false;
  try { await readToken(parseConfig(config?.plugins?.entries?.['katafit-coach']?.config)); configured = true; }
  catch { /* A readiness command must not turn an installed plugin into a failed install. */ }
  output(`${configured ? 'Credential configured (locally readable).' : setupRequired}\n`);
  let observed = await observe();
  const expectedFile = config?.plugins?.entries?.['katafit-coach']?.config?.tokenFile;
  if (expectedFile && observed?.running && observed.credentialFile !== expectedFile) observed = undefined;
  output(`${describeWorker(observed)}\n${nextStep}`);
}

export async function configure(api, { stateDir, input = inputToken, observe = observeWorker, output = text => process.stdout.write(text) } = {}) {
  // Collect before filesystem/config mutations, so cancellation changes nothing.
  let token;
  try { token = await input(); }
  catch { throw new Error('Setup cancelled; configuration unchanged. Run openclaw katafit configure when ready.'); }
  let tokenFile;
  let committed = false;
  try {
    if (!stateDir) stateDir = (await import('openclaw/plugin-sdk/state-paths')).resolveStateDir();
    const dir = await privateDirectory(stateDir);
    tokenFile = join(dir, `credential-${randomUUID()}`);
    await saveToken(tokenFile, token);
    token = undefined;
    await api.runtime.config.mutateConfigFile({
      base: 'source',
      afterWrite: { mode: 'auto' },
      mutate(draft) {
        draft.plugins ??= {};
        // An absent allowlist is unrestricted: creating a one-entry list
        // would silently disable other installed plugins.
        if (draft.plugins.allow?.length) draft.plugins.allow = [...new Set([...draft.plugins.allow, 'katafit-coach'])];
        draft.plugins.entries ??= {};
        const entry = draft.plugins.entries['katafit-coach'] ??= {};
        entry.enabled = true;
        entry.config = { ...entry.config, tokenFile };
        delete entry.config.tokenEnv;
      },
    });
    committed = true;
  } catch {
    // The host may have committed before a follow-up error. Retain the private
    // file in that ambiguous case rather than leave a config pointing at nothing.
    throw new Error('Setup could not finish. Credential input was not logged. Run openclaw katafit status, then retry openclaw katafit configure.');
  } finally { token = undefined; }
  if (!committed) return;
  output('Credential configured privately. Plugin enabled; host automatic reload requested.\n');
  let observed;
  for (let attempt = 0; attempt < 8; attempt++) {
    observed = await observe();
    if (observed?.credentialFile === tokenFile && observed.running) break;
    // A host hot reload temporarily revokes the old plugin instance/RPC.
    // Retry unavailable observations instead of mistaking that window for stop.
    if (attempt < 7) await sleep(500);
  }
  if (observed?.credentialFile !== tokenFile) observed = undefined;
  output(`${describeWorker(observed)}\n`);
  if (!observed?.running) output('The host has not confirmed this worker started. Run openclaw gateway restart for a managed gateway (or restart your foreground gateway), then openclaw katafit status. No system service was installed or started by configure.\n');
  output(nextStep);
}
