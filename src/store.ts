/**
 * Vector store backed by sqlite-vec.
 *
 * Stores memories as text + embedding vectors.
 * Retrieves by cosine similarity with a threshold filter.
 *
 * sqlite-vec uses L2 (Euclidean) distance by default. For normalized
 * vectors (which our embedder produces), we convert to cosine similarity:
 *   cosine_similarity = 1 - (L2_distance² / 2)
 */

import Database, { type Database as DatabaseType } from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { mkdirSync } from "fs";
import { dirname } from "path";

// ============================================================================
// Types
// ============================================================================

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
	/** Cosine similarity score (0 to 1 for normalized vectors) */
	similarity: number;
}

export interface MemoryStoreOptions {
	/** Path to the sqlite database file. Use ":memory:" for in-memory. */
	dbPath: string;
	/** Embedding dimensions. Default: 384 (MiniLM) */
	dimensions?: number;
}

// ============================================================================
// Helpers
// ============================================================================

/** Convert a number[] to a Uint8Array backed by Float32Array (what sqlite-vec expects) */
function toF32Bytes(vec: number[]): Uint8Array {
	return new Uint8Array(new Float32Array(vec).buffer);
}

/**
 * Convert L2 distance to cosine similarity.
 *
 * For unit-normalized vectors a and b:
 *   ||a - b||² = 2 - 2·cos(a,b)
 *   cos(a,b) = 1 - ||a - b||² / 2
 */
function l2ToCosine(l2Distance: number): number {
	return 1 - (l2Distance * l2Distance) / 2;
}

// ============================================================================
// MemoryStore
// ============================================================================

export class MemoryStore {
	private db: DatabaseType;
	private dimensions: number;

	constructor(options: MemoryStoreOptions) {
		this.dimensions = options.dimensions ?? 384;

		if (options.dbPath !== ":memory:") {
			mkdirSync(dirname(options.dbPath), { recursive: true });
		}

		this.db = new Database(options.dbPath);
		sqliteVec.load(this.db);

		this.db.pragma("journal_mode = WAL");

		this.db.exec(`
			CREATE TABLE IF NOT EXISTS memories (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				text TEXT NOT NULL,
				created_at TEXT NOT NULL,
				session_id TEXT NOT NULL
			)
		`);

		this.db.exec(
			`CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(embedding float[${this.dimensions}])`
		);
	}

	/** Store a memory with its embedding. Returns the memory ID. */
	add(text: string, embedding: number[], sessionId: string): number {
		if (embedding.length !== this.dimensions) {
			throw new Error(`Expected ${this.dimensions}-dim embedding, got ${embedding.length}`);
		}

		const insertMemory = this.db.transaction(() => {
			const result = this.db
				.prepare("INSERT INTO memories (text, created_at, session_id) VALUES (?, ?, ?)")
				.run(text, new Date().toISOString(), sessionId);

			const rowid = result.lastInsertRowid;

			this.db
				.prepare("INSERT INTO memories_vec(rowid, embedding) VALUES (:rowid, :embedding)")
				.run({ rowid: BigInt(rowid as number), embedding: toF32Bytes(embedding) });

			return Number(rowid);
		});

		return insertMemory();
	}

	/**
	 * Search for memories similar to the given embedding.
	 *
	 * Returns memories with cosine similarity >= threshold,
	 * ordered by similarity (highest first), up to limit results.
	 */
	search(embedding: number[], threshold: number, limit: number): MemoryMatch[] {
		if (embedding.length !== this.dimensions) {
			throw new Error(`Expected ${this.dimensions}-dim embedding, got ${embedding.length}`);
		}

		// Fetch more than limit since we filter by threshold after conversion
		const fetchLimit = Math.max(limit * 2, 20);

		const rows = this.db
			.prepare(
				`SELECT v.rowid, v.distance, m.text, m.created_at, m.session_id
				 FROM memories_vec v
				 JOIN memories m ON m.id = v.rowid
				 WHERE v.embedding MATCH :query
				 AND k = :k`
			)
			.all({ query: toF32Bytes(embedding), k: BigInt(fetchLimit) }) as Array<{
			rowid: number;
			distance: number;
			text: string;
			created_at: string;
			session_id: string;
		}>;

		const results: MemoryMatch[] = [];

		for (const row of rows) {
			const similarity = l2ToCosine(row.distance);
			if (similarity < threshold) continue;

			results.push({
				memory: {
					id: row.rowid,
					text: row.text,
					createdAt: row.created_at,
					sessionId: row.session_id,
				},
				similarity,
			});

			if (results.length >= limit) break;
		}

		return results;
	}

	/** Delete a memory by ID. */
	delete(id: number): void {
		const deleteMemory = this.db.transaction(() => {
			this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
			this.db.prepare("DELETE FROM memories_vec WHERE rowid = ?").run(BigInt(id));
		});
		deleteMemory();
	}

	/** List all memories, ordered by creation time (newest first). */
	list(): Memory[] {
		const rows = this.db
			.prepare("SELECT id, text, created_at, session_id FROM memories ORDER BY created_at DESC")
			.all() as Array<{ id: number; text: string; created_at: string; session_id: string }>;

		return rows.map((row) => ({
			id: row.id,
			text: row.text,
			createdAt: row.created_at,
			sessionId: row.session_id,
		}));
	}

	/** Get total number of memories. */
	count(): number {
		const row = this.db.prepare("SELECT COUNT(*) as cnt FROM memories").get() as { cnt: number };
		return row.cnt;
	}

	/** Close the database connection. */
	close(): void {
		this.db.close();
	}
}
