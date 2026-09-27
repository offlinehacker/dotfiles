# Autoport — OpenCode 2.0.16

Server plugin: default `{id, setup}` using the official `@opencode/plugin@2.0.16`
contract, `ctx.tool.transform`, JSON Schema input and `{content}` results.
The SDK import is type-only, so loading requires no legacy SDK or runtime dependency.

Register the **directory** `./plugins/toggle-autoport` in `opencode.jsonc`'s
`plugins` array. The entrypoint is `index.ts`. Parent configuration is intentionally
not modified by this migration.

The `autoport` tool preserves enable, disable, add, remove and status, the
1025–65535 integer port restriction, usage messages, 5-second CLI timeout and CLI
error output. It calls `$HOME/.local/bin/traefik-autoport` with literal argv instead
of shell interpolation. `command/autoport.md` remains unchanged.

Tests (never expose ports):

```sh
bun test ~/.config/opencode/plugins/toggle-autoport/index.test.ts
python ~/.config/opencode/plugins/toggle-autoport/runtime-smoke.py
```

The unit test uses a disposable fake HOME and fake CLI. The loader smoke uses a
fresh HOME/XDG/database/config and loopback server, reads `/api/plugin` until this
plugin is active, then terminates only that test server. It never executes the tool.
Its diagnostic files remain under `$TMPDIR/autoport-load-*`.

API reference: exact upstream tag `v2.0.16`, `packages/plugin/src/promise/tool.ts`,
`packages/plugin/src/promise/plugin.ts`, `packages/schema/src/tool.ts`, and
`packages/plugin/src/host.ts`.
