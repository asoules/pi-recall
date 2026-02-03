import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createEmbedder, type Embedder } from "../src/embedder.js";
import { MemoryStore } from "../src/store.js";
import { extractSignature } from "../src/signature.js";

/**
 * Integration test: the full deja vu flow.
 *
 * We can't test the pi extension hooks directly without the agent runtime,
 * but we can test the complete pipeline that the extension orchestrates:
 *
 *   1. Store a memory with its embedding
 *   2. Agent reads a file → extract signature → embed → search
 *   3. Verify the memory surfaces
 */

const TIMEOUT = 120_000;

describe("deja vu pipeline", () => {
	let embedder: Embedder;
	let store: MemoryStore;

	beforeAll(async () => {
		embedder = await createEmbedder();
		store = new MemoryStore({ dbPath: ":memory:" });
	}, TIMEOUT);

	afterAll(async () => {
		store.close();
		await embedder.dispose();
	});

	it("surfaces a memory when reading a related file", async () => {
		// 1. Store a memory about soft-deletes
		const memoryText = "The events table uses soft-deletes. Never hard-delete event rows.";
		const memoryVec = await embedder.embed(memoryText);
		store.add(memoryText, memoryVec, "session-001");

		// 2. Simulate reading a TypeScript file about events
		const fileContent = `
export class EventService {
	async delete(id: string): Promise<void> {
		await this.db.query("UPDATE events SET deleted_at = NOW() WHERE id = ?", [id]);
	}

	async findAll(): Promise<Event[]> {
		return this.db.query("SELECT * FROM events WHERE deleted_at IS NULL");
	}
}

export interface EventRepository {
	delete(id: string): Promise<void>;
	findAll(): Promise<Event[]>;
}
`;

		// 3. Extract signature from the file
		const signature = await extractSignature("src/services/events.ts", fileContent);
		expect(signature).not.toBeNull();

		// 4. Embed the signature and search
		const queryVec = await embedder.embed(signature!);
		const matches = store.search(queryVec, 0.2, 5);

		// 5. The soft-delete memory should surface
		expect(matches.length).toBeGreaterThanOrEqual(1);
		expect(matches[0].memory.text).toContain("soft-deletes");
		expect(matches[0].similarity).toBeGreaterThan(0.2);
	});

	it("does not surface unrelated memories", async () => {
		// Store unrelated memories
		const cssMemory = "CSS flexbox uses row direction by default. Use flex-direction: column for vertical.";
		const cssVec = await embedder.embed(cssMemory);
		store.add(cssMemory, cssVec, "session-002");

		// Read an auth file
		const authContent = `
export class AuthMiddleware {
	async validateToken(token: string): Promise<boolean> {
		return jwt.verify(token, this.secret);
	}

	async refreshSession(userId: string): Promise<Session> {
		return this.sessionStore.create(userId);
	}
}
`;

		const signature = await extractSignature("src/middleware/auth.ts", authContent);
		expect(signature).not.toBeNull();

		const queryVec = await embedder.embed(signature!);
		const matches = store.search(queryVec, 0.4, 5);

		// CSS memory should NOT match auth code at threshold 0.4
		const cssMatch = matches.find((m) => m.memory.text.includes("CSS"));
		expect(cssMatch).toBeUndefined();
	});

	it("handles manual memory addition and search", async () => {
		const fact = "Auth tokens expire after 24 hours. Refresh silently on 401 responses.";
		const vec = await embedder.embed(fact);
		store.add(fact, vec, "manual");

		// Search by natural language query
		const queryVec = await embedder.embed("token expiration and refresh");
		const matches = store.search(queryVec, 0.3, 5);

		const found = matches.find((m) => m.memory.text.includes("24 hours"));
		expect(found).toBeDefined();
	});

	it("supports the full flow across multiple memories", async () => {
		// Add several domain-specific memories
		const memories = [
			"The payments service requires idempotency keys for all mutation endpoints.",
			"User email addresses are case-insensitive. Always normalize to lowercase before comparison.",
			"The audit_log table is append-only. Never update or delete rows.",
		];

		for (const mem of memories) {
			const vec = await embedder.embed(mem);
			store.add(mem, vec, "session-003");
		}

		// Read a payments file
		const paymentsContent = `
export class PaymentProcessor {
	async charge(amount: number, idempotencyKey: string): Promise<ChargeResult> {
		return this.gateway.charge({ amount, key: idempotencyKey });
	}

	async refund(chargeId: string, idempotencyKey: string): Promise<RefundResult> {
		return this.gateway.refund({ chargeId, key: idempotencyKey });
	}
}
`;

		const signature = await extractSignature("src/payments/processor.ts", paymentsContent);
		const queryVec = await embedder.embed(signature!);
		const matches = store.search(queryVec, 0.25, 5);

		// Should find the idempotency key memory
		const idempotencyMatch = matches.find((m) =>
			m.memory.text.includes("idempotency"),
		);
		expect(idempotencyMatch).toBeDefined();
	});
});
