import { strict as assert } from "node:assert"

const pluginModule = await import(process.env.DOCS_UPDATE_PLUGIN ?? "./index")
const plugin = pluginModule.default

const calls: Array<{ name: string; input: any }> = []
let messages: any[] = [
  {
    info: {
      id: "user-1",
      role: "user",
      agent: "build",
      model: { providerID: "test", modelID: "model" },
    },
    parts: [{ type: "text" }],
  },
  {
    info: {
      id: "assistant-1",
      role: "assistant",
      providerID: "test",
      modelID: "model",
      time: { completed: 1 },
      tokens: { input: 90, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [{ type: "text" }],
  },
]
let fork = 0
let diffs: any[] = []
let sessions: any[] = []
let sourceMetadata: Record<string, unknown> = {}

const client = {
  _client: {
    get: async (input: any) => {
      calls.push({ name: "skills", input })
      return {
        data: [
          {
            name: "test-docs",
            content: "# Test documentation skill\n\nUpdate durable documentation.",
          },
        ],
      }
    },
  },
  app: { log: async (input: any) => calls.push({ name: "log", input }) },
  tui: { showToast: async (input: any) => calls.push({ name: "toast", input }) },
  session: {
    get: async () => ({ data: { title: "Feature work", metadata: sourceMetadata } }),
    list: async () => ({ data: sessions }),
    status: async () => ({ data: {} }),
    messages: async () => ({ data: messages }),
    diff: async () => ({ data: diffs }),
    fork: async (input: any) => {
      calls.push({ name: "fork", input })
      return { data: { id: `fork-${++fork}` } }
    },
    promptAsync: async (input: any) => {
      calls.push({ name: "prompt", input })
      diffs = [{ file: "docs/feature/example.md", after: "updated" }]
    },
    prompt: async (input: any) => calls.push({ name: "notice", input }),
    update: async (input: any) => {
      calls.push({ name: "update", input })
      if (input.path.id === "source" && input.body.metadata) sourceMetadata = input.body.metadata
      return { data: {} }
    },
  },
}

const hooks = await plugin({ client } as any, {
  initialTokens: 100,
  intervalTokens: 50,
  model: "custom/docs-model",
  skill: "test-docs",
})
assert.equal(calls.filter((call) => call.name === "skills").length, 0)
const config: any = {}
await hooks.config?.(config)
assert.equal(config.command["update-docs"].description, "Update project documentation from this session")
assert.equal(config.command["docs-update"], undefined)

await hooks.event?.({
  event: { type: "session.status", properties: { sessionID: "source", status: { type: "idle" } } } as any,
})
assert.equal(calls.filter((call) => call.name === "fork").length, 1)
assert.deepEqual(calls.find((call) => call.name === "fork")?.input.body, {})
assert.equal(calls.filter((call) => call.name === "prompt").length, 1)
assert.equal(calls.filter((call) => call.name === "skills").length, 1)
assert.match(calls.find((call) => call.name === "prompt")?.input.body.parts[0].text, /^# Test documentation skill/)
assert.deepEqual(calls.find((call) => call.name === "prompt")?.input.body.model, {
  providerID: "custom",
  modelID: "docs-model",
})
await hooks.tool?.docs_updated.execute(
  { files: ["docs/feature/example.md"] },
  { sessionID: "fork-1", messageID: "docs-finished-1", agent: "build" } as any,
)
assert.equal(
  calls.find((call) => call.name === "update" && call.input.body.title)?.input.body.title,
  "Feature work - docs-update #1",
)

await hooks.event?.({
  event: { type: "session.status", properties: { sessionID: "fork-1", status: { type: "idle" } } } as any,
})
assert.equal(
  calls.find((call) => call.name === "update" && call.input.body.time)?.input.body.time.archived > 0,
  true,
)
assert.equal(
  calls.find((call) => call.name === "update" && call.input.body.time)?.input.body.metadata.docsUpdate.status,
  "completed",
)
assert.match(
  calls.find((call) => call.name === "notice")?.input.body.parts[0].text,
  /docs\/feature\/example\.md/,
)
assert.equal(calls.find((call) => call.name === "notice")?.input.body.noReply, true)

messages = [
  ...messages,
  {
    info: {
      id: "assistant-2",
      role: "assistant",
      providerID: "test",
      modelID: "model",
      time: { completed: 2 },
      tokens: { input: 140, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [{ type: "text" }],
  },
  { info: { id: "compact-1", role: "user" }, parts: [{ type: "compaction" }] },
]
await hooks["experimental.session.compacting"]?.({ sessionID: "source" }, { context: [] })
assert.equal(calls.filter((call) => call.name === "fork").length, 2)
assert.deepEqual(calls.filter((call) => call.name === "fork")[1]?.input.body, { messageID: "compact-1" })

await hooks.tool?.docs_updated.execute(
  { files: [] },
  { sessionID: "fork-2", messageID: "docs-finished-2", agent: "build" } as any,
)
await hooks.event?.({
  event: { type: "session.status", properties: { sessionID: "fork-2", status: { type: "idle" } } } as any,
})
const manual = await hooks.tool?.docs_update.execute(
  {},
  { sessionID: "source", messageID: "assistant-tool", agent: "build" } as any,
)
assert.equal(manual, "Documentation update started in a background fork.")
assert.deepEqual(calls.filter((call) => call.name === "fork")[2]?.input.body, {
  messageID: "assistant-tool",
})

await hooks.tool?.docs_updated.execute(
  { files: [] },
  { sessionID: "fork-3", messageID: "docs-finished-3", agent: "build" } as any,
)
await hooks.event?.({
  event: { type: "session.status", properties: { sessionID: "fork-3", status: { type: "idle" } } } as any,
})
const checkpointResult = await hooks.tool?.docs_updated.execute(
  { files: ["AGENTS.md"] },
  { sessionID: "source", messageID: "docs-finished-source", agent: "build" } as any,
)
assert.equal(checkpointResult, "Documentation checkpoint recorded.")
assert.equal(calls.filter((call) => call.name === "fork").length, 3)
assert.deepEqual((sourceMetadata.docsUpdated as any).files, ["AGENTS.md"])
const commandOutput: any = { parts: [{ type: "text", text: "original" }] }
await hooks["command.execute.before"]?.(
  { command: "update-docs", sessionID: "source", arguments: "Focus on migration behavior." },
  commandOutput,
)
assert.match(commandOutput.parts[0].text, /has started/)
assert.equal(calls.filter((call) => call.name === "fork").length, 4)
assert.match(
  calls.filter((call) => call.name === "prompt").at(-1)?.input.body.parts[0].text,
  /Additional instructions for this documentation update:\nFocus on migration behavior\.$/,
)
await hooks.event?.({
  event: { type: "session.status", properties: { sessionID: "fork-4", status: { type: "idle" } } } as any,
})
assert.equal(
  calls.filter((call) => call.name === "update" && call.input.body.time).at(-1)?.input.body.metadata.docsUpdate.status,
  "failed",
)

await hooks.dispose?.()

sessions = [
  {
    title: "Feature work - docs-update #4",
    metadata: {
      docsUpdate: {
        sourceSessionID: "source",
        startedAt: 900,
        completedAt: 1_000,
        sourceContextTokens: 100,
        sequence: 4,
        status: "completed",
      },
    },
  },
]
messages = [
  {
    info: {
      id: "user-restart",
      role: "user",
      agent: "build",
      model: { providerID: "test", modelID: "model" },
    },
    parts: [{ type: "text" }],
  },
  {
    info: {
      id: "assistant-restart",
      role: "assistant",
      providerID: "test",
      modelID: "model",
      time: { completed: 2_000 },
      tokens: { input: 140, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [{ type: "text" }],
  },
]
const restarted = await plugin({ client } as any, {
  initialTokens: 100,
  intervalTokens: 50,
})
await restarted.event?.({
  event: { type: "session.status", properties: { sessionID: "source", status: { type: "idle" } } } as any,
})
assert.equal(calls.filter((call) => call.name === "fork").length, 4)
messages = [
  ...messages,
  {
    info: {
      id: "assistant-after-checkpoint",
      role: "assistant",
      providerID: "test",
      modelID: "model",
      time: { completed: Date.now() + 1 },
      tokens: { input: 190, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [{ type: "text" }],
  },
]
await restarted.event?.({
  event: { type: "session.status", properties: { sessionID: "source", status: { type: "idle" } } } as any,
})
assert.equal(calls.filter((call) => call.name === "fork").length, 5)
assert.equal(
  calls.filter((call) => call.name === "update" && call.input.body.title).at(-1)?.input.body.title,
  "Feature work - docs-update #5",
)
await restarted.dispose?.()
console.log("plugin checks passed")
