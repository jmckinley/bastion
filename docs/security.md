# Security & secrets handling

## Secrets at runtime (never in git)

| Secret | Where it lives | How it's used |
|--------|----------------|---------------|
| LucidLink service-account tokens (`sa_live:…`) | Root-only `connections.json` (chmod 600) on the host; supplied **per request** | Sent as `Authorization: Bearer <token>` to the in-boundary file service, with `X-LucidLink-Filespace` naming the filespace. Never baked into an image or committed |
| Anthropic (cloud BYOK) key | Root-only `/etc/bastion/bastion.env` | Read by the Bastion service only; used solely for public/internal cloud routing |
| Connection records | `connections.json`, chmod 600 | Tokens are **masked** in every API response (`tokenHint: "sa_live:…"`) — the raw token is never returned by the service |

## Sanitization policy for this repository

This repo is shared on a limited basis, so it is sanitized before anything is committed:

- No `sa_live:` tokens, API keys, passwords, or live host addresses. Code that needs a
  secret reads it from the environment or a root-only file; `sa_live:REPLACE_ME` marks the
  substitution point.
- `.gitignore` excludes `*.rvf`, `*.chunks.json`, `connections.json`, `*.env`, `*sa_live*`,
  and logs — so vector stores (which may embed private content) and connection records
  cannot be committed even accidentally.
- Use `rag-service/connections.example.json` as the shape; create the real
  `connections.json` only on the host.

Before any future commit, run a secret scan:

```bash
grep -rEi 'sa_live:[A-Za-z0-9]{8}|ANTHROPIC_API_KEY *=|-----BEGIN|sk-[A-Za-z0-9]{16}' . \
  --exclude-dir=.git
```

It should return nothing but placeholders.

## Exposure

- The RAG service / console binds **loopback only** (`127.0.0.1:8090`). The LAN cannot
  reach it.
- The only external path is **Tailscale Serve** — a tailnet-only HTTPS route. It is **not**
  a public Funnel; only the operator's own tailnet devices can reach the console.
- Bastion (`:3000`) is likewise in-boundary; model calls do not traverse the public
  internet except the explicit, governed cloud-BYOK path for public/internal work.

## Threats explicitly addressed vs. deferred

Addressed: regulated-content egress (governor + local embeddings), tool-access abuse (MCP
RBAC), unauthenticated exposure (loopback + tailnet-only), tamper-evidence of the decision
record (HMAC-signed audit).

Deferred (named in [`oia-mapping.md`](oia-mapping.md)): hardware-attested execution,
per-user human identity/SSO, mimicry and agent-spoofing defences.
