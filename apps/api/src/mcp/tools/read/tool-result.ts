/**
 * MCP Tool Result Helpers
 *
 * Shared shaping for tool results (#1487). Every tool returns JSON text —
 * the calling model parses it — so the serialization lives in one place
 * rather than being re-spelled per tool.
 *
 * @module apps/api/src/mcp/tools/read
 */
import type { CallToolResult } from '@modelcontextprotocol/server';

/** Successful result carrying a JSON payload. */
export function jsonResult(payload: unknown): CallToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

/**
 * Failure result. The text is AGENT-FACING COPY: the calling model reads it
 * and decides what to do next, so it should say what went wrong and, where
 * useful, which tool to call instead.
 */
export function toolFailure(message: string): CallToolResult {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}
