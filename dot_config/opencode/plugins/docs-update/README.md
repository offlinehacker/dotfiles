# Automatic documentation updates

The global plugin at `~/.config/opencode/plugins/docs-update/index.ts` maintains durable project documentation in a background OpenCode session. It is registered explicitly in the global OpenCode config; restart OpenCode after changing the plugin or its configuration.

## Behavior

The plugin watches root sessions and estimates their live context from the latest completed, non-summary assistant message. The estimate includes input, cache read/write, output, and reasoning tokens.

- The first automatic update becomes eligible at 100,000 context tokens.
- Later updates require 50,000 tokens of additional positive context growth.
- Context reductions after compaction reset the observation baseline without subtracting growth already accumulated.
- Normal updates start when an eligible session becomes idle.
- The pre-compaction hook applies the same threshold rather than forcing an update for every compaction.
- `/update-docs [instructions]` bypasses the token threshold but still refuses duplicate concurrent runs.

Each run forks the source session so the documentation agent retains its complete conversation and tool history. Idle and manual command runs fork the full session. Pre-compaction runs stop before the pending compaction message. Direct `docs_update` tool calls stop before the assistant tool call that launched the update. These boundaries avoid replaying unfinished operations in the fork.

The fork receives the source session's latest agent and model unless the plugin has a custom `model` option. The plugin reads OpenCode's resolved skill list through the authenticated `/skill` endpoint and selects `docs-update`, so normal project/global skill precedence applies. Filesystem fallback resolution is disabled; a run fails if the endpoint or skill is unavailable. The complete `SKILL.md` content is used verbatim as the maintenance prompt. Nested task delegation and the `docs_update` tool are disabled in the maintenance run; `docs_updated` remains enabled as its required completion signal.

OpenCode shows a toast when maintenance starts and when it completes or fails. Each fork is renamed to `<source title> - docs-update #N`; the sequence number is one greater than the highest sequence found in prior fork metadata or matching session names, with process-local state as a fallback if session listing fails. Completed forks are archived rather than deleted, preserving an audit trail without keeping them in the normal session list.

Before prompting the fork, the plugin records its current session diff. The maintenance agent calls `docs_updated` with the files it changed, and the plugin compares that report with the final diff. The diff is authoritative when available; the reported list is the fallback. A fork that becomes idle without reporting is marked failed and remains eligible for retry. Successful completion adds a synthetic `noReply` source-session message listing changed files. If the source session is busy or retrying, the notice waits until it becomes idle.

## Manual command

The plugin injects `/update-docs` and the `docs_update` custom tool. Text after the command is appended to the end of the skill content under an additional-instructions heading:

```text
/update-docs Focus on migration behavior and configuration examples.
```

The `command.execute.before` hook starts maintenance directly, so the command does not depend on the model discovering or invoking the custom tool. The command prompt is replaced with a short confirmation instruction. One small parent-session model turn remains unavoidable because OpenCode custom commands are model prompts rather than direct plugin callbacks.

The `docs_update` tool accepts optional additional instructions and starts the same background workflow. The `docs_updated` tool records completion with a `files` array. In a root session, it immediately persists a checkpoint at the latest completed-message context and resets the automatic cooldown without starting a fork. Generation after the tool call counts toward the next interval. In a plugin-owned maintenance fork, it supplies the completion report consumed when the fork becomes idle. Other child sessions cannot create checkpoints.

## Persisted run history

Documentation forks store a `docsUpdate` metadata record containing the source session ID, start and completion timestamps, source context-token watermark, sequence number, and run status. Only successfully completed runs become cooldown watermarks; failed or still-running forks do not suppress a later automatic update.

When OpenCode restarts, the plugin uses the newest completed maintenance fork or source-session `docs_updated` checkpoint and reconstructs cooldown progress from later source assistant messages. It begins with the stored source-context watermark, adds only positive context changes, and treats decreases such as compaction as baseline resets. For maintenance forks, activity after the fork started counts because it was not inherited by that run.

Older documentation forks created before metadata persistence are detected by the `<source title> - docs-update #N` naming convention. Their exact historical token watermark cannot be recovered, so the current source context becomes a fresh baseline and the next run waits for 50,000 additional tokens.

## Configuration

The global OpenCode config registers the plugin by path. A plugin tuple can provide these options:

```json
{
  "plugin": [
    [
      "./plugins/docs-update/index.ts",
      {
        "initialTokens": 100000,
        "intervalTokens": 50000,
        "model": "anthropic/claude-sonnet-4-6",
        "skill": "docs-update",
        "prompt": "Only update documentation paths approved by this project.",
        "replacePrompt": false
      }
    ]
  ]
}
```

`model` accepts `provider/model` and applies to automatic and manual maintenance runs. If it is omitted or malformed, the fork inherits the source session model. `skill` selects the resolved OpenCode skill by name and defaults to `docs-update`. Blank values also use the default. `prompt` is appended under a project-specific heading by default. Set `replacePrompt` to `true` to replace the resolved skill prompt entirely. Missing, non-numeric, or non-positive thresholds fall back to their defaults.

Keep the plugin outside the directly auto-discovered `plugins/*.ts` path when using explicit registration so it loads only once. Registration without tuple options uses the defaults.

## Feature documentation skill

The global `docs-update` skill is the source of truth for maintenance policy and can also be loaded directly in a normal session. The companion `feature-docs` skill teaches agents to discover and maintain matching `docs/feature/*.md` files in projects that already use feature documentation, without imposing that structure globally.

## Operational constraints

- Active fork IDs and in-progress meter state are process-local, but completed-run cooldown state is reconstructed from archived fork metadata after restart.
- Completion notices queued while a source session is busy are also process-local and are lost if OpenCode exits before that session becomes idle.
- Forks copy historical token and cost records. Archived maintenance forks can therefore inflate aggregate OpenCode statistics even though copied history was not billed again.
- The archive update uses a server-supported session field that is not yet represented by the plugin client's v1 TypeScript declaration; the implementation contains a narrow compatibility cast.
- Rename and archive calls inspect the SDK's `{ error }` response because the client does not throw request failures by default.
- Generic event hooks are fire-and-forget. Failures are caught and logged so documentation maintenance cannot break the source session.
- Changed-file reporting compares the fork's baseline and final session diffs. If either diff cannot be read, it falls back to the maintenance agent's `docs_updated` report.
- Root-session `docs_updated` checkpoints use the completed history available when the tool executes; they intentionally exclude generation after the call.
- Project-specific target restrictions are prompt policy, not filesystem permission enforcement. Keep the configured prompt explicit about permitted documentation paths.

## Verification

The implementation has been checked against OpenCode 1.17.18 and `@opencode-ai/plugin` 1.17.18 using strict TypeScript checking, a Bun bundle, OpenCode startup validation, and a mock lifecycle covering threshold and restart reconstruction, manual command/tool, custom model selection, pre-compaction, changed-file notice, notification, rename, metadata, and archive paths.

Run the committed lifecycle test from the global OpenCode config directory:

```sh
bun run test:docs-update
```
