/**
 * worktree.ts — simplified worktree plugin for OpenCode.
 *
 * One mechanism, two entry points:
 *   worktree_create { branch, base?, prompt? }
 *     - Creates a git worktree at <repoRoot>/.worktrees/<branch-slug> on a new branch.
 *     - No `prompt`:  MOVES the current session into the worktree (OpenCode
 *       control-plane move-session API, same mechanism OpenChamber's /move uses).
 *     - With `prompt`: creates a NEW session in the worktree and submits the
 *       prompt to it (the current session stays where it is).
 *   worktree_list {}
 *     - Lists the repository's worktrees with branches, paths, and per-worktree
 *       session activity. (Switching this session into an existing worktree is
 *       done via worktree_create on the existing branch — it is idempotent.)
 *   worktree_delete { path }
 *     - Moves sessions still attached to that worktree back to the repo root,
 *       commits uncommitted changes on the worktree branch, removes the
 *       worktree, and deletes its local branch.
 *
 * Configuration (opencode.jsonc plugin tuple):
 *   ["./plugins/worktree.ts", { "worktreeDir": ".worktrees" }]
 * `worktreeDir` is relative to the repo root (default ".worktrees").
 */

import * as os from "node:os"
import * as path from "node:path"
import { type Plugin, tool } from "@opencode-ai/plugin"

// ---------------------------------------------------------------- helpers

function slugifyBranch(branch: string): string {
	return (
		branch
			.trim()
			.replace(/^refs\/heads\//, "")
			// keep slashes out of the on-disk name
			.split("/")
			.join("-")
			.replace(/[^A-Za-z0-9._-]+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 80)
	)
}

function resolveWorktreeDir(directory: string, configured?: string): string {
	const p = configured ?? ".worktrees"
	if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1))
	if (path.isAbsolute(p)) return p
	return path.resolve(directory, p)
}

interface GitResult {
	ok: boolean
	out: string
	err: string
}

type BunShell = ($$: TemplateStringsArray, ...values: unknown[]) => Promise<{ stdout: Blob; stderr: Blob; exitCode: number }>

async function git($: BunShell, repoRoot: string, args: string[]): Promise<GitResult> {
	const p = await $`git -C ${repoRoot} ${args}`.quiet().nothrow()
	return { ok: p.exitCode === 0, out: p.stdout.toString().trim(), err: p.stderr.toString().trim() }
}

async function listWorktrees($: BunShell, repoRoot: string): Promise<{ path: string; branch?: string }[]> {
	const r = await git($, repoRoot, ["worktree", "list", "--porcelain"])
	const items: { path: string; branch?: string }[] = []
	let cur: { path: string; branch?: string } | null = null
	for (const line of r.out.split("\n")) {
		if (line.startsWith("worktree ")) {
			if (cur) items.push(cur)
			cur = { path: line.slice("worktree ".length) }
		} else if (cur && line.startsWith("branch ")) {
			cur.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "")
		}
	}
	if (cur) items.push(cur)
	return items
}

async function repoRootOf($: BunShell, directory: string): Promise<string | null> {
	// --show-toplevel returns the LINKED WORKTREE root when called from inside one,
	// which would nest new worktrees under <worktree>/.worktrees. Resolve the main
	// repository root instead: --git-common-dir points at the primary .git even
	// from a linked worktree; its parent is the main repo root.
	const r = await git($, directory, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
	if (!r.ok || !r.out) {
		const fallback = await git($, directory, ["rev-parse", "--show-toplevel"])
		return fallback.ok ? fallback.out : null
	}
	const commonDir = r.out
	// Bare-repo safety: if the common dir is the repo root itself (bare), keep it.
	const parent = path.dirname(commonDir)
	if (path.basename(commonDir) === ".git") return parent
	return commonDir
}

// ---------------------------------------------------------------- plugin

type Options = { worktreeDir?: string }

const WorktreePlugin: Plugin = async (ctx, options?: Options) => {
	const { directory, $, serverUrl } = ctx

	const baseDir = resolveWorktreeDir(directory, options?.worktreeDir)
	// ctx.serverUrl is a URL object in v1.18.x, not a string — normalize defensively.
	const apiBase = String(serverUrl ?? "").replace(/\/$/, "")

	// Managed servers may require Basic auth (OPENCODE_SERVER_PASSWORD, set by OpenChamber).
	// Same scheme as OpenCode's own ServerAuth.headers().
	function authHeaders(): Record<string, string> {
		const password = process.env.OPENCODE_SERVER_PASSWORD
		if (!password) return {}
		const username = process.env.OPENCODE_SERVER_USERNAME || "opencode"
		return { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` }
	}

	// Resolve the model for a new worktree session:
	// user-named model ("provider/model" in options or args) wins, else inherit the
	// calling (parent) session's model, else undefined (server default).
	async function resolveModel(
		sessionID: string,
		named?: string,
	): Promise<{ providerID: string; modelID: string; variant?: string } | undefined> {
		const namedTrim = (named ?? "").trim()
		if (namedTrim && namedTrim.includes("/")) {
			// "provider/model" or "provider/model#variant" (e.g. openai/gpt-5.6-sol#medium → reasoningEffort medium)
			const [pm, variant] = namedTrim.split("#", 2)
			const [providerID, modelID] = pm.split("/", 2)
			if (providerID && modelID) {
				return { providerID, modelID, ...(variant?.trim() ? { variant: variant.trim() } : {}) }
			}
		}
		if (!sessionID) return undefined
		try {
			const res = await fetch(`${apiBase}/session/${sessionID}/message`, { headers: authHeaders() })
			if (!res.ok) return undefined
			const messages: any[] = await res.json()
			for (let i = messages.length - 1; i >= 0; i--) {
				const info = messages[i]?.info
				if (info?.role === "assistant" && info?.providerID && info?.modelID) {
					// assistant info doesn't expose the variant; inherit model only.
					return { providerID: info.providerID, modelID: info.modelID }
				}
			}
		} catch {}
		return undefined
	}

	// v1 SDK client (injected) is used for session.create/prompt; the control-plane
	// move-session endpoint is v2-only, so it is called via fetch on serverUrl.

	return {
		tool: {
			worktree_create: tool({
				description:
					"Create a git worktree for isolated work. Creates a new branch and a worktree under " +
					"<repo>/.worktrees/<branch-slug>. Without `prompt`: this session moves into the new " +
					"worktree (uncommitted changes come along). With `prompt`: a NEW session is created " +
					"in the worktree and started on that prompt, while this session stays put.",
				args: {
					branch: tool.schema.string().min(1).describe("Branch name for the worktree, e.g. feature/login"),
					base: tool.schema.string().optional().describe("Base branch/commit to branch from (default: current HEAD)"),
					prompt: tool.schema.string().optional().describe("If set, start a NEW session in the worktree with this prompt instead of moving this session"),
					moveChanges: tool.schema.boolean().optional().describe("Move uncommitted changes from the current directory into the worktree (move mode only, default true)"),
					model: tool.schema.string().optional().describe("Model for the new session: provider/model or provider/model#variant (e.g. openai/gpt-5.6-sol#medium for reasoning effort medium). Default: inherit this session's model."),
				},
				async execute(args, toolCtx) {
					const repoRoot = await repoRootOf($, toolCtx.directory)
					if (!repoRoot) return `Error: ${toolCtx.directory} is not inside a git repository`

					const wtDir = resolveWorktreeDir(repoRoot, options?.worktreeDir)
					const slug = slugifyBranch(args.branch)
					if (!slug) return "Error: branch name produced an empty worktree name"

					// Idempotent: if a worktree for this branch already exists (at the expected path
					// or anywhere in the repo), reuse it instead of failing. The rest of the flow
					// (bind session / start prompt) proceeds unchanged.
					const target = path.join(wtDir, slug)
					const existingWorktrees = await listWorktrees($, repoRoot)
					const existing = existingWorktrees.find(
						(w) => w.branch === args.branch || w.path === target || w.path.endsWith(`/${slug}`),
					)

					if (!existing) {
						// branch already checked out somewhere?
						const branchExists = await git($, repoRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${args.branch}`])

						let addArgs: string[]
						if (branchExists.ok) {
							addArgs = ["worktree", "add", target, args.branch]
						} else {
							addArgs = args.base
								? ["worktree", "add", "-b", args.branch, target, args.base]
								: ["worktree", "add", "-b", args.branch, target]
						}
						const created = await git($, repoRoot, addArgs)
						if (!created.ok) {
							return `Error creating worktree: ${created.err || created.out}`
						}
					}

					// ----- agent flow: new session in the worktree, prompt submitted there
					if (args.prompt) {
						// Create the session directly IN the worktree (POST /session accepts ?directory).
						// Without it the server binds the session to the default instance (home), which
						// breaks any later move (project mismatch).
						const model = await resolveModel(toolCtx.sessionID, args.model)
						// NOTE: /session create uses model {id, providerID}; prompt endpoints use
						// model {providerID, modelID}. Different schemas per endpoint (v1 quirk).
						const createModel = model
							? { id: model.modelID, providerID: model.providerID, ...(model.variant ? { variant: model.variant } : {}) }
							: undefined
						const cr = await fetch(`${apiBase}/session/?directory=${encodeURIComponent(target)}`, {
							method: "POST",
							headers: { "content-type": "application/json", ...authHeaders() },
							body: JSON.stringify({ title: args.prompt.slice(0, 60), ...(createModel ? { model: createModel } : {}) }),
						})
						const cj: any = await cr.json().catch(() => ({}))
						const sessionID = cj?.id
						if (!sessionID) return `Error: failed to create session (HTTP ${cr.status})`
						// Session is already bound to the worktree; verify rather than move.
						const bind = await fetch(`${apiBase}/session/${sessionID}`, { headers: authHeaders() })
						const bound: any = await bind.json().catch(() => ({}))
						if (bind.ok && bound?.directory && bound.directory !== target) {
							const mv = await fetch(`${apiBase}/experimental/control-plane/move-session`, {
								method: "POST",
								headers: { "content-type": "application/json", ...authHeaders() },
								body: JSON.stringify({ sessionID, destination: { directory: target } }),
							})
							if (mv.status !== 204 && mv.status !== 200) {
								return `Worktree created at ${target}, but binding the new session failed (HTTP ${mv.status}). Session ID: ${sessionID} (exists, bound elsewhere). Open a session manually in ${target}.`
							}
						}
						// Fire-and-forget: prompt_async returns 204 immediately instead of waiting for
						// the new session's first assistant message (which would block the creator
						// session's tool call for the whole first LLM round).
						const pr = await fetch(`${apiBase}/session/${sessionID}/prompt_async?directory=${encodeURIComponent(target)}`, {
							method: "POST",
							headers: { "content-type": "application/json", ...authHeaders() },
							body: JSON.stringify({
								...(model ? { model: { providerID: model.providerID, modelID: model.modelID, ...(model.variant ? { variant: model.variant } : {}) } } : {}),
								parts: [{ type: "text", text: `${args.prompt}\n\n(You are working in the git worktree at ${target} on branch ${args.branch}.)` }],
							}),
						})
						if (pr.status !== 204 && !pr.ok) {
							return `Worktree ready at ${target}; session ${sessionID} bound, but submitting the prompt failed (HTTP ${pr.status}).`
						}
						return `Worktree ready at ${target} (branch ${args.branch}).
New session ID: ${sessionID} — starting asynchronously in the worktree with your prompt (it will appear in the session list shortly; first run may take a moment to boot).
Check its progress later with session_status(filter: "${args.branch}").`
					}

					// ----- manual flow: move THIS session into the worktree
					const moveChanges = args.moveChanges ?? true
					const mv = await fetch(`${apiBase}/experimental/control-plane/move-session`, {
						method: "POST",
						headers: { "content-type": "application/json", ...authHeaders() },
						body: JSON.stringify({
							sessionID: toolCtx.sessionID,
							destination: { directory: target },
							moveChanges,
						}),
					})
					if (mv.status !== 204 && mv.status !== 200) {
						const detail = await mv.text().catch(() => "")
						return `Worktree created at ${target} (branch ${args.branch}), but moving this session failed (HTTP ${mv.status}) ${detail.slice(0, 200)}. You can still work in it via: opencode --cwd ${target}`
					}
					return `Moved this session (ID: ${toolCtx.sessionID}) into ${target} (branch ${args.branch}). Uncommitted changes ${moveChanges ? "came along" : "stayed behind"}.
IMPORTANT: The session's directory changed server-side. OpenChamber caches the old directory client-side until it reloads, so follow-up commands in this session may target the stale directory. Tell the user to reload OpenChamber (F5 / Ctrl+R) — after the reload this session continues in ${target} with full command support.`
				},
			}),

			worktree_list: tool({
				description:
					"List the git worktrees of this repository with their branches and paths, including " +
					"sessions currently bound to each worktree. Worktrees live under " +
					"<repo>/.worktrees/<branch-slug>.",
				args: {},
				async execute(_args, toolCtx) {
					const repoRoot = await repoRootOf($, toolCtx.directory)
					if (!repoRoot) return `Error: ${toolCtx.directory} is not inside a git repository`

					const wts = await listWorktrees($, repoRoot)
					if (wts.length <= 1) return "No additional worktrees. Create one with worktree_create."

					let sessionInfo = ""
					if (apiBase) {
						try {
							const res = await fetch(`${apiBase}/session`, { headers: authHeaders() })
							if (res.ok) {
								const sessions: any[] = await res.json()
								const byDir = new Map<string, { count: number; busy: boolean }>()
								for (const s of sessions) {
									const dir: string | undefined = s.directory
									if (!dir) continue
									const entry = byDir.get(dir) ?? { count: 0, busy: false }
									entry.count += 1
									byDir.set(dir, entry)
								}
								try {
									const st = await fetch(`${apiBase}/session/status`, { headers: authHeaders() })
									if (st.ok) {
										const statusMap: any = await st.json()
										for (const [sid, v] of Object.entries(statusMap)) {
											const session = sessions.find((s) => s.id === sid)
											if (session?.directory && (v as any)?.type === "busy") {
												const entry = byDir.get(session.directory)
												if (entry) entry.busy = true
											}
										}
									}
								} catch {}
								sessionInfo = "\n\nSessions per worktree:"
								for (const w of wts.slice(1)) {
									const info = byDir.get(w.path)
									if (info) {
										sessionInfo += `\n  ${w.path}\n    ${info.count} session(s)${info.busy ? " — BUSY" : ""}`
									}
								}
							}
						} catch {}
					}

					const lines = wts.map((w, i) =>
						`${i === 0 ? "* (main)" : "  -"} ${w.branch ?? "(detached)"}  →  ${w.path}`,
					)
					return `Worktrees of ${repoRoot}:\n${lines.join("\n")}${sessionInfo}`
				},
			}),

			worktree_delete: tool({
				description:
					"Delete a git worktree. Sessions still attached to it are moved back to the repo root, " +
					"uncommitted changes are committed on the worktree branch, then the worktree and its " +
					"local branch are removed.",
				args: {
					path: tool.schema.string().describe("Path or path fragment of the worktree to delete"),
					force: tool.schema.boolean().optional().describe("Skip the safety commit if there are uncommitted changes (destructive)"),
				},
				async execute(args, toolCtx) {
					const repoRoot = await repoRootOf($, toolCtx.directory)
					if (!repoRoot) return `Error: ${toolCtx.directory} is not inside a git repository`

					const wts = await listWorktrees($, repoRoot)
					const needle = args.path.toLowerCase()
					const hit = wts.find((w) => w.path.toLowerCase().includes(needle) && w.path !== repoRoot)
					if (!hit) return `No worktree matches "${args.path}". Known:\n${wts.map((w) => w.path).join("\n")}`

					// sessions living in that worktree → move home first
					if (apiBase) {
						const listRes = await fetch(`${apiBase}/session?directory=${encodeURIComponent(hit.path)}`, { headers: authHeaders() }).catch(() => null)
						if (listRes?.ok) {
							const sessions = (await listRes.json().catch(() => [])) as { id: string }[]
							for (const s of sessions) {
								await fetch(`${apiBase}/experimental/control-plane/move-session`, {
									method: "POST",
									headers: { "content-type": "application/json", ...authHeaders() },
									body: JSON.stringify({ sessionID: s.id, destination: { directory: repoRoot }, moveChanges: false }),
								}).catch(() => {})
							}
						}
					}

					// safety commit
					const status = await git($, hit.path, ["status", "--porcelain"])
					if (status.out && !args.force) {
						await git($, hit.path, ["add", "-A"])
						const c = await git($, hit.path, ["commit", "-m", "wip: state before worktree removal", "--no-verify"])
						if (!c.ok) return `Error: could not commit uncommitted changes in ${hit.path}: ${c.err}. Use force:true to discard them.`
					}

					if (hit.branch) {
						const rm = await git($, repoRoot, ["worktree", "remove", hit.path])
						if (!rm.ok) return `Error removing worktree: ${rm.err}`
						await git($, repoRoot, ["branch", "-D", hit.branch])
						return `Removed ${hit.path} and branch ${hit.branch}. Sessions from it were moved back to ${repoRoot}.`
					}
					const rm = await git($, repoRoot, ["worktree", "remove", hit.path])
					return rm.ok ? `Removed ${hit.path}.` : `Error removing worktree: ${rm.err}`
				},
			}),
		},
	}
}

export default WorktreePlugin
