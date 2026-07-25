# The Sovereign AI Stack, mapped to the OIA Reference Model (v0.5)

The [OIA Reference Model](https://github.com/markt-heximal/oia-model) is a vendor-neutral
ten-layer architecture for enterprise intelligent systems — ten layers (0–9), seven
cross-layer spans, three defining properties, and four named threat surfaces — published
by the Agentics Foundation. It is the "OSI of enterprise AI": a shared structural
vocabulary, additive to NIST CSF, NIST AI RMF, MITRE ATLAS, OWASP LLM, and ISO/IEC 42001.

This document reads the Sovereign AI Stack *through* that model. The claim it makes is
deliberately modest and testable: **the stack is close to a reference implementation of the
lower-and-mid layers of the OIA, and the layers it does not implement are named, not
hidden.**

> Using the OIA here is not marketing borrowed from a third party — the OIA is Mark
> Templeton's own reference model. Mapping the stack onto it is a way to state, in a
> vocabulary a CISO or board already reads, exactly what this stack does and does not
> guarantee.

---

## The ten layers

Read bottom-up (Layer 0 is the physical substrate beneath the stack; Layers 1–9 are the
architectural stack).

| Layer | OIA name | Stack component | Fit |
|------:|----------|-----------------|-----|
| **0** | Physical Compute | On-prem **Nutanix host**, **Spark cluster** nodes, **RTX 2000 Ada** GPU (passthrough VM) | **Strong.** All compute is physically on-premises under the operator's control — the origin of the sovereignty posture |
| **1** | Silicon Abstraction | **MiniLM ONNX/WASM** portable embedder (runs across silicon); Ollama/vLLM runtimes | **Partial.** Portable runtime is real; **hardware-attested execution (TEE / Confidential GPU) is roadmap, not deployed** — see gaps |
| **2** | Sovereign Infrastructure | **The boundary itself** — Nutanix + Tailscale, no data egress; the in-boundary daemons | **Strong — the establishing layer.** Sovereignty is established here and threads upward; this is the whole thesis |
| **3** | Agent Data Substrate | **RVF / agenticow** local vector store + **LucidLink in-boundary file service** + per-chunk **sensitivity tags** | **Strong.** Persistent, access-controlled, provenance-bearing data environment with erasure |
| **4** | Model Training & Adaptation | *Out of scope* — the stack **consumes** models, it does not train or fine-tune them | **Not implemented (by design).** Stated honestly; attested fine-tuning would live here if added |
| **5** | Inference & Retrieval | **Bastion** routing to the **self-hosted fleet** (gpt-oss / qwen / llama); **model-as-actor** governance | **Strong.** Inference is governed and boundary-aware; retrieval feeds it |
| **6** | Context & Knowledge | **The RAG pipeline** — local embeddings, hybrid retrieval, provenance-preserving context, sensitivity-tagged chunks | **Strong.** Grounding with lineage preserved into the answer |
| **7** | Orchestration & Workflow | **Bastion trust router** + **MCP RBAC** + policy routing | **Solid.** Tool access is role-gated; routing is the orchestration locus. (Multi-step agent workflows are light today) |
| **8** | Continuity Fabric | **agenticow COW lineage** + **RVF witness chains** (provenance, rollback, GDPR erasure) | **Strong — the single best mapping.** Witness-chained state, branchable/rollbackable memory. (Cross-framework continuity is not attempted) |
| **9** | Human & Browser Interface | **The live console** (tailnet-only) | **Solid.** The human surface; identity is currently tailnet-membership (see spans) |

## The seven cross-layer spans

Spans thread *through* the layers. These are where a governance conversation actually
lands.

| Span | How the stack carries it | Strength |
|------|--------------------------|----------|
| **Sovereignty** (established at L2) | The entire architecture — local embeddings + governed prompt + in-boundary fleet; regulated content has no egress path | **Load-bearing.** This is the stack's reason to exist |
| **Provenance** (origin L3) | RVF witness chains + agenticow `lineage()`; per-chunk source citations carried into the answer | **Strong** |
| **Auditability** (origin L3) | Bastion's **HMAC-signed `audit.jsonl`** — every routing decision recorded with verifiable per-entry hashes | **Strong** |
| **Identity** (L7/L9/L5) | **MCP RBAC** for tool access; **model-as-actor** governance (models chosen by boundary/capability); operator identity via tailnet | **Partial.** Agent/model identity governed; human identity is tailnet-membership, not per-user SSO yet |
| **Verifiability** (anchor L1, new in v0.5) | Witness-chained continuity (L8) and signed audit give *cryptographic recording*; **hardware attestation (L1) is not yet present** | **Partial — honest.** Trust is *recorded and signed*, not yet *hardware-attested* end-to-end |
| **Security** | Governance gates (classify, PII redaction, policy routing, governed search, RBAC) | **Solid** |
| **Energy & Environmental** | Self-hosted fleet on owned hardware makes energy an operator-visible cost; `gpt-oss` held resident | **Present** as an operational property |

## The four named threat surfaces

The OIA names four threat surfaces of the agentic era. The stack addresses two directly and
touches a third:

- **Model compromise** (L5 — *the trusted model that is no longer trustworthy*):
  addressed by **governed routing** — the boundary decision does not depend on trusting a
  third-party model with regulated content, and the fleet is self-hosted and known.
- **Agent-in-the-middle** (L7 — *rogue MCP server between agent and tool*): addressed by
  **MCP RBAC** — tool calls are role-gated through the governor rather than trusted blindly.
- **Mimicry** (L9) and **agent spoofing** (Identity span): **not specifically addressed
  yet** — human-vs-agent liveness and per-agent identity governance are future work.

## The three defining properties

- **Persistence** — held in the two state-holding layers the OIA pairs: **L3** (RVF/agenticow
  substrate) and **L8** (witness-chained continuity fabric). The stack implements both.
- **Autonomy** — light today; orchestration (L7) is routing + RBAC rather than long-running
  autonomous agents. Named as a direction, not a claim.
- **Consequence** — the signed audit chain makes decisions reconstructable *after the fact*,
  which is the OIA's temporal framing of consequence: posture is recorded over time.

## What's honestly missing

Stating the gaps is part of using the model correctly:

1. **No hardware-attested execution (L1 / Verifiability).** Trust is signed and recorded,
   not yet proven by TEE / Confidential GPU. This is the largest gap versus a full
   Verifiability span.
2. **No training/adaptation layer (L4).** The stack consumes models; it does not train or
   attest fine-tuning.
3. **Human identity is coarse (Identity span, L9).** Access is tailnet-membership today, not
   per-user SSO with scoped authority.
4. **Mimicry / agent-spoofing defences (L9 / L7) are absent.** Not yet in scope.
5. **Cross-framework continuity (L8)** — the OIA's hardest open problem — is not attempted;
   agenticow gives continuity *within* the RVF memory, not across arbitrary agent frameworks.

## Verdict

Across Layers 0, 2, 3, 5, 6, and 8 the stack has concrete, working components, and the
Sovereignty, Provenance, and Auditability spans are load-bearing rather than aspirational.
The stack is **close to a reference implementation of the OIA lower-and-mid stack; the gaps
are named, not hidden.**

---

*OIA Reference Model © Agentics Foundation, CC BY 4.0. This mapping is part of the
proprietary Bastion AI project.*
