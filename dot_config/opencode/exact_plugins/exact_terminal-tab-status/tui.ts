import type { Plugin } from "@opencode/plugin/tui"

/** Runs in the attached TUI, not the headless server. Uses its renderer's title
 * and focus API rather than /dev/tty or a platform-specific Accessibility helper.
 * Disable the built-in title writer with tui.json: terminal.title = false.
 */
export default {
  id: "terminal-tab-status",
  setup(ctx) {
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    let sessionID: string | undefined
    let state: "idle" | "running" | "done" = "idle"
    let focused: boolean | undefined
    let frame = 0
    let lastTitle: string | undefined
    let disposed = false

    const update = () => {
      if (disposed || ctx.renderer.isDestroyed) return
      const route = ctx.ui.router.current()
      const next = route.type === "session" ? route.sessionID : undefined
      if (next !== sessionID) {
        sessionID = next
        state = "idle"
        frame = 0
      }
      const status = next ? ctx.data.session.status(next) : "idle"
      if (status === "running") state = "running"
      else if (state === "running") state = focused === true ? "idle" : "done"
      const title = (next ? ctx.data.session.get(next)?.title || "OpenCode" : "OpenCode")
        .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
      const prefix = state === "running" ? `${frames[frame++ % frames.length]} ` : state === "done" ? "✓ " : ""
      const value = prefix + title
      if (value !== lastTitle) {
        ctx.renderer.setTerminalTitle(value)
        lastTitle = value
      }
    }
    const onFocus = () => {
      focused = true
      if (state === "done") state = "idle"
      update()
    }
    const onBlur = () => { focused = false }
    ctx.renderer.on("focus", onFocus)
    ctx.renderer.on("blur", onBlur)
    const onFailure = (event: { data: { sessionID: string } }) => {
      if (event.data.sessionID !== sessionID) return
      state = "idle"
      update()
    }
    const unsubscribe = [
      ctx.data.on("session.execution.failed", onFailure),
      ctx.data.on("session.execution.interrupted", onFailure),
    ]
    update()
    // The public router has a getter, not a subscription. Sampling also animates
    // the spinner and picks up selected-session renames without cross-session races.
    const interval = setInterval(update, 100)
    interval.unref?.()
    return () => {
      disposed = true
      clearInterval(interval)
      for (const off of unsubscribe) off()
      ctx.renderer.off("focus", onFocus)
      ctx.renderer.off("blur", onBlur)
      if (!ctx.renderer.isDestroyed) ctx.renderer.setTerminalTitle("")
    }
  },
} satisfies Plugin.Definition
