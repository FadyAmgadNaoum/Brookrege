# Phase 2 · Week 5 — Multi-server setup & load balancing

## Topology

```
                         Internet (443)
                              │
                ┌─────────────▼──────────────┐
                │ VPS1  10.0.0.1 + public IP │  Nginx load balancer (least_conn)
                │                            │  PostgreSQL PRIMARY  ─────────┐ streaming
                │                            │  pgBouncer :6432              │ replication
                │                            │  Shared uploads (NFS)         │
                └──────┬──────────────┬──────┘                               │
          WireGuard    │              │     private network 10.0.0.0/24      │
                ┌──────▼─────┐  ┌─────▼──────┐                               │
                │ VPS2       │  │ VPS3       │                               │
                │ 10.0.0.2   │  │ 10.0.0.3   │                               │
                │ api/web/   │  │ api/web/   │                               │
                │ admin      │  │ admin      │                               │
                │ PG REPLICA ◄──┼────────────┼───────────────────────────────┘
                └────────────┘  └────────────┘
```

- **Load balancing:** Nginx on VPS1, `least_conn`, passive health checks (3 failures in 15 s → server skipped for 15 s). A failed GET is retried on the other server automatically; POST/PATCH/DELETE are never retried, so a form is never submitted twice.
- **Database access:** every app query goes through **pgBouncer on VPS1**, which exposes three names for one database:
  - `brookrege` — writes and admin reads, transaction pooling, primary.
  - `brookrege_direct` — migrations, session pooling, primary.
  - `brookrege_ro` — public read-only pages, served by the replica.
  A failover therefore changes one place only.
- **Replica reads:** public listing pages read from the replica. If it becomes unreachable, the API switches those reads to the primary within 10 seconds and switches back when it recovers.
- **Private network:** Hostinger VPS plans don't include a private network between servers, so the three servers are joined with **WireGuard** (encrypted, 10.0.0.x). Postgres, pgBouncer, NFS and the app ports are bound to the WireGuard addresses only, and are never exposed on public IPs.
- **Photos:** VPS1 shares `/srv/brookrege/uploads` with both app servers over the private network, so a photo uploaded through VPS2 is visible through VPS3. This is replaced by Cloudflare R2 in Week 6.
- **Background job:** listing expiry runs on both app servers, and a database lock ensures it executes once.

## Try it on one computer first

```bash
docker compose -f docker-compose.cluster.yml up --build -d
bash scripts/cluster/run-local-drill.sh
```

This runs all Week 5 tests against a simulation of the three servers (same Postgres setup, pgBouncer image and proxy rules), including a real database failover. Website: http://localhost:8080, admin: http://localhost:8081. On Windows, run the script from Git Bash or WSL.

## Production rollout (in order)

| Step | Where | Command |
|---|---|---|
| 1. Order VPS2 and VPS3 (KVM 2 or larger), Ubuntu 24.04, same datacenter as VPS1 | Hostinger panel | — |
| 2. Harden every server | VPS1, 2, 3 as root | `bash infra/provision/00-harden.sh` |
| 3. Private network — generate keys | each server | `sudo bash infra/provision/10-wireguard.sh keygen` |
| 4. Private network — connect | each server | `sudo bash infra/provision/10-wireguard.sh configure <N> <PUB1> <IP1> <PUB2> <IP2> <PUB3> <IP3>` |
| 5. Check the network | any server | `ping 10.0.0.1; ping 10.0.0.2; ping 10.0.0.3` |
| 6. Server roles | VPS1 / VPS2 / VPS3 | `sudo bash infra/provision/20-vps1.sh` / `20-app-server.sh 2` / `20-app-server.sh 3` |
| 7. Code + secrets on all three | each | `git clone … /opt/brookrege`, then create `/opt/brookrege/.env.cluster` from `.env.cluster.example` (`chmod 600`) |
| 8. Migrate data from the Phase 1 single server | VPS1 | Take a final `pg_dump`, then restore into the new primary (see below) |
| 9. Start VPS1 | VPS1 | `cd infra/servers/vps1 && docker compose --env-file ../../../.env.cluster up -d --build` |
| 10. Start VPS2 (replica clones automatically) | VPS2 | same command in `infra/servers/vps2` |
| 11. Start VPS3 | VPS3 | same command in `infra/servers/vps3` |
| 12. Run the tests | your computer | see below |

**Moving data from Phase 1.** Do this in step 9: start only `postgres` and `pgbouncer` on VPS1, then run:

```
pg_restore -h 127.0.0.1 -U brookrege -d brookrege --no-owner last.dump
```

Then start VPS2 and let the replica clone. Also copy the old `uploads` volume contents into `/srv/brookrege/uploads`.

## Week 5 tests against production

```bash
export CLUSTER_MODE=ssh VPS1_SSH=deploy@<vps1-ip> VPS2_SSH=deploy@<vps2-ip> VPS3_SSH=deploy@<vps3-ip> PUBLIC_DOMAIN=brookrege.com
bash scripts/cluster/test-lb-distribution.sh      # both app servers share traffic, 0 errors
bash scripts/cluster/test-app-failover.sh         # stops VPS2's apps: every request still succeeds; VPS2 rejoins
bash scripts/cluster/test-replication-lag.sh      # replay lag measured by PostgreSQL itself, must be < 1 s
bash scripts/cluster/failover-db.sh --planned     # database switchover drill (schedule a quiet hour)
bash scripts/cluster/reinit-replica.sh            # after any failover: rebuild VPS1's database as the new replica
```

## Database failover — when and how

**Postgres on VPS1 has failed** (crash, disk, corruption) but VPS1 itself is up:

```bash
bash scripts/cluster/failover-db.sh
```

The script:
1. Checks the replica is healthy.
2. Refuses to run if the primary is actually fine.
3. Stops the old primary so there can never be two primaries.
4. Promotes VPS2.
5. Points pgBouncer at it.
6. Verifies a real write.

The apps reconnect by themselves, and no config changes are needed on VPS2 or VPS3. Then run `reinit-replica.sh` to restore redundancy.

**Planned maintenance:** `failover-db.sh --planned` stops the primary cleanly and only promotes once the replica has confirmed every write, so no data is lost.

**Expected data loss in an emergency:** replication is asynchronous, so writes from the last moment before a crash may be missing. With measured lag under 1 second, this is at most about one second of writes.

## Known limit — VPS1 is still a single point of failure

VPS1 carries the load balancer, pgBouncer and the primary database, as the architecture document specifies. If **the whole VPS1 server** goes down, the site is down even though VPS2 and VPS3 are healthy.

Manual recovery takes about 15–30 minutes:
1. Promote the replica on VPS2 directly: `docker compose exec postgres psql -U brookrege -c "SELECT pg_promote()"`.
2. Point VPS2's and VPS3's `DATABASE_URL`, `DIRECT_DATABASE_URL` and `DATABASE_REPLICA_URL` at `10.0.0.2:5432` (drop `pgbouncer=true`).
3. Run Nginx on VPS2 with the same template.
4. Switch the DNS A-record to VPS2. With Cloudflare proxying, this takes effect in seconds.

Removing this weak point needs a second load balancer with a floating IP, or Cloudflare Load Balancing in front of two entry points. That belongs in Phase 4 (production hardening).
