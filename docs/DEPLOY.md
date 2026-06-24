# Deploying the ACG MCP server (CI/CD)

`git push` to `main` → GitHub Actions builds the MCP server, ships the artifact
to the Hetzner box, atomically swaps it in, restarts, and health-checks — with
automatic rollback. No more manual `git pull`/recopy.

Pipeline: [`.github/workflows/deploy-mcp.yml`](../.github/workflows/deploy-mcp.yml).

```
git push ──▶ GitHub Actions (build @acg/core + mcp-server, npm ci --omit=dev,
              assemble artifact + REVISION) ──SSH/rsync──▶ /opt/acg/releases/<rel>/
           ──▶ swap /opt/acg/current symlink ──▶ systemctl restart acg-mcp
           ──▶ health gate (assert /healthz revision == pushed sha) ──▶ ✅ or ⤺ rollback
```

The box **never compiles** (so it can't OOM-kill the co-resident Typesense),
**no secrets** enter CI or the artifact, and rollback is a symlink flip — no
rebuild, no network.

---

## Why this shape (vetted)

Three approaches were designed and adversarially scored: build-in-CI+rsync (8/10,
chosen), build-on-box via SSH (5/10 — building on the 4GB box races Typesense for
RAM and overwrites `dist/` in place while the live process reads it), and
Docker→GHCR (7/10 — adds a Docker daemon + a registry PAT, and bind-to-127.0.0.1
inside a container breaks its own health check). The chosen design wins on the
two constraints that matter here: never compile on the box, add no new box
dependency. The compiled `dist/` requires **none** of `@acg/core`/`@acg/shared`
(they're `import type` only), so a plain `npm ci --omit=dev` against the committed
lockfile is the whole runtime — no vendoring.

---

## Step 0 — Push the repo to GitHub

The repo is `git@github.com:exilonX/ap2.git` but local `main` is ahead/unpushed.
Push it and confirm the **Actions** tab is enabled:

```bash
git push origin main
```

---

## Step 1 — One-time box provisioning (run as an admin over SSH)

```bash
# 1. Users: an unprivileged CI 'deploy' user, and 'acgsvc' the service runs as.
sudo useradd -m -s /bin/bash deploy
sudo useradd -r -s /usr/sbin/nologin acgsvc

# 2. Release tree owned by the deploy user.
sudo mkdir -p /opt/acg/releases
sudo chown -R deploy:deploy /opt/acg

# 3. Secrets dir + tenant registry — created ONCE by admin, never by CI.
#    Readable by the service user only; the deploy user gets NO access.
sudo mkdir -p /etc/acg
sudo tee /etc/acg/tenants.json >/dev/null <<'JSON'
{
  "vtexeurope": { "account": "vtexeurope", "workspace": "acg", "acgAuthToken": "PUT-ADAPTER-acgAuthToken-HERE" }
}
JSON
sudo chown root:acgsvc /etc/acg /etc/acg/tenants.json
sudo chmod 750 /etc/acg
sudo chmod 640 /etc/acg/tenants.json

# Verify the SERVICE user can actually read it (else the registry loads empty
# with an EACCES in the log, and every /mcp request 404s):
sudo -u acgsvc cat /etc/acg/tenants.json
```
> `workspace` = where the ACG adapter is linked (logs showed `acg--vtexeurope`, so `acg`). `acgAuthToken` must match the adapter's `acgAuthToken` app setting in VTEX Admin.
>
> **Full tenant config reference, the ownership/permission model, and troubleshooting (`EACCES`, `Unknown tenant`, …): [TENANTS.md](TENANTS.md).**

### systemd unit
`ExecStart` points at the **symlink**, so a release swap + restart picks up new
code with no unit edit. Hardened so a compromise can't reach Typesense/Caddy.

```bash
sudo tee /etc/systemd/system/acg-mcp.service >/dev/null <<'UNIT'
[Unit]
Description=ACG MCP server (Streamable HTTP)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=acgsvc
Group=acgsvc
WorkingDirectory=/opt/acg/current
ExecStart=/usr/bin/node /opt/acg/current/dist/http.js
Environment=PORT=3000
Environment=HOST=127.0.0.1
Environment=ACG_TENANTS_FILE=/etc/acg/tenants.json
Environment=MCP_ALLOWED_HOSTS=bookmap-search.duckdns.org,localhost,127.0.0.1
Restart=on-failure
RestartSec=2
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/acg
ReadOnlyPaths=/etc/acg

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable acg-mcp     # don't start yet — no release exists until the first deploy
```
> `MCP_ALLOWED_HOSTS` MUST include `bookmap-search.duckdns.org` (the Host Caddy forwards) or `/mcp` 403s. `localhost,127.0.0.1` are included for convenience.

### Narrow sudo (the deploy user may restart ONLY this unit)
```bash
echo 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart acg-mcp, /usr/bin/systemctl status acg-mcp' \
  | sudo tee /etc/sudoers.d/acg-mcp-deploy
sudo chmod 440 /etc/sudoers.d/acg-mcp-deploy
sudo visudo -c
```

### Caddy
Already done — `/mcp* → 127.0.0.1:3000` (see [REMOTE_MCP.md](REMOTE_MCP.md)). No change.

---

## Step 2 — GitHub repo secrets

Generate a **dedicated** deploy key **off the box** (never reuse a personal key):

```bash
ssh-keygen -t ed25519 -f acg-deploy -N '' -C 'gha-deploy-mcp'
```

Install the **public** half on the box, locked to deploy-only use:
```bash
# on the box, as admin:
sudo -u deploy mkdir -p /home/deploy/.ssh && sudo -u deploy chmod 700 /home/deploy/.ssh
# append, prefixed with restrictions:
printf 'no-agent-forwarding,no-port-forwarding,no-X11-forwarding %s\n' "$(cat acg-deploy.pub)" \
  | sudo -u deploy tee -a /home/deploy/.ssh/authorized_keys
sudo -u deploy chmod 600 /home/deploy/.ssh/authorized_keys
```

Capture the box host key (pin it — no trust-on-first-use in CI):
```bash
ssh-keyscan -t ed25519 bookmap-search.duckdns.org
# verify it matches the box's /etc/ssh/ssh_host_ed25519_key.pub before trusting
```

Add under **GitHub → repo → Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `MCP_DEPLOY_SSH_KEY` | contents of the **private** `acg-deploy` file |
| `MCP_SSH_KNOWN_HOSTS` | the `ssh-keyscan` line above |

(Host `bookmap-search.duckdns.org` and user `deploy` are non-secret — they're in the workflow `env`.)

> Optional: create a **`production`** Environment (Settings → Environments) to add a required-reviewer approval gate before each deploy.

---

## Step 3 — First deploy

Push a change under `packages/mcp-server/**` (or run the workflow manually:
Actions → **deploy-mcp** → *Run workflow*). The first run creates
`/opt/acg/releases/<rel>/`, points `current` at it, and starts the service.

Verify end-to-end:
```bash
# through Caddy (the real path):
curl -s https://bookmap-search.duckdns.org/healthz        # {"ok":true,"revision":"<sha>",...}
curl -s https://bookmap-search.duckdns.org/health         # Typesense still fine
```
The connector URL for Claude: **`https://bookmap-search.duckdns.org/mcp/vtexeurope`**.

---

## Operations

**Update** — just `git push` to `main` (changes under `packages/mcp-server/**`).
The Action redeploys and the health gate confirms the new revision is live.

**Rollback (automatic)** — if `/healthz` doesn't report the new sha within ~15s,
the Action repoints `current` to the previous release, restarts, and goes red.

**Rollback (manual)** — on the box:
```bash
ls -1dt /opt/acg/releases/*/          # newest first
sudo ln -sfn /opt/acg/releases/<good-rel> /opt/acg/.next && sudo mv -Tf /opt/acg/.next /opt/acg/current
sudo systemctl restart acg-mcp
```

**Logs / status**
```bash
systemctl status acg-mcp --no-pager
journalctl -u acg-mcp -n 100 --no-pager
```

**Adding a merchant** — edit `/etc/acg/tenants.json` on the box (`sudo`), then
`sudo systemctl restart acg-mcp`. No redeploy needed; their connector URL is
`https://bookmap-search.duckdns.org/mcp/<id>`. See [TENANTS.md](TENANTS.md).

---

## Notes / caveats

- **Not zero-downtime.** `restart` drops in-memory MCP sessions (each holds its
  cart's `orderFormId`) and yields a ~1–2s blip. Fine for this scale; there's no
  graceful drain.
- **Secrets never leave the box.** `/etc/acg/tenants.json` holds the per-merchant
  VTEX tokens and is never read by CI, the artifact, or any log.
- **Path filter.** `@acg/core` is type-only at runtime, so a `core`-only change
  triggers a harmless no-op redeploy (same code, new sha) — not a bug.
