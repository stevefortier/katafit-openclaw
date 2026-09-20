import { onboard } from './src/auth.js';
import { createWorker } from './src/worker.js';
import { parseConfig, readToken } from './src/config.js';

export default {
  id: 'katafit-coach',
  name: 'Kata.fit Coach',
  description: 'Request-isolated, text-only Kata.fit Coach worker',
  register(api) {
    api.registerCli(({ program, config }) => {
      const command = program.command('katafit').description('Kata.fit Coach credential setup and local readiness');
      command.command('auth <absolute-file>').description('Save a shown-once credential from hidden prompt or stdin; never overwrites')
        .action(async path => {
          try { await onboard(path); }
          catch { throw new Error('CREDENTIAL_WRITE_FAILED: use a new absolute private file path; token via hidden prompt or stdin only'); }
        });
      command.command('status').description('Check local configuration and credential presence; not a live authorization/model test')
        .action(async () => {
          const settings = parseConfig(config?.plugins?.entries?.['katafit-coach']?.config ?? api.pluginConfig);
          await readToken(settings);
          process.stdout.write('Local credential and configuration are readable. This does not verify live authorization, worker health, or model readiness. Confirm a reply in Kata.fit.\n');
        });
    }, { descriptors: [{ name: 'katafit', description: 'Kata.fit Coach setup and status', hasSubcommands: true }] });
    if (api.registrationMode !== 'full') return;
    let worker;
    let generation = 0;
    api.registerService({
      id: 'katafit-coach',
      reload: { configPrefixes: ['plugins.entries.katafit-coach'] },
      async start(ctx) {
        if (worker) return;
        const ticket = ++generation;
        if (api.runtime.version !== '2026.9.5' || typeof api.runtime.llm?.complete !== 'function') throw new Error('OPENCLAW_VERSION_UNSUPPORTED');
        const config = parseConfig(ctx.config?.plugins?.entries?.['katafit-coach']?.config ?? api.pluginConfig);
        const token = await readToken(config);
        if (ticket !== generation) return;
        worker = createWorker({
          ...config, token,
          complete: params => api.runtime.llm.complete(params),
          onHealthy: () => ctx.serviceHealth?.clearFailure(),
          onError(error) {
            ctx.logger.warn(`Kata.fit Coach: ${error.message}`);
            ctx.serviceHealth?.reportFailure(error);
          },
        });
        worker.start();
      },
      async stop() {
        generation++;
        await worker?.stop();
        worker = undefined;
      },
    });
  },
};
