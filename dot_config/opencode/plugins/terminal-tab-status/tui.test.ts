import { test, expect } from "bun:test"
import { EventEmitter } from "node:events"
import plugin from "./tui"

const wait = () => new Promise(resolve => setTimeout(resolve, 130))
test("TUI title follows selected session, spinner, completion, focus and cleanup", async () => {
  expect(plugin?.id).toBe("terminal-tab-status")
  const renderer = Object.assign(new EventEmitter(), { isDestroyed: false, setTerminalTitle: (s: string) => { titles.push(s) } })
  const titles: string[] = []
  let route: any = { type: "session", sessionID: "a" }
  const sessions: any = { a: { title: "Alpha\x1b\x07\u009c" }, b: { title: "Beta" } }
  const statuses: any = { a: "idle", b: "running" }
  const events = new EventEmitter()
  const cleanup = await plugin.setup({ renderer, ui: { router: { current: () => route } }, data: { on: (type: string, fn: any) => { events.on(type, fn); return () => events.off(type, fn) }, session: { get: (id: string) => sessions[id], status: (id: string) => statuses[id] } } } as any)
  try {
    expect(titles.at(-1)).toBe("Alpha")
    renderer.emit("blur")
    statuses.a = "running"
    await wait()
    expect(titles.at(-1)).toMatch(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Alpha$/)
    statuses.a = "idle"
    await wait()
    expect(titles.at(-1)).toBe("✓ Alpha")
    sessions.a.title = "Renamed"
    await wait()
    expect(titles.at(-1)).toBe("✓ Renamed")
    renderer.emit("focus")
    expect(titles.at(-1)).toBe("Renamed")
    route = { type: "session", sessionID: "b" }
    await wait()
    expect(titles.at(-1)).toMatch(/ Beta$/)
    statuses.b = "idle"
    await wait()
    expect(titles.at(-1)).toBe("Beta")
    renderer.emit("blur")
    statuses.b = "running"
    await wait()
    statuses.b = "idle"
    events.emit("session.execution.failed", { data: { sessionID: "b" } })
    await wait()
    expect(titles.at(-1)).toBe("Beta")
    route = { type: "home" }
    await wait()
    expect(titles.at(-1)).toBe("OpenCode")
  } finally { await cleanup?.() }
  expect(renderer.listenerCount("focus")).toBe(0)
  const count = titles.length
  await wait()
  expect(titles.length).toBe(count)
})
