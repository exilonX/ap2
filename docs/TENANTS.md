# Configuring tenants (merchants) on the remote MCP server

The remote MCP server is **multi-tenant**: one Node process serves many merchants,
and the merchant is chosen by the URL the customer's Claude connector points at:

```
https://bookmap-search.duckdns.org/mcp/<tenant>     e.g. /mcp/vtexeurope
```

Each tenant maps to a VTEX account + the adapter secret the per-session
`VtexClient` uses. The mapping lives in **one JSON file on the box** —
never in the repo, CI, or the deployed artifact.

- Loader: [`packages/mcp-server/src/tenants.ts`](../packages/mcp-server/src/tenants.ts)
- Consumed at session-init in [`src/http.ts`](../packages/mcp-server/src/http.ts) (`tenants.get(tenant)`)
- Provisioning context: [DEPLOY.md](DEPLOY.md) Step 1

---

## Where it lives

| | |
|---|---|
| **File** | `/etc/acg/tenants.json` |
| **Pointed at by** | `ACG_TENANTS_FILE=/etc/acg/tenants.json` (set in the systemd unit) |
| **Read by** | the service user **`acgsvc`** (the user `acg-mcp.service` runs as) |
| **Edited by** | an **admin (`root`) only** — never CI, never the `deploy` user |

The loader also accepts `ACG_TENANTS_JSON` (inline JSON in an env var) as an
alternative to the file; the file is preferred so secrets aren't in the unit.

---

## File format

A JSON object keyed by **tenant id** (the `<tenant>` in the URL path). Tenant ids
are lower-cased on load, so `/mcp/vtexeurope` matches a `"vtexeurope"` key.

```json
{
  "vtexeurope": {
    "account": "vtexeurope",
    "workspace": "acg",
    "acgAuthToken": "THE-ADAPTER-acgAuthToken"
  }
}
```

| Field | Required | Notes |
|---|---|---|
| `account` | **yes** | VTEX account. A tenant with no `account` is silently skipped. |
| `workspace` | no (default `master`) | Where the ACG adapter is linked. For `vtexeurope` this is **`acg`** (logs show `acg--vtexeurope`), *not* `master`. |
| `acgAuthToken` | yes in practice | Shared secret the MCP server sends to the adapter's `/_v/acg/*` routes. Must equal the adapter's `acgAuthToken` app setting (VTEX Admin → Apps → `vtexeurope.acg-adapter`). The tenant *loads* without it, but every tool call 401s against the adapter. |
| `appKey` / `appToken` | no | Optional VTEX app credentials, only if a tenant needs them. |

> The MCP server talks to the **adapter**, not VTEX directly — so the only secret
> it needs per tenant is `acgAuthToken`. The real VTEX keys stay in the adapter's
> VTEX app settings.

---

## Ownership & permissions — the part that bites

The file holds per-merchant secrets, so it is **owned by `root`, group `acgsvc`,
mode `640`** — and the directory is **`750`**. This means:

| Principal | Dir `/etc/acg` (750) | File `tenants.json` (640) | Why |
|---|---|---|---|
| `root` (admin) | rwx | rw | Only root edits the registry. |
| `acgsvc` (the service) | r-x (can traverse) | r (can read) | The service must *read* it, not write it — a compromised service can't rewrite its own secrets. |
| `deploy` (CI) & others | — | — | CI ships code, never secrets. It has no business reading merchant tokens. |

`root` **owns** (not `acgsvc`) on purpose: the service reads via the **group**, so
even the process running the server can't modify its own secret file.

### Set it exactly like this

```bash
sudo chown root:acgsvc /etc/acg /etc/acg/tenants.json
sudo chmod 750 /etc/acg
sudo chmod 640 /etc/acg/tenants.json
```

### Why `EACCES` happens (and how to confirm the fix)

`[ACG] could not read ACG_TENANTS_FILE (...): EACCES: permission denied` means
the file **exists but `acgsvc` can't read it** — caused by *either* the file not
being group-readable by `acgsvc`, *or* the directory `/etc/acg` not being
traversable (`x`) by `acgsvc`. The commands above fix both.

**The one test that matters** — run the read *as the service user*:

```bash
sudo -u acgsvc cat /etc/acg/tenants.json     # must print the JSON, not "Permission denied"
```

If that prints the JSON, the service will read it too. (This tests Unix perms.
The systemd unit additionally sandboxes the service with `ProtectSystem=strict` +
`ReadOnlyPaths=/etc/acg`, which already grants read access to this path — so once
`sudo -u acgsvc cat` works, the running service works.)

---

## First-time setup (full sequence)

```bash
# 1. Create the dir + file (admin / root)
sudo mkdir -p /etc/acg
sudo tee /etc/acg/tenants.json >/dev/null <<'JSON'
{
  "vtexeurope": { "account": "vtexeurope", "workspace": "acg", "acgAuthToken": "PUT-REAL-TOKEN-HERE" }
}
JSON

# 2. Lock down ownership + perms (see table above)
sudo chown root:acgsvc /etc/acg /etc/acg/tenants.json
sudo chmod 750 /etc/acg
sudo chmod 640 /etc/acg/tenants.json

# 3. Prove the service user can read it
sudo -u acgsvc cat /etc/acg/tenants.json

# 4. Restart and confirm the registry loaded
sudo systemctl restart acg-mcp
journalctl -u acg-mcp -n 20 --no-pager | grep -i tenant   # -> [ACG] tenants: vtexeurope
```

---

## Verify end-to-end

```bash
# Registry loaded? (through Caddy, from anywhere)
curl -s https://bookmap-search.duckdns.org/healthz
# -> {"ok":true,"revision":"<sha>","sessions":0,"tenants":["vtexeurope"]}

# MCP handshake reaches the right tenant (returns an initialize result + an
# Mcp-Session-Id response header, NOT a 404 "Unknown tenant"):
curl -i -s -X POST https://bookmap-search.duckdns.org/mcp/vtexeurope \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

---

## Add a new merchant

No redeploy needed — the registry is read at process start.

```bash
sudo vim /etc/acg/tenants.json        # add another "<id>": { "account": ..., "workspace": ..., "acgAuthToken": ... }
# keep ownership/perms (a fresh vim write usually preserves them; re-run the chown/chmod if unsure)
sudo chown root:acgsvc /etc/acg/tenants.json && sudo chmod 640 /etc/acg/tenants.json
sudo systemctl restart acg-mcp
curl -s https://bookmap-search.duckdns.org/healthz   # new id appears in "tenants"
```

Their connector URL is `https://bookmap-search.duckdns.org/mcp/<id>`.

---

## Troubleshooting

| Symptom (in `journalctl -u acg-mcp` or `/healthz`) | Cause | Fix |
|---|---|---|
| `EACCES: permission denied` + `"tenants":[]` | File exists but `acgsvc` can't read it (file or dir perms) | `chown root:acgsvc` + `chmod 750` dir / `640` file; verify with `sudo -u acgsvc cat` |
| `ENOENT: no such file` + `"tenants":[]` | File doesn't exist | Create `/etc/acg/tenants.json` (setup above) |
| `... is not valid JSON` + `"tenants":[]` | Malformed JSON (trailing comma, smart quotes from an editor) | Fix JSON; validate: `sudo -u acgsvc cat /etc/acg/tenants.json \| python3 -m json.tool` |
| `"tenants":[]`, no error line | `ACG_TENANTS_FILE` not set on the unit, **or** the tenant has no `account` field | `systemctl show acg-mcp -p Environment`; ensure each entry has `"account"` |
| `404 "Unknown tenant \"vtexeurope\""` on `POST /mcp/vtexeurope` | Registry loaded but that id isn't in it (typo / case) | Check the key exists; ids are lower-cased on load |
| Tenant loads, but tool calls 401/403 against the adapter | `acgAuthToken` is the placeholder or doesn't match the adapter | Set the real `acgAuthToken` from VTEX Admin; restart |

---

## Security notes

- **Secrets live only on the box** in `/etc/acg/tenants.json`. They are never in
  the git repo, the GitHub Actions run, the rsync'd artifact, or any log.
- The **`deploy` (CI) user has no access** to this file — it's outside the
  `acgsvc` group and the file is `640`. CI ships code; it never reads tokens.
- Rotating a merchant's token = edit the file (`root`) + `systemctl restart acg-mcp`.
  No redeploy, no repo change.
