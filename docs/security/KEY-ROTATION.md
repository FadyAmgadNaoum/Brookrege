# Rotating keys and passwords

Rotate straight away if a key may have leaked (for example, a laptop with the env file was lost, or someone with access left). Otherwise rotate yearly.

| Secret | Where | How to rotate | Effect |
|---|---|---|---|
| `JWT_ACCESS_SECRET` | env file on app servers | Generate a new one (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`), update the env file, restart the API on all servers. | Access tokens in use stop working; browsers silently get new ones with their refresh token. It does **not** sign anyone out — to do that, run `scripts/ops/revoke-all-sessions.sh` (ends every session at once). |
| `SETTINGS_ENCRYPTION_KEY` | env file on app servers | Steps below. | None, if the steps are followed in order. |
| Database password | `DB_PASSWORD` in env | `ALTER USER brookrege PASSWORD '…'` in psql, then update the env file on every server, then restart pgBouncer and the apps. | A few seconds of errors during the restart. |
| Replication password | `REPLICATION_PASSWORD` | `ALTER USER replicator PASSWORD '…'` on the primary, update the env file, restart Postgres on VPS2. | The replica catches up after the restart. |
| SendGrid / Twilio keys | Admin › Notifications | Create a new key at the provider, paste it in the admin, then delete the old key at the provider. | None. |
| R2 keys | env file | Create a new token in Cloudflare, update the env file, restart, delete the old token. | None. |
| Backup key pair | Owner (private) / env (public) | `age-keygen -o new-key.txt`, put the new public key in `BACKUP_AGE_RECIPIENT`, restart the backup container. **Keep the old private key** until every backup made with it has expired (12 months). | None. |
| SSH keys | `~deploy/.ssh/authorized_keys` | Add the new key, test logging in with it, then remove the old key. | None. |

## Encryption key (`SETTINGS_ENCRYPTION_KEY`), step by step
1. Generate a new key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
2. On every app server, set `SETTINGS_ENCRYPTION_KEY=<new>` and `SETTINGS_ENCRYPTION_KEY_PREVIOUS=<old>`, then restart. Everything keeps working: values are read with either key.
3. On one server, run:
   ```
   docker compose exec api node dist/scripts/rotateEncryptionKey.js
   ```
   It re-encrypts every provider key with the new key. Running it twice is harmless.
4. Remove `SETTINGS_ENCRYPTION_KEY_PREVIOUS` everywhere and restart.
5. Store the new key in the password manager. **Losing it** means the email/SMS provider keys must be re-entered.
