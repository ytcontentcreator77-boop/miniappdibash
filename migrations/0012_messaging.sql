-- Persistent in-app messaging. Messages are retained until a user or admin deletes them.
ALTER TABLE users ADD COLUMN app_display_name TEXT;
ALTER TABLE users ADD COLUMN app_username TEXT;
ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN premium_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_active_at INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX users_app_username_unique ON users(app_username) WHERE app_username IS NOT NULL AND app_username <> '';
CREATE TABLE dm_threads (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_low INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 user_high INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 last_message_id INTEGER,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(user_low,user_high),
 CHECK(user_low < user_high)
);
CREATE INDEX dm_threads_low ON dm_threads(user_low,updated_at DESC);
CREATE INDEX dm_threads_high ON dm_threads(user_high,updated_at DESC);
CREATE TABLE dm_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 thread_id INTEGER NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
 sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 body TEXT NOT NULL DEFAULT '',
 kind TEXT NOT NULL DEFAULT 'text',
 reply_to_id INTEGER REFERENCES dm_messages(id),
 edited_at INTEGER,
 deleted_at INTEGER,
 created_at INTEGER NOT NULL
);
CREATE INDEX dm_messages_thread ON dm_messages(thread_id,id DESC);
CREATE INDEX dm_messages_sender ON dm_messages(sender_id,created_at DESC);
CREATE TABLE dm_reads (
 thread_id INTEGER NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 last_read_message_id INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(thread_id,user_id)
) WITHOUT ROWID;
CREATE TABLE dm_reactions (
 message_id INTEGER NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 emoji TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(message_id,user_id,emoji)
) WITHOUT ROWID;
CREATE TABLE user_blocks (
 blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(blocker_id,blocked_id),
 CHECK(blocker_id != blocked_id)
) WITHOUT ROWID;
CREATE TABLE user_reports (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 reported_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 message_id INTEGER REFERENCES dm_messages(id) ON DELETE SET NULL,
 reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open',
 created_at INTEGER NOT NULL
);
CREATE INDEX user_reports_status ON user_reports(status,created_at DESC);
