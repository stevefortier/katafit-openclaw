# Kata.fit Coach for OpenClaw

The official Kata.fit plugin for **main Coach text chat**, using Kata.fit's v1 external-agent contract. The OpenClaw gateway owns the polling service; merely adding an MCP URL is not enough to run a worker.

**Status:** first implementation, unpublished. `@katafit/openclaw` is a proposed package name, not a claimed/reserved npm namespace or a working registry install command. This is a Kata.fit integration, **not** an OpenClaw trusted-official/catalog plugin. No publishing happens in CI.

## Compatibility

- OpenClaw **2026.9.5** only, explicitly checked at service startup. Revalidate the SDK before widening this pin.
- Node **>=24.16.0 <25 or >=26.1.0**, matching that OpenClaw release.
- Kata.fit external Coach **v1**, Streamable HTTP MCP; `@modelcontextprotocol/sdk` **1.30.0**.
- A configured OpenClaw runtime that supports **isolated agent-runtime completions**. Unsupported owners fail closed; the plugin never falls back to a normal agent/session or direct-provider request.
- Linux/macOS owner-only credential files. The POSIX file-mode checks are not a Windows ACL implementation; use a private gateway environment variable on Windows and validate the host separately.

The implementation calls the supported `api.runtime.llm.complete` with exactly one user message, request-local `systemPrompt`, `signal`, and `execution: { mode: "isolated-agent-runtime", timeoutMs }`. It verifies the returned execution mode and CLI/harness owner. It does **not** call invented `runAgent` APIs, import OpenClaw internals, add tools, reuse conversations, read memory/workspace files, register global prompt hooks, or change model/session policy. Only the explicit configure command mutates the Kata.fit plugin configuration.

References: [model runtime SDK](https://docs.openclaw.ai/plugins/sdk-runtime/models), [native manifests](https://docs.openclaw.ai/plugins/manifest), [Kata.fit live contract](https://kata.fit/api/agents/coach.md).

## Install from this repository

Use the supported Node version and an existing OpenClaw 2026.9.5 installation. Review the source before installing an in-process plugin.

```sh
git clone https://github.com/stevefortier/katafit-openclaw.git
cd katafit-openclaw
npm ci
npm test
npm run check
npm pack
openclaw plugins install npm-pack:./katafit-openclaw-0.1.0.tgz
```

The `npm-pack:` archive path installs package dependencies in the managed plugin installation. It is the current distribution path, not `openclaw plugins install @katafit/openclaw`. OpenClaw may ask you to confirm a non-catalog install or its security policy warnings; review them rather than disabling security checks. For unattended trusted-local verification, see the supported install CLI `--force` / `--accept-capabilities` flags (and `--acknowledge-install-policy-warning` only when a reviewed warning requires it). An installation record is **not** proof that your credential or model can answer a request.

**Next:** run `openclaw katafit configure` to finish setup.

## Configure (one command)

After installation, **Installed — setup required** is normal until a credential is configured. OpenClaw's generic “enabled” label is an activation setting, not evidence that the worker is running.

1. In Kata.fit, create an external Coach credential in **Profile**, or (for the current chief only) **Dojo settings**. Use request read/claim/context/reply scopes, not proposal scope. Copy the shown-once credential; Kata.fit retains only its hash.
2. Run:

   ```sh
   openclaw katafit configure
   ```

   Paste into the **hidden prompt**. No path selection or JSON editing is needed. A secret-manager stdin pipeline is also supported. Never put the credential in command arguments, JSON, model prompts, chat, screenshots, logs, or source control.

   Configure chooses a unique owner-only `0600` file inside a `0700` `katafit-coach-private` directory in the active OpenClaw state directory. It rejects symlink ancestors and unsafe directory permissions. It preserves unrelated config, existing plugin entries, and every existing allowlisted plugin; an absent/empty unrestricted allowlist stays unrestricted. It enables the Kata.fit entry and uses OpenClaw's supported config mutation writer with automatic reload. Explicit host deny/global-disable policies are not bypassed.

3. Read the startup report. A **running** report requires a live gateway RPC observation matching the newly configured credential file. A reload request alone is not startup success. A running gateway normally hot-reloads the plugin automatically. If no live observation can be obtained, configure reports **unknown**, not success. It does not install/start an OS service or kill another gateway. For a managed gateway run `openclaw gateway restart`; for a foreground gateway restart that foreground process, then run:

   ```sh
   openclaw katafit status
   ```

4. **Enable external-agent routing in Kata.fit. Send a real message in the main Coach chat. Confirm a visibly attributed external-agent reply.** Only that real reply proves end-to-end integration; installation, readable credentials, worker startup, and MCP connectivity do not.

### Status meanings

`openclaw katafit status` separates local credential readability from live, authenticated gateway observations:

| State | Evidence / limits |
|---|---|
| Installed — setup required | No readable credential; run `openclaw katafit configure`. This is not failed installation. |
| Credential configured | Locally readable private file/environment source, not proven server acceptance. |
| Worker running | Live plugin service has started its loop. It may still fail to connect or infer. |
| Connected to Kata.fit | Last successful MCP handshake, not a persistent connection or real app reply. |
| Waiting for requests | Last authenticated queue poll returned no requests. No inference was performed. |
| Temporarily backing off | Worker observed an error and is delaying its next attempt. |
| Credential rejected or expired | Observed MCP HTTP 401/403. Exact cause (expiry, revocation, missing scopes, etc.) is unknown; check authorization in Kata.fit and reconfigure as needed. |
| Unknown / stopped | No live gateway observation, or a live service reports stopped. Never inferred from “enabled.” |

The state is read through a scoped `operator.read` gateway RPC, not a stale local status file. These checks do not send a coaching message, invoke a model, or enable routing in Kata.fit.

### Rotation and advanced configuration

To replace a credential, create a new one in Kata.fit and rerun `openclaw katafit configure`. Each run creates a new private file; it never overwrites or deletes prior credentials (including when a config write's outcome is ambiguous). Revoke the old credential in Kata.fit. Remove obsolete local private files only after verifying the new configuration. There is no device-code/OAuth/refresh/automatic-renewal API in v1; see [authorization roadmap](docs/authorization-roadmap.md).

The legacy `openclaw katafit auth <absolute-file>` helper only writes a new file; it does **not** configure/enable/reload the plugin. Prefer `configure`. Advanced operators may instead provision `tokenEnv` privately in the **gateway process environment**, or manually set `tokenFile`. Choose one source. When editing manually, **append** `katafit-coach` to an existing nonempty `plugins.allow` list; never replace that list or unrelated entries. Then **reload/restart the gateway** and run `openclaw katafit status`.

All in-process plugins and other processes running as your OS user remain in the host trust boundary. Private file modes are not a sandbox. Keep the OpenClaw state directory outside agent workspaces and public/synced folders.

## Runtime and safety

- Sequential `list → claim → start → read_context → respond` or `fail`; preserve the server's `lease_generation`. Let the server choose eligible work so an unexpired first item cannot starve queued work.
- No LLM calls for an empty queue or lost claim. One request at a time per worker, even if polling is invoked concurrently. Multiple gateway processes still need backend leases; run one gateway per credential operationally.
- Fetch the current contract before **each claimed coaching request**; reject an unsupported version or unavailable/oversized document. No stale cached contract fallback. Changes within v1 apply to that request only.
- Only the claimed requester's allowlisted context enters a fresh completion. The backend remains the authority for personal/dojo membership, chief management, authorization, revocation, and cross-member isolation. The plugin checks request ID, scope, requester, generation, and text-only status before inference.
- No proposals, plan writes, tools, attachment access, activity reviews, workout threads, insights, notifications, or hosted fallback. Replies offer advice; they cannot perform actions.
- Bound HTTP operations and model work; reserve delivery time before the earlier lease/request deadline. Stop aborts active work, interrupts sleep, and suppresses late model replies even if cancellation is ignored. A stopped process cannot renew a lease.
- Unknown errors become fixed safe codes. No raw server/model errors, tokens, prompts, replies, or requester identifiers are logged by the plugin. OpenClaw/provider-level diagnostic logging is separately controlled by the operator; consider health data sensitivity before enabling it.
- A response with uncertain delivery is **not** followed by `fail`. The backend supports identical idempotent responses; this initial worker does not automatically retry a possibly accepted publication or persist replies locally. Kata.fit owns timeout/recovery and explicit user retry.
- Network requests reject redirects. Production URLs are pinned to `https://kata.fit/api/agents/coach/mcp` and `https://kata.fit/api/agents/coach.md`. MCP bodies are capped at 1 MiB, instructions at 64 KiB. Synthetic tests can explicitly opt into same-origin numeric-loopback HTTP with `allowInsecureLoopback`; do not use real credentials there.

### Optional settings

| Setting | Default | Meaning |
|---|---:|---|
| `pollIntervalMs` | 15000 | Idle/success delay; at least 1000 |
| `maxBackoffMs` | 120000 | Bounded exponential error delay |
| `httpTimeoutMs` | 10000 | Connect, HTTP, and tool call deadline |
| `modelTimeoutMs` | 90000 | Maximum inference time, further lease-capped |
| `leaseSeconds` | 180 | Requested claim duration; 15–300 |
| `safetyMarginMs` | 5000 | Reserve before lease/request expiry |

The manifest and runtime validate settings. Health failures are visible through the host logger/service-health interface. Credential replacement currently needs a service restart.

## Development and verification

```sh
npm ci
npm test
npm run check
npm pack --dry-run
```

Tests use a **local synthetic HTTP MCP server**, real MCP client/server protocol lifecycle, fake credentials, and a synthetic completion function at the OpenClaw boundary. They cover requester-scoped prompts, no idle inference, successful response, failures, lease limits, safe errors, polling backoff, cancellation, and secure file onboarding. They do not claim production inference, real app delivery, or subscription eligibility was verified. The private Kata.fit backend source and any user data are not included.

CI also installs the packed tarball into a clean OpenClaw 2026.9.5 state directory and exercises the native `katafit configure` and `katafit status` commands with a synthetic credential. Run the same check locally after `npm pack`:

```sh
node scripts/verify-install.mjs /path/to/openclaw/openclaw.mjs ./katafit-openclaw-0.1.0.tgz
```

This check uses a temporary HOME and minimal environment, starts only its own foreground loopback gateway against a synthetic MCP server, verifies automatic reload and idle state, then stops that process and removes its state. It never uses provider credentials, installs an OS service, or restarts a live gateway. Separately, local integration verification exercised the actual packed plugin in an OpenClaw gateway against Kata.fit's real MCP route with synthetic service data and a local model-provider fixture: list → claim → start → context → model → respond. The provider payload had no tools, bearer credential, or private workspace-memory sentinel. That is host/transport integration evidence, **not** production inference or a real user's in-app reply.

The public SDK was checked against npm `openclaw@2026.9.5` (build `ec9c1a1`): `dist/runtime-api-wzmGBys0.d.ts` defines `LlmIsolatedAgentRuntimeCompleteParams` and `OpenClawPluginService`; `dist/runtime-llm.runtime-DQtXZfQr.mjs` implements isolated runtime dispatch. These are **research references**, not imports. Only injected public runtime APIs and public SDK exports are used. See [onboarding SDK evidence](docs/onboarding-sdk.md).
