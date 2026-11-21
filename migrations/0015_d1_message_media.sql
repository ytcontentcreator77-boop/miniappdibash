-- Store small messenger attachments directly in D1; no object-storage binding required.
ALTER TABLE message_attachments ADD COLUMN data TEXT;
