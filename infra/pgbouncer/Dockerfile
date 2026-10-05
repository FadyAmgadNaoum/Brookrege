# Minimal pgBouncer built from Alpine packages (no third-party image to trust or pin).
FROM alpine:3.24
RUN apk add --no-cache pgbouncer postgresql15-client gettext \
 && adduser -S -D -H -u 70 pgb \
 && mkdir -p /run/pgbouncer /state && chown pgb /run/pgbouncer /state
COPY pgbouncer.ini.template /etc/pgbouncer/pgbouncer.ini.template
COPY entrypoint.sh /usr/local/bin/pgbouncer-entrypoint
RUN tr -d '\r' < /usr/local/bin/pgbouncer-entrypoint > /tmp/s && cat /tmp/s > /usr/local/bin/pgbouncer-entrypoint && rm /tmp/s && chmod +x /usr/local/bin/pgbouncer-entrypoint
USER pgb
EXPOSE 6432
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD pg_isready -q -h 127.0.0.1 -p 6432 || exit 1
ENTRYPOINT ["/usr/local/bin/pgbouncer-entrypoint"]
