/**
 * Text embedding using a local transformer model.
 *
 * Uses @huggingface/transformers to run all-MiniLM-L6-v2 locally via ONNX.
 * The model is ~80MB, downloaded on first use and cached by the library.
 *
 * Produces 384-dimensional normalized embeddings suitable for cosine similarity.
 */

import { FeatureExtractionPipeline, pipeline } from "@huggingface/transformers";

// ============================================================================
// Types
// ============================================================================

export interface Embedder {
	/** Embed a single text into a vector. */
	embed(text: string): Promise<number[]>;

	/** Embed multiple texts in a batch. More efficient than calling embed() in a loop. */
	embedBatch(texts: string[]): Promise<number[][]>;

	/** Release model resources. */
	dispose(): Promise<void>;
}

export interface EmbedderOptions {
	/**
	 * HuggingFace model ID.
	 * Default: "Xenova/all-MiniLM-L6-v2"
	 */
	model?: string;

	/**
	 * Model dtype. Default: "fp32".
	 * Use "q8" for quantized (smaller, slightly less accurate).
	 */
	dtype?: "fp32" | "q8";
}

// ============================================================================
// Default model
// ============================================================================

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_DTYPE = "fp32";

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create an embedder backed by a local ONNX model.
 *
 * First call downloads the model (~80MB) and caches it.
 * Subsequent calls reuse the cached model. The pipeline itself
 * is kept in memory for fast repeated embeddings.
 */
export async function createEmbedder(options?: EmbedderOptions): Promise<Embedder> {
	const model = options?.model ?? DEFAULT_MODEL;
	const dtype = options?.dtype ?? DEFAULT_DTYPE;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- pipeline() overloads produce a union too complex for TS
	const extractor = await (pipeline as any)("feature-extraction", model, {
		dtype,
	}) as FeatureExtractionPipeline;

	return {
		async embed(text: string): Promise<number[]> {
			const result = await extractor(text, {
				pooling: "mean",
				normalize: true,
			});
			// result.dims is [1, 384] for a single input
			return result.tolist()[0] as number[];
		},

		async embedBatch(texts: string[]): Promise<number[][]> {
			if (texts.length === 0) return [];

			const result = await extractor(texts, {
				pooling: "mean",
				normalize: true,
			});
			// result.dims is [n, 384] for n inputs
			return result.tolist() as number[][];
		},

		async dispose(): Promise<void> {
			await extractor.dispose();
		},
	};
}
