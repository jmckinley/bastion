# console

`console.html` — the unified live console (single-page app) served **same-origin** by the
RAG service at loopback `:8090`, exposed to the operator's tailnet via Tailscale Serve
(tailnet-only HTTPS, not Funnel).

Sections, all on real data: **Overview** (KPIs from the signed audit chain), **Fleet**
(models from Bastion's registry), **Policy** (sovereignty strategy + tiers), **Audit**
(HMAC-signed chain with real hashes), and the **Knowledge** workflow (Connections, ingest,
library, retrieval preview, ask-with-citations). Each section degrades to an illustrative
demo mode if its API is unreachable.

The enterprise explainer *deck* is a separate site under [`../site/`](../site/).
