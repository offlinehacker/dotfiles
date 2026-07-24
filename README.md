# dotfiles

My personal dotfiles used primarily in devcontainers and codespaces

## systemd user services

### brew auto-update

Timer is installed but not enabled by default.

- enable/start timer: `systemctl --user enable --now brew-update.timer`
- start once: `systemctl --user start brew-update.service`
- schedule: 02:00 UTC (09:00 Bangkok)

### opencode

Service is installed but not enabled by default.

- enable/start service: `systemctl --user enable --now opencode.service`
- check status: `systemctl --user status opencode.service`

The global OpenCode configuration includes a documentation-update plugin and companion feature-documentation skill. See [Automatic documentation updates](dot_config/opencode/plugins/docs-update/README.md) for triggers, configuration, and operational constraints.
