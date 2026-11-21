# Telegram media storage setup

Host media files in Telegram instead of the app database or object storage.

## Create storage channels

1. Create one or more private Telegram channels.
2. Add the same Telegram bot used by this Mini App as an administrator in every channel.
3. Grant permission to post messages.
4. Open the Mini App's Messaging Admin panel.
5. Paste each channel ID on its own line and save. The server checks the bot's administrator/post permission before saving.

For private channels, use their numeric channel ID, normally beginning with `-100`. Do not use the existing required-join channel as storage unless you intentionally want media files mixed into that channel.

## How uploads work

- The Worker sends every new attachment to Telegram with `sendDocument`.
- Telegram returns a bot-specific `file_id`.
- D1 stores only that `file_id` plus message/file metadata. New file bytes are not inserted into D1 or MongoDB.
- Multiple configured storage channels are distributed by user ID.
- Media downloads use Telegram `getFile` and the Bot API file endpoint.
- Maximum file size is 20 MB because the standard cloud Bot API download endpoint supports files up to 20 MB.

## Existing small attachments

If earlier versions saved small media in D1, the admin panel displays how many legacy files remain. Select **Move old files from app DB to Telegram** to upload them into Telegram and set their D1 `data` field to NULL. The migration processes batches and can be repeated until no legacy files remain.

## Operational notes

- Keep the bot in every storage channel. Removing it can prevent future uploads.
- Do not delete storage channel messages; their file IDs are referenced by chat messages.
- Back up the storage channels and retain access to the bot token as a Worker secret.
- This is Telegram Bot API storage, not a separate Telegram database. Telegram hosts the binary media; your app database keeps references and chat metadata.
