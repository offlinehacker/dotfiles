---
name: homelab-openbao
description: Use when working on the OpenBao stack of the homelab on core-jarvis (OpenBao server, openbao-authorizer, its policies, token roles, users, SSH CA and roles, or Podman secrets): deploying a new authorizer release, changing OpenBao configuration, checking or debugging the running stack, or reissuing its tokens.
---

# Homelab OpenBao on core-jarvis

The stack is `stacks/openbao` of the `xtruder/homelab` repo, branch `master`. Its README (`~/Code/homelab/stacks/openbao/README.md`) documents components, secrets and setup; read it before changing the stack. This skill holds what the README doesn't: the host, how changes reach it, and the gotchas.

## Where things are

| What | Where |
|---|---|
| Your working copy | `~/Code/homelab` on this workstation. It often has unrelated uncommitted work: stage and commit only `stacks/openbao` (and `dotfiles/` paths you changed). Renovate pushes to `master` often: rebase with `git rebase --autostash origin/master` before pushing |
| Host | `bao-cred ssh core@jarvis` (user `core` at `100.126.6.34`), stack at `~/homelab/stacks/openbao` (`/var/home/core/homelab`). `core` accepts only OpenBao SSH certificates (and the user's hardware key). `bao-cred ssh` signs one for your session (role `jarvis-core`), filing a Grant Request and waiting for approval when needed; pass the reason the Approver sees: `bao-cred ssh --reason "<what and why>" core@jarvis '...'`. One approval gives a 1h certificate that later calls reuse. Plain `ssh` gets no certificate |
| Public URLs | `https://bao.cloud.x-truder.net` (OpenBao), `https://baoauthz.cloud.x-truder.net` (authorizer PWA and API, `/healthz`) |
| On-host ports | `127.0.0.1:18200` OpenBao, `127.0.0.1:18202` authorizer |
| Containers | `openbao` (local image with the GitHub plugin), `openbao_authorizer_1` (`ghcr.io/xtruder/openbao-authorizer`, tag set in `docker-compose.yml`, not overridden by any `.env`) |
| Root token, recovery share | `runtime/init.json` on the host |
| Secrets | rootless Podman secrets on the host, listed in the README |

## How changes reach the host

`homelab-cron.timer` runs `~/.local/bin/homelab-deploy` every 5 minutes: `git pull --ff-only origin master`, `chezmoi apply`, then reloads every `docker-compose@<stack>` unit (`podman compose up -d --remove-orphans --build`), then starts `homelab-verify` (an opencode run that checks the deployment). So a push to `master` deploys within 5 minutes.

- **Deploy now** instead of waiting: `bao-cred ssh core@jarvis 'touch ~/homelab/.working; cd ~/homelab && git pull --ff-only && cd stacks/openbao && make start'`, then `rm ~/homelab/.working`. `make start` recreates the authorizer and, through podman-compose's dependency handling, the OpenBao container too; OpenBao auto-unseals. Pause auto-deploy first and check that no `podman-compose ... up` is running (`pgrep -af podman-compose`): a push starts a deploy within 5 minutes, and two concurrent recreations removed both containers once (`"openbao" is not a valid container`), taking OpenBao down. To recover, run `podman-compose --env-file .env up -d --remove-orphans` in the stack.
- **Pause auto-deploy** while working on the host: `touch ~/homelab/.working` there; remove it when done.
- **New authorizer release:** tag it in the `openbao-authorizer` repo, wait for its CI release run, check `podman pull ghcr.io/xtruder/openbao-authorizer:<tag>` on the host, and only then bump the tag in `docker-compose.yml` and push. Pushing the tag before the image exists breaks the next auto-deploy.

## Changing OpenBao configuration

Change `setup-openbao.sh`, `policies/`, `permission-sets.json` or `ssh-roles.json`, push, then run `make setup` on the host. It reconciles configuration only and is safe to rerun: after the first run it leaves the authorizer token and `runtime/agent-token` alone, and it never regenerates the SSH CA. `make credentials` also reissues both tokens (old ones are not revoked); follow it with `make start`, and run it only when the user asks.

```sh
bao-cred ssh core@jarvis 'cd ~/homelab && git pull --ff-only && cd stacks/openbao && make setup'
```

For a one-off command or inspection, use the tools container:

```sh
bao-cred ssh core@jarvis 'cd ~/homelab/stacks/openbao; root=$(jq -er .root_token runtime/init.json)
podman-compose --env-file .env --profile tools run --rm -T -e BAO_TOKEN="$root" bao <args>'
```

- The tools container sees `./policies` as checked out on the host. For a policy not pushed yet, pipe it: `bao policy write <name> - < policies/<file>.hcl` from the workstation over ssh.
- podman-compose prints noise on stderr. If you discard stderr to quiet it, check exit codes, or real errors vanish. Exit codes do pass through: `bao list` exits 2 on an empty list.
- Tokens with metadata: `bao token create -role=... -entity-alias=... -metadata=k=v`; `bao write .../create meta=k=v` does not build the map.
- After changing what a running token may do, verify through the authorizer: `bao-cred grantable` lists the GitHub permission sets and SSH roles only if the authorizer token works.

## GitHub tokens and commit signing

- `permission-sets.json` has one set per repository, named `project-<owner>-<repo>` (lowercase), because `bao-cred git-credential github/token/project-{owner}-{repo}` picks it from the remote URL. `project-xtruder` and `project-offlinehacker` cover whole organizations; git never picks them. `make setup` removes sets no longer listed.
- `signing-keys.json` lists ed25519 transit keys (`git-<person>`) that sign git commits through `bao-cred-ssh-keygen`. `make setup` creates missing keys and never rotates or deletes one: GitHub and every verifier know the public key.
- After `make setup`, new names appear in `bao-cred grantable` within a minute (the authorizer caches discovery).

## SSH certificates

The `ssh` mount signs user certificates; roles come from `ssh-roles.json`, one per node and user (`jarvis-core` signs only `core@jarvis`). The README's "SSH certificates" section has the design.

- Never write `ssh/config/ca` on the live mount: it replaces the default issuer, rotating the CA every node trusts.
- Nodes trust the CA through a `cert-authority` line in `~/.ssh/authorized_keys`, added by chezmoi (`dotfiles/dot_ssh/modify_authorized_keys`) from the public key in `dotfiles/.chezmoidata/openbao.toml`. jarvis's sshd config is root-only and not readable as `core`; don't plan on changing it.
- Test with a throwaway key and no agent, so only the certificate can authenticate: `ssh -F /dev/null -o IdentityAgent=none -o IdentitiesOnly=yes -i key core@100.126.6.34` (jarvis's tailnet address).

## Identities

| Identity | Use |
|---|---|
| `admin` (userpass) | Full OpenBao administration |
| `approver` (userpass) | Signs in to the PWA only. Never `bao login` as approver: its token in `~/.vault-token` would let agents approve their own requests |
| `dev` (userpass) | Only `named-identity-minter`: `bao login -method=userpass username=dev`, then `bao-cred init` in a project |
| `agent` (userpass on `agents/`) | Host-side bao-cred; the `host-agent` Requester Rule matches every token of that mount |
| Authorizer token | Podman secret `openbao_authorizer_token`; periodic (720h), renewed by the authorizer at start and every 72h (log line `renewed authorizer token`). Created without `default`, so it can't `lookup-self`; check it through the authorizer instead |

Token roles `named-identity` (project Named Tokens) and `agent-session` (child session tokens) back the `named` and `sessions` Requester Rules in `authorizer.hcl`.

## Secrets

Keep secret values out of output, transcripts and files. Pipe them where they are needed, for example:

```sh
umask 077
bao-cred ssh core@jarvis "podman secret inspect --showsecret --format '{{.SecretData}}' dev_password" \
  | jq -Rn '{password: input}' \
  | curl -sf -X POST --data @- https://bao.cloud.x-truder.net/v1/auth/userpass/login/dev \
  | jq -er .auth.client_token > ~/.vault-token
```

When listing environment variables or tokens, print names, policies and TTLs, never values. When a command must show a token, redact it (`sed -E 's/s\.[A-Za-z0-9]{20,}/<token>/g'`).

## Checking the stack

```sh
bao-cred ssh core@jarvis 'podman ps --format "{{.Names}} {{.Image}} {{.Status}}" | grep -i bao; podman logs --tail 20 openbao_authorizer_1'
curl -s -o /dev/null -w '%{http_code}\n' https://baoauthz.cloud.x-truder.net/healthz
```
