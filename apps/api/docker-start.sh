#!/bin/sh
# Start-up sequence for the API container.
set -e
echo "› Applying database migrations"
npx prisma migrate deploy

if [ "$SEED_DEMO" = "true" ]; then
  echo "› Loading demo data (SEED_DEMO=true — development/preview only)"
  node dist/scripts/seedDemo.js
fi

if [ -n "$BOOTSTRAP_EMAIL" ] && [ -n "$BOOTSTRAP_PASSWORD" ]; then
  echo "› Ensuring first super admin exists"
  node dist/scripts/bootstrap.js
fi

echo "› Starting API"
exec node dist/server.js
