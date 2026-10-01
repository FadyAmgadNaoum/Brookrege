#!/usr/bin/env python3
"""
Prepares the monitoring configuration for one installation.

    python3 infra/monitoring/configure.py --topology cluster --env .env.monitoring

Reads settings from the env file (see .env.monitoring.example), then writes infra/monitoring/generated/:
  targets/*.yml        scrape targets for the chosen topology (single server or 3-server cluster)
  targets/blackbox-http.yml   the public URLs to check, from PUBLIC_DOMAIN / ADMIN_DOMAIN
  alertmanager.yml     notification routing (email always; Slack / Telegram / heartbeat when configured)

Secrets are NOT in the env file. Put each one in its own file (chmod 600) in SECRETS_DIR
(default /etc/brookrege/monitoring/secrets):
  smtp_password (required) · slack_webhook_url · telegram_bot_token · heartbeat_url · grafana_admin_password (required)
"""
import argparse, os, pathlib, re, shutil, sys

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "generated"

def read_env(path):
    env = {}
    for n, line in enumerate(pathlib.Path(path).read_text().splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            sys.exit(f"{path}:{n}: expected KEY=value")
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env

def render(template, values, flags):
    out, keep = [], [True]
    for line in template.splitlines():
        m = re.match(r"^#if (\w+)$", line.strip())
        if m:
            keep.append(keep[-1] and flags.get(m.group(1), False)); continue
        if line.strip() == "#endif":
            keep.pop(); continue
        if keep[-1]:
            out.append(line)
    text = "\n".join(out) + "\n"
    missing = sorted(set(re.findall(r"\{\{([A-Z_]+)\}\}", text)) - set(values))
    if missing:
        sys.exit("Missing settings: " + ", ".join(missing))
    return re.sub(r"\{\{([A-Z_]+)\}\}", lambda m: values[m.group(1)], text)

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--topology", choices=["single", "cluster"], required=True)
    ap.add_argument("--env", default=str(HERE.parent.parent / ".env.monitoring"))
    ap.add_argument("--secrets-dir", default=None)
    ap.add_argument("--skip-secret-check", action="store_true", help="for CI / local testing")
    a = ap.parse_args()

    env = read_env(a.env)
    secrets = pathlib.Path(a.secrets_dir or env.get("SECRETS_DIR", "/etc/brookrege/monitoring/secrets"))
    for k in ["PUBLIC_DOMAIN", "ADMIN_DOMAIN", "ALERT_EMAIL_TO", "ALERT_EMAIL_FROM", "SMTP_HOST", "SMTP_PORT", "SMTP_USER"]:
        if not env.get(k):
            sys.exit(f"{k} is required in {a.env}")
    for k in ["PUBLIC_DOMAIN", "ADMIN_DOMAIN"]:
        if not re.fullmatch(r"[a-z0-9.-]+\.[a-z]{2,}", env[k]):
            sys.exit(f"{k} doesn't look like a domain: {env[k]}")

    has = lambda name: (secrets / name).is_file()
    flags = {"SLACK": has("slack_webhook_url"), "TELEGRAM": has("telegram_bot_token") and bool(env.get("TELEGRAM_CHAT_ID")), "HEARTBEAT": has("heartbeat_url")}
    if flags["SLACK"] and not env.get("SLACK_CHANNEL"):
        env["SLACK_CHANNEL"] = "#alerts"
    if not a.skip_secret_check:
        for req in ["smtp_password", "grafana_admin_password"]:
            if not has(req):
                sys.exit(f"Missing secret file {secrets / req}")
        for f in secrets.glob("*"):
            if f.stat().st_mode & 0o077:
                print(f"warning: {f} is readable by other users — run: chmod 600 {f}")

    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "targets").mkdir(parents=True)
    for f in (HERE / "prometheus" / "targets" / a.topology).glob("*.yml"):
        shutil.copy(f, OUT / "targets" / f.name)
    pub, adm = env["PUBLIC_DOMAIN"], env["ADMIN_DOMAIN"]
    (OUT / "targets" / "blackbox-http.yml").write_text(
        "# The pages a visitor would open (checked through Cloudflare every 30 s).\n"
        f"- targets:\n    - https://{pub}/ar\n    - https://{pub}/en\n    - https://{pub}/api/health\n    - https://{adm}/login\n"
        "  labels: { server: public }\n")
    (OUT / "alertmanager.yml").write_text(render((HERE / "alertmanager" / "alertmanager.template.yml").read_text(), env, flags))
    print(f"✓ generated/ written for topology={a.topology}; notifications: email"
          + "".join(f", {k.lower()}" for k, v in flags.items() if v))

if __name__ == "__main__":
    main()
