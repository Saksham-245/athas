import { invoke } from "@tauri-apps/api/core";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import {
  createDirectory,
  readDirectory,
  readFile,
  writeFile,
} from "@/features/file-system/controllers/platform";
import {
  fffSearchFiles,
  searchFilesContent,
} from "@/features/global-search/lib/rust-api/search";
import { getRelativePath, joinPath, normalizePath } from "@/utils/path-helpers";
import type { AgentHttpTool, AgentHttpToolResult } from "./tool-types";

const MAX_READ_CHARS = 120_000;
const MAX_LIST_ENTRIES = 200;
const MAX_SEARCH_RESULTS = 40;
const MAX_CONTENT_MATCHES = 80;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function resolveToolPath(pathValue: unknown, projectRoot?: string | null): string | null {
  const raw = asString(pathValue);
  if (!raw) return null;

  if (raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("remote://")) {
    return normalizePath(raw);
  }

  if (!projectRoot) return normalizePath(raw);
  return normalizePath(joinPath(projectRoot, raw));
}

function truncateText(text: string, maxChars = MAX_READ_CHARS): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} characters]`,
    truncated: true,
  };
}

function failure(error: string): AgentHttpToolResult {
  return { ok: false, output: null, error };
}

function success(output: unknown, locations?: AgentHttpToolResult["locations"]): AgentHttpToolResult {
  return { ok: true, output, locations };
}

async function readFilePreferred(path: string): Promise<string> {
  try {
    return await invoke<string>("read_file_custom", { path });
  } catch {
    return readFile(path);
  }
}

export const builtinAgentHttpTools: AgentHttpTool[] = [
  {
    name: "read_file",
    description:
      "Read a text file from the workspace (or an absolute path). Prefer relative paths from the project root.",
    kind: "read",
    permission: "none",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to the project root, or an absolute path",
        },
        offset: {
          type: "integer",
          description: "Optional 1-based starting line number",
        },
        limit: {
          type: "integer",
          description: "Optional maximum number of lines to return",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    execute: async (args, context) => {
      const path = resolveToolPath(args.path, context.projectRoot);
      if (!path) return failure("path is required");

      try {
        const content = await readFilePreferred(path);
        const lines = content.split(/\r?\n/);
        const offset = asPositiveInt(args.offset, 1);
        const limit = args.limit == null ? lines.length : asPositiveInt(args.limit, lines.length);
        const startIndex = Math.max(0, offset - 1);
        const sliced = lines.slice(startIndex, startIndex + limit).join("\n");
        const truncated = truncateText(sliced);

        return success(
          {
            path,
            relative_path: getRelativePath(path, context.projectRoot),
            start_line: offset,
            end_line: Math.min(lines.length, startIndex + limit),
            total_lines: lines.length,
            truncated: truncated.truncated,
            content: truncated.text,
          },
          [{ path, line: offset }],
        );
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  },
  {
    name: "list_dir",
    description: "List files and directories at a path. Defaults to the project root.",
    kind: "read",
    permission: "none",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory path relative to the project root, or an absolute path",
        },
        max_entries: {
          type: "integer",
          description: `Maximum entries to return (default ${MAX_LIST_ENTRIES})`,
        },
      },
      additionalProperties: false,
    },
    execute: async (args, context) => {
      const path =
        resolveToolPath(args.path, context.projectRoot) ||
        (context.projectRoot ? normalizePath(context.projectRoot) : null);
      if (!path) return failure("No directory path provided and no project root is open");

      try {
        const maxEntries = Math.min(
          asPositiveInt(args.max_entries, MAX_LIST_ENTRIES),
          MAX_LIST_ENTRIES,
        );
        const entries = await readDirectory(path);
        const mapped = entries.slice(0, maxEntries).map((entry) => ({
          name: entry.name,
          path: entry.path,
          is_dir: Boolean(entry.is_dir),
          relative_path: getRelativePath(entry.path, context.projectRoot),
        }));

        return success(
          {
            path,
            relative_path: getRelativePath(path, context.projectRoot),
            truncated: entries.length > mapped.length,
            total_entries: entries.length,
            entries: mapped,
          },
          [{ path }],
        );
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  },
  {
    name: "search_files",
    description:
      "Search the project for files by name/path fuzzy query, and optionally for text content matches.",
    kind: "search",
    permission: "none",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query for file names/paths or content",
        },
        mode: {
          type: "string",
          enum: ["files", "content", "both"],
          description: "Search mode. Defaults to both when a project root is available.",
        },
        max_results: {
          type: "integer",
          description: `Maximum results to return (default ${MAX_SEARCH_RESULTS})`,
        },
        case_sensitive: {
          type: "boolean",
          description: "Case-sensitive content search (content mode only)",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    execute: async (args, context) => {
      const query = asString(args.query);
      if (!query) return failure("query is required");
      if (!context.projectRoot) {
        return failure("Open a project folder before searching files");
      }

      const mode = asString(args.mode) || "both";
      const maxResults = Math.min(
        asPositiveInt(args.max_results, MAX_SEARCH_RESULTS),
        MAX_SEARCH_RESULTS,
      );

      try {
        const includeFiles = mode === "files" || mode === "both";
        const includeContent = mode === "content" || mode === "both";

        const files = includeFiles
          ? await fffSearchFiles(query, maxResults, context.projectRoot)
          : [];

        const content = includeContent
          ? await searchFilesContent({
              root_path: context.projectRoot,
              query,
              case_sensitive: args.case_sensitive === true,
              max_results: Math.min(maxResults, MAX_CONTENT_MATCHES),
              context_lines: 1,
            })
          : null;

        return success({
          query,
          mode,
          files: files.map((hit) => ({
            path: hit.path,
            name: hit.name,
            relative_path: hit.relative_path,
            score: hit.score,
          })),
          content: content
            ? {
                total_files: content.total_files,
                files_with_matches: content.files_with_matches,
                has_more: content.has_more,
                results: content.results.slice(0, maxResults).map((result) => ({
                  file_path: result.file_path,
                  relative_path: getRelativePath(result.file_path, context.projectRoot),
                  total_matches: result.total_matches,
                  matches: result.matches.slice(0, 8).map((match) => ({
                    line_number: match.line_number,
                    line_content: match.line_content,
                    column_start: match.column_start,
                    column_end: match.column_end,
                  })),
                })),
              }
            : null,
        });
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  },
  {
    name: "get_open_buffers",
    description:
      "List currently open editor buffers/tabs in Athas, including dirty state and optional content previews.",
    kind: "read",
    permission: "none",
    parameters: {
      type: "object",
      properties: {
        include_content: {
          type: "boolean",
          description: "Include truncated buffer content previews (default false)",
        },
        max_content_chars: {
          type: "integer",
          description: "Max characters per buffer when include_content is true",
        },
      },
      additionalProperties: false,
    },
    execute: async (args, context) => {
      const includeContent = args.include_content === true;
      const maxContentChars = Math.min(asPositiveInt(args.max_content_chars, 4000), 20_000);
      const { buffers, activeBufferId } = useBufferStore.getState();

      const openBuffers = buffers
        .filter((buffer) => buffer.type === "editor" || buffer.type === "markdownPreview")
        .map((buffer) => {
          const base = {
            id: buffer.id,
            name: buffer.name,
            path: buffer.path,
            relative_path: getRelativePath(buffer.path, context.projectRoot),
            type: buffer.type,
            is_active: buffer.id === activeBufferId,
            is_dirty: "isDirty" in buffer ? Boolean(buffer.isDirty) : false,
            language: "language" in buffer ? buffer.language : undefined,
          };

          if (!includeContent || !("content" in buffer) || typeof buffer.content !== "string") {
            return base;
          }

          const truncated = truncateText(buffer.content, maxContentChars);
          return {
            ...base,
            content_truncated: truncated.truncated,
            content: truncated.text,
          };
        });

      return success({
        active_buffer_id: activeBufferId,
        buffers: openBuffers,
      });
    },
  },
  {
    name: "apply_file_edit",
    description:
      "Create or overwrite a text file in the workspace. Requires explicit permission in Agent mode.",
    kind: "edit",
    permission: "write",
    modes: ["agent"],
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to the project root, or an absolute path",
        },
        content: {
          type: "string",
          description: "Full file contents to write",
        },
        create_directories: {
          type: "boolean",
          description: "Create parent directories if missing (best-effort)",
        },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    execute: async (args, context) => {
      const path = resolveToolPath(args.path, context.projectRoot);
      if (!path) return failure("path is required");
      if (typeof args.content !== "string") return failure("content must be a string");

      try {
        if (args.create_directories === true) {
          const parent = path.replace(/[/\\][^/\\]+$/, "");
          if (parent && parent !== path) {
            try {
              await createDirectory(parent);
            } catch {
              // Best-effort; writeFile may still succeed if parent exists.
            }
          }
        }

        await writeFile(path, args.content);
        return success(
          {
            path,
            relative_path: getRelativePath(path, context.projectRoot),
            bytes_written: args.content.length,
            wrote: true,
          },
          [{ path }],
        );
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  },
];

export function createBuiltinAgentHttpTools(): AgentHttpTool[] {
  return [...builtinAgentHttpTools];
}