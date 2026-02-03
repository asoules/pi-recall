import { describe, it, expect } from "vitest";
import { extractMemories, parseResponse, type CompletionFn, type SessionMessage } from "../src/extractor.js";

describe("parseResponse", () => {
	it("parses valid JSON array", () => {
		const response = `[
			{"text": "events use soft-deletes", "rationale": "architectural decision"},
			{"text": "refund window is 30 days", "rationale": "domain rule"}
		]`;
		const memories = parseResponse(response);
		expect(memories).toHaveLength(2);
		expect(memories[0].text).toBe("events use soft-deletes");
		expect(memories[0].rationale).toBe("architectural decision");
		expect(memories[1].text).toBe("refund window is 30 days");
	});

	it("handles markdown code fences", () => {
		const response = '```json\n[{"text": "use tabs", "rationale": "convention"}]\n```';
		const memories = parseResponse(response);
		expect(memories).toHaveLength(1);
		expect(memories[0].text).toBe("use tabs");
	});

	it("handles code fences without language tag", () => {
		const response = '```\n[{"text": "use tabs", "rationale": "convention"}]\n```';
		const memories = parseResponse(response);
		expect(memories).toHaveLength(1);
	});

	it("returns empty for empty array", () => {
		expect(parseResponse("[]")).toHaveLength(0);
	});

	it("returns empty for invalid JSON", () => {
		expect(parseResponse("this is not json")).toHaveLength(0);
	});

	it("returns empty for non-array JSON", () => {
		expect(parseResponse('{"text": "hello"}')).toHaveLength(0);
	});

	it("skips items with missing fields", () => {
		const response = `[
			{"text": "valid", "rationale": "good"},
			{"text": "missing rationale"},
			{"rationale": "missing text"},
			{"text": "", "rationale": "empty text"},
			{"text": "also valid", "rationale": "fine"}
		]`;
		const memories = parseResponse(response);
		expect(memories).toHaveLength(2);
		expect(memories[0].text).toBe("valid");
		expect(memories[1].text).toBe("also valid");
	});

	it("trims whitespace from text and rationale", () => {
		const response = '[{"text": "  spaced out  ", "rationale": "  also spaced  "}]';
		const memories = parseResponse(response);
		expect(memories[0].text).toBe("spaced out");
		expect(memories[0].rationale).toBe("also spaced");
	});

	it("extracts JSON array from surrounding text", () => {
		const response = `Here are the memories I extracted:
[{"text": "found it", "rationale": "buried in text"}]
Hope that helps!`;
		const memories = parseResponse(response);
		expect(memories).toHaveLength(1);
		expect(memories[0].text).toBe("found it");
	});
});

describe("extractMemories", () => {
	it("returns empty for empty messages", async () => {
		const mockComplete: CompletionFn = async () => "[]";
		const result = await extractMemories([], mockComplete);
		expect(result).toHaveLength(0);
	});

	it("sends transcript to completion function and parses result", async () => {
		let capturedSystem = "";
		let capturedUser = "";

		const mockComplete: CompletionFn = async (system, user) => {
			capturedSystem = system;
			capturedUser = user;
			return '[{"text": "events use soft-deletes", "rationale": "architectural decision"}]';
		};

		const messages: SessionMessage[] = [
			{ role: "user", text: "How does the events table handle deletion?" },
			{ role: "assistant", text: "The events table uses soft-deletes. We never hard-delete rows." },
		];

		const result = await extractMemories(messages, mockComplete);

		expect(result).toHaveLength(1);
		expect(result[0].text).toBe("events use soft-deletes");

		// Verify the system prompt contains key instructions
		expect(capturedSystem).toContain("durable facts");
		expect(capturedSystem).toContain("Architectural decisions");
		expect(capturedSystem).toContain("JSON array");

		// Verify the user message contains the transcript
		expect(capturedUser).toContain("[user]: How does the events table handle deletion?");
		expect(capturedUser).toContain("[assistant]: The events table uses soft-deletes");
	});

	it("passes existing memories to avoid duplicates", async () => {
		let capturedSystem = "";

		const mockComplete: CompletionFn = async (system) => {
			capturedSystem = system;
			return "[]";
		};

		await extractMemories(
			[{ role: "user", text: "test" }],
			mockComplete,
			{ existingMemories: ["events use soft-deletes", "refund window is 30 days"] },
		);

		expect(capturedSystem).toContain("events use soft-deletes");
		expect(capturedSystem).toContain("refund window is 30 days");
		expect(capturedSystem).toContain("Do NOT extract duplicates");
	});

	it("respects maxMemories in prompt", async () => {
		let capturedSystem = "";

		const mockComplete: CompletionFn = async (system) => {
			capturedSystem = system;
			return "[]";
		};

		await extractMemories(
			[{ role: "user", text: "test" }],
			mockComplete,
			{ maxMemories: 5 },
		);

		expect(capturedSystem).toContain("at most 5 memories");
	});

	it("handles LLM returning garbage gracefully", async () => {
		const mockComplete: CompletionFn = async () => "I don't understand the question.";
		const result = await extractMemories(
			[{ role: "user", text: "test" }],
			mockComplete,
		);
		expect(result).toHaveLength(0);
	});
});
