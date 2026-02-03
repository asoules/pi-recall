/**
 * Text embedding.
 *
 * Converts text into vector embeddings for similarity search.
 * Supports local models (ONNX) and API-based providers.
 */

export interface EmbedderOptions {
	/** Embedding provider. Default: "local" */
	provider?: "local";
	// Future: "openai" | "voyage" etc.
}

/**
 * Embed text into a vector.
 *
 * Uses a local model (all-MiniLM-L6-v2) by default.
 * Returns a float array of dimension 384.
 */
export async function embed(text: string, _options?: EmbedderOptions): Promise<number[]> {
	void text;
	// TODO: load ONNX runtime, run all-MiniLM-L6-v2
	// Consider caching the model in memory across calls
	throw new Error("Not implemented");
}

/**
 * Embed multiple texts in a batch.
 */
export async function embedBatch(texts: string[], _options?: EmbedderOptions): Promise<number[][]> {
	void texts;
	throw new Error("Not implemented");
}
