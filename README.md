# Kata.fit OpenClaw Plugin

Official Kata.fit plugin for OpenClaw — connect your agent as your fitness coach with:

- secure authentication
- automatic message delivery
- up-to-date coaching instructions

## Files

- `openclaw.plugin.json`  
  OpenClaw plugin metadata and runtime contract.

## Configuration

Set the following environment variables in your OpenClaw runtime:

- `KATAFIT_API_URL` (default: `https://api.kata.fit`)
- `KATAFIT_API_KEY` (required)

## Behavior

The plugin contract declares:

1. **Secure auth** via bearer token (`KATAFIT_API_KEY`) sent only in the `Authorization` header.
2. **Automatic message delivery** through a `POST /v1/openclaw/messages` operation for coach/agent message exchange.
3. **Instruction freshness** through a `GET /v1/openclaw/instructions` operation for retrieving latest coaching instructions.
