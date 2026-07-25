# The sovereignty model — where the guarantee actually lives

The stack makes one hard promise: **confidential and regulated content is answered
in-boundary and never egresses to a third-party model.** This document states precisely
what does and does not deliver that promise, so the guarantee can be defended to a skeptic.

## What does *not* provide sovereignty

- **Streaming is not egress control.** Streaming a file from LucidLink (or anywhere) is a
  transport choice. The bytes still arrive in a process that could send them anywhere.
  Streaming reduces *at-rest copies*; it does not, by itself, keep anything in-boundary.
- **Vectors are not safe anonymization.** Embeddings can be inverted to recover
  approximate source text (embedding-inversion). Treating "we only stored vectors" as
  anonymization is a mistake. Vectors of confidential text are themselves confidential.
- **A cloud model with a good contract is not sovereignty.** A contractual promise is
  *trust granted*, not *trust verified*. The architecture must not depend on it for
  regulated content.

## The two gates that *do* provide sovereignty

1. **Local embeddings.** Raw text is vectorized **in-process** by RuVector's ONNX MiniLM
   (`all-MiniLM-L6-v2`, 384-dim, WASM/SIMD). No embedding API is called. The raw text is
   never sent out to be turned into vectors — closing the most common silent egress in RAG
   systems.

2. **A governor over the augmented prompt.** This is the decisive gate. In RAG, the
   retrieved chunk text is placed **into the prompt**. So whatever governs the prompt
   governs the confidential content. Bastion classifies the augmented prompt's sensitivity
   and, under `routingStrategy = sovereignty`, **forces a confidential/regulated query onto
   an in-boundary model (`gpt-oss-120b`) and blocks the cloud path — even when a cloud key
   is present and a cloud model would be more capable.**

Everything else in the stack exists to feed these two gates sovereign context and to prove,
afterward, that they held.

## Where LucidLink fits

LucidLink's value in this design is **minimal at-rest copies and client-side encryption**,
not sovereignty by itself. It is the in-boundary source layer the pipeline streams from; it
is not the thing that keeps a regulated answer off the cloud. The governor does that.

## What "proven" means here

- A **regulated** query is answered by `gpt-oss-120b` on the `customer` boundary at **$0**,
  and the cloud path is **blocked even when a cloud key is available**.
- A **public** query is allowed to reach cloud Claude (BYOK) — the difference is a
  governance decision, recorded in the signed audit chain.
- A private business deck, streamed from in-boundary storage and embedded locally, is
  answered with inline citations under the same regulated verdict.
- The `prove:no-leak` check passes.

## Honest boundary of the claim

The guarantee is **governance-enforced and audit-recorded**, not yet **hardware-attested**.
The stack proves *that it decided correctly and recorded the decision*; it does not yet
prove *that the execution ran inside a hardware-verified enclave* (OIA Verifiability span,
Layer 1 — roadmap). That distinction is stated plainly rather than blurred. See
[`oia-mapping.md`](oia-mapping.md).
