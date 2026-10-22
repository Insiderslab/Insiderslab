-- Email + password sign-in (additive: existing users keep the magic link).
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordUpdatedAt" TIMESTAMP(3);
