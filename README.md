# pi-recall

Long-term memory for the pi coding agent.

When the agent reads a file, pi-recall triggers a "deja vu" moment: it extracts the file's structural signature (class names, module declarations, function signatures), searches a local vector database for semantically similar memories, and injects them into the read result. The agent just... remembers.

## How it works

### The problem

Coding agents forget everything between sessions. Every time you start a new session, the agent has no idea that "the events table always soft-deletes" or "we stopped using raw SQL last month." A human developer would remember these things. An agent doesn't.

### The solution

pi-recall gives the agent a persistent memory that surfaces automatically when relevant — no explicit recall needed.

**Writing memories** (end of session):

```
Session messages (not tool calls)
    ↓
LLM extracts durable facts
    ("the events table uses soft-deletes, never hard-delete")
    ("cascade deletes are disabled on event_attendees FK")
    ↓
Embed each fact → store in sqlite-vec
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
    - never hard-delete from this table (2025-01-15)
    - the updated_at trigger was added to fix audit gaps (2025-01-28)
    </memory>
```

The agent reads a file and *remembers things about it*. Not because it was told to look — because the act of looking triggered recall. Like walking into a room and having deja vu.

### Why `read` is the right trigger

User messages are vague: "fix the bug", "update the tests." Hard to match against memories.

File contents are concrete. When the agent reads `schema/events.sql`, that's a precise signal. Memories stored against similar content will have strong similarity matches. And `read` is the only channel through which the agent learns about the codebase — every exploration passes through it.

### Why semantic, not path-based

Files move, get renamed, get deleted. A memory keyed to `src/db/events.ts` breaks when the file becomes `src/models/event-repository.ts`. But a memory about "soft-delete logic for event records" matches against any file that talks about events and deletion, regardless of where it lives.

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

### Two extraction modes

**`extractSignature`** — compact, name-only:

```
src/events.ts | EventService | EventRepository | UserId | createUserService
```

**`extractSignatureLines`** — full declaration first lines:

```
src/events.ts | class EventService extends BaseService { | interface EventRepository {
```

Returns `null` for unsupported file types.

## Architecture

```
~/.pi-recall/
  <project-hash>/
    memories.db          # sqlite-vec database
```

### Components

| Component | Status | Description |
|-----------|--------|-------------|
| **Signature extractor** | Done | Tree-sitter based, 14 languages |
| **Embedder** | Stub | Local model (all-MiniLM-L6-v2 via ONNX) or API-based |
| **Vector store** | Stub | sqlite-vec for storage and similarity search |
| **Memory extractor** | Stub | LLM-based session analysis to extract durable facts |
| **Read interceptor** | Not started | Hooks into the agent's `read` tool to inject memories |
| **Memory search tool** | Not started | `memory_search(query)` for explicit agent-initiated recall |

### Memory retrieval paths

```
sqlite-vec (single store)
    ↑              ↑              ↑
    |              |              |
on read        on message     memory_search tool
(deja vu)      (kung fu)      (explicit recall)
```

- **On read** (primary) — every `read` call triggers signature extraction, embedding, and memory lookup
- **On message** (optional) — embed user message, inject top-k memories into system prompt
- **Memory search** (explicit) — agent tool for deliberate recall when exploring unfamiliar code

## Development

```bash
npm install
npm run check    # typecheck
npm test         # run tests
```

## License

MIT
