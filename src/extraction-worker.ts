/**
 * Detached child process for session memory extraction.
 *
 * Runs after pi exits: extracts memories via LLM, embeds them,
 * deduplicates against existing store, and saves.
 *
 * Invoked with a single argument: path to a JSON payload file
 * containing session messages, model config, API key, and store path.
 *
 * The payload file is deleted after processing.
 */

import { readFileSync, unlinkSync } from "fs";
import { completeSimple } from "@mariozechner/pi-ai";
import type { TextContent, Model, Api } from "@mariozechner/pi-ai";
import { extractMemories, type SessionMessage } from "./extractor.js";
import { createEmbedder } from "./embedder.js";
import { MemoryStore } from "./store.js";

interface Payload {
	sessionMessages: SessionMessage[];
	model: Model<Api>;
	apiKey: string;
	dbPath: string;
	sessionId: string;
	maxMemories: number;
	dedupThreshold: number;
}

async function main() {
	const payloadPath = process.argv[2];
	if (!payloadPath) {
		process.stderr.write("[pi-recall extraction] No payload path provided\n");
		process.exit(1);
	}

	let payload: Payload;
	try {
		payload = JSON.parse(readFileSync(payloadPath, "utf-8"));
	} finally {
		// Clean up the temp file regardless
		try { unlinkSync(payloadPath); } catch {}
	}

	const { sessionMessages, model, apiKey, dbPath, sessionId, maxMemories, dedupThreshold } = payload;

	// Extract memories via LLM
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
		{ maxMemories },
	);

	if (extracted.length === 0) {
		process.stderr.write("[pi-recall extraction] No memories extracted.\n");
		return;
	}

	// Embed and store, deduplicating
	const embedder = await createEmbedder();
	const store = new MemoryStore({ dbPath });

	let stored = 0;
	let skipped = 0;

	for (const memory of extracted) {
		const vec = await embedder.embed(memory.text);

		if (store.count() > 0) {
			const dupes = store.search(vec, dedupThreshold, 1);
			if (dupes.length > 0) {
				skipped++;
				continue;
			}
		}

		store.add(memory.text, vec, sessionId);
		stored++;
	}

	process.stderr.write(
		`[pi-recall extraction] Extracted ${extracted.length} memories: stored ${stored}, skipped ${skipped} duplicates.\n`,
	);

	store.close();
	await embedder.dispose();
}

main().catch((e) => {
	process.stderr.write(`[pi-recall extraction] Fatal: ${e}\n`);
	process.exit(1);
});
