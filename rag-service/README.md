# rag-service

The zero-egress RAG service: the API + live-console server, the ingest pipeline, hybrid
retrieval, and the local embedder. Full walkthrough in
[`../docs/architecture.md`](../docs/architecture.md).

| File | Role |
|------|------|
| `server.mjs` | HTTP service: RAG API + serves the console (`../console/console.html`) same-origin on loopback `:8090`. Endpoints: `/health /connections /browse /ingest /library /forget /retrieval-test /query` + `/overview /fleet /policy /audit` (read Bastion's own audit/config/registry) |
| `ingest.mjs` | CLI wrapper: `LL_BASE=… LL_TOKEN=… STORE_BASE=… SENSITIVITY=… MAX_DEPTH=… node ingest.mjs <filespace>` |
| `ingestlib.mjs` | The ingester: stream (BFS) → per-slide pptx / windowed text extract → local embed → RVF store + citation sidecar. Media skipped; legacy `.ppt` catalogued by metadata; retry-and-backoff on stream drops |
| `embed.mjs` | Local ONNX MiniLM embedder (`all-MiniLM-L6-v2`, 384d, WASM/SIMD) — the local-embeddings sovereignty gate |
| `retrieval.mjs` | Hybrid retrieval: dense + multi-field BM25 + RRF + phrase boost + MMR + distance threshold |
| `ask.mjs` / `rag.mjs` | Retrieve → augment → send to Bastion `/v1` → cited answer with boundary verdict |
| `smoke.mjs` | Store round-trip smoke test |
| `connections.example.json` | Shape of the (git-ignored) `connections.json`; real tokens live only on the host |

## Prerequisites

- Node 22, `npm i agenticow adm-zip ruvector` (RVF native binding + local embedder)
- A running **Bastion** trust router at `BASTION_URL` (default `http://localhost:3000/v1`)
- One or more **LucidLink in-boundary daemons** (see [`../lucidlink/`](../lucidlink/))

## Secrets

Nothing in this directory contains a real secret. `sa_live:REPLACE_ME` marks where a
service-account token is supplied at runtime (env or root-only `connections.json`). See
[`../docs/security.md`](../docs/security.md).
