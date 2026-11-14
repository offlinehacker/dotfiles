---
name: openbao-grants
description: Use when a task needs a secret or credential from OpenBao/Vault (API tokens, database passwords, cloud keys, `bao`/`vault` CLI, secretspec `openbao://`), when an OpenBao read or secretspec fails with permission denied, or when you must ask a human to grant access with bao-cred.
---

# OpenBao grants

The project works as a **Named Identity**: a `.bao-identity` file at its git root (or `BAO_IDENTITY`) names it. Your conversation is an **Agent Session** of it: bao-cred reads the session ID from `OPENCODE_SESSION_ID` (or `BAO_SESSION_ID`) and mints this session's own token from the project's on first use. A subagent is a session of its own. Leave these variables and `.bao-identity` as they are.

The token starts with almost no access. You gain access through **Grants**: a human Approver approves each requested path and capability, and the Grant then applies to this same token until it expires. Each Grant has a scope, which the Approver decides: **session** (this conversation only), **project** (every session of the project) or **global** (every project).

## Check the setup first

```sh
bao-cred status
```

It prints the identity, your session, where the project token is stored and the remaining TTL, as JSON. When it reports a missing or invalid token, a keyring that is unavailable, or no identity selected, stop and tell the user what it says. Minting the project token is the human's step: they run `bao login`, then `bao-cred init` in the project, or unlock their keyring.

## Find what you may request

When you don't already know the exact path, start here:

```sh
bao-cred grantable
```

It prints, as JSON, every rule for what may be requested: `path` (an OpenBao pattern: `+` is one segment, a trailing `*` any suffix), `capabilities`, `max_ttl`, `description`, and sometimes `paths`, concrete paths the authorizer found. Prefer a path from `paths` that fits the task. Otherwise build a concrete path that matches `path`, guided by `description`. A `discover_error` only means the list of concrete paths is unavailable; the pattern still applies. Anything matching no rule is refused.

## Read a credential

Hand the secret straight to the program that needs it, so it never appears in your output:

```sh
bao-cred read --reason "Run the integration tests against the staging DB" \
  --map PGUSER=username --map PGPASSWORD=password database/creds/staging -- make integration-test
```

- `bao-cred read [flags] <path> [-- command ...]` reads `<path>`. With `--reason`, a permission-denied read files a Grant Request for `PATH=read`, waits for the Approver, then retries once. Without `--reason` it just fails with a hint.
- Output options: `--map ENV=field` (repeatable; with `-- command` it sets the command's environment), `--output FILE` (mode 0600), `--format json|dotenv|shell|template`, `--field NAME` (one value to stdout).
- Flags take two dashes (`--reason`, not `-reason`). Everything after `--` goes to the command unchanged.

## Request several paths at once

When you know up front what the task needs, ask for everything in one request so the human approves it in one pass:

```sh
bao-cred request --reason "Deploy api to staging: read DB creds and push the image" \
  --item database/creds/staging=read \
  --item kv/data/registry/staging=read
```

- `--item PATH=CAP[,CAP]` is repeatable. Capabilities: `create, read, update, patch, delete, list`. Paths are concrete: no `*` or `+`.
- Ask for the least you need: exact paths and only the capabilities you'll use. Add `--ttl 1h` when the task is short.
- Requests default to session scope. Add `--scope project` only when other sessions of the project will clearly need the same access, such as a credential the user asked to set up for the project; say why in the reason. The Approver may change the scope either way.
- It waits until no item is pending (`--timeout`, default 15m) and prints each item's outcome as JSON. Progress goes to stderr. `--no-wait` returns at once; `bao-cred request --wait ID` resumes waiting.

**Write reasons for a human deciding on a phone.** Say what you're doing and why this path is needed: "Rotate the webhook secret for project-foo as the user asked", not "need access" or "task".

## Check what you already have

```sh
bao-cred grants
```

Prints the active Grants that reach this session, with their scope and expiry, as JSON; `"mine": true` marks those this session filed. Check it before requesting, and after an approval if something still fails.

## Give access back

When the task that needed a Grant is done, end it instead of letting it run out:

```sh
bao-cred revoke --all        # every Grant this session filed
bao-cred revoke <grant-id>   # one of them
```

It ends only Grants this session filed, including project or global ones it asked for; other sessions' Grants stay.

## secretspec

secretspec, the `bao` CLI and other tools that read the token from the environment get your session's token through `bao-cred run`:

```sh
bao-cred run -- secretspec run -- make test
```

secretspec's KV v2 secrets live at `<mount>/data/secretspec/<project>/<profile>/<KEY>`. When it fails with permission denied, request those exact paths with `bao-cred request` (`read`), then rerun it. A `secretspec.toml` whose provider alias sets a `token` credential uses that instead, which is the project's token: session Grants don't reach it.

## Outcomes

Each item ends in one state:

| State | Meaning | What to do |
|---|---|---|
| `approved`, `already_granted` | Access is in effect | Continue |
| `rejected` | The Approver said no | Leave it. Tell the user and continue without it, or ask how to proceed |
| `refused` | Outside what may be requested; `reason` says why | Tell the user; an operator may need to allow it |
| `pending` | Nobody decided before the timeout | Tell the user an approval is waiting; `bao-cred request --wait ID` to keep waiting |
| `expired`, `revoked` | Pending too long, or the Grant ran out or was withdrawn | Request again only if still needed, with a reason that says why |

Exit status: `0` every item approved or already granted; `3` some item rejected, refused, expired or revoked; `4` some item still pending (timeout or `--no-wait`); `2` usage error; `1` other error. On `3` or `4`, read the JSON on stdout and act per item, one request per need.

## Rules

- Keep secret values out of the conversation, committed files, logs and command lines: use `--map ... -- cmd`, `--output`, `bao-cred run -- secretspec run`, and `--field` only when nothing else fits.
- Keep tokens out of output and files, including `BAO_TOKEN`, `VAULT_TOKEN` and `~/.vault-token`. The human's own `bao login` token is theirs alone; work only with the tokens bao-cred picks.
- Paths under `sys/`, `auth/`, `identity/` and `cubbyhole/`, and the `sudo` capability, are always refused.
