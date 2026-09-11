/**
 * session-tools.ts — read-only introspection tools for OpenCode sessions and models.
 *
 *   model_search   — search the provider catalog (provider/model[#variant] IDs, thinking variants)
 *   session_status — list project sessions with directory, title, activity, busy/idle flag
 *
 * Config (opencode.jsonc plugin tuple): ["./plugins/session-tools.ts"] — no options needed.
 * Model IDs from model_search plug directly into worktree_create's `model` argument.
 */

import { type Plugin, tool } from "@opencode-ai/plugin"

type Options = Record<string, never>

const SessionToolsPlugin: Plugin = async (ctx, _options?: Options) => {
	const { serverUrl } = ctx

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

	return {
		tool: {
			model_search: tool({
				description:
					"Search available AI models (provider catalog, ~7000 models). Returns provider/model IDs " +
					"suitable for the `model` argument of worktree_create (optionally with #variant for " +
					"reasoning/thinking effort). Use query for fuzzy matching on provider, model id, or " +
					"display name; optionally restrict to one provider.",
				args: {
					query: tool.schema.string().optional().describe("Search terms, e.g. \"gpt-5.6 sol\", \"claude opus\", \"deepseek\". All terms must match."),
					provider: tool.schema.string().optional().describe("Restrict to this provider ID (e.g. \"openai\", \"anthropic\")"),
					withVariants: tool.schema.boolean().optional().describe("Include the model's variant (thinking/reasoning effort) list in output, default true"),
					deprecated: tool.schema.boolean().optional().describe("Include deprecated models, default false"),
					limit: tool.schema.number().optional().describe("Max results (default 20, max 50)"),
				},
				async execute(args) {
					const res = await fetch(`${apiBase}/provider`, { headers: authHeaders() })
					if (!res.ok) return `Error: provider catalog fetch failed (HTTP ${res.status})`
					const catalog: any = await res.json()
					const providers: any[] = catalog.all ?? []
					const terms = (args.query ?? "").toLowerCase().split(/\s+/).filter(Boolean)
					const limit = Math.min(Math.max(args.limit ?? 20, 1), 50)
					const showVariants = args.withVariants !== false
					const includeDeprecated = args.deprecated === true

					type Hit = { id: string; name: string; status: string; variants: string[]; score: number }
					const hits: Hit[] = []
					for (const p of providers) {
						if (args.provider && p.id !== args.provider) continue
						for (const [mid, m] of Object.entries(p.models ?? {}) as [string, any][]) {
							const status = String(m.status ?? "active")
							if (status === "deprecated" && !includeDeprecated) continue
							const full = `${p.id}/${mid}`.toLowerCase()
							const haystacks = [full, mid.toLowerCase(), String(m.name ?? "").toLowerCase()]
							if (terms.length > 0 && !terms.every((term) => haystacks.some((h) => h.includes(term)))) continue
							// score: exact full-id > model-id prefix > substring
							let score = 2
							if (terms.length > 0 && full === terms.join(" ")) score = 0
							else if (terms.length === 1 && mid.toLowerCase().startsWith(terms[0])) score = 1
							hits.push({
								id: `${p.id}/${mid}`,
								name: String(m.name ?? mid),
								status,
								variants: Object.keys(m.variants ?? {}),
								score,
							})
						}
					}

					if (hits.length === 0) {
						const scope = args.provider ? ` in provider \"${args.provider}\"` : ""
						return `No models matching${terms.length ? ` \"${args.query}\"` : ""}${scope}.`
					}

					hits.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))
					const shown = hits.slice(0, limit)
					const lines = shown.map((h) => {
						const v = showVariants && h.variants.length > 0 ? ` variants: ${h.variants.join(",")}` : ""
						const flag = h.status !== "active" ? ` [${h.status}]` : ""
						return `${h.id}${flag} — ${h.name}${v}`
					})
					const more = hits.length > shown.length ? `\n... and ${hits.length - shown.length} more (narrow the query or raise limit).` : ""
					return `Models (${hits.length} matches, showing ${shown.length}):\n${lines.join("\n")}${more}\n\nUse as model: \"<provider>/<model>\" or with thinking effort: \"<provider>/<model>#<variant>\" (e.g. ${shown[0].id}${shown[0].variants.includes("medium") ? "#medium" : ""}).`
				},
			}),

			session_status: tool({
				description:
					"List OpenCode sessions of this project — including sessions running inside worktrees — " +
					"with their directory, title, last activity, and busy/idle status. Use it to check what " +
					"other sessions are doing before creating conflicts. Optionally filter by path fragment " +
					"(matches directory, title, or session ID).",
				args: {
					filter: tool.schema.string().optional().describe("Only show sessions whose directory or title contains this fragment"),
					roots: tool.schema.boolean().optional().describe("Only root sessions (hide subagent/forked children), default true"),
					limit: tool.schema.number().optional().describe("Max sessions per directory (default 30, max 100)"),
				},
				async execute(args, toolCtx) {
					// Sessions are scoped per directory instance: a session created inside a worktree is
					// only visible via that worktree's directory query. Enumerate the repo root + all
					// worktrees and query each.
					const root = toolCtx.worktree || toolCtx.directory
					const dirs = [root]
					try {
						const wres = await fetch(`${apiBase}/experimental/worktree?directory=${encodeURIComponent(root)}`, { headers: authHeaders() })
						if (wres.ok) {
							const wts: string[] = await wres.json()
							for (const w of wts) if (w && !dirs.includes(w)) dirs.push(w)
						}
					} catch {}

					const limit = Math.min(Math.max(args.limit ?? 30, 1), 100)
					const roots = args.roots ?? true
					type Row = { id: string; title: string; directory: string; updated: number | null; busy: boolean | null }
					const rows: Row[] = []
					const seen = new Set<string>()

					for (const dir of dirs) {
						try {
							const q = new URLSearchParams({ directory: dir, roots: String(roots), limit: String(limit) })
							const res = await fetch(`${apiBase}/session?${q}`, { headers: authHeaders() })
							if (!res.ok) continue
							const sessions: any[] = await res.json()
							let statusMap: Record<string, any> = {}
							try {
								const st = await fetch(`${apiBase}/session/status?directory=${encodeURIComponent(dir)}`, { headers: authHeaders() })
								if (st.ok) statusMap = await st.json()
							} catch {}
							const now = Date.now()
							for (const s of sessions) {
								if (seen.has(s.id)) continue
								seen.add(s.id)
								const live = statusMap[s.id]
								rows.push({
									id: s.id,
									title: s.title ?? "(untitled)",
									directory: s.directory ?? dir,
									updated: s.time?.updated ?? null,
									busy: live ? live.type === "busy" : null,
								})
							}
						} catch {}
					}

					if (rows.length === 0) return "No sessions found."
					const frag = (args.filter ?? "").toLowerCase()
					const filtered = rows
						.filter((r) =>
							!frag ||
							r.directory.toLowerCase().includes(frag) ||
							r.title.toLowerCase().includes(frag) ||
							r.id.toLowerCase().includes(frag),
						)
						.toSorted((a, b) => (b.updated ?? 0) - (a.updated ?? 0))

					if (filtered.length === 0) return `No sessions matching "${args.filter}" (searched ${dirs.length} director${dirs.length === 1 ? "y" : "ies"}: repo root + worktrees).`
					const lines = filtered.map((r) => {
						const flag = r.busy === true ? "[busy]  " : r.busy === false ? "[idle]  " : "[?]     "
						const age = r.updated ? `${Math.max(0, Math.round((Date.now() - r.updated) / 60000))}m ago` : "unknown"
						return `${flag} ${r.id}\n    ${r.title}\n    dir: ${r.directory} — updated ${age}`
					})
					return `Sessions (${filtered.length} of ${rows.length} total, across ${dirs.length} directories):\n${lines.join("\n")}`
				},
			}),

		},
	}
}

const SessionToolsPluginWithInternals = Object.assign(SessionToolsPlugin, {
	testInternals: {},
} as const)

export default SessionToolsPluginWithInternals
