# Kata.fit Coach for OpenClaw

The official Kata.fit plugin for **main Coach text chat**, using Kata.fit's v1 external-agent contract. The OpenClaw gateway owns the polling service; merely adding an MCP URL is not enough to run a worker.

**Status:** first implementation, unpublished. `@katafit/openclaw` is a proposed package name, not a claimed/reserved npm namespace or a working registry install command. This is a Kata.fit integration, **not** an OpenClaw trusted-official/catalog plugin. No publishing happens in CI.

## Compatibility

- OpenClaw **2026.9.5** only, explicitly checked at service startup. Revalidate the SDK before widening this pin.
- Node **>=24.16.0 <25 or >=26.1.0**, matching that OpenClaw release.
- Kata.fit external Coach **v1**, Streamable HTTP MCP; `@modelcontextprotocol/sdk` **1.30.0**.
- A configured OpenClaw runtime that supports **isolated agent-runtime completions**. Unsupported owners fail closed; the plugin never falls back to a normal agent/session or direct-provider request.
- Linux/macOS owner-only credential files. The POSIX file-mode checks are not a Windows ACL implementation; use a private gateway environment variable on Windows and validate the host separately.

The implementation calls the supported `api.runtime.llm.complete` with exactly one user message, request-local `systemPrompt`, `signal`, and `execution: { mode: "isolated-agent-runtime", timeoutMs }`. It verifies the returned execution mode and CLI/harness owner. It does **not** call invented `runAgent` APIs, import OpenClaw internals, add tools, reuse conversations, read memory/workspace files, register global prompt hooks, or change host configuration.

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

## Connect a credential

1. In Kata.fit, create an external Coach credential. Outside a dojo, use **Profile**. For a dojo-owned Coach, only the **current chief** manages credentials in **Dojo settings**; members see status only. Use the required request read/claim/context/reply scopes, not proposal scope. Prefer the 30-day expiry.
2. Copy the **shown-once** bearer credential immediately. Kata.fit retains only its hash. There is no device-code, OAuth, refresh, renewal, or automatic rotation endpoint in v1.
3. After installing/enabling the plugin, store it privately using its native OpenClaw command:

   ```sh
   openclaw katafit auth "$HOME/.config/katafit/coach-token"
   ```

   `openclaw katafit --help` discovers setup commands. `openclaw katafit status` checks only local config/credential readability (not live authorization or model readiness). For source development, `node bin/auth.js` exposes the same helper. Paste at the hidden prompt. The helper creates an owner-only (`0600`) file and refuses to overwrite an existing file or follow a file symlink. It also accepts stdin for a secret-manager pipeline. **Never pass the token as a command-line argument, commit it, paste it into chat, or put it in plugin JSON.** Use a private directory, outside any OpenClaw agent workspace or synced/public repository. Anyone running as your OS user (including other in-process plugins) remains inside your trust boundary.
4. Configure the plugin under your existing OpenClaw config, preserving other entries and allowlisted plugins:

   ```json
   {
     "plugins": {
       "allow": ["katafit-coach"],
       "entries": {
         "katafit-coach": {
           "enabled": true,
           "config": {
             "tokenFile": "/absolute/private/path/coach-token"
           }
         }
       }
     }
   }
   ```

   Alternatively set `"tokenEnv": "KATAFIT_COACH_TOKEN"` and provision that variable privately in the **gateway process environment**. The value is never written by this plugin to OpenClaw config. Choose one source; missing/invalid credentials fail startup. No model, auth-profile, or cross-agent override permissions are needed.
5. Restart your OpenClaw gateway using your normal service manager. The plugin starts polling only when OpenClaw activates its background service, never during discovery/install/inspection. Confirm a real in-app main Coach request receives a visibly attributed reply before calling the integration ready.

To replace an expired/revoked credential, create a new one in Kata.fit, save to a new private file, update `tokenFile`, and restart the gateway. Revoke old credentials in Kata.fit. No refresh is fabricated. Device authorization requires backend work; see [authorization roadmap](docs/authorization-roadmap.md).

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

CI also installs the packed tarball into a clean OpenClaw 2026.9.5 state directory and exercises the native `katafit auth` and `katafit status` commands with a synthetic credential. Run the same check locally after `npm pack`:

```sh
node scripts/verify-install.mjs /path/to/openclaw/openclaw.mjs ./katafit-openclaw-0.1.0.tgz
```

This check removes its temporary state and does not start a gateway or use your provider credentials. Separately, local integration verification exercised the actual packed plugin in an OpenClaw gateway against Kata.fit's real MCP route with synthetic service data and a local model-provider fixture: list → claim → start → context → model → respond. The provider payload had no tools, bearer credential, or private workspace-memory sentinel. That is host/transport integration evidence, **not** production inference or a real user's in-app reply.

The public SDK was checked against npm `openclaw@2026.9.5` (build `ec9c1a1`): `dist/runtime-api-wzmGBys0.d.ts` defines `LlmIsolatedAgentRuntimeCompleteParams` and `OpenClawPluginService`; `dist/runtime-llm.runtime-DQtXZfQr.mjs` implements isolated runtime dispatch. These are **research references**, not imports. Only injected public runtime APIs are used.
