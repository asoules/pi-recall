/**
 * Embedder proxy that runs onnxruntime in a child process.
 *
 * onnxruntime-node has background threads that crash with
 * "mutex lock failed" when the host process calls process.exit().
 * By running the embedder in a spawned child, the crash is isolated —
 * we just SIGKILL the child on dispose.
 */

import { spawn, type ChildProcess } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createInterface, type Interface } from "readline";
import type { Embedder } from "./embedder.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(__dirname, "embedder-worker.ts");

interface WorkerMessage {
	type: "ready" | "result" | "error";
	vectors?: number[][];
	message?: string;
}

/**
 * Create an embedder that runs in a child process.
 * The child is spawned once and reused for all embed calls.
 * On dispose, the child is killed immediately (no graceful shutdown
 * needed — onnxruntime can't exit cleanly anyway).
 */
export async function createEmbedderProxy(): Promise<Embedder> {
	let child: ChildProcess | null = null;
	let rl: Interface | null = null;
	let pendingResolve: ((msg: WorkerMessage) => void) | null = null;
	let pendingReject: ((err: Error) => void) | null = null;

	function ensureChild(): Promise<void> {
		if (child) return Promise.resolve();

		return new Promise<void>((resolve, reject) => {
			child = spawn(process.execPath, ["--import", "tsx", WORKER_PATH], {
				stdio: ["pipe", "pipe", "ignore"],
				cwd: dirname(WORKER_PATH),
				env: process.env,
			});

			child.on("error", (e) => {
				child = null;
				rl = null;
				reject(e);
				if (pendingReject) {
					pendingReject(e);
					pendingReject = null;
					pendingResolve = null;
				}
			});

			child.on("exit", () => {
				child = null;
				rl = null;
				if (pendingReject) {
					pendingReject(new Error("Worker exited unexpectedly"));
					pendingReject = null;
					pendingResolve = null;
				}
			});

			rl = createInterface({ input: child.stdout! });

			rl.on("line", (line) => {
				try {
					const msg: WorkerMessage = JSON.parse(line);
					if (msg.type === "ready") {
						resolve();
					} else if (pendingResolve) {
						const r = pendingResolve;
						pendingResolve = null;
						pendingReject = null;
						r(msg);
					}
				} catch {
					// skip malformed lines (e.g. onnxruntime warnings)
				}
			});
		});
	}

	function send(msg: object): Promise<WorkerMessage> {
		return new Promise((resolve, reject) => {
			if (!child?.stdin) {
				reject(new Error("Worker not running"));
				return;
			}
			pendingResolve = resolve;
			pendingReject = reject;
			child.stdin.write(JSON.stringify(msg) + "\n");
		});
	}

	return {
		async embed(text: string): Promise<number[]> {
			await ensureChild();
			const response = await send({ type: "embed", texts: [text] });
			if (response.type === "error") throw new Error(response.message);
			return response.vectors![0];
		},

		async embedBatch(texts: string[]): Promise<number[][]> {
			if (texts.length === 0) return [];
			await ensureChild();
			const response = await send({ type: "embed", texts });
			if (response.type === "error") throw new Error(response.message);
			return response.vectors!;
		},

		async dispose(): Promise<void> {
			if (!child) return;
			// SIGKILL immediately — no graceful shutdown.
			// onnxruntime can't exit cleanly, so don't bother asking.
			child.kill("SIGKILL");
			child = null;
			rl = null;
		},
	};
}
