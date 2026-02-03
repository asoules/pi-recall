/**
 * Vector store backed by sqlite-vec.
 *
 * Stores memories as text + embedding vectors.
 * Retrieves by cosine similarity with a threshold filter.
 */

export interface Memory {
	id: number;
	text: string;
	/** ISO timestamp of when this memory was created */
	createdAt: string;
	/** Session ID this memory was extracted from */
	sessionId: string;
}

export interface MemoryMatch {
	memory: Memory;
	similarity: number;
}

export interface MemoryStoreOptions {
	/** Path to the sqlite database file */
	dbPath: string;
	/** Embedding dimensions (depends on model). Default: 384 (MiniLM) */
	dimensions?: number;
}

export class MemoryStore {
	private dbPath: string;
	private dimensions: number;

	constructor(options: MemoryStoreOptions) {
		this.dbPath = options.dbPath;
		this.dimensions = options.dimensions ?? 384;
	}

	/** Initialize the database and create tables if needed */
	async init(): Promise<void> {
		// TODO: open sqlite, load sqlite-vec extension, create tables
		// - memories: id, text, created_at, session_id
		// - memories_vec: virtual table for vector search
		throw new Error("Not implemented");
	}

	/** Store a memory with its embedding */
	async add(text: string, embedding: number[], sessionId: string): Promise<number> {
		void [text, embedding, sessionId];
		throw new Error("Not implemented");
	}

	/** Search for memories similar to the given embedding */
	async search(embedding: number[], threshold: number, limit: number): Promise<MemoryMatch[]> {
		void [embedding, threshold, limit];
		throw new Error("Not implemented");
	}

	/** Delete a memory by ID */
	async delete(id: number): Promise<void> {
		void id;
		throw new Error("Not implemented");
	}

	/** List all memories */
	async list(): Promise<Memory[]> {
		throw new Error("Not implemented");
	}

	close(): void {
		// TODO: close sqlite connection
	}
}
