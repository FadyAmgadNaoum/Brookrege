-- Separate database for integration tests (tests refuse to run against any DB without "test" in its URL).
CREATE DATABASE brookrege_test OWNER brookrege;
