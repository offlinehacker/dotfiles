import { tool, type Plugin } from "@opencode-ai/plugin"

type DocsUpdateOptions = {
  initialTokens?: number
  intervalTokens?: number
  model?: string
  skill?: string
  prompt?: string
  replacePrompt?: boolean
}

type SessionMessage = {
  info: {
    id: string
    role: "user" | "assistant"
    agent?: string
    model?: { providerID: string; modelID: string }
    providerID?: string
    modelID?: string
    summary?: boolean
    error?: unknown
    time?: { created?: number; completed?: number }
    tokens?: {
      input: number
      output: number
      reasoning: number
      cache: { read: number; write: number }
    }
  }
  parts: Array<{ type: string }>
}

type Meter = {
  lastContext?: number
  growth: number
  hasRun: boolean
  hydrated: boolean
  checking: boolean
  forkID?: string
}

type DocsUpdateRun = {
  sourceSessionID: string
  startedAt: number
  completedAt?: number
  sourceContextTokens: number
  sequence: number
  status: "running" | "completed" | "failed"
  files?: string[]
}

type DocsUpdatedCheckpoint = {
  completedAt: number
  sourceContextTokens: number
  files: string[]
}

type OwnedFork = {
  sourceID: string
  finishing: boolean
  baseline?: Map<string, string>
  reportedFiles?: string[]
  previousMeter: Pick<Meter, "hasRun" | "growth" | "lastContext">
  execution: {
    agent?: string
    model?: { providerID: string; modelID: string }
  }
  metadata: Record<string, unknown>
  run: DocsUpdateRun
}

type PendingNotice = OwnedFork["execution"] & { text: string }

type StartResult = "started" | "busy" | "ineligible" | "ignored"

const METADATA_KEY = "docsUpdate"
const CHECKPOINT_KEY = "docsUpdated"

function positiveNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

function parseModel(value: unknown) {
  if (typeof value !== "string") return
  const separator = value.indexOf("/")
  if (separator <= 0 || separator === value.length - 1) return
  return { providerID: value.slice(0, separator), modelID: value.slice(separator + 1) }
}

function normalizeFiles(files: string[]) {
  const normalized = files.map((file) => file.trim())
  if (normalized.some((file) => !file || /[\r\n]/.test(file))) {
    throw new Error("Documentation file names must be non-empty single-line paths")
  }
  return [...new Set(normalized)].sort()
}

function responseData<T>(response: T | { data?: T; error?: unknown }): T {
  if (response && typeof response === "object" && "error" in response && response.error) {
    throw response.error
  }
  if (response && typeof response === "object" && "data" in response && response.data !== undefined) {
    return response.data
  }
  return response as T
}

async function loadSkill(client: unknown, directory: string, skillName: string) {
  const transport = (client as {
    _client?: {
      get(input: { url: string; query: { directory: string } }): Promise<unknown>
    }
  })._client
  if (!transport) throw new Error("OpenCode skill endpoint is unavailable")

  let timer: ReturnType<typeof setTimeout> | undefined
  const skills = responseData(
    await Promise.race([
      transport.get({ url: "/skill", query: { directory } }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Skill endpoint timed out")), 2_000)
      }),
    ]).finally(() => clearTimeout(timer)),
  ) as Array<{ name: string; content: string }>
  const resolved = skills.find((skill) => skill.name === skillName)
  if (!resolved) throw new Error(`OpenCode skill "${skillName}" is unavailable`)
  return resolved.content
}

export const DocsUpdatePlugin: Plugin = async ({ client, directory }, rawOptions) => {
  const options = (rawOptions ?? {}) as DocsUpdateOptions
  const initialTokens = positiveNumber(options.initialTokens, 100_000)
  const intervalTokens = positiveNumber(options.intervalTokens, 50_000)
  const configuredModel = parseModel(options.model)
  const skillName = options.skill?.trim() || "docs-update"
  const buildPrompt = async () => {
    const skillPrompt = await loadSkill(client, directory, skillName)
    return options.replacePrompt
      ? options.prompt?.trim() || skillPrompt
      : [skillPrompt, options.prompt?.trim()].filter(Boolean).join("\n\nProject-specific instructions:\n")
  }

  const meters = new Map<string, Meter>()
  const ownedForks = new Map<string, OwnedFork>()
  const maintenanceSessions = new Set<string>()
  const pendingNotices = new Map<string, PendingNotice>()
  const runCounts = new Map<string, number>()
  let disposed = false

  const log = async (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    extra?: Record<string, unknown>,
  ) => {
    try {
      await client.app.log({
        body: { service: "docs-update", level, message, extra },
      })
    } catch {
      // Logging must never break the source session.
    }
  }

  const toast = async (variant: "info" | "success" | "warning" | "error", message: string) => {
    try {
      await client.tui.showToast({
        body: {
          title: "Documentation update",
          message,
          variant,
          duration: variant === "error" ? 8_000 : 5_000,
        },
      })
    } catch {
      // Headless clients may not expose a TUI.
    }
  }

  const getMeter = (sessionID: string) => {
    let meter = meters.get(sessionID)
    if (!meter) {
      meter = { growth: 0, hasRun: false, hydrated: false, checking: false }
      meters.set(sessionID, meter)
    }
    return meter
  }

  const getMessages = async (sessionID: string) => {
    const response = await client.session.messages({ path: { id: sessionID } })
    return responseData(response) as SessionMessage[]
  }

  const getDiff = async (sessionID: string) => {
    const response = await client.session.diff({ path: { id: sessionID } })
    return responseData(response) as Array<{ file: string; after: string }>
  }

  const messageContext = (message?: SessionMessage) => {
    if (!message?.info.tokens) return 0
    const tokens = message.info.tokens
    return tokens.input + tokens.cache.read + tokens.cache.write + tokens.output + tokens.reasoning
  }

  const currentContext = (messages: SessionMessage[]) =>
    messageContext(
      messages.findLast(
        (message) =>
          message.info.role === "assistant" &&
          !message.info.summary &&
          !message.info.error &&
          message.info.time?.completed !== undefined &&
          message.info.tokens,
      ),
    )

  const observe = (meter: Meter, context: number) => {
    if (meter.lastContext !== undefined && context > meter.lastContext) {
      meter.growth += context - meter.lastContext
    }
    meter.lastContext = context
    return meter.hasRun ? meter.growth >= intervalTokens : context >= initialTokens
  }

  const latestExecution = (messages: SessionMessage[]) => {
    const user = messages.findLast((message) => message.info.role === "user")
    const assistant = messages.findLast((message) => message.info.role === "assistant")
    return {
      agent: user?.info.agent,
      model:
        configuredModel ??
        user?.info.model ??
        (assistant?.info.providerID && assistant.info.modelID
          ? { providerID: assistant.info.providerID, modelID: assistant.info.modelID }
          : undefined),
    }
  }

  const archive = async (sessionID: string, owned: OwnedFork, failed: boolean, files: string[]) => {
    const run: DocsUpdateRun = {
      ...owned.run,
      completedAt: Date.now(),
      status: failed ? "failed" : "completed",
      ...(!failed ? { files } : {}),
    }
    responseData(
      await client.session.update({
        path: { id: sessionID },
        // The current server accepts this v2 field, but the plugin's v1 client type
        // still narrows the update body to title-only.
        body: {
          metadata: { ...owned.metadata, [METADATA_KEY]: run },
          time: { archived: run.completedAt },
        } as { title?: string },
      }),
    )
  }

  const prepareFork = async (input: {
    sourceID: string
    sourceTitle: string
    sourceMetadata?: Record<string, unknown>
    sourceContextTokens: number
    forkID: string
  }) => {
    const { sourceID, sourceTitle, sourceMetadata, sourceContextTokens, forkID } = input
    const prefix = `${sourceTitle} - docs-update #`
    let count = runCounts.get(sourceID) ?? 0
    try {
      const sessions = responseData(await client.session.list()) as Array<{
        title: string
        metadata?: Record<string, unknown>
      }>
      for (const session of sessions) {
        const run = session.metadata?.[METADATA_KEY] as DocsUpdateRun | undefined
        if (run?.sourceSessionID === sourceID && Number.isInteger(run.sequence) && run.sequence > count) {
          count = run.sequence
        }
        if (!session.title.startsWith(prefix)) continue
        const value = Number(session.title.slice(prefix.length))
        if (Number.isInteger(value) && value > count) count = value
      }
    } catch (error) {
      await log("warn", "Failed to inspect existing documentation session names", {
        sourceID,
        error: String(error),
      })
    }

    count++
    runCounts.set(sourceID, count)
    const run: DocsUpdateRun = {
      sourceSessionID: sourceID,
      startedAt: Date.now(),
      sourceContextTokens,
      sequence: count,
      status: "running",
    }
    const metadata = { ...sourceMetadata, [METADATA_KEY]: run }
    responseData(
      await client.session.update({
        path: { id: forkID },
        body: { title: `${prefix}${count}`, metadata } as { title?: string },
      }),
    )
    return { metadata, run }
  }

  const hydrateMeter = async (
    sessionID: string,
    sessionTitle: string,
    sourceMetadata: Record<string, unknown> | undefined,
    messages: SessionMessage[],
    meter: Meter,
  ) => {
    if (meter.hydrated) return

    try {
      const sessions = responseData(await client.session.list()) as Array<{
        title: string
        metadata?: Record<string, unknown>
        time?: { created?: number; updated?: number; archived?: number }
      }>
      const completed = sessions
        .map((session) => session.metadata?.[METADATA_KEY] as DocsUpdateRun | undefined)
        .filter(
          (run): run is DocsUpdateRun =>
            run?.sourceSessionID === sessionID &&
            run.status === "completed" &&
            typeof run.completedAt === "number",
        )
        .sort((a, b) => b.completedAt! - a.completedAt!)
      const latest = completed[0]
      const checkpoint = sourceMetadata?.[CHECKPOINT_KEY] as DocsUpdatedCheckpoint | undefined
      const useCheckpoint =
        typeof checkpoint?.completedAt === "number" &&
        typeof checkpoint.sourceContextTokens === "number" &&
        (!latest?.completedAt || checkpoint.completedAt >= latest.completedAt)

      if (latest || useCheckpoint) {
        const watermark = useCheckpoint ? checkpoint.sourceContextTokens : latest!.sourceContextTokens
        const countAfter = useCheckpoint ? checkpoint.completedAt : latest!.startedAt
        let previous = watermark
        let growth = 0
        for (const message of messages) {
          if (
            message.info.role !== "assistant" ||
            message.info.summary ||
            message.info.error ||
            !message.info.tokens
          )
            continue
          const completedAt = message.info.time?.completed
          // The fork only contains source context captured at start. Count source
          // activity that happened while documentation maintenance was running.
          if (completedAt === undefined || completedAt <= countAfter) continue
          const context = messageContext(message)
          if (context > previous) growth += context - previous
          previous = context
        }
        meter.hasRun = true
        meter.growth = growth
        meter.lastContext = previous
        if (latest) runCounts.set(sessionID, Math.max(runCounts.get(sessionID) ?? 0, latest.sequence))
      } else {
        const prefix = `${sessionTitle} - docs-update #`
        const previousRuns = sessions.filter((session) => session.title.startsWith(prefix))
        if (previousRuns.length) {
          meter.hasRun = true
          meter.growth = 0
          meter.lastContext = currentContext(messages)
          for (const session of previousRuns) {
            const sequence = Number(session.title.slice(prefix.length))
            if (Number.isInteger(sequence)) {
              runCounts.set(sessionID, Math.max(runCounts.get(sessionID) ?? 0, sequence))
            }
          }
        }
      }
      meter.hydrated = true
    } catch (error) {
      await log("warn", "Failed to reconstruct documentation update history", {
        sessionID,
        error: String(error),
      })
    }
  }

  const injectNotice = async (sessionID: string, notice: PendingNotice) => {
    await client.session.prompt({
      path: { id: sessionID },
      body: {
        noReply: true,
        ...(notice.agent ? { agent: notice.agent } : {}),
        ...(notice.model ? { model: notice.model } : {}),
        parts: [{ type: "text", text: notice.text, synthetic: true }],
      },
    })
  }

  const notifySource = async (sessionID: string, notice: PendingNotice) => {
    try {
      const response = await client.session.status()
      const statuses = responseData(response) as Record<string, { type: string }>
      if (statuses[sessionID]?.type === "busy" || statuses[sessionID]?.type === "retry") {
        pendingNotices.set(sessionID, notice)
        return
      }
      await injectNotice(sessionID, notice)
    } catch (error) {
      pendingNotices.set(sessionID, notice)
      await log("warn", "Queued source-session notice after injection failed", {
        sessionID,
        error: String(error),
      })
    }
  }

  const completeCheckpoint = async (sessionID: string, files: string[]) => {
    const session = responseData(await client.session.get({ path: { id: sessionID } })) as {
      metadata?: Record<string, unknown>
    }
    const context = currentContext(await getMessages(sessionID))
    const checkpoint: DocsUpdatedCheckpoint = {
      completedAt: Date.now(),
      sourceContextTokens: context,
      files,
    }
    responseData(
      await client.session.update({
        path: { id: sessionID },
        body: { metadata: { ...session.metadata, [CHECKPOINT_KEY]: checkpoint } } as { title?: string },
      }),
    )
    const meter = getMeter(sessionID)
    meter.hasRun = true
    meter.growth = 0
    meter.lastContext = context
    meter.hydrated = true
    await log("info", "Recorded source documentation checkpoint", { sessionID, context, files })
  }

  const changedFiles = async (forkID: string, baseline?: Map<string, string>) => {
    if (!baseline) return
    try {
      const final = await getDiff(forkID)
      return final
        .filter((diff) => baseline.get(diff.file) !== diff.after)
        .map((diff) => diff.file)
        .sort()
    } catch (error) {
      await log("warn", "Failed to read documentation fork diff", {
        forkID,
        error: String(error),
      })
      return
    }
  }

  const finishFork = async (forkID: string, failed: boolean, detail?: string) => {
    const owned = ownedForks.get(forkID)
    if (!owned || owned.finishing) return
    owned.finishing = true

    const actualFiles = await changedFiles(forkID, owned.baseline)
    const files = actualFiles ?? owned.reportedFiles ?? []
    if (actualFiles && owned.reportedFiles) {
      const actual = new Set(actualFiles)
      const reported = new Set(owned.reportedFiles)
      if (actualFiles.some((file) => !reported.has(file)) || owned.reportedFiles.some((file) => !actual.has(file))) {
        await log("warn", "Reported documentation files did not match the session diff", {
          forkID,
          reportedFiles: owned.reportedFiles,
          actualFiles,
        })
      }
    }

    try {
      await archive(forkID, owned, failed, files)
    } catch (error) {
      await log("warn", "Failed to archive documentation fork", {
        forkID,
        error: String(error),
      })
    }

    ownedForks.delete(forkID)
    const meter = meters.get(owned.sourceID)
    if (meter?.forkID === forkID) {
      meter.forkID = undefined
      if (failed) {
        meter.hasRun = owned.previousMeter.hasRun
        meter.growth = owned.previousMeter.growth
        meter.lastContext = owned.previousMeter.lastContext
      }
    }

    const fileList = files.length ? `\n\nChanged documentation files:\n${files.map((file) => `- ${file}`).join("\n")}` : ""
    await notifySource(owned.sourceID, {
      ...owned.execution,
      text: failed
        ? `Background documentation maintenance failed${detail ? `: ${detail}` : "."}${fileList}`
        : `Background documentation maintenance completed.${fileList || " No documentation files were changed."}`,
    })

    if (failed) {
      await toast("error", detail ? `Update failed: ${detail}` : "Documentation update failed")
    } else {
      await toast("success", "Documentation update completed")
    }
  }

  const start = async (input: {
    sessionID: string
    reason: "idle" | "compaction" | "manual"
    force?: boolean
    boundaryMessageID?: string
    messages?: SessionMessage[]
    additionalInstructions?: string
  }): Promise<StartResult> => {
    if (disposed || maintenanceSessions.has(input.sessionID)) return "ignored"

    const meter = getMeter(input.sessionID)
    if (meter.checking || meter.forkID) return "busy"
    meter.checking = true

    let forkID: string | undefined
    try {
      const sessionResponse = await client.session.get({ path: { id: input.sessionID } })
      const session = responseData(sessionResponse) as {
        parentID?: string
        title: string
        metadata?: Record<string, unknown>
      }
      if (session.parentID) return "ignored"

      const messages = input.messages ?? (await getMessages(input.sessionID))
      await hydrateMeter(input.sessionID, session.title, session.metadata, messages, meter)
      const context = currentContext(messages)
      if (!input.force && !observe(meter, context)) return "ineligible"

      const forkResponse = await client.session.fork({
        path: { id: input.sessionID },
        body: input.boundaryMessageID ? { messageID: input.boundaryMessageID } : {},
      })
      const fork = responseData(forkResponse) as { id: string }
      forkID = fork.id
      meter.forkID = forkID
      maintenanceSessions.add(forkID)

      let prepared: { metadata: Record<string, unknown>; run: DocsUpdateRun }
      try {
        prepared = await prepareFork({
          sourceID: input.sessionID,
          sourceTitle: session.title,
          sourceMetadata: session.metadata,
          sourceContextTokens: context,
          forkID,
        })
      } catch (error) {
        await log("warn", "Failed to rename documentation fork", {
          sourceID: input.sessionID,
          forkID,
          error: String(error),
        })
        const sequence = (runCounts.get(input.sessionID) ?? 0) + 1
        runCounts.set(input.sessionID, sequence)
        const run: DocsUpdateRun = {
          sourceSessionID: input.sessionID,
          startedAt: Date.now(),
          sourceContextTokens: context,
          sequence,
          status: "running",
        }
        prepared = {
          metadata: { ...session.metadata, [METADATA_KEY]: run },
          run,
        }
      }

      const execution = latestExecution(messages)
      let baseline: Map<string, string> | undefined
      try {
        baseline = new Map((await getDiff(forkID)).map((diff) => [diff.file, diff.after]))
      } catch (error) {
        await log("warn", "Failed to capture documentation fork baseline", {
          forkID,
          error: String(error),
        })
      }
      ownedForks.set(forkID, {
        sourceID: input.sessionID,
        finishing: false,
        baseline,
        previousMeter: {
          hasRun: meter.hasRun,
          growth: meter.growth,
          lastContext: meter.lastContext,
        },
        execution,
        metadata: prepared.metadata,
        run: prepared.run,
      })
      await toast("info", `Started from ${input.reason} trigger`)
      const prompt = await buildPrompt()
      const runPrompt = input.additionalInstructions?.trim()
        ? `${prompt}\n\nAdditional instructions for this documentation update:\n${input.additionalInstructions.trim()}`
        : prompt
      await client.session.promptAsync({
        path: { id: forkID },
        body: {
          ...(execution.agent ? { agent: execution.agent } : {}),
          ...(execution.model ? { model: execution.model } : {}),
          tools: { docs_update: false, docs_updated: true, task: false },
          parts: [{ type: "text", text: runPrompt }],
        },
      })

      meter.hasRun = true
      meter.growth = 0
      meter.lastContext = context
      await log("info", "Started documentation update", {
        sourceID: input.sessionID,
        forkID,
        reason: input.reason,
        context,
      })
      return "started"
    } catch (error) {
      if (forkID) await finishFork(forkID, true, String(error))
      else {
        meter.forkID = undefined
        await toast("error", `Could not start update: ${String(error)}`)
      }
      await log("error", "Failed to start documentation update", {
        sourceID: input.sessionID,
        reason: input.reason,
        error: String(error),
      })
      return "ignored"
    } finally {
      meter.checking = false
    }
  }

  const considerIdle = async (sessionID: string) => {
    const result = await start({ sessionID, reason: "idle" })
    if (result === "ineligible") {
      await log("debug", "Documentation threshold not reached", { sessionID })
    }
  }

  const considerCompaction = async (sessionID: string) => {
    if (maintenanceSessions.has(sessionID)) return
    const messages = await getMessages(sessionID)
    const pending = messages.findLast(
      (message) => message.info.role === "user" && message.parts.some((part) => part.type === "compaction"),
    )
    await start({
      sessionID,
      reason: "compaction",
      boundaryMessageID: pending?.info.id,
      messages,
    })
  }

  return {
    config: async (config) => {
      config.command ??= {}
      config.command["update-docs"] ??= {
        description: "Update project documentation from this session",
        template: "Start a background documentation update for this session.",
      }
    },

    "command.execute.before": async (input, output) => {
      if (input.command !== "update-docs") return
      const result = await start({
        sessionID: input.sessionID,
        reason: "manual",
        force: true,
        additionalInstructions: input.arguments,
      })
      const text = output.parts.find((part) => part.type === "text")
      if (text?.type !== "text") return
      text.text =
        result === "started"
          ? "The background documentation update has started. Briefly confirm this without calling any tools."
          : result === "busy"
            ? "A background documentation update is already running. Briefly report that without calling any tools."
            : "The background documentation update could not be started. Briefly report that without calling any tools."
    },

    tool: {
      docs_update: tool({
        description:
          "Fork the current session and start a background documentation update. Use only when explicitly requested.",
        args: {
          instructions: tool.schema.string().optional().describe("Additional instructions appended to the update prompt"),
        },
        async execute(args, context) {
          const result = await start({
            sessionID: context.sessionID,
            reason: "manual",
            force: true,
            boundaryMessageID: context.messageID,
            additionalInstructions: args.instructions,
          })
          if (result === "started") return "Documentation update started in a background fork."
          if (result === "busy") return "A documentation update is already running for this session."
          return "The documentation update could not be started."
        },
      }),
      docs_updated: tool({
        description:
          "Record that documentation review is complete. Call once after finishing, listing every documentation file changed; use an empty list when review found no necessary changes.",
        args: {
          files: tool.schema.array(tool.schema.string().min(1)).describe("Repository-relative documentation paths changed"),
        },
        async execute(args, context) {
          const files = normalizeFiles(args.files)
          const owned = ownedForks.get(context.sessionID)
          if (owned) {
            owned.reportedFiles = normalizeFiles([...(owned.reportedFiles ?? []), ...files])
            return "Documentation completion recorded. The update will finalize when this session becomes idle."
          }
          if (maintenanceSessions.has(context.sessionID)) {
            return "This maintenance session is no longer active; documentation completion was not recorded."
          }

          const session = responseData(await client.session.get({ path: { id: context.sessionID } })) as {
            parentID?: string
          }
          if (session.parentID) {
            return "Only a root session or plugin-owned documentation session can record documentation completion."
          }
          await completeCheckpoint(context.sessionID, files)
          await toast("success", "Documentation checkpoint recorded")
          return "Documentation checkpoint recorded."
        },
      }),
    },

    event: async ({ event }) => {
      try {
        if (disposed) return
        if (event.type === "session.status" && event.properties.status.type === "idle") {
          const sessionID = event.properties.sessionID
          const pending = pendingNotices.get(sessionID)
          if (pending) {
            pendingNotices.delete(sessionID)
            try {
              await injectNotice(sessionID, pending)
            } catch (error) {
              pendingNotices.set(sessionID, pending)
              await log("warn", "Failed to inject queued source-session notice", {
                sessionID,
                error: String(error),
              })
            }
          }
          const owned = ownedForks.get(sessionID)
          if (owned) {
            await finishFork(
              sessionID,
              !owned.reportedFiles,
              owned.reportedFiles ? undefined : "The maintenance session did not call docs_updated",
            )
            return
          }
          if (!maintenanceSessions.has(sessionID)) await considerIdle(sessionID)
          return
        }
        if (event.type === "session.error" && event.properties.sessionID) {
          const sessionID = event.properties.sessionID
          if (ownedForks.has(sessionID)) {
            await finishFork(sessionID, true, JSON.stringify(event.properties.error))
          }
        }
      } catch (error) {
        await log("error", "Unhandled documentation event error", { error: String(error) })
      }
    },

    "experimental.session.compacting": async ({ sessionID }) => {
      try {
        await considerCompaction(sessionID)
      } catch (error) {
        await log("error", "Pre-compaction documentation check failed", {
          sessionID,
          error: String(error),
        })
      }
    },

    dispose: async () => {
      disposed = true
      meters.clear()
      ownedForks.clear()
      maintenanceSessions.clear()
      pendingNotices.clear()
      runCounts.clear()
    },
  }
}

export default DocsUpdatePlugin
