# CODESYS Measurement Project

This directory contains the disposable Control Win project and measurement artifacts used to execute M0-M7 from `docs/codesys-opcua-measurement-plan.md`.

It is a connector/runtime proof fixture, not the final platform-specific interceptor library.

## Current fixture

- `gngnf.project` is the minimal CODESYS Control Win V3 x64 project.
- `codesys_handoff/` is the imported prior-learning bundle for the official CODESYS MCP Server, Test Manager, variable paths, deployment methodology, and OPC UA/browser relay patterns.
- `scripts/probe-codesys-mcp.mjs` performs a read-only stdio handshake against the installed Bridge. On 2026-10-30 it discovered 20 tools and returned the active application `Device.Plc Logic.Application` when run outside the command sandbox.

The installed Bridge is:

`C:\Program Files\CODESYS 3.5.22.30\CODESYS\CODESYS MCP Server\1.1.0.0\CodesysMCPBridge\CodesysMCPBridge.exe`

Codex has this registered globally as `codesys-ide`. A new Codex task is required to load a server added after the original task began.
