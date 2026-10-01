-- Two-step verification removed (owner's decision, DECISIONS row 79): its secrets, recovery codes and policy go too.
-- DropForeignKey
ALTER TABLE "BackupCode" DROP CONSTRAINT "BackupCode_userId_fkey";

-- DropTable
DROP TABLE "BackupCode";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "twoFactorEnabled",
DROP COLUMN "twoFactorEnabledAt",
DROP COLUMN "totpSecret",
DROP COLUMN "totpPendingSecret",
DROP COLUMN "totpLastStep";

-- AlterTable
ALTER TABLE "AdminSession" DROP COLUMN "mfaVerified";

-- The "require two-step for everyone" setting no longer exists.
DELETE FROM "Setting" WHERE "key" = 'security.policy';
