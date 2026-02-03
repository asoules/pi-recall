/**
 * Language-aware structural signature extraction.
 *
 * Extracts class names, module declarations, function signatures,
 * table definitions, etc. from source files. Falls back to first N lines
 * for unknown languages.
 *
 * The signature is used as the embedding query when searching for
 * relevant memories on file read.
 */

const FALLBACK_LINES = 30;

interface SignatureExtractor {
	/** Regex patterns to match structural declarations */
	patterns: RegExp[];
}

const extractors: Record<string, SignatureExtractor> = {
	typescript: {
		patterns: [
			/^export\s+(default\s+)?(?:abstract\s+)?class\s+\w+/,
			/^export\s+(default\s+)?interface\s+\w+/,
			/^export\s+(default\s+)?type\s+\w+/,
			/^export\s+(?:async\s+)?function\s+\w+/,
			/^(?:abstract\s+)?class\s+\w+/,
			/^interface\s+\w+/,
			/^type\s+\w+\s*=/,
			/^(?:export\s+)?(?:const|let)\s+\w+\s*[:=]/,
		],
	},
	javascript: {
		patterns: [
			/^export\s+(default\s+)?class\s+\w+/,
			/^export\s+(?:async\s+)?function\s+\w+/,
			/^class\s+\w+/,
			/^(?:async\s+)?function\s+\w+/,
			/^(?:export\s+)?(?:const|let|var)\s+\w+\s*[:=]/,
			/^module\.exports/,
		],
	},
	python: {
		patterns: [
			/^class\s+\w+/,
			/^def\s+\w+/,
			/^async\s+def\s+\w+/,
		],
	},
	ruby: {
		patterns: [
			/^module\s+\w+/,
			/^class\s+\w+/,
			/^\s*def\s+\w+/,
		],
	},
	go: {
		patterns: [
			/^package\s+\w+/,
			/^type\s+\w+\s+struct/,
			/^type\s+\w+\s+interface/,
			/^func\s+/,
		],
	},
	rust: {
		patterns: [
			/^pub\s+struct\s+\w+/,
			/^pub\s+enum\s+\w+/,
			/^pub\s+trait\s+\w+/,
			/^pub\s+fn\s+\w+/,
			/^struct\s+\w+/,
			/^enum\s+\w+/,
			/^trait\s+\w+/,
			/^fn\s+\w+/,
			/^impl\s+/,
			/^mod\s+\w+/,
		],
	},
	sql: {
		patterns: [
			/CREATE\s+TABLE/i,
			/ALTER\s+TABLE/i,
			/CREATE\s+(?:UNIQUE\s+)?INDEX/i,
			/CREATE\s+VIEW/i,
			/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i,
			/CREATE\s+TRIGGER/i,
		],
	},
	java: {
		patterns: [
			/^public\s+(?:abstract\s+)?class\s+\w+/,
			/^public\s+interface\s+\w+/,
			/^public\s+enum\s+\w+/,
			/^package\s+[\w.]+/,
		],
	},
	kotlin: {
		patterns: [
			/^(?:data\s+)?class\s+\w+/,
			/^interface\s+\w+/,
			/^object\s+\w+/,
			/^fun\s+\w+/,
			/^package\s+[\w.]+/,
		],
	},
	swift: {
		patterns: [
			/^(?:public\s+|open\s+|internal\s+)?class\s+\w+/,
			/^(?:public\s+)?struct\s+\w+/,
			/^(?:public\s+)?protocol\s+\w+/,
			/^(?:public\s+)?enum\s+\w+/,
			/^(?:public\s+)?func\s+\w+/,
		],
	},
	c: {
		patterns: [
			/^typedef\s+struct/,
			/^struct\s+\w+/,
			/^enum\s+\w+/,
			/^\w[\w\s*]+\s+\w+\s*\(/,
		],
	},
};

const extensionToLanguage: Record<string, string> = {
	".ts": "typescript",
	".tsx": "typescript",
	".js": "javascript",
	".jsx": "javascript",
	".mjs": "javascript",
	".cjs": "javascript",
	".py": "python",
	".rb": "ruby",
	".go": "go",
	".rs": "rust",
	".sql": "sql",
	".java": "java",
	".kt": "kotlin",
	".kts": "kotlin",
	".swift": "swift",
	".c": "c",
	".h": "c",
	".cpp": "c",
	".hpp": "c",
};

/**
 * Extract a structural signature from file content.
 *
 * Returns a compact string of structural declarations suitable for embedding.
 * Includes the file path as a weak signal.
 */
export function extractSignature(filePath: string, content: string): string {
	const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
	const language = extensionToLanguage[ext];
	const lines = content.split("\n");

	const parts: string[] = [filePath];

	if (language && extractors[language]) {
		const extractor = extractors[language];
		for (const line of lines) {
			const trimmed = line.trimStart();
			for (const pattern of extractor.patterns) {
				if (pattern.test(trimmed)) {
					parts.push(trimmed.trim());
					break;
				}
			}
		}
	}

	// If we got meaningful structural matches, use them
	if (parts.length > 1) {
		return parts.join(" | ");
	}

	// Fallback: file path + first N lines
	const fallback = lines.slice(0, FALLBACK_LINES).join("\n");
	return `${filePath}\n${fallback}`;
}
