---
name: feature-docs
description: Use when a project already has docs/feature, feature documentation is mentioned, or the user requests feature documentation. Finds and maintains relevant feature documents without imposing that convention on other projects.
---

# Feature Documentation

Use `docs/feature/` as durable context only when the project already follows that convention, project instructions require it, or the user explicitly requests feature documentation. Do not create `docs/feature/` merely because the work involves a feature.

## Before Working

1. If `docs/feature/` exists, search it for filenames and content related to the feature, its user-facing terminology, and the implementation area.
2. Read the closest matching feature document before planning or editing code.
3. Also read the `AGENTS.md` files that apply to the files being changed.
4. Treat existing feature documentation as context to verify against the current code, not as unquestionable truth.

## While Working

- Keep track of behavior, architecture decisions, configuration, constraints, workflows, compatibility requirements, and non-obvious implementation details that future work must preserve.
- Notice user corrections, manually stated programming preferences, and repeated prompting. These often indicate missing guidance in the nearest relevant `AGENTS.md`.
- Prefer one stable feature document over multiple overlapping documents.

## After Working

1. Create or update `docs/feature/<name>.md` only when the project already uses that directory, project instructions require it, or the user explicitly requests a feature document.
2. Use a concise, stable, kebab-case feature name and update an existing matching document instead of creating a duplicate.
3. Describe the feature's purpose, user-visible behavior, important implementation details, architecture decisions, configuration, constraints, and relevant verification workflows.
4. Update the nearest relevant `AGENTS.md` with reusable conventions, preferences, required workflows, or pitfalls discovered during the work. Use the root `AGENTS.md` only for project-wide guidance.
5. Consolidate existing content. Do not append session logs, transient debugging details, secrets, speculation, or duplicated guidance.

For a minor question or maintenance change that does not affect feature behavior and reveals no durable guidance, no documentation edit is required.
