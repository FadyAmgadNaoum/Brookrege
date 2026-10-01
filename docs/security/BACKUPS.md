# Backups & restore

## How backups work
- **Schedule:** every night at 01:00 UTC (03:00–04:00 Cairo), the `backup` container (`infra/backup`) runs `pg_dump` and encrypts the output as it streams, using [age](https://age-encryption.org). No unencrypted copy is ever written to disk.
- **Files:** `brookrege-YYYY-MM-DDTHHMM.dump.age` in `/srv/brookrege/backups` (VPS1), or `./backups` on a single server.
- **Retention:** every backup from the last 14 days, plus the first backup of each of the last 12 months.
- **Off-site (recommended):** set `BACKUP_REMOTE=r2:brookrege-backups` and the `BACKUP_R2_*` token. Use a **separate** bucket and a token that can only write to it. The files are already encrypted.

## The key pair (owner's responsibility)
1. On your own computer (not a server), run `age-keygen -o brookrege-backup-key.txt`.
2. Put the printed **public** key (`age1…`) in `BACKUP_AGE_RECIPIENT` on the server.
3. Keep `brookrege-backup-key.txt` **offline**: store it in the company password manager, and keep a printed copy in a safe place. **Without it, the backups can't be restored — by anyone.**
4. The server only has the public key. Someone who steals the server or a backup file can't read the backups.

## Restore drill (monthly, and before launch)
```bash
# copy the newest backup to a computer that has PostgreSQL client tools and age
AGE_IDENTITY=~/brookrege-backup-key.txt bash scripts/ops/restore-drill.sh brookrege-2026-10-01T0100.dump.age
```
The drill:
1. decrypts the file;
2. checks the archive;
3. restores it into a **temporary** database;
4. checks the tables, row counts, latest migration and the activity-log protection;
5. deletes the temporary database.

It never touches the live database.

### Drill log
| Date | Backup file | Size | Result | Time | By |
|---|---|---|---|---|---|
| 2026-09-26 | test backup (development data) | 49 KB | ✓ passed: 19 tables, protection trigger present, wrong key refused | 1 s | Claude, during Phase 3 build |
| | *first production drill* | | | | |

## Real restore (disaster)
1. Stop the apps: `docker compose stop api worker web admin` on every app server.
2. Decrypt the chosen backup: `age -d -i brookrege-backup-key.txt -o restore.dump brookrege-….dump.age`.
3. Restore into the (empty or recreated) database:
   ```
   pg_restore --clean --if-exists --no-owner -h <db> -U brookrege -d brookrege restore.dump
   ```
4. Start the apps, check the site, then securely delete `restore.dump`.
5. In a three-server setup, rebuild the replica afterwards (`scripts/cluster/reinit-replica.sh`).
6. Write it up (see [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md)).
