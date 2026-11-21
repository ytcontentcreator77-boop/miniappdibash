import { Hono } from "hono";
import { type AppEnv, err } from "./app";
import { isOwner } from "../env";

export const messagingMedia = new Hono<AppEnv>();
const D1_MAX_BYTES = 512 * 1024;
const GATEWAY_MAX_BYTES = 100 * 1024 * 1024;
const allowed = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|ogg|webm|wav|x-wav)|application\/(pdf|zip)|text\/plain)$/;
const safeName = (value: string) => decodeURIComponent(value).replace(/[\\/\x00-\x1f]/g, "_").slice(0, 120) || "file";

messagingMedia.post("/upload", async (c) => {
  const uid = c.get("user").id;
  const threadId = Number(c.req.query("threadId") || 0);
  const spaceId = Number(c.req.query("spaceId") || 0);
  const mime = (c.req.header("content-type") || "application/octet-stream").split(";")[0].toLowerCase();
  const declared = Number(c.req.header("content-length") || 0);
  if ((threadId > 0) === (spaceId > 0)) return err(c, 400, "INVALID_UPLOAD_SCOPE");
  if (!allowed.test(mime)) return err(c, 400, "FILE_TYPE_NOT_ALLOWED");
  const useGateway = !!(c.env.MEDIA_GATEWAY_URL && c.env.MEDIA_GATEWAY_KEY);
  const limit = useGateway ? GATEWAY_MAX_BYTES : D1_MAX_BYTES;
  if (declared > limit) return err(c, 413, "FILE_SIZE_LIMIT");
  if (threadId && !await c.env.DB.prepare("SELECT id FROM dm_threads WHERE id=?1 AND (user_low=?2 OR user_high=?2)").bind(threadId, uid).first()) return err(c, 404, "THREAD_NOT_FOUND");
  if (spaceId && !await c.env.DB.prepare("SELECT 1 FROM message_space_members WHERE space_id=?1 AND user_id=?2").bind(spaceId, uid).first()) return err(c, 403, "NOT_A_MEMBER");

  const filename = safeName(c.req.query("filename") || "file");
  let size = declared;
  let data: string | null = null;
  let storageKey = "d1:" + crypto.randomUUID();

  if (useGateway) {
    const key = crypto.randomUUID().replace(/-/g, "");
    const response = await fetch(new URL("/v1/files?key=" + key + "&filename=" + encodeURIComponent(filename), c.env.MEDIA_GATEWAY_URL), {
      method: "PUT",
      headers: { authorization: "Bearer " + c.env.MEDIA_GATEWAY_KEY, "content-type": mime, ...(declared ? { "content-length": String(declared) } : {}) },
      body: c.req.raw.body
    });
    if (!response.ok) return err(c, response.status === 413 ? 413 : 502, response.status === 413 ? "FILE_SIZE_LIMIT" : "MEDIA_STORAGE_FAILED");
    const result = await response.json() as { storageKey?: string; size?: number };
    if (!result.storageKey || !Number.isSafeInteger(result.size) || !result.size || result.size > limit) return err(c, 502, "MEDIA_STORAGE_INVALID_RESPONSE");
    storageKey = "mongo:" + result.storageKey;
    size = result.size;
  } else {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > limit || (declared > 0 && bytes.byteLength !== declared)) return err(c, 413, "FILE_SIZE_LIMIT");
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    data = btoa(binary);
    size = bytes.byteLength;
  }

  const row = await c.env.DB.prepare(
    "INSERT INTO message_attachments(owner_id,thread_id,space_id,object_key,filename,mime,size,created_at,data) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9) RETURNING id"
  ).bind(uid, threadId || null, spaceId || null, storageKey, filename, mime, size, Math.floor(Date.now() / 1000), data).first<{ id: number }>();
  if (!row) return err(c, 500, "UPLOAD_METADATA_FAILED");
  return c.json({ id: row.id, filename, mime, size });
});

messagingMedia.get("/files/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const uid = c.get("user").id;
  if (!Number.isSafeInteger(id) || id <= 0) return err(c, 400, "INVALID_FILE");
  const a = await c.env.DB.prepare("SELECT * FROM message_attachments WHERE id=?1").bind(id).first<any>();
  if (!a) return err(c, 404, "FILE_NOT_FOUND");
  if (a.thread_id && !await c.env.DB.prepare("SELECT id FROM dm_threads WHERE id=?1 AND (user_low=?2 OR user_high=?2)").bind(a.thread_id, uid).first()) return err(c, 403, "FORBIDDEN");
  if (a.space_id && !await c.env.DB.prepare("SELECT 1 FROM message_space_members WHERE space_id=?1 AND user_id=?2").bind(a.space_id, uid).first()) return err(c, 403, "FORBIDDEN");

  if (String(a.object_key).startsWith("mongo:")) {
    if (!c.env.MEDIA_GATEWAY_URL || !c.env.MEDIA_GATEWAY_KEY) return err(c, 503, "MEDIA_STORAGE_NOT_CONFIGURED");
    const response = await fetch(new URL("/v1/files?key=" + encodeURIComponent(String(a.object_key).slice(6)), c.env.MEDIA_GATEWAY_URL), {
      headers: { authorization: "Bearer " + c.env.MEDIA_GATEWAY_KEY }
    });
    if (!response.ok || !response.body) return err(c, response.status === 404 ? 404 : 502, "MEDIA_READ_FAILED");
    return new Response(response.body, { headers: {
      "content-type": a.mime, "content-length": String(a.size),
      "content-disposition": "inline; filename*=UTF-8''" + encodeURIComponent(a.filename),
      "cache-control": "private, max-age=300", "x-content-type-options": "nosniff"
    }});
  }

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
  if (!c.env.MEDIA_GATEWAY_URL || !c.env.MEDIA_GATEWAY_KEY) return c.json({ configured: false, provider: "D1 fallback", maxBytes: D1_MAX_BYTES, pools: [] });
  try {
    const response = await fetch(new URL("/health", c.env.MEDIA_GATEWAY_URL), { headers: { authorization: "Bearer " + c.env.MEDIA_GATEWAY_KEY } });
    if (!response.ok) return c.json({ configured: true, healthy: false, provider: "MongoDB GridFS", pools: [] });
    const status = await response.json() as { pools?: string[] };
    return c.json({ configured: true, healthy: true, provider: "MongoDB GridFS", pools: status.pools || [] });
  } catch {
    return c.json({ configured: true, healthy: false, provider: "MongoDB GridFS", pools: [] });
  }
});
