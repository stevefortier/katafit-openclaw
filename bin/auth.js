#!/usr/bin/env node
import { onboard } from '../src/auth.js';
try {
  if (process.argv.length !== 3) throw new Error('USAGE');
  await onboard(process.argv[2]);
} catch {
  process.stderr.write('Credential not saved. Use: katafit-coach-auth /absolute/private/new-token-file (token via hidden prompt or stdin). Existing files are never overwritten.\n');
  process.exitCode = 1;
}
