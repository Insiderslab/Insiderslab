-- The client can take back an approval right after giving it («Annulla»):
-- the audit log records it next to the APPROVED event it cancels.
ALTER TYPE "PostEventType" ADD VALUE 'APPROVAL_UNDONE';
