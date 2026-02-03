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

export interface ExtractorOptions {
	/** Maximum number of memories to extract per session. Default: 20 */
	maxMemories?: number;
}

/**
 * Extract durable memories from a session's messages.
 *
 * Filters out tool calls, sends conversation to an LLM with
 * instructions to identify facts a developer would remember.
 */
export async function extractMemories(
	messages: SessionMessage[],
	_options?: ExtractorOptions,
): Promise<ExtractedMemory[]> {
	void messages;
	// TODO:
	// 1. Format messages into a conversation transcript
	// 2. Send to LLM with extraction prompt
	// 3. Parse structured response into ExtractedMemory[]
	//
	// Extraction prompt should ask:
	// "What facts from this conversation would a developer make sure to remember?
	//  Focus on: architectural decisions, corrections, conventions, gotchas, domain rules.
	//  Exclude: implementation details that are obvious from reading the code."
	throw new Error("Not implemented");
}
