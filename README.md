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

### oo7 (Secret Service)

Service is installed but not enabled by default. It provides the D-Bus Secret
Service API (`org.freedesktop.secrets`) as a headless replacement for
gnome-keyring.

- enable/start service: `systemctl --user enable --now oo7-daemon.service`
- check status: `systemctl --user status oo7-daemon.service`

The `login` keyring starts **locked** on every daemon start and must be unlocked
before secrets can be read.

**Manual unlock** (password read from stdin — creates the keyring on first use):

```sh
systemctl --user stop oo7-daemon.service
printf 'your-password' | oo7-daemon --login --replace   # Ctrl-C to stop
systemctl --user start oo7-daemon.service
```

**Auto-unlock on a server** (zero interaction, TPM-bound, systemd ≥ 258):

```sh
systemd-ask-password -n | systemd-creds encrypt --user \
  --name=oo7.keyring-encryption-password - \
  ~/.config/credstore.encrypted/oo7.keyring-encryption-password
```

Store / retrieve secrets:

```sh
printf 'secret' | oo7-cli store "Label" key=value
oo7-cli lookup key=value
oo7-cli list
```
