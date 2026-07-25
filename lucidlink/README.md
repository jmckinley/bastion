# In-boundary LucidLink file service

The RAG pipeline reads its source documents by **streaming** them from LucidLink filespaces
over a dedicated **in-boundary** file service, rather than bulk-copying data into the
boundary. The service (a FastAPI + LucidLink SDK application) exposes LIST and READ
(utf-8 + binary/base64) over HTTP; the pipeline consumes `/files` and `/files/read`.

> The service is derived from the `markt-heximal/lucidlink-workspace-manager` project and is
> **referenced, not vendored** here. This directory documents how it is deployed and
> consumed in the sovereign path.

## The one non-obvious constraint: daemon-per-workspace

The LucidLink SDK daemon is **single-workspace**. One daemon can serve exactly one LucidLink
*workspace* at a time; pointing it at a second workspace crashes the native library
(`liblucid.so`, in `lucid_sync_all`). This was observed live when a media-workspace token
hit a filespace while the daemon was serving a different workspace.

**Solution:** run **one container/daemon per workspace**, each with its own FUSE mount:

| Container | Port | Workspace | Example filespaces |
|-----------|------|-----------|--------------------|
| `lucidlink-fileservice` | `:8000` | `my-cloud` | agenticow, ai-commander, app-buckets, … |
| `lucidlink-fs-media` | `:8001` | `media` | archive, music, sharefile, video |

A logical "connection" in the console is therefore `{ workspace, service-account token }`,
which maps to its own daemon; the pipeline is told which daemon (`LL_BASE`) and token
(`LL_TOKEN`) to use, plus the filespace as an argument. Nothing is hardcoded.

## Tokens are per-request

The file service does **not** read the token from its environment. Each request must carry:

- `Authorization: Bearer <sa_live token>` — the LucidLink service-account token
- `X-LucidLink-Filespace: <filespace>` — which filespace within the workspace to read

This keeps tokens out of images and out of git; they live only in the root-only
`connections.json` on the host and are supplied per call.

## Container requirements (FUSE)

Because the SDK mounts filespaces via FUSE (`create_daemon()`), each daemon container needs:

```yaml
devices:      ["/dev/fuse"]
cap_add:      ["SYS_ADMIN"]
security_opt: ["apparmor:unconfined"]
env_file:     .env         # minio/mgmt placeholders; the SA token is per-request, not here
```

On a standard Docker host lacking the compose plugin, install `docker-compose-v2`. The
service auto-restarts, which matters because LucidLink connections can drop mid-walk
(`ECONNRESET`); the ingester rides this out with retry-and-backoff.
