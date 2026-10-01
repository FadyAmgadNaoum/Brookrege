#!/usr/bin/env python3
"""
Offline nginx configuration checker (used in CI and where nginx isn't installed).
Renders the template like the nginx image does (envsubst of the given variables), inlines includes,
then checks: balanced braces, terminated statements, unknown directives, directives in the wrong
context, duplicate single-value directives in one block, and unresolved ${VARIABLES}.
It's not nginx itself — CI also runs `nginx -t` in the real image (see .github/workflows/ci.yml).

usage: check-nginx.py <config> [--root DIR] [--upstreams FILE] [VAR=value ...]
"""
import re, sys, pathlib

# directive → (allowed contexts, repeatable)
H, S, L, U, LIF = "http", "server", "location", "upstream", "if"
D = {
 # http-level
 "server_tokens": ({H,S,L}, False), "client_header_timeout": ({H,S}, False), "client_body_timeout": ({H,S,L}, False),
 "send_timeout": ({H,S,L}, False), "keepalive_timeout": ({H,S,L}, False), "reset_timedout_connection": ({H,S,L}, False),
 "client_header_buffer_size": ({H,S}, False), "large_client_header_buffers": ({H,S}, False),
 "limit_req_status": ({H,S,L}, False), "limit_conn_status": ({H,S,L}, False), "limit_req_zone": ({H}, True),
 "limit_conn_zone": ({H}, True), "set_real_ip_from": ({H,S,L}, True), "real_ip_header": ({H,S,L}, False),
 "real_ip_recursive": ({H,S,L}, False), "log_format": ({H}, True), "access_log": ({H,S,L,LIF}, True),
 "upstream": ({H}, True), "server": ({H,U}, True), "map": ({H}, True), "include": ({H,S,L,U,LIF}, True),
 # upstream
 "least_conn": ({U}, False), "keepalive": ({U}, False), "ip_hash": ({U}, False),
 # server
 "listen": ({S}, True), "server_name": ({S}, False), "http2": ({H,S}, False), "ssl_certificate": ({H,S}, True),
 "ssl_certificate_key": ({H,S}, True), "ssl_protocols": ({H,S}, False), "ssl_session_cache": ({H,S}, False),
 "ssl_session_timeout": ({H,S}, False), "ssl_session_tickets": ({H,S}, False), "ssl_ecdh_curve": ({H,S}, False),
 "ssl_ciphers": ({H,S}, False), "ssl_prefer_server_ciphers": ({H,S}, False), "ssl_reject_handshake": ({H,S}, False),
 "ssl_client_certificate": ({H,S}, False), "ssl_verify_client": ({H,S}, False), "location": ({S,L}, True),
 "limit_conn": ({H,S,L}, True), "client_max_body_size": ({H,S,L}, False), "gzip": ({H,S,L,LIF}, False),
 "gzip_types": ({H,S,L}, False), "root": ({H,S,L,LIF}, False), "alias": ({L}, False), "expires": ({H,S,L,LIF}, False),
 "add_header": ({H,S,L,LIF}, True), "return": ({S,L,LIF}, True), "limit_req": ({H,S,L}, True),
 "proxy_pass": ({L,LIF}, False), "proxy_http_version": ({H,S,L}, False), "proxy_set_header": ({H,S,L}, True),
 "proxy_hide_header": ({H,S,L}, True), "proxy_read_timeout": ({H,S,L}, False), "proxy_send_timeout": ({H,S,L}, False),
 "proxy_connect_timeout": ({H,S,L}, False), "proxy_next_upstream": ({H,S,L}, False), "proxy_next_upstream_tries": ({H,S,L}, False),
 "proxy_next_upstream_timeout": ({H,S,L}, False), "proxy_request_buffering": ({H,S,L}, False), "proxy_buffering": ({H,S,L}, False),
 "proxy_cache_path": ({H}, True), "proxy_cache": ({H,S,L}, False), "proxy_cache_key": ({H,S,L}, False),
 "proxy_cache_methods": ({H,S,L}, False), "proxy_ignore_headers": ({H,S,L}, False), "proxy_cache_valid": ({H,S,L}, True),
 "proxy_cache_bypass": ({H,S,L}, True), "proxy_no_cache": ({H,S,L}, True), "proxy_cache_lock": ({H,S,L}, False),
 "proxy_cache_lock_timeout": ({H,S,L}, False), "proxy_cache_background_update": ({H,S,L}, False), "proxy_cache_use_stale": ({H,S,L}, False),
 "stub_status": ({S,L}, False), "auth_basic": ({H,S,L}, False), "auth_basic_user_file": ({H,S,L}, False), "allow": ({H,S,L}, True), "deny": ({H,S,L}, True), "try_files": ({S,L}, False), "error_page": ({H,S,L,LIF}, True),
}

def tokenize(text, src):
    toks, i, line = [], 0, 1
    while i < len(text):
        c = text[i]
        if c == "\n": line += 1; i += 1; continue
        if c.isspace(): i += 1; continue
        if c == "#":
            while i < len(text) and text[i] != "\n": i += 1
            continue
        if c in "{};": toks.append((c, line, src)); i += 1; continue
        if c in "\"'":
            j = i + 1
            while j < len(text) and text[j] != c:
                if text[j] == "\\": j += 1
                j += 1
            toks.append((text[i:j+1], line, src)); line += text[i:j+1].count("\n"); i = j + 1; continue
        j = i
        while j < len(text) and not text[j].isspace() and text[j] not in "{};" :
            if text[j] == "$" and j + 1 < len(text) and text[j+1] == "{":   # ${VAR} — keep together
                k = text.index("}", j); j = k + 1; continue
            j += 1
        toks.append((text[i:j], line, src)); i = j
    return toks

def main():
    args = sys.argv[1:]
    cfg = pathlib.Path(args[0]); root = pathlib.Path(".") ; upstreams = None; env = {}
    rest = args[1:]; k = 0
    while k < len(rest):
        a = rest[k]
        if a == "--root": root = pathlib.Path(rest[k+1]); k += 2; continue
        if a == "--upstreams": upstreams = pathlib.Path(rest[k+1]); k += 2; continue
        n, v = a.split("=", 1); env[n] = v; k += 1
    errors = []

    def render(path):
        t = path.read_text()
        for n, v in env.items(): t = t.replace("${" + n + "}", v)
        for m in re.finditer(r"\$\{(\w+)\}", t): errors.append(f"{path}: unresolved ${{{m.group(1)}}} (set it in the container environment)")
        return t

    def resolve(inc):
        if inc == "/etc/nginx/upstreams.conf" and upstreams: return upstreams
        m = re.match(r"^/etc/nginx/(snippets|cloudflare)/(.*)$", inc)
        if m: return root / m.group(1) / m.group(2)
        return None

    def expand(inc, src, line):
        """nginx semantics: a wildcard include may match nothing; a plain include must exist."""
        f = resolve(inc)
        if f is None: return []  # nginx built-ins (mime.types etc.)
        if "*" in str(f): return sorted(f.parent.glob(f.name))
        if not f.exists(): errors.append(f"{src}:{line}: include not found: {inc} → {f}"); return []
        return [f]

    def parse(toks, pos, ctx, block_src, depth=0, preseen=None):
        seen = dict(preseen or {})
        while pos < len(toks):
            t, line, src = toks[pos]
            if t == "}":
                return pos + 1
            if t in "{;":
                errors.append(f"{src}:{line}: unexpected '{t}'"); pos += 1; continue
            # read one statement
            words = []; j = pos
            while j < len(toks) and toks[j][0] not in "{};": words.append(toks[j][0]); j += 1
            if j >= len(toks): errors.append(f"{src}:{line}: '{t}' not terminated with ';'"); return j
            name, term = words[0], toks[j][0]
            if term == "}": errors.append(f"{src}:{line}: '{name}' missing ';' before '}}'"); pos = j; continue
            # A directive name on a later line inside the same statement = the previous line lost its ';'.
            for w, wl, _ in toks[pos + 1:j]:
                if wl > line and w in D:
                    errors.append(f"{src}:{line}: '{name}' is missing its ';' (the next line's '{w}' was read as an argument)"); break
            spec = D.get(name)
            if not spec: errors.append(f"{src}:{line}: unknown directive '{name}'")
            elif ctx not in spec[0]: errors.append(f"{src}:{line}: '{name}' not allowed in {ctx} context")
            elif not spec[1]:
                if name in seen: errors.append(f"{src}:{line}: '{name}' is duplicate (first at {seen[name]}) — nginx refuses to start")
                else: seen[name] = f"{src}:{line}"
            if name == "include" and term == ";":
                for f in expand(words[1], src, line):
                    parse_merge(tokenize(render(f), str(f)) + [("}", 0, str(f))], ctx, seen)
                pos = j + 1; continue
            if term == "{":
                newctx = {"server": S, "location": L, "upstream": U, "if": LIF, "map": "map", "http": H}.get(name, name)
                if newctx == "map":  # skip map bodies
                    d = 1; j += 1
                    while d and j < len(toks): d += {"{": 1, "}": -1}.get(toks[j][0], 0); j += 1
                    pos = j; continue
                pos = parse(toks, j + 1, newctx, src, depth + 1); continue
            if len(words) < 2 and name not in ("least_conn", "ip_hash", "stub_status"):
                errors.append(f"{src}:{line}: '{name}' has no value")
            pos = j + 1
        if depth > 0: errors.append(f"{block_src}: unclosed '{{'")
        return pos

    def parse_merge(toks, ctx, seen):
        # included content shares the including block's duplicate tracking
        saved = dict(seen)
        pos = 0
        local = {}
        # re-use parse but merge "seen"
        def p2(toks, pos):
            while pos < len(toks):
                t, line, src = toks[pos]
                if t == "}": return pos + 1
                words = []; j = pos
                while j < len(toks) and toks[j][0] not in "{};": words.append(toks[j][0]); j += 1
                name, term = words[0], toks[j][0]
                spec = D.get(name)
                if term == "{":
                    if name == "map":  # skip map bodies (also when the map comes from an included file)
                        d = 1; j += 1
                        while d and j < len(toks): d += {"{": 1, "}": -1}.get(toks[j][0], 0); j += 1
                        pos = j; continue
                    newctx = {"server": S, "location": L, "upstream": U, "if": LIF}.get(name, name)
                    pos = parse(toks, j + 1, newctx, src, 1); continue
                if not spec: errors.append(f"{src}:{line}: unknown directive '{name}'")
                elif ctx not in spec[0]: errors.append(f"{src}:{line}: '{name}' not allowed in {ctx} context")
                elif not spec[1]:
                    if name in seen: errors.append(f"{src}:{line}: '{name}' is duplicate (first at {seen[name]}) — nginx refuses to start")
                    else: seen[name] = f"{src}:{line}"
                if name == "include":
                    for f in expand(words[1], src, line): p2(tokenize(render(f), str(f)) + [("}", 0, str(f))], 0)
                pos = j + 1
            return pos
        return p2(toks, 0)

    toks = tokenize(render(cfg), str(cfg))
    depth = sum(1 if t == "{" else -1 if t == "}" else 0 for t, _, _ in toks)
    if depth != 0: errors.append(f"{cfg}: unbalanced braces ({depth:+d})")
    # The official nginx image's /etc/nginx/nginx.conf already sets these in the http block that includes
    # our file, so setting them again at the top level of a conf.d file stops nginx from starting.
    image_http = {d: "the nginx image's /etc/nginx/nginx.conf (http block)" for d in ("keepalive_timeout", "sendfile", "default_type")}
    parse(toks + [("}", 0, str(cfg))], 0, H, str(cfg), preseen=image_http)
    for e in dict.fromkeys(errors): print("✗", e)
    print(f"{'✓' if not errors else '✗'} {cfg}: {len(set(errors))} problem(s)")
    sys.exit(1 if errors else 0)

main()
