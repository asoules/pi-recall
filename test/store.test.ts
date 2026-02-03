import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../src/store.js";

// Use 4-dim vectors for simplicity in tests
const DIMS = 4;

function unit(vec: number[]): number[] {
	const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
	return vec.map((v) => v / mag);
}

describe("MemoryStore", () => {
	let store: MemoryStore;

	beforeEach(() => {
		store = new MemoryStore({ dbPath: ":memory:", dimensions: DIMS });
	});

	afterEach(() => {
		store.close();
	});

	it("adds and lists memories", () => {
		const id1 = store.add("events soft-delete", unit([1, 0, 0, 0]), "session-1");
		const id2 = store.add("auth tokens expire", unit([0, 1, 0, 0]), "session-1");

		expect(id1).toBe(1);
		expect(id2).toBe(2);

		const all = store.list();
		expect(all).toHaveLength(2);
		const texts = all.map((m) => m.text).sort();
		expect(texts).toEqual(["auth tokens expire", "events soft-delete"]);
	});

	it("searches by similarity", () => {
		store.add("events soft-delete", unit([1, 0, 0, 0]), "s1");
		store.add("auth tokens expire", unit([0, 1, 0, 0]), "s1");
		store.add("events audit log", unit([0.9, 0.1, 0, 0]), "s2");

		const results = store.search(unit([1, 0, 0, 0]), 0.1, 10);

		// Should return events-related memories first
		expect(results.length).toBeGreaterThanOrEqual(2);
		expect(results[0].memory.text).toBe("events soft-delete");
		expect(results[0].similarity).toBeCloseTo(1.0, 2);

		// Second result should be the related events memory
		expect(results[1].memory.text).toBe("events audit log");
		expect(results[1].similarity).toBeGreaterThan(0.5);
	});

	it("filters by threshold", () => {
		store.add("events soft-delete", unit([1, 0, 0, 0]), "s1");
		store.add("totally unrelated", unit([0, 0, 0, 1]), "s1");

		// High threshold should only return the close match
		const results = store.search(unit([1, 0, 0, 0]), 0.9, 10);
		expect(results).toHaveLength(1);
		expect(results[0].memory.text).toBe("events soft-delete");
	});

	it("respects limit", () => {
		store.add("memory 1", unit([1, 0, 0, 0]), "s1");
		store.add("memory 2", unit([0.9, 0.1, 0, 0]), "s1");
		store.add("memory 3", unit([0.8, 0.2, 0, 0]), "s1");

		const results = store.search(unit([1, 0, 0, 0]), 0.1, 2);
		expect(results).toHaveLength(2);
	});

	it("deletes memories", () => {
		const id = store.add("to be deleted", unit([1, 0, 0, 0]), "s1");
		expect(store.count()).toBe(1);

		store.delete(id);
		expect(store.count()).toBe(0);

		// Should not appear in search
		const results = store.search(unit([1, 0, 0, 0]), 0.0, 10);
		expect(results).toHaveLength(0);
	});

	it("counts memories", () => {
		expect(store.count()).toBe(0);
		store.add("one", unit([1, 0, 0, 0]), "s1");
		expect(store.count()).toBe(1);
		store.add("two", unit([0, 1, 0, 0]), "s1");
		expect(store.count()).toBe(2);
	});

	it("rejects wrong dimension embeddings", () => {
		expect(() => store.add("bad", [1, 2, 3], "s1")).toThrow("Expected 4-dim");
		expect(() => store.search([1, 2, 3], 0.5, 10)).toThrow("Expected 4-dim");
	});

	it("returns empty results for empty store", () => {
		const results = store.search(unit([1, 0, 0, 0]), 0.0, 10);
		expect(results).toHaveLength(0);
	});

	it("stores session ID correctly", () => {
		store.add("mem1", unit([1, 0, 0, 0]), "session-abc-123");

		const all = store.list();
		expect(all[0].sessionId).toBe("session-abc-123");

		const results = store.search(unit([1, 0, 0, 0]), 0.5, 10);
		expect(results[0].memory.sessionId).toBe("session-abc-123");
	});
});
