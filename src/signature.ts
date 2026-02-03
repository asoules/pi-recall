/**
 * Language-aware structural signature extraction using tree-sitter.
 *
 * Parses source files with web-tree-sitter and extracts structural
 * declarations (classes, functions, interfaces, tables, etc.) using
 * tree-sitter query patterns.
 *
 * The signature is used as the embedding query when searching for
 * relevant memories on file read.
 */

import { Language, type Node, Parser, Query } from "web-tree-sitter";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

// ============================================================================
// Types
// ============================================================================

export interface LanguageConfig {
	/** tree-sitter query pattern to capture structural declarations */
	query: string;
	/** wasm file name (e.g., "tree-sitter-typescript.wasm") */
	wasmFile: string;
}

// ============================================================================
// Language configurations
// ============================================================================

/**
 * Tree-sitter queries for each language.
 *
 * Each query captures nodes tagged as @name. The text of matched nodes
 * is extracted to form the file's structural signature.
 *
 * We use maxStartDepth: 0 when executing queries to only match top-level
 * declarations (not nested classes/functions).
 */
const LANGUAGES: Record<string, LanguageConfig> = {
	typescript: {
		wasmFile: "tree-sitter-typescript.wasm",
		query: `
			(class_declaration name: (type_identifier) @name)
			(abstract_class_declaration name: (type_identifier) @name)
			(interface_declaration name: (type_identifier) @name)
			(type_alias_declaration name: (type_identifier) @name)
			(function_declaration name: (identifier) @name)
			(enum_declaration name: (identifier) @name)

			(export_statement
				declaration: (class_declaration name: (type_identifier) @name))
			(export_statement
				declaration: (abstract_class_declaration name: (type_identifier) @name))
			(export_statement
				declaration: (interface_declaration name: (type_identifier) @name))
			(export_statement
				declaration: (type_alias_declaration name: (type_identifier) @name))
			(export_statement
				declaration: (function_declaration name: (identifier) @name))
			(export_statement
				declaration: (enum_declaration name: (identifier) @name))
			(export_statement
				declaration: (lexical_declaration
					(variable_declarator name: (identifier) @name)))

			(lexical_declaration
				(variable_declarator name: (identifier) @name))
		`,
	},

	tsx: {
		wasmFile: "tree-sitter-tsx.wasm",
		query: `
			(class_declaration name: (type_identifier) @name)
			(abstract_class_declaration name: (type_identifier) @name)
			(interface_declaration name: (type_identifier) @name)
			(type_alias_declaration name: (type_identifier) @name)
			(function_declaration name: (identifier) @name)
			(enum_declaration name: (identifier) @name)

			(export_statement
				declaration: (class_declaration name: (type_identifier) @name))
			(export_statement
				declaration: (abstract_class_declaration name: (type_identifier) @name))
			(export_statement
				declaration: (interface_declaration name: (type_identifier) @name))
			(export_statement
				declaration: (type_alias_declaration name: (type_identifier) @name))
			(export_statement
				declaration: (function_declaration name: (identifier) @name))
			(export_statement
				declaration: (enum_declaration name: (identifier) @name))
			(export_statement
				declaration: (lexical_declaration
					(variable_declarator name: (identifier) @name)))

			(lexical_declaration
				(variable_declarator name: (identifier) @name))
		`,
	},

	javascript: {
		wasmFile: "tree-sitter-javascript.wasm",
		query: `
			(class_declaration name: (identifier) @name)
			(function_declaration name: (identifier) @name)

			(export_statement
				declaration: (class_declaration name: (identifier) @name))
			(export_statement
				declaration: (function_declaration name: (identifier) @name))
			(export_statement
				declaration: (lexical_declaration
					(variable_declarator name: (identifier) @name)))

			(lexical_declaration
				(variable_declarator name: (identifier) @name))
		`,
	},

	python: {
		wasmFile: "tree-sitter-python.wasm",
		query: `
			(class_definition name: (identifier) @name)
			(function_definition name: (identifier) @name)
		`,
	},

	ruby: {
		wasmFile: "tree-sitter-ruby.wasm",
		query: `
			(module name: (constant) @name)
			(class name: (constant) @name)
			(method name: (identifier) @name)
			(singleton_method name: (identifier) @name)
		`,
	},

	go: {
		wasmFile: "tree-sitter-go.wasm",
		query: `
			(package_clause (package_identifier) @name)
			(type_declaration (type_spec name: (type_identifier) @name))
			(function_declaration name: (identifier) @name)
			(method_declaration name: (field_identifier) @name)
		`,
	},

	rust: {
		wasmFile: "tree-sitter-rust.wasm",
		query: `
			(mod_item name: (identifier) @name)
			(struct_item name: (type_identifier) @name)
			(enum_item name: (type_identifier) @name)
			(trait_item name: (type_identifier) @name)
			(impl_item type: (type_identifier) @name)
			(function_item name: (identifier) @name)
			(type_item name: (type_identifier) @name)
		`,
	},

	c: {
		wasmFile: "tree-sitter-c.wasm",
		query: `
			(function_definition
				declarator: (function_declarator
					declarator: (identifier) @name))
			(function_definition
				declarator: (pointer_declarator
					declarator: (function_declarator
						declarator: (identifier) @name)))
			(struct_specifier name: (type_identifier) @name)
			(enum_specifier name: (type_identifier) @name)
			(type_definition
				declarator: (type_identifier) @name)
		`,
	},

	cpp: {
		wasmFile: "tree-sitter-cpp.wasm",
		query: `
			(function_definition
				declarator: (function_declarator
					declarator: (identifier) @name))
			(class_specifier name: (type_identifier) @name)
			(struct_specifier name: (type_identifier) @name)
			(enum_specifier name: (type_identifier) @name)
			(namespace_definition name: (identifier) @name)
			(type_definition
				declarator: (type_identifier) @name)
		`,
	},

	java: {
		wasmFile: "tree-sitter-java.wasm",
		query: `
			(package_declaration (scoped_identifier) @name)
			(class_declaration name: (identifier) @name)
			(interface_declaration name: (identifier) @name)
			(enum_declaration name: (identifier) @name)
			(method_declaration name: (identifier) @name)
		`,
	},

	swift: {
		wasmFile: "tree-sitter-swift.wasm",
		query: `
			(class_declaration name: (type_identifier) @name)
			(protocol_declaration name: (type_identifier) @name)
			(function_declaration name: (simple_identifier) @name)
		`,
	},

	dart: {
		wasmFile: "tree-sitter-dart.wasm",
		query: `
			(class_definition name: (identifier) @name)
			(function_signature name: (identifier) @name)
			(enum_declaration name: (identifier) @name)
		`,
	},

	php: {
		wasmFile: "tree-sitter-php.wasm",
		query: `
			(class_declaration name: (name) @name)
			(interface_declaration name: (name) @name)
			(trait_declaration name: (name) @name)
			(function_definition name: (name) @name)
			(namespace_definition name: (namespace_name) @name)
		`,
	},

	csharp: {
		wasmFile: "tree-sitter-c_sharp.wasm",
		query: `
			(class_declaration name: (identifier) @name)
			(interface_declaration name: (identifier) @name)
			(struct_declaration name: (identifier) @name)
			(enum_declaration name: (identifier) @name)
			(namespace_declaration name: (identifier) @name)
			(method_declaration name: (identifier) @name)
		`,
	},
};

/** Map file extensions to language keys */
const EXTENSION_MAP: Record<string, string> = {
	".ts": "typescript",
	".tsx": "tsx",
	".js": "javascript",
	".jsx": "javascript",
	".mjs": "javascript",
	".cjs": "javascript",
	".py": "python",
	".rb": "ruby",
	".go": "go",
	".rs": "rust",
	".c": "c",
	".h": "c",
	".cpp": "cpp",
	".hpp": "cpp",
	".cc": "cpp",
	".cxx": "cpp",
	".java": "java",
	".swift": "swift",
	".dart": "dart",
	".php": "php",
	".cs": "csharp",
};

// ============================================================================
// Parser management
// ============================================================================

let parserInitialized = false;
const loadedLanguages = new Map<string, Language>();
const compiledQueries = new Map<string, Query>();

/** Resolve path to wasm files from the @repomix/tree-sitter-wasms package */
function getWasmDir(): string {
	const thisDir = dirname(fileURLToPath(import.meta.url));
	// In development: src/ -> node_modules/...
	// In production: dist/ -> node_modules/...
	// Walk up to package root, then into node_modules
	const packageRoot = join(thisDir, "..");
	return join(packageRoot, "node_modules", "@repomix", "tree-sitter-wasms", "out");
}

async function ensureInit(): Promise<void> {
	if (!parserInitialized) {
		await Parser.init();
		parserInitialized = true;
		registerExitHandler();
	}
}

async function getLanguage(langKey: string): Promise<Language | null> {
	const config = LANGUAGES[langKey];
	if (!config) return null;

	const cached = loadedLanguages.get(langKey);
	if (cached) return cached;

	const wasmPath = join(getWasmDir(), config.wasmFile);
	const language = await Language.load(wasmPath);
	loadedLanguages.set(langKey, language);
	return language;
}

function getQuery(langKey: string, language: Language): Query {
	const cached = compiledQueries.get(langKey);
	if (cached) return cached;

	const config = LANGUAGES[langKey];
	if (!config) throw new Error(`No config for language: ${langKey}`);

	const query = new Query(language, config.query);
	compiledQueries.set(langKey, query);
	return query;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Clean up tree-sitter resources.
 * Must be called before process exit to avoid WASM mutex crash.
 */
export function disposeSignatureExtractor(): void {
	for (const query of compiledQueries.values()) {
		query.delete();
	}
	compiledQueries.clear();
	loadedLanguages.clear();
	parserInitialized = false;
}

// Safety net: clean up on process exit to prevent WASM mutex crash
let exitHandlerRegistered = false;
function registerExitHandler(): void {
	if (exitHandlerRegistered) return;
	exitHandlerRegistered = true;
	process.on("exit", () => {
		disposeSignatureExtractor();
	});
}

/**
 * Detect language from file extension.
 * Returns null if the language is not supported.
 */
export function detectLanguage(filePath: string): string | null {
	const dotIndex = filePath.lastIndexOf(".");
	if (dotIndex === -1) return null;
	const ext = filePath.substring(dotIndex).toLowerCase();
	return EXTENSION_MAP[ext] ?? null;
}

/**
 * Get list of supported language keys.
 */
export function supportedLanguages(): string[] {
	return Object.keys(LANGUAGES);
}

/**
 * Extract a structural signature from file content using tree-sitter.
 *
 * Parses the file, runs a language-specific query to find structural
 * declarations, and returns a compact string suitable for embedding.
 *
 * Returns null if the language is not supported.
 */
export async function extractSignature(filePath: string, content: string): Promise<string | null> {
	const langKey = detectLanguage(filePath);
	if (!langKey) return null;

	await ensureInit();

	const language = await getLanguage(langKey);
	if (!language) return null;

	const parser = new Parser();
	parser.setLanguage(language);

	const tree = parser.parse(content);
	if (!tree) {
		parser.delete();
		return null;
	}

	const query = getQuery(langKey, language);

	const captures = query.captures(tree.rootNode);

	const names: string[] = [];
	const seen = new Set<string>();

	for (const capture of captures) {
		const text = capture.node.text.trim();
		if (text && !seen.has(text)) {
			seen.add(text);
			names.push(text);
		}
	}

	tree.delete();
	parser.delete();

	if (names.length === 0) return null;

	return `${filePath} | ${names.join(" | ")}`;
}

/**
 * Extract full declaration lines (not just names) for richer signatures.
 *
 * Instead of just "EventService", returns "export class EventService extends BaseService".
 * Useful when the full declaration line carries more semantic meaning.
 */
export async function extractSignatureLines(filePath: string, content: string): Promise<string | null> {
	const langKey = detectLanguage(filePath);
	if (!langKey) return null;

	await ensureInit();

	const language = await getLanguage(langKey);
	if (!language) return null;

	const parser = new Parser();
	parser.setLanguage(language);

	const tree = parser.parse(content);
	if (!tree) {
		parser.delete();
		return null;
	}

	const query = getQuery(langKey, language);
	const captures = query.captures(tree.rootNode);

	const lines: string[] = [];
	const seen = new Set<number>();

	for (const capture of captures) {
		// Walk up to the declaration node (parent or grandparent of the name node)
		const declNode = findDeclarationAncestor(capture.node);
		if (seen.has(declNode.id)) continue;
		seen.add(declNode.id);

		// Take just the first line of the declaration
		const firstLine = declNode.text.split("\n")[0].trim();
		if (firstLine) {
			lines.push(firstLine);
		}
	}

	tree.delete();
	parser.delete();

	if (lines.length === 0) return null;

	return `${filePath} | ${lines.join(" | ")}`;
}

/**
 * Walk up from a name node to find the enclosing declaration node.
 * Stops at the first node that looks like a declaration (not an identifier/name).
 */
function findDeclarationAncestor(node: Node): Node {
	let current = node;
	while (current.parent) {
		const parentType = current.parent.type;
		// Stop at declaration-level nodes
		if (
			parentType.includes("declaration") ||
			parentType.includes("definition") ||
			parentType.includes("item") ||
			parentType.includes("specifier") ||
			parentType === "export_statement" ||
			parentType === "impl_item" ||
			parentType === "type_declaration" ||
			parentType === "program" ||
			parentType === "module"
		) {
			return current.parent.type === "program" || current.parent.type === "module"
				? current
				: current.parent;
		}
		current = current.parent;
	}
	return current;
}
