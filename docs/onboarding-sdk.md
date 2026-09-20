# Onboarding SDK evidence (OpenClaw 2026.9.5)

Compatibility is pinned to the actual npm distribution, not guessed from another release. These paths are research references, **never internal imports**.

- `dist/runtime-api-wzmGBys0.d.ts`: `PluginRuntimeCore.config.mutateConfigFile` accepts a focused draft mutation and requires an explicit `afterWrite`. `ConfigWriteAfterWrite` supports `{mode: 'auto'}`, `{mode: 'restart', reason}`, and `{mode: 'none', reason}`. Configure uses **auto**, preserving the host's normal config watcher/reload policy instead of sending process signals or invoking a service manager.
- The same declarations define `OpenClawPluginService.reload.configPrefixes`: restart the service with committed config when those paths change. Our prefix remains `plugins.entries.katafit-coach`.
- `dist/config-CJdvsHqC.d.ts` defines the host mutation result/snapshot/hash and mutation callback. We explicitly select `base: 'source'` and mutate the host-supplied draft, never serialize a stale CLI config snapshot over unrelated keys.
- `dist/plugin-sdk/state-paths.d.ts` publicly exports `resolveStateDir`, respecting the active profile/state environment. The credential path is chosen beneath that state directory, not a hard-coded user's HOME or agent workspace.
- `OpenClawPluginApi.registerGatewayMethod` supports an explicit operator scope. `katafit.status` uses `operator.read` and returns only fixed runtime state, an observation timestamp, and the configured file path (never the credential).
- `dist/plugin-sdk/gateway-runtime.d.ts` publicly exports `callGatewayFromCli`; its declared CLI options include timeout/json, and extra options include progress/scopes/read-only shared state. The CLI uses those supported options to read the live gateway rather than persisting a potentially stale health file.
- There is no injected `restartPlugin` API used here. `api.runtime.gateway.request` is an **in-process gateway context** facility; a CLI process cannot assume it owns that context. No invented gateway RPC method is called to restart services. A configured running gateway observes the supported config write. An absent/unobservable gateway remains unknown, with the supported `openclaw gateway restart` operator command (or foreground restart) as the explicit next action.

## Actual supported-host proof

`node scripts/verify-install.mjs <openclaw.mjs> <packed.tgz>` installs the managed tarball into a temporary HOME/state/config, then tests:

- package/runtime discovery without credentials or worker traffic;
- setup-required rather than installation failure;
- native configure from stdin and a real hidden PTY prompt, no credential in JSON/output, private directory/file modes;
- real Ctrl-C cancellation leaves the host config unchanged;
- no gateway: startup **unknown**, with restart instructions;
- a test-owned foreground gateway against a synthetic MCP server;
- setup-required at live service startup;
- reconfigure through the native CLI and actual automatic hot reload;
- live worker identity matches the newly configured file;
- authenticated empty-queue observation and no inference;
- unrelated config/allowlist preservation and cleanup.

A real observed reload temporarily made the old `katafit.status` handler unavailable while the host revoked/replaced its plugin instance. Configure therefore retries bounded observations during reload, rather than treating the first unavailable RPC as proof of failure or success. A running report proves only the loop started; idle/connectivity does not prove a model can respond or a real main Coach reply appeared.
