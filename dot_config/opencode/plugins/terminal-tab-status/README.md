# Terminal tab status — OpenCode 2.0.16

This is now a **TUI-only plugin**, not a headless server hook. A remote server
cannot safely choose or write the terminal belonging to one attached client.
The implementation uses the official `@opencode/plugin/tui` Context from
`@opencode/plugin@2.0.16`: `renderer.setTerminalTitle`, renderer focus/blur,
`ui.router.current()`, `data.session.get/status`, and v2 execution failure events.
No `/dev/tty`, macOS helper, or accessibility polling is needed.

## Registration (parent handles this)

On each machine running the full TUI, install this directory and merge:

```json
{
  "plugins": ["./plugins/terminal-tab-status"],
  "terminal": { "title": false }
}
```

into its `tui.json`. Disabling the built-in writer prevents title races. Register
the **directory**, not the old `.ts` file: the v2 TUI loader skips file targets and
resolves `<directory>/tui.ts`. Do not register this as a server plugin. The old
`../terminal-tab-status.ts` remains a compatibility import re-export only.
No shared config or live service was changed.

## Behavior

- Tracks only the selected session: other clients/sessions cannot rename this tab.
- Session title/rename, 100ms Braille busy spinner, completion checkmark.
- Removes the checkmark on terminal focus; completions while known-focused stay plain.
- Stops the spinner without a success checkmark on execution failure/interruption.
- Uses OpenCode on home, sanitizes C0/C1 controls, cleans up timers/listeners/title.

Focus clearing requires the terminal emulator to send focus reports. Until a
focus event is observed, completion is conservatively shown with a checkmark.
The SDK exposes no router subscription, so a 100ms sampler follows navigation and
status. A whole busy/idle transition shorter than a sample can be missed. This is
for the full TUI, not the mini TUI, browser UI, or a headless server.

## Validation

```sh
bun test ~/.config/opencode/plugins/terminal-tab-status/tui.test.ts
```

The renderer/context lifecycle test covers selected session isolation, title
sanitization/rename, spinner, completion, focus, failures, route changes and cleanup.
A real emulator focus/OSC end-to-end test is still needed on the user's TUI client.

Source references: exact upstream tag `v2.0.16`,
`packages/plugin/src/tui/{context,plugin}.ts`, `packages/plugin/src/host.ts`,
`packages/tui/src/plugin/context.tsx`, `packages/tui/src/app.tsx` and
`packages/tui/src/attention.ts`.
