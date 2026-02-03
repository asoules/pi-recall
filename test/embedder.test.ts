import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createEmbedder, type Embedder } from "../src/embedder.js";

// Model download can be slow on first run
const TIMEOUT = 120_000;

describe("embedder", () => {
	let embedder: Embedder;

	beforeAll(async () => {
		embedder = await createEmbedder();
	}, TIMEOUT);

	afterAll(async () => {
		await embedder.dispose();
	});

	it("embeds a single text to a 384-dim vector", async () => {
		const vec = await embedder.embed("the events table uses soft-deletes");
		expect(vec).toHaveLength(384);
		// Normalized: magnitude should be ~1.0
		const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
		expect(magnitude).toBeCloseTo(1.0, 2);
	});

	it("embeds a batch of texts", async () => {
		const vecs = await embedder.embedBatch([
			"class EventService",
			"soft-delete logic",
			"user authentication flow",
		]);
		expect(vecs).toHaveLength(3);
		for (const vec of vecs) {
			expect(vec).toHaveLength(384);
		}
	});

	it("returns empty array for empty batch", async () => {
		const vecs = await embedder.embedBatch([]);
		expect(vecs).toHaveLength(0);
	});

	it("produces similar embeddings for similar texts", async () => {
		const [a, b, c] = await embedder.embedBatch([
			"the events table uses soft-deletes, never hard-delete rows",
			"soft-delete pattern for the events database table",
			"quantum physics and the theory of relativity",
		]);

		const simAB = cosine(a, b);
		const simAC = cosine(a, c);

		// Related texts should be more similar than unrelated ones
		expect(simAB).toBeGreaterThan(simAC);
		expect(simAB).toBeGreaterThan(0.5);
		expect(simAC).toBeLessThan(0.3);
	});

	it("produces similar embeddings for code signature vs memory", async () => {
		const [signature, memory, unrelated] = await embedder.embedBatch([
			"schema/events.sql | events | event_attendees | idx_events_deleted_at",
			"the events table uses soft-deletes, never hard-delete rows",
			"CSS flexbox layout with responsive breakpoints",
		]);

		const simMatch = cosine(signature, memory);
		const simUnrelated = cosine(signature, unrelated);

		// Signature should match the memory about events
		expect(simMatch).toBeGreaterThan(simUnrelated);
		expect(simMatch).toBeGreaterThan(0.3);
	});
});

function cosine(a: number[], b: number[]): number {
	let dot = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
	}
	// Vectors are already normalized, so dot product = cosine similarity
	return dot;
}
