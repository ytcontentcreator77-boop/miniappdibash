import { Hono } from "hono";
import { type AppEnv, err } from "./app";

export const messagingMedia = new Hono<AppEnv>();
const MAX_BYTES = 512 * 1024;
const allowed = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|ogg|webm|wav|x-wav)|application\/(pdf|zip)|text\/plain)$/;

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

  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES || (declared > 0 && bytes.byteLength !== declared)) return err(c, 413, "FILE_SIZE_LIMIT");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const data = btoa(binary);
  const rawName = c.req.query("filename") || "file";
  const filename = decodeURIComponent(rawName).replace(/[\\/\x00-\x1f]/g, "_").slice(0, 120) || "file";
  const key = "d1:" + crypto.randomUUID();
  const row = await c.env.DB.prepare(
    "INSERT INTO message_attachments(owner_id,thread_id,space_id,object_key,filename,mime,size,created_at,data) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9) RETURNING id"
  ).bind(uid, threadId || null, spaceId || null, key, filename, mime, bytes.byteLength, Math.floor(Date.now() / 1000), data).first<{ id: number }>();
  if (!row) return err(c, 500, "UPLOAD_FAILED");
  return c.json({ id: row.id, filename, mime, size: bytes.byteLength });
});

messagingMedia.get("/files/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const uid = c.get("user").id;
  if (!Number.isSafeInteger(id) || id <= 0) return err(c, 400, "INVALID_FILE");
  const a = await c.env.DB.prepare("SELECT * FROM message_attachments WHERE id=?1").bind(id).first<any>();
  if (!a) return err(c, 404, "FILE_NOT_FOUND");
  if (a.thread_id && !await c.env.DB.prepare("SELECT id FROM dm_threads WHERE id=?1 AND (user_low=?2 OR user_high=?2)").bind(a.thread_id, uid).first()) return err(c, 403, "FORBIDDEN");
  if (a.space_id && !await c.env.DB.prepare("SELECT 1 FROM message_space_members WHERE space_id=?1 AND user_id=?2").bind(a.space_id, uid).first()) return err(c, 403, "FORBIDDEN");
  if (!a.data) return err(c, 404, "FILE_NOT_FOUND");
  const binary = atob(a.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Response(bytes, { headers: {
    "content-type": a.mime,
    "content-length": String(a.size),
    "content-disposition": "inline; filename*=UTF-8''" + encodeURIComponent(a.filename),
    "cache-control": "private, max-age=300",
    "x-content-type-options": "nosniff"
  }});
});
