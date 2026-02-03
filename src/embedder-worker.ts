/**
 * Child process worker for embedding.
 *
 * onnxruntime-node has background threads that crash when the host
 * process calls process.exit(). By running the embedder in a child
 * process, we isolate the crash — the child can be killed without
 * affecting the parent.
 *
 * Protocol (over stdin/stdout, newline-delimited JSON):
 *   Parent sends: { "type": "embed", "texts": ["..."] }
 *   Worker sends: { "type": "result", "vectors": [[...], ...] }
 *
 *   Parent sends: { "type": "exit" }
 *   Worker exits.
 */

import { createEmbedder } from "./embedder.js";
import { createInterface } from "readline";

async function main() {
	const embedder = await createEmbedder();

	// Signal ready
	process.stdout.write(JSON.stringify({ type: "ready" }) + "\n");

	const rl = createInterface({ input: process.stdin });

	for await (const line of rl) {
		try {
			const msg = JSON.parse(line);

			if (msg.type === "exit") {
				await embedder.dispose();
				// Don't call process.exit — let the event loop drain naturally
				rl.close();
				return;
			}

			if (msg.type === "embed") {
				const texts: string[] = msg.texts;
				const vectors = await embedder.embedBatch(texts);
				process.stdout.write(JSON.stringify({ type: "result", vectors }) + "\n");
			}
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);
			process.stdout.write(JSON.stringify({ type: "error", message }) + "\n");
		}
	}
}

main().catch((e) => {
	process.stderr.write(`[pi-recall worker] Fatal: ${e}\n`);
	process.exit(1);
});
