import { tool, type Plugin } from "@opencode-ai/plugin"
import { z } from "zod"
import { execSync } from "node:child_process"

const CLI = `${process.env.HOME}/.local/bin/traefik-autoport`

function run(args: string): string {
  try {
    return execSync(`${CLI} ${args}`, { encoding: "utf-8", timeout: 5000 }).trim()
  } catch (e: any) {
    return e.stderr || e.stdout || e.message || "Command failed"
  }
}

export const AutoportPlugin: Plugin = async () => {
  return {
    tool: {
      autoport: tool({
        description:
          "Manage traefik-autoport dev port exposure. " +
          "Subcommands: enable | disable | add <name> <port> | remove <name> | status",
        args: {
          action: z
            .enum(["enable", "disable", "add", "remove", "status"])
            .describe("enable | disable | add | remove | status"),
          name: z.string().optional().describe("Name for add/remove (e.g., 'synapse-api')"),
          port: z.number().int().min(1025).max(65535).optional().describe("Port number for add"),
        },
        async execute(args) {
          switch (args.action) {
            case "enable":
              return run("enable")
            case "disable":
              return run("disable")
            case "add":
              if (!args.name || !args.port) {
                return "❌ Usage: autoport add <name> <port>"
              }
              return run(`add ${args.name} ${args.port}`)
            case "remove":
              if (!args.name) {
                return "❌ Usage: autoport remove <name>"
              }
              return run(`remove ${args.name}`)
            case "status":
              return run("status")
          }
        },
      }),
    },
  }
}
