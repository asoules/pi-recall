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
import type { TextContent } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { spawn } from "child_process";
import { createHash } from "crypto";
import { writeFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { tmpdir, homedir } from "os";
import { fileURLToPath } from "url";

import { createEmbedderProxy } from "./embedder-proxy.js";
import type { Embedder } from "./embedder.js";

import { MemoryStore } from "./store.js";
import { extractSignature, detectLanguage, disposeSignatureExtractor } from "./signature.js";
import type { SessionMessage } from "./extractor.js";

// ============================================================================
// Config
// ============================================================================

const RECALL_DIR = join(homedir(), ".pi-recall");
const SIMILARITY_THRESHOLD = 0.3;
const DEDUP_THRESHOLD = 0.9;
const MAX_MEMORIES_PER_READ = 5;
const MAX_MEMORIES_PER_SESSION = 20;

/** Hash a string to create a project-specific database directory name */
function projectHash(identity: string): string {
	return createHash("sha256").update(identity).digest("hex").slice(0, 12);
}

/**
 * Resolve a stable identity for the git repository at `cwd`.
 *
 * Uses `git rev-parse --git-common-dir` which returns the same path
 * for all worktrees of the same repo, making them share one memories.db.
 *
 * Falls back to `cwd` if not inside a git repository.
 */
export function getRepoIdentity(cwd: string): Promise<string> {
	return new Promise((res) => {
		const child = spawn("git", ["rev-parse", "--git-common-dir"], {
			cwd,
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 5000,
		});
		let stdout = "";
		child.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
		child.on("error", () => res(cwd));
		child.on("close", (code) => {
			if (code === 0 && stdout.trim()) {
				const gitCommonDir = stdout.trim();
				// resolve() handles both relative (".git") and absolute paths
				const absPath = resolve(cwd, gitCommonDir);
				res(absPath);
			} else {
				res(cwd);
			}
		});
	});
}

// ============================================================================
// Extension
// ============================================================================

export default function (pi: ExtensionAPI) {
	let store: MemoryStore | null = null;
	let embedder: Embedder | null = null;
	let cwd = "";
	let repoIdentity = "";
	let storeInitialized = false;

	/** Open the store (sqlite only, no native threads) */
	function ensureStore(): boolean {
		if (store) return true;
		if (storeInitialized) return false; // previously failed

		storeInitialized = true;
		try {
			const dbPath = join(RECALL_DIR, projectHash(repoIdentity || cwd), "memories.db");
			store = new MemoryStore({ dbPath });
			return true;
		} catch (e) {
			console.error("[pi-recall] Failed to open store:", e);
			return false;
		}
	}

	/**
	 * Get the shared embedder proxy (child process).
	 * Lazy-created on first use, reused for the session.
	 * Killed on session shutdown.
	 */
	async function getEmbedder(): Promise<Embedder> {
		if (!embedder) {
			embedder = await createEmbedderProxy();
		}
		return embedder;
	}

	// --------------------------------------------------------------------------
	// Session start: capture cwd
	// --------------------------------------------------------------------------

	pi.on("session_start", async (_event, ctx) => {
		cwd = ctx.cwd;
		repoIdentity = await getRepoIdentity(cwd);
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

		if (!ensureStore() || !store) return;

		// Don't bother if store is empty
		if (store.count() === 0) return;

		try {
			// Extract structural signature from file content
			const signature = await extractSignature(filePath, textContent.text);
			if (!signature) return;

			// Embed the signature and search for memories
			const emb = await getEmbedder();
			const queryVec = await emb.embed(signature);
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
			if (!ensureStore() || !store) {
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
				const emb = await getEmbedder();
				const queryVec = await emb.embed(params.query);
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

			const dbPath = join(RECALL_DIR, projectHash(repoIdentity || cwd), "memories.db");
			const sessionId = ctx.sessionManager.getSessionFile() ?? `session-${Date.now()}`;

			// Write payload to a temp file (session transcripts can be large)
			const payloadPath = join(tmpdir(), `pi-recall-${Date.now()}.json`);
			writeFileSync(payloadPath, JSON.stringify({
				sessionMessages,
				model,
				apiKey,
				dbPath,
				sessionId,
				maxMemories: MAX_MEMORIES_PER_SESSION,
				dedupThreshold: DEDUP_THRESHOLD,
			}));

			// Spawn detached extraction worker — pi exits immediately
			const workerPath = join(dirname(fileURLToPath(import.meta.url)), "extraction-worker.ts");
			const child = spawn(process.execPath, ["--import", "tsx", workerPath, payloadPath], {
				detached: true,
				stdio: "ignore",
				cwd: dirname(workerPath),
				env: process.env,
			});
			child.unref();

			console.error("[pi-recall] Memory extraction spawned in background.");
		} catch (e) {
			console.error("[pi-recall] Error spawning memory extraction:", e);
		}
	});

	// --------------------------------------------------------------------------
	// Cleanup: kill the embedder child process and close store
	// --------------------------------------------------------------------------

	pi.on("session_shutdown", async () => {
		disposeSignatureExtractor();
		if (embedder) {
			await embedder.dispose(); // SIGKILL, instant
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
			if (!ensureStore() || !store) {
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

			if (!ensureStore() || !store) {
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

			if (!ensureStore() || !store) {
				ctx.ui.notify("Memory system not initialized", "error");
				return;
			}

			try {
				const emb = await getEmbedder();
				const vec = await emb.embed(args);
				const id = store.add(args, vec, "manual");
				ctx.ui.notify(`Remembered (id: ${id}): ${args}`, "info");
			} catch (e) {
				ctx.ui.notify("Failed to embed memory", "error");
				console.error("[pi-recall] Error in /remember:", e);
			}
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
