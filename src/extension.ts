/**
 * pi-recall extension for the pi coding agent.
 *
 * Hooks into the agent's `read` tool to trigger "deja vu" moments:
 * when the agent reads a file, we extract its structural signature,
 * search for semantically similar memories, and append them to the
 * read result.
 *
 * Also registers a `memory_search` tool for explicit agent-initiated recall,
 * and extracts new memories from sessions on shutdown.
 *
 * Setup:
 *   pi -e path/to/pi-recall/src/extension.ts
 *
 * Or place in ~/.pi/agent/extensions/ for auto-discovery.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import type { TextContent } from "@mariozechner/pi-ai";
import { completeSimple } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { createHash } from "crypto";
import { join } from "path";
import { homedir } from "os";

import { createEmbedder, type Embedder } from "./embedder.js";
import { MemoryStore } from "./store.js";
import { extractSignature, detectLanguage } from "./signature.js";
import { extractMemories, type SessionMessage } from "./extractor.js";

// ============================================================================
// Config
// ============================================================================

const RECALL_DIR = join(homedir(), ".pi-recall");
const SIMILARITY_THRESHOLD = 0.3;
const DEDUP_THRESHOLD = 0.9;
const MAX_MEMORIES_PER_READ = 5;
const MAX_MEMORIES_PER_SESSION = 20;

/** Hash the cwd to create a project-specific database */
function projectHash(cwd: string): string {
	return createHash("sha256").update(cwd).digest("hex").slice(0, 12);
}

// ============================================================================
// Extension
// ============================================================================

export default function (pi: ExtensionAPI) {
	let embedder: Embedder | null = null;
	let store: MemoryStore | null = null;
	let cwd = "";
	let initPromise: Promise<void> | null = null;
	let initFailed = false;

	/** Lazy initialization — loads model and opens DB on first use */
	async function ensureInit(): Promise<boolean> {
		if (initFailed) return false;
		if (embedder && store) return true;

		if (!initPromise) {
			initPromise = (async () => {
				try {
					embedder = await createEmbedder();
					const dbPath = join(RECALL_DIR, projectHash(cwd), "memories.db");
					store = new MemoryStore({ dbPath });
				} catch (e) {
					initFailed = true;
					console.error("[pi-recall] Failed to initialize:", e);
					throw e;
				}
			})();
		}

		try {
			await initPromise;
			return true;
		} catch {
			return false;
		}
	}

	// --------------------------------------------------------------------------
	// Session start: capture cwd
	// --------------------------------------------------------------------------

	pi.on("session_start", async (_event, ctx) => {
		cwd = ctx.cwd;
	});

	// --------------------------------------------------------------------------
	// Deja vu: intercept read results
	// --------------------------------------------------------------------------

	pi.on("tool_result", async (event, _ctx) => {
		if (event.toolName !== "read") return;
		if (event.isError) return;

		// Get the file path from the tool call input
		const input = event.input as { path?: string };
		const filePath = input?.path;
		if (!filePath) return;

		// Only process supported languages
		if (!detectLanguage(filePath)) return;

		// Extract text content from the result
		const textContent = event.content?.find(
			(c): c is TextContent => c.type === "text"
		);
		if (!textContent?.text) return;

		const ready = await ensureInit();
		if (!ready || !embedder || !store) return;

		// Don't bother if store is empty
		if (store.count() === 0) return;

		try {
			// Extract structural signature from file content
			const signature = await extractSignature(filePath, textContent.text);
			if (!signature) return;

			// Embed the signature and search for memories
			const queryVec = await embedder.embed(signature);
			const matches = store.search(queryVec, SIMILARITY_THRESHOLD, MAX_MEMORIES_PER_READ);

			if (matches.length === 0) return;

			// Format memories as a block to append
			const memoryBlock = formatMemoryBlock(matches);

			// Append to the read result
			const newContent = event.content.map((c) => {
				if (c === textContent) {
					return { ...c, text: c.text + memoryBlock };
				}
				return c;
			});

			return { content: newContent };
		} catch (e) {
			// Don't break reads if recall fails
			console.error("[pi-recall] Error during recall:", e);
		}
	});

	// --------------------------------------------------------------------------
	// Explicit recall: memory_search tool
	// --------------------------------------------------------------------------

	pi.registerTool({
		name: "memory_search",
		label: "memory search",
		description:
			"Search long-term memory for relevant context. Use when you encounter something unfamiliar or want to check if there's prior knowledge about a topic. Returns memories semantically similar to your query.",
		parameters: Type.Object({
			query: Type.String({
				description: "What to search for (e.g., 'events table deletion behavior', 'auth token expiry')",
			}),
			limit: Type.Optional(
				Type.Number({ description: "Maximum results to return. Default: 10" }),
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const ready = await ensureInit();
			if (!ready || !embedder || !store) {
				return {
					content: [{ type: "text" as const, text: "Memory system not initialized." }],
					details: {},
				};
			}

			if (store.count() === 0) {
				return {
					content: [{ type: "text" as const, text: "No memories stored yet." }],
					details: {},
				};
			}

			const limit = params.limit ?? 10;

			try {
				const queryVec = await embedder.embed(params.query);
				const matches = store.search(queryVec, SIMILARITY_THRESHOLD, limit);

				if (matches.length === 0) {
					return {
						content: [{ type: "text" as const, text: "No relevant memories found." }],
						details: {},
					};
				}

				const lines = matches.map(
					(m) =>
						`- ${m.memory.text} (similarity: ${m.similarity.toFixed(2)}, from: ${m.memory.sessionId})`,
				);

				return {
					content: [{ type: "text" as const, text: lines.join("\n") }],
					details: { matchCount: matches.length },
				};
			} catch (e: unknown) {
				const msg = e instanceof Error ? e.message : String(e);
				return {
					content: [{ type: "text" as const, text: `Memory search failed: ${msg}` }],
					details: {},
				};
			}
		},
	});

	// --------------------------------------------------------------------------
	// Memory extraction: on session shutdown
	// --------------------------------------------------------------------------

	pi.on("session_shutdown", async (_event, ctx) => {
		const ready = await ensureInit();
		if (!ready || !embedder || !store) return;

		try {
			const sessionMessages = collectSessionMessages(ctx);
			if (sessionMessages.length === 0) return;

			const model = ctx.model;
			if (!model) {
				console.error("[pi-recall] No model available for memory extraction.");
				return;
			}

			const apiKey = await ctx.modelRegistry.getApiKey(model);
			if (!apiKey) {
				console.error("[pi-recall] No API key available for memory extraction.");
				return;
			}

			const extracted = await extractMemories(
				sessionMessages,
				async (systemPrompt, userMessage) => {
					const result = await completeSimple(model, {
						systemPrompt,
						messages: [{
							role: "user" as const,
							content: [{ type: "text" as const, text: userMessage }],
							timestamp: Date.now(),
						}],
					}, { apiKey });

					return result.content
						.filter((c): c is TextContent => c.type === "text")
						.map((c) => c.text)
						.join("");
				},
				{ maxMemories: MAX_MEMORIES_PER_SESSION },
			);

			if (extracted.length === 0) return;

			// Embed each extracted memory and deduplicate against existing store.
			// If a new memory is too similar to an existing one (>0.9 cosine),
			// it's a duplicate and we skip it.
			const sessionId = ctx.sessionManager.getSessionFile() ?? `session-${Date.now()}`;
			let stored = 0;
			let skipped = 0;

			for (const memory of extracted) {
				const vec = await embedder.embed(memory.text);

				// Check for near-duplicates in the store
				if (store.count() > 0) {
					const dupes = store.search(vec, DEDUP_THRESHOLD, 1);
					if (dupes.length > 0) {
						skipped++;
						continue;
					}
				}

				store.add(memory.text, vec, sessionId);
				stored++;
			}

			console.error(
				`[pi-recall] Extracted ${extracted.length} memories: stored ${stored}, skipped ${skipped} duplicates.`,
			);
		} catch (e) {
			console.error("[pi-recall] Error during memory extraction:", e);
		}
	});

	// --------------------------------------------------------------------------
	// Cleanup
	// --------------------------------------------------------------------------

	pi.on("session_shutdown", async () => {
		if (embedder) {
			await embedder.dispose();
			embedder = null;
		}
		if (store) {
			store.close();
			store = null;
		}
	});

	// --------------------------------------------------------------------------
	// Commands
	// --------------------------------------------------------------------------

	pi.registerCommand("memories", {
		description: "List all stored memories",
		handler: async (_args, ctx) => {
			const ready = await ensureInit();
			if (!ready || !store) {
				ctx.ui.notify("Memory system not initialized", "error");
				return;
			}

			const memories = store.list();
			if (memories.length === 0) {
				ctx.ui.notify("No memories stored yet.", "info");
				return;
			}

			const lines = memories.map(
				(m) => `[${m.createdAt.slice(0, 10)}] ${m.text}`,
			);
			ctx.ui.notify(`${memories.length} memories:\n${lines.join("\n")}`, "info");
		},
	});

	pi.registerCommand("forget", {
		description: "Delete a memory by ID",
		handler: async (args, ctx) => {
			const id = parseInt(args, 10);
			if (isNaN(id)) {
				ctx.ui.notify("Usage: /forget <memory-id>", "error");
				return;
			}

			const ready = await ensureInit();
			if (!ready || !store) {
				ctx.ui.notify("Memory system not initialized", "error");
				return;
			}

			store.delete(id);
			ctx.ui.notify(`Deleted memory ${id}`, "info");
		},
	});

	pi.registerCommand("remember", {
		description: "Manually add a memory",
		handler: async (args, ctx) => {
			if (!args.trim()) {
				ctx.ui.notify("Usage: /remember <fact to remember>", "error");
				return;
			}

			const ready = await ensureInit();
			if (!ready || !embedder || !store) {
				ctx.ui.notify("Memory system not initialized", "error");
				return;
			}

			const vec = await embedder.embed(args);
			const id = store.add(args, vec, "manual");
			ctx.ui.notify(`Remembered (id: ${id}): ${args}`, "info");
		},
	});
}

// ============================================================================
// Helpers
// ============================================================================

function formatMemoryBlock(
	matches: Array<{ memory: { text: string; createdAt: string }; similarity: number }>,
): string {
	const lines = matches.map((m) => `- ${m.memory.text}`);
	return `\n\n<memory>\n${lines.join("\n")}\n</memory>`;
}

/**
 * Collect user/assistant text messages from the session,
 * filtering out tool calls and results.
 */
function collectSessionMessages(ctx: ExtensionContext): SessionMessage[] {
	const messages: SessionMessage[] = [];

	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;

		const msg = entry.message;
		if (msg.role === "user" && msg.content) {
			const text = extractText(msg.content);
			if (text) messages.push({ role: "user", text });
		} else if (msg.role === "assistant" && msg.content) {
			const text = extractText(msg.content);
			if (text) messages.push({ role: "assistant", text });
		}
	}

	return messages;
}

function extractText(content: unknown): string | null {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const texts: string[] = [];
		for (const part of content) {
			if (typeof part === "object" && part !== null && "type" in part) {
				const p = part as { type: string; text?: string };
				if (p.type === "text" && p.text) {
					texts.push(p.text);
				}
			}
		}
		return texts.length > 0 ? texts.join("\n") : null;
	}
	return null;
}
