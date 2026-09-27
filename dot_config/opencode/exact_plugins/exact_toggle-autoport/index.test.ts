import { test, expect, afterAll } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"

// Never invoke the real exposure CLI, even when a test fails.
const home = mkdtempSync(join(process.env.TMPDIR!, "autoport-test-"))
mkdirSync(join(home, ".local/bin"), { recursive: true })
writeFileSync(join(home, ".local/bin/traefik-autoport"), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 })
const previous = process.env.HOME
process.env.HOME = home
const { default: plugin } = await import("./index")
afterAll(() => { process.env.HOME = previous; rmSync(home, { recursive: true, force: true }) })

test("v2 registers autoport and preserves safe argv CLI behavior", async () => {
  expect(plugin?.id).toBe("toggle-autoport")
  let tool: any
  await plugin.setup({ tool: { transform: (fn: any) => fn({ add: (value: any) => { tool = value } }) } } as any)
  expect(tool.name).toBe("autoport")
  expect(tool.input.properties.port.minimum).toBe(1025)
  for (const action of ["status", "enable", "disable"]) {
    expect(await tool.execute({ action }, {})).toEqual({ content: action })
  }
  expect(await tool.execute({ action: "add", name: "api; printf INJECTED", port: 3000 }, {}))
    .toEqual({ content: "add\napi; printf INJECTED\n3000" })
  expect(await tool.execute({ action: "remove", name: "api" }, {})).toEqual({ content: "remove\napi" })
  expect((await tool.execute({ action: "add" }, {})).content).toContain("Usage")
  expect((await tool.execute({ action: "remove" }, {})).content).toContain("Usage")
})
