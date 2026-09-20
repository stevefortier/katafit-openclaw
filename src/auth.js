import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { saveToken } from './config.js';

// Never accept a credential as an argv value (shell history/process listings).
export async function inputToken() {
  if (!process.stdin.isTTY) {
    let value = '';
    for await (const chunk of process.stdin) {
      value += chunk.toString();
      if (value.length > 4097) throw new Error('INPUT_REJECTED');
    }
    return value;
  }
  process.stderr.write('Paste the shown-once Kata.fit credential (hidden): ');
  const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  try {
    return await new Promise((resolve, reject) => {
      rl.once('line', resolve);
      rl.once('SIGINT', () => reject(new Error('CANCELLED')));
      rl.once('close', () => reject(new Error('CANCELLED')));
    });
  } finally { rl.close(); process.stderr.write('\n'); }
}

export async function onboard(path) {
  await saveToken(path, await inputToken());
  process.stdout.write('Credential stored privately. Set tokenFile to that absolute path, then restart the OpenClaw gateway.\n');
}
