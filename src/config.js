import { constants } from 'node:fs';
import { open, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';

export const defaults = Object.freeze({
  endpoint: 'https://kata.fit/api/agents/coach/mcp',
  instructionsUrl: 'https://kata.fit/api/agents/coach.md',
  pollIntervalMs: 15000, maxBackoffMs: 120000,
  httpTimeoutMs: 10000, modelTimeoutMs: 90000,
  leaseSeconds: 180, safetyMarginMs: 5000,
});

export function parseConfig(input = {}) {
  const allowed = new Set([...Object.keys(defaults), 'tokenEnv', 'tokenFile', 'allowInsecureLoopback']);
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !allowed.has(k))) throw new Error('CONFIG_INVALID');
  if (input.tokenEnv && input.tokenFile) throw new Error('CONFIG_INVALID');
  const config = { ...defaults, ...input };
  if (!config.tokenFile) config.tokenEnv ??= 'KATAFIT_COACH_TOKEN';
  if (config.tokenEnv && !/^[A-Z_][A-Z0-9_]{0,127}$/.test(config.tokenEnv)) throw new Error('CONFIG_INVALID');
  if (config.tokenFile !== undefined && (typeof config.tokenFile !== 'string' || !isAbsolute(config.tokenFile))) throw new Error('CONFIG_INVALID');
  const ranges = { pollIntervalMs: [1000, 300000], maxBackoffMs: [1000, 900000], httpTimeoutMs: [100, 30000], modelTimeoutMs: [100, 240000], leaseSeconds: [15, 300], safetyMarginMs: [100, 30000] };
  for (const [key, [min, max]] of Object.entries(ranges)) if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max) throw new Error('CONFIG_INVALID');
  if (config.maxBackoffMs < config.pollIntervalMs || config.leaseSeconds * 1000 <= config.httpTimeoutMs * 2 + config.safetyMarginMs) throw new Error('CONFIG_INVALID');
  if (config.endpoint !== defaults.endpoint || config.instructionsUrl !== defaults.instructionsUrl) {
    let urls;
    try { urls = [config.endpoint, config.instructionsUrl].map(value => new URL(value)); }
    catch { throw new Error('CONFIG_INVALID'); }
    if (config.allowInsecureLoopback !== true || urls.some(u => u.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(u.hostname) || u.username || u.password || u.hash) || urls[0].origin !== urls[1].origin) throw new Error('CONFIG_INVALID');
  }
  return config;
}

function validateToken(token) {
  if (typeof token !== 'string' || !/^[\x21-\x7e]{16,4096}$/.test(token.trim())) throw new Error('CREDENTIAL_UNAVAILABLE');
  return token.trim();
}

export async function readToken(config, env = process.env) {
  let handle;
  try {
    if (!config.tokenFile) return validateToken(env[config.tokenEnv]);
    handle = await open(config.tokenFile, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 4097 || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw new Error('CREDENTIAL_UNAVAILABLE');
    return validateToken(await handle.readFile('utf8'));
  } catch {
    throw new Error('CREDENTIAL_UNAVAILABLE');
  } finally {
    await handle?.close();
  }
}

export async function saveToken(path, value) {
  let handle;
  try {
    if (!isAbsolute(path)) throw new Error('CREDENTIAL_WRITE_FAILED');
    const token = validateToken(value);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(`${token}\n`);
    await handle.sync();
  } catch {
    throw new Error('CREDENTIAL_WRITE_FAILED');
  } finally {
    await handle?.close();
  }
}
