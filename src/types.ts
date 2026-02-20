// --- Roles ---

/** The five base role types from the spec */
export type RoleType = "system" | "user" | "agent" | "process_call" | "process_result"

/** Parsed role: {type} or {type}:{identity} */
export interface ParsedRole {
  type: RoleType
  identity?: string
}

/** Parse a role string into type + identity. Split on first colon. */
export function parse_role(role: string): ParsedRole {
  const colon = role.indexOf(":")
  if (colon === -1) {
    return { type: role as RoleType }
  }
  return {
    type: role.slice(0, colon) as RoleType,
    identity: role.slice(colon + 1),
  }
}

/** Format a ParsedRole back to a role string */
export function format_role(parsed: ParsedRole): string {
  return parsed.identity ? `${parsed.type}:${parsed.identity}` : parsed.type
}

// --- Messages ---

/** A message in the stream (input or output) */
export interface Message {
  id?: string
  role: string
  content: string | Record<string, unknown> | Message[]
  done?: boolean
  delta?: string
  call_id?: string
  exit_code?: number
}

// --- Manifest ---

/** A process declaration in the agent manifest */
export interface ProcessDeclaration {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

/** Agent manifest loaded from JSON file */
export interface AgentManifest {
  name: string
  description?: string
  system?: string
  model?: string
  processes: ProcessDeclaration[]
}
