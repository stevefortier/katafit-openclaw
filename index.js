import { onboard } from './src/auth.js';
import { configure, status, setupRequired } from './src/onboarding.js';
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
      command.command('configure').description('Privately configure and enable Kata.fit Coach; request host reload')
        .action(async () => configure(api));
      command.command('status').description('Local setup and observed live worker state; not proof of a real app reply')
        .action(async () => status(config));
    }, { descriptors: [{ name: 'katafit', description: 'Kata.fit Coach setup and status', hasSubcommands: true }] });
    if (api.registrationMode !== 'full') return;
    let worker;
    let observed = { schema: 1, state: 'stopped', running: false };
    api.registerGatewayMethod?.('katafit.status', ({ respond }) => respond(true, { ...observed }), { scope: 'operator.read' });
    let generation = 0;
    api.registerService({
      id: 'katafit-coach',
      reload: { configPrefixes: ['plugins.entries.katafit-coach'] },
      async start(ctx) {
        if (worker) return;
        const ticket = ++generation;
        if (api.runtime.version !== '2026.9.5' || typeof api.runtime.llm?.complete !== 'function') throw new Error('OPENCLAW_VERSION_UNSUPPORTED');
        const config = parseConfig(ctx.config?.plugins?.entries?.['katafit-coach']?.config ?? api.pluginConfig);
        let token;
        try { token = await readToken(config); }
        catch {
          if (ticket !== generation) return;
          observed = { schema: 1, state: 'setup-required', running: false };
          ctx.logger.warn(setupRequired);
          ctx.serviceHealth?.clearFailure();
          return;
        }
        if (ticket !== generation) return;
        observed = { schema: 1, state: 'running', running: true, credentialFile: config.tokenFile };
        worker = createWorker({
          ...config, token,
          complete: params => api.runtime.llm.complete(params),
          onState(state) { if (ticket === generation) observed = { ...observed, state, observedAt: Date.now() }; },
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
        observed = { schema: 1, state: 'stopped', running: false };
      },
    });
  },
};
