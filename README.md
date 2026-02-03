# pi-recall

Long-term memory for the [pi coding agent](https://github.com/badlogic/pi-mono).

When the agent reads a file, pi-recall triggers a "deja vu" moment: it extracts the file's structural signature (class names, module declarations, function signatures), searches a local vector database for semantically similar memories, and injects them into the read result. The agent just... remembers.

## Install

```bash
cd ~/Code  # or wherever you keep projects
git clone <this-repo> pi-recall
cd pi-recall
npm install

# Symlink into pi's extension directory
mkdir -p ~/.pi/agent/extensions
ln -s $(pwd) ~/.pi/agent/extensions/pi-recall
```

That's it. Next time you start pi, the extension loads automatically.

## How it works

### The problem

Coding agents forget everything between sessions. Every time you start a new session, the agent has no idea that "the events table always soft-deletes" or "we stopped using raw SQL last month." A human developer would remember these things. An agent doesn't.

### The solution

pi-recall gives the agent a persistent memory that surfaces automatically when relevant — no explicit recall needed.

**Writing memories** (end of session):

```
Session messages (not tool calls)
    ↓
LLM extracts durable facts (using the agent's own model)
    ("the events table uses soft-deletes, never hard-delete")
    ("cascade deletes are disabled on event_attendees FK")
    ↓
Embed each fact → deduplicate → store in sqlite-vec
```

**Recalling memories** (on every file read):

```
Agent calls read("schema/events.sql")
    ↓
Parse file with tree-sitter → extract structural signature
    ("schema/events.sql | events | event_attendees | idx_events_deleted_at")
    ↓
Embed signature → query sqlite-vec (similarity threshold)
    ↓
Matching memories appended to read result:
    <memory>
    - never hard-delete from this table
    - the updated_at trigger was added to fix audit gaps
    </memory>
```

The agent reads a file and *remembers things about it*. Not because it was told to look — because the act of looking triggered recall. Like walking into a room and having deja vu.

### Why `read` is the right trigger

User messages are vague: "fix the bug", "update the tests." Hard to match against memories.

File contents are concrete. When the agent reads `schema/events.sql`, that's a precise signal. Memories stored against similar content will have strong similarity matches. And `read` is the only channel through which the agent learns about the codebase — every exploration passes through it.

### Why semantic, not path-based

Files move, get renamed, get deleted. A memory keyed to `src/db/events.ts` breaks when the file becomes `src/models/event-repository.ts`. But a memory about "soft-delete logic for event records" matches against any file that talks about events and deletion, regardless of where it lives.

## Usage

### Commands

| Command | Description |
|---------|-------------|
| `/remember <fact>` | Manually store a memory |
| `/memories` | List all stored memories |
| `/forget <id>` | Delete a memory by ID |

### Agent tool

The agent also has a `memory_search` tool it can use on its own when it wants to actively search for prior context (e.g., "let me check if there's anything about this...").

### Automatic extraction

When a session ends, pi-recall analyzes the conversation using the agent's current model and extracts durable facts — architectural decisions, corrections, conventions, gotchas, domain rules. These are embedded and stored automatically for future sessions.

New memories are deduplicated at the embedding level: if a newly extracted fact is >0.9 cosine similarity to an existing memory, it's skipped.

## Signature extraction

pi-recall uses [tree-sitter](https://tree-sitter.github.io/) (via [web-tree-sitter](https://www.npmjs.com/package/web-tree-sitter) WASM) to parse source files and extract structural declarations. This produces a compact, semantically rich string for embedding.

### Supported languages

TypeScript, TSX, JavaScript, Python, Ruby, Go, Rust, C, C++, Java, Swift, Dart, PHP, C#

### What gets extracted

| Language | Extracted declarations |
|----------|----------------------|
| TypeScript/JavaScript | classes, interfaces, types, enums, functions, exported constants |
| Python | classes, functions |
| Ruby | modules, classes, methods |
| Go | package name, types (struct/interface), functions, methods |
| Rust | modules, structs, enums, traits, impls, functions, type aliases |
| C/C++ | structs, enums, typedefs, functions, namespaces (C++), classes (C++) |
| Java | packages, classes, interfaces, enums, methods |
| Swift | classes, protocols, functions |
| Dart | classes, functions, enums |
| PHP | namespaces, classes, interfaces, traits, functions |
| C# | namespaces, classes, interfaces, structs, enums, methods |

Unsupported file types are silently skipped — no memory lookup occurs.

## Architecture

### Storage

Each project gets its own database, keyed by a hash of the working directory:

```
~/.pi-recall/
  <project-hash>/
    memories.db          # sqlite-vec database
```

### Components

| Component | Description |
|-----------|-------------|
| **Signature extractor** | Tree-sitter WASM, 14 languages, extracts structural declarations |
| **Embedder** | Local ONNX model (all-MiniLM-L6-v2), 384-dim, ~5ms/embed |
| **Vector store** | better-sqlite3 + sqlite-vec, cosine similarity via L2 conversion |
| **Memory extractor** | LLM-based session analysis, provider-agnostic |
| **Extension** | pi extension that ties it all together |

### Memory retrieval paths

```
sqlite-vec (single store)
    ↑                    ↑
    |                    |
on read              memory_search tool
(deja vu)            (explicit recall)
```

- **On read** (automatic) — every `read` of a supported file triggers signature extraction, embedding, and memory lookup
- **Memory search** (explicit) — agent tool for deliberate recall

### Performance

| Operation | Time |
|-----------|------|
| Embedder cold start (first use per session) | ~150ms |
| Embedding per text | ~5ms |
| Signature extraction per file | ~5-30ms |
| Vector search | <1ms |
| Total overhead per `read` | ~10-35ms |

The embedder initializes lazily on first `read` of a supported file. Subsequent reads in the same session reuse the cached model.

## Configuration

Constants in `src/extension.ts`:

| Constant | Default | Description |
|----------|---------|-------------|
| `SIMILARITY_THRESHOLD` | 0.3 | Minimum cosine similarity to surface a memory |
| `DEDUP_THRESHOLD` | 0.9 | Above this, a new memory is considered a duplicate |
| `MAX_MEMORIES_PER_READ` | 5 | Maximum memories injected per file read |
| `MAX_MEMORIES_PER_SESSION` | 20 | Maximum memories extracted per session end |

## Known issues

- Memory blocks appear in the read tool output in the UI. The agent sees them (which is the point) but they can be visually noisy. A future version may hide them from the UI while keeping them visible to the LLM.

## Development

```bash
npm install
npm run check    # typecheck
npm test         # run tests (45 tests across 5 suites)
```

## License

MIT
