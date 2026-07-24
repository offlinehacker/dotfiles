---
name: docs-update
description: Use when reviewing completed work for durable documentation updates, improving relevant skills and AGENTS.md guidance, recording user corrections or project conventions, or when a docs-update session requests it.
---

# Documentation Update

Review the conversation and current workspace for durable knowledge that future contributors and agents need. Treat relevant skills and scoped `AGENTS.md` files as first-class documentation targets, not just README-style documents. Update documentation directly; do not delegate the work.

Do not call the `docs_update` tool. Perform the documentation review and edits directly in the current session.

After the review and all edits are complete, call `docs_updated` exactly once with every documentation file changed. Pass an empty file list when no changes were needed.

## Documentation Scope

- Follow all project and global instructions and preserve the project's existing documentation structure.
- Update established README files, architecture or operational documentation, and other relevant docs when behavior, configuration, constraints, decisions, or workflows changed.
- Create or update `docs/feature/<name>.md` only when the project already uses `docs/feature/`, project instructions require it, or the user explicitly requests it. Update an existing matching document instead of creating a duplicate.
- Consolidate existing content rather than appending a session log.

## Skill Scope

Review skills that were loaded, invoked, or relevant to the task. Improve them with durable guidance that was difficult to infer automatically or materially helped complete the work, especially:

- User corrections and decision criteria.
- Non-obvious prerequisites, constraints, workflows, failure modes, and verified workarounds.

Prefer improving an existing skill, including its trigger description when needed. Keep global skills portable; put repository-specific rules in project skills or `AGENTS.md`. Exclude task history and facts obvious from code or standard documentation.

## AGENTS.md Scope

Use `AGENTS.md` for reusable, non-obvious instructions tied to a repository, directory, or module, such as programming preferences, project conventions, required workflows, architecture rules, recurring pitfalls, and corrections the user had to state manually. Use a skill instead when the knowledge describes a reusable task procedure or capability rather than a rule for files in that scope.

Place each rule in the narrowest useful scope:

1. Identify the directory or module whose files the guidance affects.
2. Update the nearest applicable `AGENTS.md` when one exists.
3. If no scoped file exists, create an `AGENTS.md` at a meaningful module or directory boundary.
4. Use the repository-root `AGENTS.md` only for guidance that applies across the whole project.

Do not create an `AGENTS.md` in every touched directory. Create one only where the directory represents a stable scope and the guidance would otherwise pollute a broader file. Move or consolidate existing guidance when a narrower scope is clearly more appropriate, avoiding duplicate rules across parent and child files.

## Quality Bar

- Verify claims against the current workspace.
- Preserve file structure and style.
- Keep guidance concise, actionable, and independent of this conversation.
- Exclude secrets, speculation, transient debugging details, generic advice, and facts already obvious from the code.
- Do not modify source code.
- If nothing durable was learned, make no changes.

When invoked from a normal development session, apply these rules to discoveries made during that work. When invoked from a background documentation session, use the inherited session history as evidence and complete the documentation update yourself.
