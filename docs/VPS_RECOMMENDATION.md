# VPS recommendation for the first public MineMine world

Prepared 2026-10-22. This is a proposed starting configuration, not a purchased server or a claim that 16 players have been load tested.

## Recommended first public test host

Use one [DigitalOcean Basic Droplet](https://www.digitalocean.com/pricing/droplets) in `nyc3` (New York City) with **4 shared vCPUs, 8 GiB RAM, 160 GiB SSD, and 5,000 GiB bundled monthly transfer**. DigitalOcean currently lists that configuration at **$48/month**. Add [daily automated backups](https://www.digitalocean.com/products/backups) at **30% of the Droplet price**, or **$14.40/month**. The listed base is therefore **$62.40/month**, before any domain, tax, extra transfer, snapshots, or other services. [DigitalOcean's region table](https://docs.digitalocean.com/platform/regional-availability/) lists Basic Droplets in `nyc3`.

This size is a cautious starting point for one native Luanti process, the Node wallet/API and WebSocket bridge, TLS ingress, and a small persistent world. It is **not** evidence of 16-player capacity; measure concurrent players and resize based on CPU, tick time, RAM, egress and disk use. The VM's CPU is shared, so sustained game tick performance needs direct measurement.

For a short closed alpha, the same [pricing table](https://www.digitalocean.com/pricing/droplets) lists **2 shared vCPUs, 4 GiB RAM, 80 GiB SSD, and 4,000 GiB transfer at $24/month**; daily backups add $7.20, giving a **$31.20/month** listed base. This is the lower-cost validation option, with a resize before opening to a larger audience if measurements call for it. Do not infer player capacity from RAM and vCPU labels alone.

## Single-host layout

1. Serve the MineMine landing, `/play/` browser bundle, wallet/API endpoints, and `/game-proxy` from one HTTPS origin, for example `https://minemine.gg`, behind a TLS reverse proxy. Preserve Host and WebSocket upgrade headers and the engine's COOP/COEP isolation headers. The current Pages deployment remains the solo playtest until the public stack is ready.
2. Run one Node service bound to `127.0.0.1:3000`, one native Luanti server bound to `127.0.0.1:30000/udp`, and one persistent SQLite-backed world. Expose SSH, HTTPS 443, and HTTP 80 for [automatic TLS certificate issuance and redirects](https://caddyserver.com/docs/quick-starts/https) at the VM firewall; keep Node and native UDP private. The browser's `10.0.0.1` address is virtual; the Node bridge sends only to the loopback game port.
3. Use a dedicated unprivileged service account for Node and Luanti so the private `wallet_grants` and `town_quotas` directories can be shared without putting them under the web root. Keep one Node process until sessions and grants have durable coordination.
4. Enable daily provider backups and a separate application-level stopped-world backup with a tested restore. Provider disk images alone do not demonstrate an application-consistent SQLite restore. Retain build manifests and private configuration separately from the world.
5. Begin with one region and no load balancer, CDN split origin, or SpacetimeDB node. Add components only after the first remote-browser and 16-player measurements identify a bottleneck.

## Provisioning and launch gates

The account owner needs to select and authorize the spending account, confirm the monthly budget and region, and provide SSH and domain/DNS access through an approved secure channel. No VM, domain, DNS record, testnet token, or paid service has been created by this recommendation.

Before enabling the shared-world button or announcing the URL, verify:

- The deployment uses the credential-safe WASM artifact and hash-checked static assets; TLS, WSS, COOP/COEP and browser features work from an outside network.
- Two distinct wallet browsers join the public world, see each other's edits, reconnect to the same character and inventory, and cannot register or elevate privilege outside wallet auth.
- Town quotas reflect confirmed testnet purchases; owner/member/outsider dig and place behavior survives restart.
- Automated backups, a stopped-world restore, process restarts, log/metric collection, disk alerts, and a 16-client load test pass with recorded CPU, RAM, tick time and egress.

This host recommendation is for the first native-server milestone. The [SpacetimeDB plan](SPACETIMEDB.md) is a later architecture decision after native-world measurements.
