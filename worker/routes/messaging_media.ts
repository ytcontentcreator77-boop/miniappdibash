import { Hono } from "hono";
import { type AppEnv, err } from "./app";
import { isOwner } from "../env";
import { setSettings } from "../settings";

export const messagingMedia = new Hono<AppEnv>();
const MAX_BYTES = 20 * 1024 * 1024;
const allowed = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|ogg|webm|wav|x-wav)|application\/(pdf|zip)|text\/plain)$/;
const safeName = (value: string) => value.replace(/[\\/\x00-\x1f]/g, "_").slice(0, 120) || "file";
const channels = (raw: string) => raw.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
const channelValid = (value: string) => /^-100\d{5,}$/.test(value) || /^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(value);
const telegram = (token: string, method: string) => "https://api.telegram.org/bot" + token + "/" + method;

async function uploadToTelegram(token: string, channel: string, filename: string, mime: string, bytes: Uint8Array) {
  const form = new FormData();
  form.set("chat_id", channel);
  form.set("caption", "Messenger media");
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  form.set("document", new Blob([buffer], { type: mime }), safeName(filename));
  const response = await fetch(telegram(token, "sendDocument"), { method: "POST", body: form });
  const result = await response.json() as { ok?: boolean; description?: string; result?: { document?: { file_id?: string; file_size?: number } } };
  if (!response.ok || !result.ok || !result.result?.document?.file_id) throw new Error(result.description || "TELEGRAM_UPLOAD_FAILED");
  return { fileId: result.result.document.file_id, size: result.result.document.file_size || bytes.byteLength };
}

async function validateChannels(token: string, list: string[]) {
  const meResponse = await fetch(telegram(token, "getMe"));
  const me = await meResponse.json() as { ok?: boolean; result?: { id?: number } };
  if (!meResponse.ok || !me.ok || !me.result?.id) return "BOT_TOKEN_INVALID";
  for (const chat of list) {
    const response = await fetch(telegram(token, "getChatMember"), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, user_id: me.result.id })
    });
    const data = await response.json() as { ok?: boolean; description?: string; result?: { status?: string; can_post_messages?: boolean } };
    if (!response.ok || !data.ok || !data.result || !["administrator", "creator"].includes(data.result.status || "") || data.result.can_post_messages === false)
      return "BOT_MUST_BE_CHANNEL_ADMIN_WITH_POST_PERMISSION";
  }
  return null;
}

messagingMedia.post("/upload", async (c) => {
  const uid = c.get("user").id;
  const threadId = Number(c.req.query("threadId") || 0);
  const spaceId = Number(c.req.query("spaceId") || 0);
  const mime = (c.req.header("content-type") || "application/octet-stream").split(";")[0].toLowerCase();
  const declared = Number(c.req.header("content-length") || 0);
  if ((threadId > 0) === (spaceId > 0)) return err(c, 400, "INVALID_UPLOAD_SCOPE");
  if (!allowed.test(mime)) return err(c, 400, "FILE_TYPE_NOT_ALLOWED");
  if (declared > MAX_BYTES) return err(c, 413, "FILE_SIZE_LIMIT");
  if (threadId && !await c.env.DB.prepare("SELECT id FROM dm_threads WHERE id=?1 AND (user_low=?2 OR user_high=?2)").bind(threadId, uid).first()) return err(c, 404, "THREAD_NOT_FOUND");
  if (spaceId && !await c.env.DB.prepare("SELECT 1 FROM message_space_members WHERE space_id=?1 AND user_id=?2").bind(spaceId, uid).first()) return err(c, 403, "NOT_A_MEMBER");

  const configured = channels(c.get("settings").media_storage_channels || "");
  if (!configured.length) return err(c, 503, "TELEGRAM_MEDIA_STORAGE_NOT_CONFIGURED");
  if (configured.some(x => !channelValid(x))) return err(c, 503, "TELEGRAM_MEDIA_CHANNEL_INVALID");
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES || (declared > 0 && bytes.byteLength !== declared)) return err(c, 413, "FILE_SIZE_LIMIT");
  const filename = safeName(c.req.query("filename") || "file");
  const channel = configured[Math.abs(uid) % configured.length];
  let stored: { fileId: string; size: number };
  try {
    stored = await uploadToTelegram(c.env.BOT_TOKEN, channel, filename, mime, bytes);
  } catch (e) {
    console.error("Telegram media upload failed", (e as Error).message);
    return err(c, 502, "TELEGRAM_MEDIA_UPLOAD_FAILED");
  }
  const row = await c.env.DB.prepare(
    "INSERT INTO message_attachments(owner_id,thread_id,space_id,object_key,filename,mime,size,created_at,data) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,NULL) RETURNING id"
  ).bind(uid, threadId || null, spaceId || null, "tg:" + stored.fileId, filename, mime, stored.size, Math.floor(Date.now() / 1000)).first<{ id: number }>();
  if (!row) return err(c, 500, "UPLOAD_METADATA_FAILED");
  return c.json({ id: row.id, filename, mime, size: stored.size });
});

messagingMedia.get("/files/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const uid = c.get("user").id;
  if (!Number.isSafeInteger(id) || id <= 0) return err(c, 400, "INVALID_FILE");
  const a = await c.env.DB.prepare("SELECT * FROM message_attachments WHERE id=?1").bind(id).first<any>();
  if (!a) return err(c, 404, "FILE_NOT_FOUND");
  if (a.thread_id && !await c.env.DB.prepare("SELECT id FROM dm_threads WHERE id=?1 AND (user_low=?2 OR user_high=?2)").bind(a.thread_id, uid).first()) return err(c, 403, "FORBIDDEN");
  if (a.space_id && !await c.env.DB.prepare("SELECT 1 FROM message_space_members WHERE space_id=?1 AND user_id=?2").bind(a.space_id, uid).first()) return err(c, 403, "FORBIDDEN");

  if (String(a.object_key).startsWith("tg:")) {
    const fileId = String(a.object_key).slice(3);
    const infoResponse = await fetch(telegram(c.env.BOT_TOKEN, "getFile"), {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_id: fileId })
    });
    const info = await infoResponse.json() as { ok?: boolean; result?: { file_path?: string } };
    if (!infoResponse.ok || !info.ok || !info.result?.file_path) return err(c, 502, "TELEGRAM_MEDIA_LOOKUP_FAILED");
    const fileResponse = await fetch("https://api.telegram.org/file/bot" + c.env.BOT_TOKEN + "/" + info.result.file_path);
    if (!fileResponse.ok || !fileResponse.body) return err(c, 502, "TELEGRAM_MEDIA_DOWNLOAD_FAILED");
    return new Response(fileResponse.body, { headers: {
      "content-type": a.mime, "content-length": String(a.size),
      "content-disposition": "inline; filename*=UTF-8''" + encodeURIComponent(a.filename),
      "cache-control": "private, max-age=300", "x-content-type-options": "nosniff"
    }});
  }

  // Backward compatibility for older D1-stored attachments; use the admin migration action to move them to Telegram.
  if (!a.data) return err(c, 404, "FILE_NOT_FOUND");
  const binary = atob(a.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Response(bytes, { headers: {
    "content-type": a.mime, "content-length": String(a.size),
    "content-disposition": "inline; filename*=UTF-8''" + encodeURIComponent(a.filename),
    "cache-control": "private, max-age=300", "x-content-type-options": "nosniff"
  }});
});

messagingMedia.get("/admin/media-storage", async (c) => {
  if (!isOwner(c.env, c.get("settings"), c.get("user").id)) return err(c, 403, "FORBIDDEN");
  const list = channels(c.get("settings").media_storage_channels || "");
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM message_attachments WHERE data IS NOT NULL").first<{ n: number }>();
  return c.json({ provider: "Telegram private channels", configured: list.length > 0, channels: list, maxBytes: MAX_BYTES, binaryStoredInAppDatabase: false, legacyFilesRemaining: count?.n || 0 });
});

messagingMedia.put("/admin/media-storage", async (c) => {
  if (!isOwner(c.env, c.get("settings"), c.get("user").id)) return err(c, 403, "FORBIDDEN");
  const body = await c.req.json<{ channels?: string[] | string }>().catch(() => null);
  if (!body || body.channels === undefined) return err(c, 400, "INVALID_BODY");
  const list = (Array.isArray(body.channels) ? body.channels : channels(String(body.channels))).map(x => String(x).trim()).filter(Boolean);
  if (list.length > 20 || list.some(x => !channelValid(x)) || new Set(list).size !== list.length) return err(c, 400, "INVALID_CHANNEL_LIST");
  const validationError = list.length ? await validateChannels(c.env.BOT_TOKEN, list) : null;
  if (validationError) return err(c, 400, validationError);
  await setSettings(c.env, { media_storage_channels: list.join("\n") } as any);
  return c.json({ ok: true, channels: list });
});

messagingMedia.post("/admin/media-storage/migrate-legacy", async (c) => {
  if (!isOwner(c.env, c.get("settings"), c.get("user").id)) return err(c, 403, "FORBIDDEN");
  const list = channels(c.get("settings").media_storage_channels || "");
  if (!list.length) return err(c, 400, "TELEGRAM_MEDIA_STORAGE_NOT_CONFIGURED");
  const { results } = await c.env.DB.prepare("SELECT id,owner_id,filename,mime,size,data FROM message_attachments WHERE data IS NOT NULL ORDER BY id LIMIT 20").all<any>();
  let migrated = 0;
  for (const item of results) {
    try {
      const binary = atob(item.data);
      const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
      const channel = list[Math.abs(Number(item.owner_id)) % list.length];
      const stored = await uploadToTelegram(c.env.BOT_TOKEN, channel, item.filename, item.mime, bytes);
      await c.env.DB.prepare("UPDATE message_attachments SET object_key=?1,size=?2,data=NULL WHERE id=?3").bind("tg:" + stored.fileId, stored.size, item.id).run();
      migrated++;
    } catch (e) {
      console.error("Legacy media migration failed for attachment", item.id, (e as Error).message);
      break;
    }
  }
  const remaining = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM message_attachments WHERE data IS NOT NULL").first<{ n: number }>();
  return c.json({ ok: true, migrated, remaining: remaining?.n || 0 });
});
