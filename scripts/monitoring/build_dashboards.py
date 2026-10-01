#!/usr/bin/env python3
"""
Generates the Grafana dashboards in infra/monitoring/grafana/dashboards/ (committed JSON, provisioned
read-only). Edit here and re-run:  python3 scripts/monitoring/build_dashboards.py

Seven dashboards (roadmap Week 13): Overview, Application, Database, Servers & containers, Business,
Security, Background jobs & cache. Every query is also written to dashboards.queries.json so
scripts/monitoring/verify-dashboards.py can run each one against a real Prometheus/Loki.
"""
import json, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "infra" / "monitoring" / "grafana" / "dashboards"
PROM = {"type": "prometheus", "uid": "prometheus"}
LOKI = {"type": "loki", "uid": "loki"}
QUERIES = []

# Brookrege palette (matches the website): palm green, sandstone, and semantic red/amber.
PALM, SAND, RED, AMBER, BLUE, GREY = "#41594F", "#A8875A", "#C4453C", "#D69E2E", "#4A7FA7", "#8A948F"


class Board:
    def __init__(self, uid, title, description, tags, variables=()):
        self.uid, self.title, self.description, self.tags = uid, title, description, tags
        self.panels, self.y, self.x, self.row_h, self.next_id = [], 0, 0, 0, 1
        self.variables = list(variables)

    def _place(self, w, h):
        if self.x + w > 24:
            self.x, self.y, self.row_h = 0, self.y + self.row_h, 0
        pos = {"x": self.x, "y": self.y, "w": w, "h": h}
        self.x += w
        self.row_h = max(self.row_h, h)
        return pos

    def row(self, title):
        if self.x:
            self.x, self.y, self.row_h = 0, self.y + self.row_h, 0
        self.panels.append({"id": self.next_id, "type": "row", "title": title, "collapsed": False, "gridPos": {"x": 0, "y": self.y, "w": 24, "h": 1}, "panels": []})
        self.next_id += 1
        self.y += 1

    def add(self, ptype, title, targets, w=8, h=8, unit=None, description=None, ds=PROM, options=None, field=None):
        panel = {
            "id": self.next_id, "type": ptype, "title": title, "datasource": ds, "gridPos": self._place(w, h),
            "targets": [], "fieldConfig": {"defaults": {}, "overrides": []}, "options": options or {},
        }
        if description:
            panel["description"] = description
        if unit:
            panel["fieldConfig"]["defaults"]["unit"] = unit
        if field:
            panel["fieldConfig"]["defaults"].update(field)
        for i, t in enumerate(targets):
            expr, legend = (t, "") if isinstance(t, str) else t
            ref = chr(65 + i)
            target = {"refId": ref, "expr": expr, "datasource": ds}
            if ds is PROM:
                target["legendFormat"] = legend or "__auto"
                if ptype in ("stat", "gauge", "bargauge", "table"):
                    target["instant"] = True
                    target["range"] = False
            else:
                target["queryType"] = "range"
            panel["targets"].append(target)
            QUERIES.append({"dashboard": self.uid, "panel": title, "datasource": "loki" if ds is LOKI else "prometheus", "expr": expr})
        self.next_id += 1
        self.panels.append(panel)
        return panel

    def ts(self, title, targets, unit=None, w=8, h=8, stack=False, description=None, thresholds=None, ds=PROM):
        field = {"custom": {"lineWidth": 2, "fillOpacity": 12, "showPoints": "never", "stacking": {"mode": "normal" if stack else "none"}}}
        if thresholds:
            field["thresholds"] = {"mode": "absolute", "steps": thresholds}
            field["custom"]["thresholdsStyle"] = {"mode": "line"}
        return self.add("timeseries", title, targets, w, h, unit, description, ds=ds, field=field,
                        options={"legend": {"displayMode": "list", "placement": "bottom"}, "tooltip": {"mode": "multi", "sort": "desc"}})

    def stat(self, title, expr, unit=None, w=4, h=4, steps=None, description=None, color_mode="background", decimals=None, mappings=None):
        field = {"thresholds": {"mode": "absolute", "steps": steps or [{"color": PALM, "value": None}]}, "color": {"mode": "thresholds"}}
        if decimals is not None:
            field["decimals"] = decimals
        if mappings:
            field["mappings"] = mappings
        return self.add("stat", title, [expr], w, h, unit, description, field=field,
                        options={"colorMode": color_mode, "graphMode": "none", "reduceOptions": {"calcs": ["lastNotNull"]}, "textMode": "value"})

    def logs(self, title, expr, w=24, h=10, description=None):
        return self.add("logs", title, [expr], w, h, description=description, ds=LOKI,
                        options={"showTime": True, "wrapLogMessage": True, "sortOrder": "Descending", "enableLogDetails": True})

    def json(self):
        return {
            "uid": self.uid, "title": self.title, "description": self.description, "tags": ["brookrege", *self.tags],
            "timezone": "Africa/Cairo", "schemaVersion": 39, "version": 1, "editable": False, "graphTooltip": 1,
            "time": {"from": "now-6h", "to": "now"}, "refresh": "1m",
            "templating": {"list": self.variables},
            "links": [{"title": "All Brookrege dashboards", "type": "dashboards", "tags": ["brookrege"], "asDropdown": True}],
            "annotations": {"list": []},
            "panels": self.panels,
        }


def server_var(job):
    return {"name": "server", "label": "Server", "type": "query", "datasource": PROM,
            "query": {"query": f'label_values(up{{job="{job}"}}, server)', "refId": "server"},
            "definition": f'label_values(up{{job="{job}"}}, server)', "refresh": 2, "includeAll": True, "multi": True,
            "current": {"text": "All", "value": "$__all"}, "sort": 1}


ok_bad = lambda good, bad: [{"color": RED, "value": None}, {"color": PALM, "value": good}] if good > bad else None
UP_MAP = [{"type": "value", "options": {"0": {"text": "DOWN", "color": RED}, "1": {"text": "UP", "color": PALM}}}]
boards = []

# ───────────────────────── 1. Overview ─────────────────────────
b = Board("brookrege-overview", "Brookrege · Overview", "Is the site healthy right now? Start here.", ["overview"])
b.row("Right now")
b.stat("Website (from outside)", 'min(probe_success{job="blackbox_http"})', w=4, steps=[{"color": RED, "value": None}, {"color": PALM, "value": 1}], mappings=UP_MAP)
b.stat("API servers up", 'sum(up{job="api"})', w=4, steps=[{"color": RED, "value": None}, {"color": AMBER, "value": 1}, {"color": PALM, "value": 2}])
b.stat("Server errors (5xx)", 'max(brookrege:http_errors:ratio5m{job="api"})', unit="percentunit", w=4, decimals=2,
       steps=[{"color": PALM, "value": None}, {"color": AMBER, "value": 0.01}, {"color": RED, "value": 0.05}])
b.stat("API p95 response time", 'max(brookrege:http_latency:p95_5m{job="api"})', unit="s", w=4,
       steps=[{"color": PALM, "value": None}, {"color": AMBER, "value": 0.3}, {"color": RED, "value": 0.5}])
b.stat("Alerts firing", 'count(ALERTS{alertstate="firing", alertname!="Watchdog"}) or vector(0)', w=4,
       steps=[{"color": PALM, "value": None}, {"color": RED, "value": 1}])
b.stat("Last backup", 'time() - max(brookrege_backup_last_success_timestamp_seconds)', unit="s", w=4,
       steps=[{"color": PALM, "value": None}, {"color": AMBER, "value": 26 * 3600}, {"color": RED, "value": 30 * 3600}],
       description="Time since the last successful encrypted backup.")
b.row("Traffic")
b.ts("Requests per second (API)", [('sum by (server) (rate(http_requests_total{job="api"}[$__rate_interval]))', "{{server}}")], unit="reqps", w=12)
b.ts("Page load time from outside", [('probe_duration_seconds{job="blackbox_http"}', "{{instance}}")], unit="s", w=12)
b.row("Leads today")
b.stat("Inquiries (24 h)", 'max(brookrege_leads_last_24h{kind="inquiry"})', w=6, color_mode="value")
b.stat("Property requests (24 h)", 'max(brookrege_leads_last_24h{kind="submission"})', w=6, color_mode="value")
b.stat("Inquiries waiting (NEW)", 'max(brookrege_leads_open{kind="inquiry"})', w=6, color_mode="value",
       steps=[{"color": PALM, "value": None}, {"color": AMBER, "value": 10}, {"color": RED, "value": 25}])
b.stat("Active listings", 'max(brookrege_listings{status="ACTIVE"})', w=6, color_mode="value")
boards.append(b)

# ───────────────────────── 2. Application ─────────────────────────
b = Board("brookrege-application", "Brookrege · Application (API)", "Requests, errors, response times and process health of the API servers and worker.", ["api"], [server_var("api")])
b.row("Requests")
b.ts("Requests per second by status", [('sum by (status) (rate(http_requests_total{job="api", server=~"$server"}[$__rate_interval]))', "{{status}}")], unit="reqps", w=12, stack=True)
b.ts("Server error ratio (5xx)", [('brookrege:http_errors:ratio5m{job="api"}', "all servers")], unit="percentunit", w=12,
     thresholds=[{"color": PALM, "value": None}, {"color": RED, "value": 0.05}])
b.ts("Response time p50 / p95 / p99", [
    ('histogram_quantile(0.5, sum by (le) (rate(http_request_duration_seconds_bucket{job="api", server=~"$server"}[$__rate_interval])))', "p50"),
    ('histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{job="api", server=~"$server"}[$__rate_interval])))', "p95"),
    ('histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket{job="api", server=~"$server"}[$__rate_interval])))', "p99"),
], unit="s", w=12, thresholds=[{"color": PALM, "value": None}, {"color": RED, "value": 0.5}])
b.ts("Slowest routes (p95)", [('topk(8, brookrege:http_latency_route:p95_5m)', "{{route}}")], unit="s", w=12)
b.ts("Busiest routes", [('topk(10, sum by (route) (rate(http_requests_total{job="api", server=~"$server", route!="unmatched"}[$__rate_interval])))', "{{route}}")], unit="reqps", w=12)
b.ts("Requests in flight", [('sum by (server) (http_requests_in_flight{job="api", server=~"$server"})', "{{server}}")], w=12)
b.row("Processes")
b.ts("Memory (RSS)", [('process_resident_memory_bytes{job=~"api|worker", server=~"$server"}', "{{job}} {{server}}")], unit="bytes", w=8)
b.ts("CPU", [('rate(process_cpu_seconds_total{job=~"api|worker", server=~"$server"}[$__rate_interval])', "{{job}} {{server}}")], unit="percentunit", w=8)
b.ts("Event-loop delay p99", [('nodejs_eventloop_lag_p99_seconds{job=~"api|worker", server=~"$server"}', "{{job}} {{server}}")], unit="s", w=8,
     thresholds=[{"color": PALM, "value": None}, {"color": RED, "value": 0.5}])
b.stat("Version running", 'count by (version) (brookrege_app_info)', w=8, color_mode="none",
       description="Number of processes per build version — more than one row during a deploy only.")
b.ts("Restarts (process start time)", [('changes(process_start_time_seconds{job=~"api|worker"}[1h])', "{{job}} {{server}}")], w=16)
b.row("Logs")
b.logs("API errors", '{service=~"api|worker", level="error"}')
boards.append(b)

# ───────────────────────── 3. Database ─────────────────────────
b = Board("brookrege-database", "Brookrege · Database", "PostgreSQL primary and replica: connections, throughput, cache, replication.", ["database"])
b.row("Health")
b.stat("Primary", 'max(pg_up{db_role="primary"})', w=4, mappings=UP_MAP, steps=[{"color": RED, "value": None}, {"color": PALM, "value": 1}])
b.stat("Replica", 'max(pg_up{db_role="replica"}) or vector(0)', w=4, mappings=UP_MAP, steps=[{"color": RED, "value": None}, {"color": PALM, "value": 1}],
       description="0 on a single server (no replica).")
b.stat("Replication lag", 'max(pg_replication_lag_seconds{db_role="replica"}) or vector(0)', unit="s", w=4,
       steps=[{"color": PALM, "value": None}, {"color": AMBER, "value": 10}, {"color": RED, "value": 30}])
b.stat("Connections used", 'max(sum by (server) (pg_stat_activity_count) / on(server) max by (server) (pg_settings_max_connections))', unit="percentunit", w=4,
       steps=[{"color": PALM, "value": None}, {"color": AMBER, "value": 0.6}, {"color": RED, "value": 0.8}])
b.stat("Cache hit ratio", 'sum(rate(pg_stat_database_blks_hit{db_role="primary"}[5m])) / clamp_min(sum(rate(pg_stat_database_blks_hit{db_role="primary"}[5m])) + sum(rate(pg_stat_database_blks_read{db_role="primary"}[5m])), 1)',
       unit="percentunit", w=4, decimals=1, steps=[{"color": RED, "value": None}, {"color": AMBER, "value": 0.9}, {"color": PALM, "value": 0.98}],
       description="Share of reads served from memory. Below 95% means shared_buffers is too small for the data.")
b.stat("Database size", 'max(pg_database_size_bytes{datname!~"template.*|postgres"})', unit="bytes", w=4, color_mode="value")
b.row("Load")
b.ts("Connections by state", [('sum by (server, state) (pg_stat_activity_count{datname!~"template.*"})', "{{server}} {{state}}")], w=12, stack=True)
b.ts("Transactions per second", [
    ('sum by (server) (rate(pg_stat_database_xact_commit[$__rate_interval]))', "{{server}} commits"),
    ('sum by (server) (rate(pg_stat_database_xact_rollback[$__rate_interval]))', "{{server}} rollbacks"),
], unit="ops", w=12)
b.ts("Rows read / written", [
    ('sum by (server) (rate(pg_stat_database_tup_fetched[$__rate_interval]))', "{{server}} fetched"),
    ('sum by (server) (rate(pg_stat_database_tup_inserted[$__rate_interval]) + rate(pg_stat_database_tup_updated[$__rate_interval]) + rate(pg_stat_database_tup_deleted[$__rate_interval]))', "{{server}} written"),
], unit="rowsps", w=12)
b.ts("Replication lag", [('pg_replication_lag_seconds{db_role="replica"}', "{{server}}")], unit="s", w=12,
     thresholds=[{"color": PALM, "value": None}, {"color": RED, "value": 30}])
b.ts("Deadlocks & temp files", [
    ('sum by (server) (increase(pg_stat_database_deadlocks[$__rate_interval]))', "{{server}} deadlocks"),
    ('sum by (server) (increase(pg_stat_database_temp_bytes[$__rate_interval]))', "{{server}} temp bytes"),
], w=12)
b.ts("Reads falling back to the primary", [('1 - min by (server) (brookrege_db_replica_healthy)', "{{server}}")], w=12,
     description="1 = this app server can't use the replica and reads from the primary instead.")
boards.append(b)

# ───────────────────────── 4. Servers & containers ─────────────────────────
b = Board("brookrege-servers", "Brookrege · Servers & containers", "CPU, memory, disk and network of each VPS, and of each container.", ["infrastructure"], [server_var("node")])
b.row("Servers")
b.ts("CPU used", [('brookrege:node_cpu:ratio5m{server=~"$server"}', "{{server}}")], unit="percentunit", w=8,
     thresholds=[{"color": PALM, "value": None}, {"color": RED, "value": 0.9}])
b.ts("Memory available", [('brookrege:node_memory_available:ratio{server=~"$server"}', "{{server}}")], unit="percentunit", w=8,
     thresholds=[{"color": RED, "value": None}, {"color": PALM, "value": 0.1}])
b.ts("Disk free", [('brookrege:node_filesystem_free:ratio{server=~"$server", mountpoint=~"/|/srv.*|/var/lib/docker"}', "{{server}} {{mountpoint}}")], unit="percentunit", w=8,
     thresholds=[{"color": RED, "value": None}, {"color": AMBER, "value": 0.05}, {"color": PALM, "value": 0.15}])
b.ts("Load (1 min) per CPU", [('node_load1{server=~"$server"} / on(server) count by (server) (node_cpu_seconds_total{mode="idle", server=~"$server"})', "{{server}}")], w=8)
b.ts("Network in / out", [
    ('sum by (server) (rate(node_network_receive_bytes_total{device!~"lo|veth.*|docker.*|br-.*", server=~"$server"}[$__rate_interval]))', "{{server}} in"),
    ('- sum by (server) (rate(node_network_transmit_bytes_total{device!~"lo|veth.*|docker.*|br-.*", server=~"$server"}[$__rate_interval]))', "{{server}} out"),
], unit="Bps", w=8)
b.ts("Disk I/O time", [('sum by (server) (rate(node_disk_io_time_seconds_total{server=~"$server"}[$__rate_interval]))', "{{server}}")], unit="percentunit", w=8)
b.row("Containers")
b.ts("Container CPU", [('sum by (server, name) (rate(container_cpu_usage_seconds_total{name!="", server=~"$server"}[$__rate_interval]))', "{{server}} {{name}}")], unit="percentunit", w=12)
b.ts("Container memory", [('sum by (server, name) (container_memory_working_set_bytes{name!="", server=~"$server"})', "{{server}} {{name}}")], unit="bytes", w=12)
b.row("Load balancer (nginx)")
b.ts("Connections", [
    ('sum(nginx_connections_active)', "active"), ('sum(nginx_connections_waiting)', "idle keep-alive"),
], w=12)
b.ts("Requests per second (all sites)", [('sum(rate(nginx_http_requests_total[$__rate_interval]))', "requests")], unit="reqps", w=12)
boards.append(b)

# ───────────────────────── 5. Business ─────────────────────────
b = Board("brookrege-business", "Brookrege · Business", "Listings, leads and customer messages — the numbers the owner cares about.", ["business"])
b.row("Listings")
for st, color in [("ACTIVE", PALM), ("DRAFT", GREY), ("EXPIRED", AMBER), ("SOLD", SAND)]:
    b.stat({"ACTIVE": "Active listings", "DRAFT": "Drafts", "EXPIRED": "Expired", "SOLD": "Sold"}[st], f'max(brookrege_listings{{status="{st}"}})', w=4, color_mode="value", steps=[{"color": color, "value": None}])
b.stat("Expiring within 7 days", 'max(brookrege_listings_expiring_7d)', w=4, color_mode="value", steps=[{"color": PALM, "value": None}, {"color": AMBER, "value": 5}])
b.stat("Uploads processing", 'max(brookrege_media_processing)', w=4, color_mode="value")
b.ts("Listings by status", [('max by (status) (brookrege_listings)', "{{status}}")], w=24, h=7)
b.row("Leads")
b.ts("Leads received per hour", [('sum by (kind) (increase(brookrege_leads_created_total[1h]))', "{{kind}}")], w=12)
b.ts("Leads waiting for a reply (NEW)", [('max by (kind) (brookrege_leads_open)', "{{kind}}")], w=12)
b.ts("Leads in the last 24 h", [('max by (kind) (brookrege_leads_last_24h)', "{{kind}}")], w=12)
b.ts("Messages to customers & staff", [('sum by (channel, status) (increase(brookrege_notifications_total[1h]))', "{{channel}} {{status}}")], w=12, stack=True)
boards.append(b)

# ───────────────────────── 6. Security ─────────────────────────
b = Board("brookrege-security", "Brookrege · Security", "Sign-in attempts, blocked requests, and SSH activity.", ["security"])
b.row("Admin sign-ins")
b.stat("Failed sign-ins (1 h)", 'sum(increase(brookrege_auth_events_total{event=~"login_failed|mfa_failed"}[1h])) or vector(0)', w=6, decimals=0,
       steps=[{"color": PALM, "value": None}, {"color": AMBER, "value": 10}, {"color": RED, "value": 30}])
b.stat("Accounts locked (24 h)", 'sum(increase(brookrege_auth_events_total{event="locked"}[24h])) or vector(0)', w=6, decimals=0,
       steps=[{"color": PALM, "value": None}, {"color": AMBER, "value": 1}])
b.stat("Successful sign-ins (24 h)", 'sum(increase(brookrege_auth_events_total{event="login"}[24h])) or vector(0)', w=6, decimals=0, color_mode="value")
b.stat("Admin sessions now", 'max(brookrege_admin_sessions_active)', w=6, color_mode="value")
b.ts("Sign-in events", [('sum by (event) (increase(brookrege_auth_events_total[$__rate_interval]))', "{{event}}")], w=12, stack=True)
b.ts("Blocked admin requests", [('sum by (reason) (increase(brookrege_security_blocks_total[$__rate_interval]))', "{{reason}}")], w=12,
     description="origin = request from another website (CSRF attempt); ip_allowlist = network not on the allowed list.")
b.row("Web traffic")
b.ts("Refused requests (401 / 403 / 429)", [('sum by (status) (rate(http_requests_total{job="api", status=~"401|403|429"}[$__rate_interval]))', "{{status}}")], unit="reqps", w=12,
     description="429 = rate limited by the API. Nginx and Cloudflare limits appear in their own logs.")
b.ts("Requests answered by nginx, by status class", [('sum by (status_class) (count_over_time({service="nginx"} [$__auto]))', "{{status_class}}")], w=12, ds=LOKI, stack=True)
b.logs("SSH and fail2ban (servers)", '{job="journal"}', h=9)
boards.append(b)

# ───────────────────────── 7. Background jobs & cache ─────────────────────────
b = Board("brookrege-jobs", "Brookrege · Background jobs & cache", "Emails, text messages, video processing, reports; cache efficiency and Redis.", ["jobs", "cache"])
b.row("Job queue")
b.stat("Waiting (due now)", 'max(brookrege_jobs{status="QUEUED"})', w=6, color_mode="value", steps=[{"color": PALM, "value": None}, {"color": AMBER, "value": 50}])
b.stat("Oldest waiting", 'max(brookrege_jobs_oldest_due_seconds)', unit="s", w=6, steps=[{"color": PALM, "value": None}, {"color": AMBER, "value": 120}, {"color": RED, "value": 600}])
b.stat("Running", 'max(brookrege_jobs{status="RUNNING"})', w=6, color_mode="value")
b.stat("Failed (kept 30 days)", 'max(brookrege_jobs{status="FAILED"})', w=6, color_mode="value", steps=[{"color": PALM, "value": None}, {"color": AMBER, "value": 1}])
b.ts("Jobs finished", [('sum by (type, outcome) (increase(brookrege_jobs_processed_total[$__rate_interval]))', "{{type}} {{outcome}}")], w=12, stack=True)
b.ts("Job run time p95", [('histogram_quantile(0.95, sum by (type, le) (rate(brookrege_job_duration_seconds_bucket[$__rate_interval])))', "{{type}}")], unit="s", w=12)
b.row("Cache")
b.ts("Cache hit ratio", [('sum by (level) (rate(brookrege_cache_requests_total{result="hit"}[$__rate_interval])) / clamp_min(sum by (level) (rate(brookrege_cache_requests_total[$__rate_interval])), 0.001)', "{{level}}")],
     unit="percentunit", w=12, description="l1 = memory of each API server; l2 = Redis shared by both.")
b.ts("Redis memory", [('redis_memory_used_bytes', "used"), ('redis_memory_max_bytes', "limit")], unit="bytes", w=12)
b.ts("Redis commands per second", [('sum(rate(redis_commands_processed_total[$__rate_interval]))', "commands")], unit="ops", w=12)
b.ts("Redis evictions & expirations", [('rate(redis_evicted_keys_total[$__rate_interval])', "evicted"), ('rate(redis_expired_keys_total[$__rate_interval])', "expired")], unit="ops", w=12)
b.row("Logs")
b.logs("Worker log", '{service="worker"}')
boards.append(b)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    for board in boards:
        (OUT / f"{board.uid}.json").write_text(json.dumps(board.json(), indent=2, ensure_ascii=False) + "\n")
    (ROOT / "infra" / "monitoring" / "grafana" / "dashboards.queries.json").write_text(json.dumps(QUERIES, indent=1) + "\n")
    print(f"✓ {len(boards)} dashboards, {sum(len([p for p in b.panels if p['type'] != 'row']) for b in boards)} panels, {len(QUERIES)} queries → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
