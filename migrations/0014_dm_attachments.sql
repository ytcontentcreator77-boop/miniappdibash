-- Link uploaded media objects to direct-message records.
ALTER TABLE dm_messages ADD COLUMN attachment_id INTEGER REFERENCES message_attachments(id);
