# Caddy Reverse Proxy (Phase B7)

Auto-TLS reverse proxy for iFIND multi-tenant deployment.

## Why Caddy and not nginx?

- Auto Let's Encrypt with zero config (just need DNS pointing to server)
- HTTP/2 + HTTP/3 enabled by default
- Config reload without dropping connections (`caddy reload`)
- Single binary, ~50MB image

## Activation (3 steps)

### 1. DNS records (manual — Alexis)

In your DNS provider (Hostinger, Cloudflare, etc.):

```
Type   Name                 Value
A      ifind-agency.fr      76.13.137.130
A      *.ifind-agency.fr    76.13.137.130   # wildcard for all client subdomains
```

Wait for DNS propagation (use `dig +short *.ifind-agency.fr` to verify).

### 2. Open ports 80 + 443 on the server

On Hostinger VPS firewall (or `ufw allow 80,443/tcp` if using UFW directly).

### 3. Start Caddy

```bash
cd /opt/moltbot
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d caddy
```

Caddy will automatically request Let's Encrypt certs on first request. Watch logs:

```bash
docker compose logs -f caddy
```

## Adding a new client

When a new tenant container is added (e.g. `router-fimmop` on port 9091 in `clients/docker-compose.clients.yml`):

1. Edit `gateway/caddy/Caddyfile` — uncomment / add the stanza:

   ```caddy
   fimmop.ifind-agency.fr {
       encode gzip
       reverse_proxy router-fimmop:9090
       log {
           output file /var/log/caddy/fimmop.log
           format json
       }
   }
   ```

2. Reload Caddy without downtime:

   ```bash
   docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
   ```

3. Verify:

   ```bash
   curl -I https://fimmop.ifind-agency.fr/health
   ```

## Troubleshooting

**Cert issuance fails ("could not solve challenge")**
- Verify DNS propagation: `dig +short fimmop.ifind-agency.fr` returns the right IP
- Verify port 80 reachable from outside (Let's Encrypt does HTTP-01 challenge on port 80)
- Check Caddy logs: `docker compose logs caddy | grep -i acme`

**404 "Unknown host"**
- Subdomain not in Caddyfile — add a stanza and reload
- Or DNS resolves to wrong IP

**Reload doesn't pick up changes**
- Caddyfile syntax error — validate first: `docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile`

## Backup considerations

The `caddy-data` Docker volume contains ACME account state and issued certs.
Losing it means re-issuing all certs on next start (Let's Encrypt rate limit:
50 certs / week / domain). Add to backup-external.sh once Caddy is in prod use.
