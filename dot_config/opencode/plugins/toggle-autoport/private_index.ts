import type { Plugin } from "@opencode/plugin"
import { execFileSync } from "node:child_process"
import { join } from "node:path"

const CLI = join(process.env.HOME!, ".local/bin/traefik-autoport")
type Input = { action: "enable" | "disable" | "add" | "remove" | "status"; name?: string; port?: number }

function run(args: string[]): string {
  try {
    // An argv array keeps names literal: never interpolate model input into a shell.
    return execFileSync(CLI, args, { encoding: "utf8", timeout: 5000 }).trim()
  } catch (error: any) {
    return String(error.stderr || error.stdout || error.message || "Command failed")
  }
}

export default {
  id: "toggle-autoport",
  setup(ctx) {
    ctx.tool.transform((editor) => {
      editor.add({
        name: "autoport",
        description: "Manage traefik-autoport dev port exposure. Subcommands: enable | disable | add <name> <port> | remove <name> | status",
        // JSON Schema is an official v2 Tool.ValueSchema; no legacy tool()/zod adapter.
        input: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["enable", "disable", "add", "remove", "status"] },
            name: { type: "string", description: "Name for add/remove (e.g., synapse-api)" },
            port: { type: "integer", minimum: 1025, maximum: 65535, description: "Port number for add" },
          },
          required: ["action"],
          additionalProperties: false,
        },
        async execute(input) {
          const args = input as Input
          if (args.action === "add") {
            if (!args.name || !args.port) return { content: "❌ Usage: autoport add <name> <port>" }
            return { content: run(["add", args.name, String(args.port)]) }
          }
          if (args.action === "remove") {
            if (!args.name) return { content: "❌ Usage: autoport remove <name>" }
            return { content: run(["remove", args.name]) }
          }
          return { content: run([args.action]) }
        },
      })
    })
  },
} satisfies Plugin.Plugin
