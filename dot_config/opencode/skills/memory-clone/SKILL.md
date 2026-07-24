---
name: memory-clone
description: Clone and inspect external Git repositories in temporary storage. Use when an Explore subagent needs source code from a repository that is not already available in the workspace or configured references.
---

# Memory Clone

Clone an external repository with:

```bash
git memory-clone <repository-url>
```

The command prints the generated `/tmp/opencode-explore-XXXXX` path. Use that path with `read`, `glob`, `grep`, or read-only Git commands such as:

```bash
git -C <temporary-path> status --short --branch
git -C <temporary-path> log --oneline -10
git -C <temporary-path> grep <pattern>
```

Treat the clone as temporary investigation material. Do not edit it or use it as a project workspace.
