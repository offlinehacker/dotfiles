---
name: spawn-session
description: Start a separate top-level opencode session, in another directory, on the running opencode server, with a handoff of this conversation.
argument-hint: "Directory, task, and optionally model and title"
disable-model-invocation: true
metadata:
  opencode/autoinvoke: false
---

Start a new, independent opencode session — not a subagent — that the user can open in their session list and steer themselves.

1. **Pin down the launch.** From the user's arguments and the conversation: the target directory, the task, the model and its thinking level (only ones the user named; otherwise leave the server's defaults), and a short title. Ask with `AskUserQuestion` for anything missing. Done when all of them are settled.

   The thinking level is the model's variant, written `provider/model#variant`. List a model's variants with `opencode api get /api/model` (each entry has `id`, `providerID` and `variants[].id`; Claude models have `low`, `medium`, `high`, `xhigh`, `max`).

2. **Prepare the directory.** Create it if missing. Run `git init -b main` only for a new project the user asked for. Leave existing contents alone.

3. **Write the handoff** to `/tmp/opencode/handoff-<slug>.md`, following `~/.agents/skills/handoff/SKILL.md`. The new session starts with no memory of this conversation, so the document carries everything it needs: goal, decisions made and why, open questions to confirm with the user, reference repositories and the practices to copy from them, conventions (commit signing, `BAO_REASON`, asking before pushing or deploying), and suggested skills. Done when a reader with only this file and the filesystem could start correctly.

4. **Launch it in tmux** on the existing server. The server is `opencode.service`; read its port from `systemctl --user cat opencode.service` (it has been `4096`). `OPENCODE_SERVER_PASSWORD` from the environment authenticates.

   ```sh
   tmux new-session -d -s <slug> -c <directory> \
     "opencode run --server http://127.0.0.1:<port> [--model <provider/model>[#<variant>]] --title '<title>' \
        --file /tmp/opencode/handoff-<slug>.md \
        'Implement the attached handoff in this directory. Confirm its open questions with me before writing code.' \
        2>&1 | tee /tmp/opencode/<slug>-run.log; exec bash"
   ```

   Leave out `--auto`, so permission requests still reach the user, unless they asked for it.

5. **Verify** with `tail /tmp/opencode/<slug>-run.log`: the `> <agent> · <model>` line and the agent's first actions show it started on the requested model. Done when that line is there; on an error, show it to the user and stop.

6. **Report**: directory, model, title, handoff path, `tmux attach -t <slug>`, and the log path.
