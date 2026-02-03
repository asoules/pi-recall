# pi-recall

Long-term memory for the pi coding agent.

When the agent reads a file, pi-recall triggers a "deja vu" moment: it extracts the file's structural signature (class names, module declarations, function signatures), searches a local vector database for semantically similar memories, and injects them into the read result. The agent just... remembers.

## Design

### Write path (session end)

1. Analyze session messages (not tool calls) for durable learnings
2. LLM extracts facts a developer would remember ("the events table always soft-deletes")
3. Embed each fact and store in sqlite-vec

### Read path (on every `read` call)

1. Detect language from file extension
2. Extract structural signature: class/module/function/table names
3. Embed the signature
4. Query sqlite-vec with similarity threshold
5. If matches found, append `<memory>` block to read result

### Explicit recall

A `memory_search(query)` tool for when the agent wants to actively search memory.

## Architecture

```
~/.pi-recall/
  <project-hash>/
    memories.db          # sqlite-vec database
```

### Components

- **Signature extractor** - Language-aware structural identity extraction (regex-based, first-N-lines fallback)
- **Embedder** - Local embedding model (all-MiniLM-L6-v2 via ONNX) or API-based
- **Vector store** - sqlite-vec for storage and similarity search
- **Memory extractor** - LLM-based session analysis to produce durable facts
- **Read interceptor** - Hooks into the agent's read tool to inject memories

## Status

Early design phase.
