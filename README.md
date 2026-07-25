# Bastion AI — Sovereign AI Stack for Enterprises

**Use the best AI models without regulated data leaving the boundary.**

Bastion AI is a working, self-hosted sovereign-AI stack running on an on-premises
Nutanix lab. It lets an enterprise put the strongest available models to work on its
most sensitive data while holding a hard architectural guarantee: **confidential and
regulated content is answered entirely in-boundary — it never egresses to a third-party
model.** Public and low-sensitivity work can still reach frontier cloud models (bring your
own key); the difference is decided by governance, not by hope.

The stack pairs a **trust router** (Bastion) that classifies and governs every request
with a **zero-egress RAG pipeline** that streams enterprise documents from in-boundary
storage, embeds them locally, and answers them with a self-hosted model fleet — all
observable through one **live console** served privately over the operator's tailnet.

---

## The thesis in one paragraph

Streaming a file is transport, not egress control. Vectors are not safe anonymization
(embeddings can be inverted). The only durable sovereignty guarantees are (1) **local
embeddings** — raw text is never sent out to be vectorized — and (2) **a governor over
the augmented prompt** — because retrieved chunk text rides inside the prompt, the
governor that classifies sensitivity is the thing that forces a confidential/regulated
query onto an in-boundary model and blocks the cloud path even when a cloud key is
available. Bastion is that governor. Everything else in the stack exists to feed it
sovereign context and to prove, after the fact, that the guarantee held.

## Architecture at a glance

```
                       ┌──────────────────────── the boundary ────────────────────────┐
   operator (tailnet)  │                                                               │
        │              │   ┌─────────────┐      classify + policy      ┌───────────┐   │
        │  HTTPS       │   │   Bastion    │─────  route + audit  ──────▶│  model    │   │
        └── Serve ────▶│   │ trust router │◀── governed /v1 (OpenAI) ───│  fleet    │   │
                       │   │   :3000      │                             │ gpt-oss…  │   │
   ┌───────────────┐   │   └──────┬──────┘                             └───────────┘   │
   │ live console  │───┼──────────┘  ▲ augmented prompt (governed)           ▲          │
   │  :8090 (loop) │   │             │                                       │ public   │
   └───────────────┘   │   ┌─────────┴──────────┐   local MiniLM      ┌──────┴──────┐   │
                       │   │  RAG pipeline       │─── embed (384d) ───▶│  RVF /      │   │
                       │   │  stream→chunk→embed │                     │  agenticow  │   │
                       │   └─────────┬───────────┘                     │  store      │   │
                       │             │ stream (in-boundary)            └─────────────┘   │
                       │   ┌─────────┴───────────┐                                       │
                       │   │ LucidLink file svc  │  (daemon per workspace, FUSE)         │
                       │   └─────────────────────┘                                       │
                       └───────────────────────────────────────────────────────────────┘
                                            cloud (Claude, BYOK) ── only for public/internal
```

See [`docs/architecture.md`](docs/architecture.md) for the full component-by-component
walkthrough and a request-flow diagram.

## Components, and why each is here

| Component | What it does | Why it's in the stack |
|-----------|--------------|-----------------------|
| **Bastion trust router** (`:3000`) | OpenAI-compatible `/v1` gateway that classifies sensitivity, applies policy, routes to the right model, redacts PII (Presidio), governs web search (SearXNG), enforces MCP RBAC, and writes a signed (HMAC) audit chain | It is the single governor. Sovereignty is *established* here — the decision that keeps regulated content in-boundary is made in one auditable place, not scattered across apps |
| **Self-hosted model fleet** | `gpt-oss:120b` (resident), `qwen2.5-32b`, `llama-3.1-70b`, `qwen2.5-7b`, plus cloud Claude via BYOK | Gives the boundary real capability. Regulated work lands on `gpt-oss:120b`; frontier cloud is reachable only for public/internal work |
| **LucidLink in-boundary file service** | Streams enterprise filespaces over FUSE, one daemon per workspace, token per request | Brings the source documents *to* the boundary without bulk-copying them; keeps at-rest copies minimal |
| **RAG pipeline** | stream → chunk → **local** MiniLM embed → RVF/agenticow store → hybrid retrieval → augment → Bastion governs | The zero-egress path: raw text is vectorized locally, and the answer is produced under governance |
| **RuVector RVF + agenticow** | Single-file HNSW vector store with witness-chained provenance; copy-on-write branch/lineage/erasure | The sovereign memory: provenance you can reconstruct and data you can surgically erase (GDPR) |
| **Live console** (`:8090`, tailnet) | One page: Overview, Fleet, Policy, signed Audit, and the Knowledge/RAG workflow — all on real data | Proof and operation in one surface, reachable privately over the tailnet without exposing anything to the LAN or the internet |

## How it's proven

- **Governance:** a regulated/PII query is answered by `gpt-oss-120b` on the `customer`
  boundary at **$0**, with the cloud path **blocked even when a cloud key is available**;
  a public query is allowed to reach cloud Claude. The `prove:no-leak` check passes.
- **Zero-egress RAG:** a private business deck streamed from in-boundary storage was
  chunked, embedded locally, and answered with inline citations — verdict *regulated ·
  gpt-oss-120b · customer · $0*.
- **Live console:** Overview / Fleet / Policy / Audit / Knowledge all read real data
  (audit chain, model registry, router policy).

## Mapping to the OIA Reference Model

This stack is close to a **reference implementation of the lower-and-mid layers of the
[OIA Reference Model](https://github.com/markt-heximal/oia-model) (v0.5)** — the
vendor-neutral ten-layer model for enterprise intelligent systems. Sovereign
Infrastructure (L2), Agent Data Substrate (L3), Inference & Retrieval (L5), Context &
Knowledge (L6), Orchestration (L7), and Continuity Fabric (L8) all have concrete
components here, and the Sovereignty, Provenance, and Auditability spans are load-bearing.
The gaps (no hardware attestation yet; models are consumed, not trained) are named, not
hidden. Full mapping: [`docs/oia-mapping.md`](docs/oia-mapping.md).

## Repository layout

| Path | Contents |
|------|----------|
| [`index.html`](index.html) | The enterprise explainer deck — a single self-contained page, no build step. Published at <https://jmckinley.github.io/bastion/> and also served over the tailnet |
| [`rag-service/`](rag-service/) | The zero-egress RAG service: API + console server, ingest pipeline, retrieval, local embedder |
| [`console/`](console/) | The unified live console (single-page app served by the RAG service) |
| [`lucidlink/`](lucidlink/) | Notes on the in-boundary LucidLink file service (daemon-per-workspace) |
| [`deploy/`](deploy/) | Deployment: systemd units, docker, Tailscale Serve — sanitized examples |
| [`docs/`](docs/) | Architecture, OIA mapping, sovereignty model, security |

## Secrets & sanitization

This repository is **sanitized**. No service-account tokens, API keys, passwords, or live
host addresses are committed. Code that needs a secret reads it from the environment or a
root-only file at runtime (`sa_live:REPLACE_ME` marks where a real token goes). See
[`docs/security.md`](docs/security.md) and [`.gitignore`](.gitignore). Vector stores
(`*.rvf`) and connection records (`connections.json`) are never committed.

---

*Proprietary — Copyright (c) 2026 Mark Templeton. All rights reserved. See [LICENSE](LICENSE).*
