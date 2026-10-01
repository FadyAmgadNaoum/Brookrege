import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/*.test.ts"] /* test/unit uses node:test (npm run test:unit) */,
    fileParallelism: false,
    testTimeout: 20000,
    // Test-only values (never used outside the test database).
    env: { SETTINGS_ENCRYPTION_KEY: "5c".repeat(32), BCRYPT_ROUNDS: "10", APP_ENV: "test", SIGNIN_RATE_LIMIT: "1000", ADMIN_APP_URL: "http://localhost:3001", CACHE_ENABLED: "false" /* test/cache.test.ts turns it on */ },
  },
});
