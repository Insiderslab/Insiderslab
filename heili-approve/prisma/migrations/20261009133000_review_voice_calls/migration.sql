CREATE TYPE "ReviewVoiceCallStatus" AS ENUM (
  'STARTING',
  'ACTIVE',
  'CLOSING',
  'CLOSED',
  'EXPIRED',
  'FAILED'
);

CREATE TABLE "ReviewVoiceCall" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "providerSessionId" TEXT,
  "status" "ReviewVoiceCallStatus" NOT NULL DEFAULT 'STARTING',
  "model" TEXT NOT NULL,
  "voice" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "providerExpiresAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "lastContextAt" TIMESTAMP(3),
  "currentContextMarker" TEXT,
  "audioSeconds" INTEGER NOT NULL DEFAULT 0,
  "closeReason" TEXT,
  "failureCode" TEXT,

  CONSTRAINT "ReviewVoiceCall_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReviewVoiceTranscriptFragment" (
  "id" TEXT NOT NULL,
  "callId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "speaker" TEXT NOT NULL,
  "delta" TEXT NOT NULL,
  "startMs" INTEGER NOT NULL,
  "endMs" INTEGER NOT NULL,
  "contextMarker" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReviewVoiceTranscriptFragment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReviewVoiceTranscriptSegment" (
  "id" TEXT NOT NULL,
  "callId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "messageId" TEXT NOT NULL,
  "startMs" INTEGER NOT NULL,
  "endMs" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReviewVoiceTranscriptSegment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReviewVoiceCall_providerSessionId_key" ON "ReviewVoiceCall"("providerSessionId");
CREATE INDEX "ReviewVoiceCall_sessionId_startedAt_idx" ON "ReviewVoiceCall"("sessionId", "startedAt");
CREATE INDEX "ReviewVoiceCall_status_expiresAt_idx" ON "ReviewVoiceCall"("status", "expiresAt");

CREATE UNIQUE INDEX "ReviewVoiceTranscriptFragment_callId_eventId_key"
  ON "ReviewVoiceTranscriptFragment"("callId", "eventId");
CREATE INDEX "ReviewVoiceTranscriptFragment_callId_startMs_endMs_idx"
  ON "ReviewVoiceTranscriptFragment"("callId", "startMs", "endMs");

CREATE UNIQUE INDEX "ReviewVoiceTranscriptSegment_messageId_key" ON "ReviewVoiceTranscriptSegment"("messageId");
CREATE UNIQUE INDEX "ReviewVoiceTranscriptSegment_callId_ordinal_key"
  ON "ReviewVoiceTranscriptSegment"("callId", "ordinal");
CREATE INDEX "ReviewVoiceTranscriptSegment_callId_idx" ON "ReviewVoiceTranscriptSegment"("callId");

ALTER TABLE "ReviewVoiceCall"
  ADD CONSTRAINT "ReviewVoiceCall_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "ReviewSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReviewVoiceTranscriptFragment"
  ADD CONSTRAINT "ReviewVoiceTranscriptFragment_callId_fkey"
  FOREIGN KEY ("callId") REFERENCES "ReviewVoiceCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReviewVoiceTranscriptSegment"
  ADD CONSTRAINT "ReviewVoiceTranscriptSegment_callId_fkey"
  FOREIGN KEY ("callId") REFERENCES "ReviewVoiceCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReviewVoiceTranscriptSegment"
  ADD CONSTRAINT "ReviewVoiceTranscriptSegment_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "ReviewMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
