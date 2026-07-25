# Deployment

How the Sovereign AI Stack runs on the control-plane host (`bastion-01`, an on-prem Nutanix
VM: x86_64, Docker, Node 22). All example files here are **sanitized** — secrets are
referenced via a root-only `EnvironmentFile`, never included.

## Processes

| Unit / container | Bind | Role |
|------------------|------|------|
| `bastion.service` (systemd) | `:3000` | The trust router (OpenAI-compatible `/v1`, governed) |
| `sovereign-rag.service` (systemd) | `127.0.0.1:8090` **loopback** | The RAG API + the live console (served same-origin) |
| `lucidlink-fileservice` (docker) | `:8000` | LucidLink **my-cloud** workspace daemon (FUSE) |
| `lucidlink-fs-media` (docker) | `:8001` | LucidLink **media** workspace daemon (FUSE) |
| `lucidlink-api` (docker) | `:3003` | LucidLink management API |

## Docker (LucidLink daemons)

The LucidLink SDK mounts a filespace via FUSE, so each daemon container needs:

```yaml
# docker/docker-compose.override.yml (shape only)
services:
  fileservice:
    devices: ["/dev/fuse"]
    cap_add: ["SYS_ADMIN"]
    security_opt: ["apparmor:unconfined"]
    env_file: .env
```

One **daemon per workspace** (the SDK is single-workspace — see
[`../lucidlink/README.md`](../lucidlink/README.md)). On a standard Docker host without the
compose plugin, install `docker-compose-v2`.

## Tailscale Serve (console over the tailnet)

The console is exposed to the operator's tailnet only — **Serve, not Funnel** (a sovereign
console must not touch the public internet):

```bash
tailscale up --ssh --hostname=bastion-01 --accept-routes   # one-time, join the tailnet
tailscale serve --bg 8090                                  # front loopback :8090 over HTTPS
tailscale serve status                                     # -> https://bastion-01.<tailnet>.ts.net (tailnet only)
```

`tailscaled` is enabled on boot and the Serve config persists, so the route survives
reboots. The service itself stays bound to `127.0.0.1`, so the only path in is the
tailnet-authenticated HTTPS route.

## Example unit files

- [`bastion.service.example`](bastion.service.example)
- [`sovereign-rag.service.example`](sovereign-rag.service.example)

Copy to `/etc/systemd/system/`, drop the `.example` suffix, adjust paths, provide the
root-only `EnvironmentFile`, then `systemctl daemon-reload && systemctl enable --now <unit>`.

## Reboot / recovery notes

- Bring the LucidLink daemon containers up before the RAG service (it reads them at ingest).
- If the console 404s at `/`, the static route may have been dropped from `server.mjs` —
  re-add the `GET /` → `console.html` route and `systemctl restart sovereign-rag`.
- `gpt-oss:120b` is held resident on its host (`OLLAMA_KEEP_ALIVE=-1`) so the sovereign path
  has no cold start.
