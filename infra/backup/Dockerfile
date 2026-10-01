# Nightly encrypted database backups (see infra/backup/backup.sh and docs/security/BACKUPS.md).
FROM postgres:15-alpine
RUN apk add --no-cache age rclone tzdata
COPY backup.sh /usr/local/bin/brookrege-backup
RUN chmod +x /usr/local/bin/brookrege-backup
# 01:00 UTC = 03:00/04:00 Cairo. crond doesn't pass the container's environment to jobs, so it's saved at start.
CMD ["/bin/sh", "-c", "export -p > /etc/backup.env && echo '0 1 * * * . /etc/backup.env && /usr/local/bin/brookrege-backup >> /proc/1/fd/1 2>&1' > /etc/crontabs/root && exec crond -f -l 8"]
