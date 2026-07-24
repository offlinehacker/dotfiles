# OpenCode plugin conventions

- Package substantial global plugins in `dot_config/opencode/plugins/<name>/` with the implementation, lifecycle tests, and feature README colocated.
- Register a nested plugin entry point explicitly in `dot_config/opencode/opencode.jsonc`; do not add a second top-level auto-discovered loader for the same plugin.
- Treat the colocated plugin README as the feature document for that plugin instead of creating a duplicate under the repository's `docs/feature/` directory.
- Keep companion global skills under `dot_config/opencode/skills/<name>/` so OpenCode discovers them independently from the plugin.
- Preserve shipped command names as aliases when introducing a preferred replacement unless removal is explicitly requested.
- Completion context injected into a source session must use `noReply: true`; a background documentation update must not restart an idle source agent.
- OpenCode SDK requests may return `{ error }` without throwing. Pass mutation responses through the plugin's response validation helper before treating them as successful.
- Run `bun run test:docs-update` from the global OpenCode config directory after changing the documentation-update plugin, then validate OpenCode startup with the source global config.
