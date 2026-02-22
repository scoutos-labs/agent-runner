import type { AgentManifest, ProcessDeclaration } from "./types"

/**
 * Load an agent manifest from a JSON file or a PERSONA.md file.
 *
 * JSON files are loaded directly. Markdown files are parsed as
 * dot-agents persona files: YAML frontmatter for metadata,
 * markdown body for the system prompt.
 */
export async function load_manifest(path: string): Promise<AgentManifest> {
  const text = await Bun.file(path).text()

  if (path.endsWith(".md")) {
    return parse_persona(text)
  }

  return JSON.parse(text) as AgentManifest
}

/**
 * Parse a PERSONA.md file into an AgentManifest.
 *
 * Frontmatter fields:
 *   name, description  — mapped directly
 *   cmd                — used to infer adapter (if no explicit adapter)
 *   adapter            — explicit adapter override (optional)
 *   options            — adapter options (optional)
 *   processes          — process declarations (optional)
 *
 * Markdown body → system prompt.
 */
export function parse_persona(text: string): AgentManifest {
  const { frontmatter, body } = parse_frontmatter(text)

  const adapter = (frontmatter.adapter as string | undefined)
    ?? infer_adapter_from_cmd(frontmatter.cmd)

  return {
    name: frontmatter.name as string,
    description: frontmatter.description as string | undefined,
    adapter,
    system: body.trim() || undefined,
    processes: (frontmatter.processes as ProcessDeclaration[]) ?? [],
    options: frontmatter.options as Record<string, Record<string, unknown>> | undefined,
  }
}

/**
 * Infer an adapter preset from a dot-agents cmd field.
 * cmd can be a string or an object with headless/interactive variants.
 */
function infer_adapter_from_cmd(cmd: unknown): string | undefined {
  if (!cmd) return undefined

  const cmd_str = typeof cmd === "string"
    ? cmd
    : typeof cmd === "object" && cmd !== null
      ? (cmd as Record<string, string>).headless ?? Object.values(cmd as Record<string, string>)[0]
      : undefined

  if (!cmd_str) return undefined
  if (cmd_str.includes("claude")) return "claude-code"

  return cmd_str
}

interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>
  body: string
}

/** Parse YAML-ish frontmatter from a markdown file. */
export function parse_frontmatter(text: string): ParsedFrontmatter {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) {
    return { frontmatter: {}, body: text }
  }

  const yaml_text = match[1]
  const body = match[2]

  return {
    frontmatter: parse_simple_yaml(yaml_text),
    body,
  }
}

/**
 * Minimal YAML parser for frontmatter. Handles:
 *   key: "value"     → string (quoted)
 *   key: value       → string (unquoted)
 *   key:             → start of nested object (indented block)
 *     sub: value
 */
export function parse_simple_yaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = text.split("\n")
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const match = line.match(/^(\w[\w-]*):\s*(.*)$/)
    if (!match) { i++; continue }

    const key = match[1]
    const value_str = match[2].trim()

    if (value_str) {
      // Inline value — strip quotes if present
      result[key] = strip_quotes(value_str)
    } else {
      // Block value — collect indented lines
      const block_lines: string[] = []
      i++
      while (i < lines.length && lines[i].match(/^\s+/)) {
        block_lines.push(lines[i])
        i++
      }

      if (block_lines.length > 0) {
        result[key] = parse_block(block_lines)
      }
      continue
    }

    i++
  }

  return result
}

function strip_quotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

/** Parse an indented block as a nested key-value object. */
function parse_block(lines: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of lines) {
    const match = line.match(/^\s+([\w-]+):\s*(.+)$/)
    if (match) {
      result[match[1]] = strip_quotes(match[2].trim())
    }
  }
  return result
}
