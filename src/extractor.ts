/**
 * Memory extraction from session messages.
 *
 * Analyzes a session's user/assistant messages (not tool calls)
 * and extracts durable facts worth remembering.
 *
 * Uses an LLM to identify:
 * - Architectural decisions ("events table uses soft-deletes")
 * - Corrections ("don't use raw SQL, use the query builder")
 * - Conventions ("we use tabs, not spaces")
 * - Gotchas ("the updated_at trigger must be manually added")
 * - Domain knowledge ("refund window is 30 days")
 */

// ============================================================================
// Types
// ============================================================================

export interface SessionMessage {
	role: "user" | "assistant";
	text: string;
}

export interface ExtractedMemory {
	/** The fact to remember */
	text: string;
	/** Why this is worth remembering */
	rationale: string;
}

/**
 * A function that sends a prompt to an LLM and returns the response text.
 * The extractor is provider-agnostic — the caller supplies this.
 */
export type CompletionFn = (systemPrompt: string, userMessage: string) => Promise<string>;

export interface ExtractorOptions {
	/** Maximum number of memories to extract per session. Default: 20 */
	maxMemories?: number;

	/** Existing memories to avoid duplicates. Default: [] */
	existingMemories?: string[];
}

// ============================================================================
// Prompt
// ============================================================================

function buildSystemPrompt(maxMemories: number, existingMemories: string[]): string {
	let prompt = `You extract durable facts from coding session conversations.

Given a transcript of a coding session (user messages and assistant responses, tool calls excluded), identify facts that a developer would make sure to remember for future sessions.

Focus on:
- Architectural decisions ("the events table uses soft-deletes")
- Corrections and mistakes ("don't use raw SQL here, use the query builder")
- Project conventions ("we use tabs not spaces", "all API routes require auth")
- Gotchas and surprises ("the updated_at trigger must be manually added after migration")
- Domain rules ("refund window is 30 days", "users can have at most 3 active sessions")
- Important relationships ("EventService always delegates to AuditLog before mutations")

Exclude:
- Implementation details obvious from reading the code (function signatures, variable names)
- Temporary debugging context ("I added a console.log on line 42")
- Generic programming knowledge ("use try/catch for error handling")
- Anything the assistant would figure out by reading the codebase

Extract at most ${maxMemories} memories. Fewer is better — only extract what's genuinely worth remembering.`;

	if (existingMemories.length > 0) {
		prompt += `

The following memories already exist. Do NOT extract duplicates or facts that are already covered:
${existingMemories.map((m) => `- ${m}`).join("\n")}`;
	}

	prompt += `

Respond with a JSON array. Each element has "text" (the fact) and "rationale" (why it's worth remembering). The "text" should be a standalone statement — understandable without the conversation context.

Example response:
[
  {
    "text": "The events table uses soft-deletes. Never hard-delete event rows.",
    "rationale": "Architectural decision that affects all event-related queries and mutations."
  },
  {
    "text": "Cascade deletes are disabled on event_attendees FK — delete attendees manually before events.",
    "rationale": "Gotcha that would cause foreign key violations if forgotten."
  }
]

If there is nothing worth remembering, respond with an empty array: []`;

	return prompt;
}

function buildUserMessage(messages: SessionMessage[]): string {
	const transcript = messages
		.map((m) => `[${m.role}]: ${m.text}`)
		.join("\n\n");

	return `Here is the session transcript:\n\n${transcript}`;
}

// ============================================================================
// Extraction
// ============================================================================

/**
 * Extract durable memories from a session's messages.
 *
 * Sends the conversation transcript to an LLM and parses
 * the structured response into ExtractedMemory[].
 */
export async function extractMemories(
	messages: SessionMessage[],
	complete: CompletionFn,
	options?: ExtractorOptions,
): Promise<ExtractedMemory[]> {
	if (messages.length === 0) return [];

	const maxMemories = options?.maxMemories ?? 20;
	const existingMemories = options?.existingMemories ?? [];

	const systemPrompt = buildSystemPrompt(maxMemories, existingMemories);
	const userMessage = buildUserMessage(messages);

	const response = await complete(systemPrompt, userMessage);

	return parseResponse(response);
}

/**
 * Parse the LLM response into ExtractedMemory[].
 * Handles JSON wrapped in markdown code blocks.
 */
export function parseResponse(response: string): ExtractedMemory[] {
	// Strip markdown code fences if present
	let json = response.trim();
	if (json.startsWith("```")) {
		// Remove opening fence (with optional language tag)
		json = json.replace(/^```(?:json)?\s*\n?/, "");
		// Remove closing fence
		json = json.replace(/\n?\s*```\s*$/, "");
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		// Try to find a JSON array in the response
		const match = json.match(/\[[\s\S]*\]/);
		if (match) {
			try {
				parsed = JSON.parse(match[0]);
			} catch {
				return [];
			}
		} else {
			return [];
		}
	}

	if (!Array.isArray(parsed)) return [];

	const memories: ExtractedMemory[] = [];
	for (const item of parsed) {
		if (
			typeof item === "object" &&
			item !== null &&
			typeof item.text === "string" &&
			typeof item.rationale === "string" &&
			item.text.trim().length > 0
		) {
			memories.push({
				text: item.text.trim(),
				rationale: item.rationale.trim(),
			});
		}
	}

	return memories;
}
