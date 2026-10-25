import { Hono } from "hono";
import { validateInitData } from "./auth";
import { getSettings, type Settings } from "./settings";
import { isOwner, type Env } from "./env";

const manualPay = new Hono<{ Bindings: Env }>();

manualPay.get("/methods", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, name, currency, min_amount, max_amount, description, qr_key, auto_approve FROM payment_methods WHERE enabled = 1 ORDER BY id").all();
  return c.json({ methods: results });
});

manualPay.post("/submit", async (c) => {
  const user = await requireUser(c.env, c.req.header("authorization") ?? "");
  if (!user) return c.json({ error: "UNAUTHORIZED", code: "UNAUTHORIZED" }, 401);

  const b = (await c.req.json().catch(() => null)) as any;
  if (!b || !b.method_id || !b.amount || !b.utr) return c.json({ error: "INVALID_BODY", code: "INVALID_BODY" }, 400);

  const method = await c.env.DB.prepare("SELECT * FROM payment_methods WHERE id = ?1 AND enabled = 1").bind(Number(b.method_id)).first<any>();
  if (!method) return c.json({ error: "METHOD_NOT_FOUND", code: "METHOD_NOT_FOUND" }, 404);

  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount < method.min_amount || amount > method.max_amount) return c.json({ error: "INVALID_AMOUNT", code: "INVALID_AMOUNT" }, 400);

  const s = await getSettings(c.env);
  let rate = 1_000_000; // Default USD rate
  try {
    const list = JSON.parse(s.display_currencies) as any[];
    const found = list.find((x) => x.code === method.currency);
    if (found) rate = found.rate_micro_usd;
  } catch {}

  const credited = Math.round(amount * rate);
  const isAuto = method.auto_approve === 1;
  const now = Math.floor(Date.now() / 1000);

  const insert = await c.env.DB.prepare(
    "INSERT INTO manual_payments (user_id, method_id, amount, currency, utr, status, credited_micro_usd, decided_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
  ).bind(user.id, method.id, amount, method.currency, b.utr.trim().slice(0, 100), isAuto ? "auto" : "pending", isAuto ? credited : 0, isAuto ? now : null, now).run();

  if (isAuto) {
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE users SET balance = balance + ?1 WHERE id = ?2").bind(credited, user.id),
      c.env.DB.prepare("INSERT INTO ledger (user_id, delta, kind, ref, note, created_at) VALUES (?1, ?2, 'topup', ?3, 'manual payment (auto)', ?4)").bind(user.id, credited, insert.meta.last_row_id, now),
    ]);
  }
  return c.json({ ok: true, auto: isAuto });
});

manualPay.get("/admin/list", async (c) => {
  const admin = await requireAdmin(c.env, c.req.header("authorization") ?? "");
  if (!admin) return c.json({ error: "FORBIDDEN", code: "FORBIDDEN" }, 403);
  const status = c.req.query("status") || "pending";
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.user_id, p.method_id, p.amount, p.currency, p.utr, p.status, p.credited_micro_usd, p.created_at, p.decided_at,
            u.first_name, u.username, m.name AS method_name
     FROM manual_payments p JOIN users u ON u.id = p.user_id JOIN payment_methods m ON m.id = p.method_id
     WHERE p.status = ?1 ORDER BY p.created_at DESC LIMIT 100`,
  ).bind(status).all();
  return c.json({ payments: results });
});

manualPay.post("/admin/:id/accept", async (c) => {
  const admin = await requireAdmin(c.env, c.req.header("authorization") ?? "");
  if (!admin) return c.json({ error: "FORBIDDEN" }, 403);
  const id = Number(c.req.param("id"));
  const p = await c.env.DB.prepare("SELECT * FROM manual_payments WHERE id = ?1").bind(id).first<any>();
  if (!p || p.status !== "pending") return c.json({ error: "ALREADY_DECIDED" }, 400);
  const now = Math.floor(Date.now() / 1000);
  
  const upd = await c.env.DB.prepare("UPDATE manual_payments SET status = 'accepted', admin_id = ?1, decided_at = ?2 WHERE id = ?3 AND status = 'pending'").bind(admin.id, now, id).run();
  if (upd.meta.changes !== 1) return c.json({ error: "ALREADY_DECIDED" }, 400);

  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET balance = balance + ?1 WHERE id = ?2").bind(p.credited_micro_usd, p.user_id),
    c.env.DB.prepare("INSERT INTO ledger (user_id, delta, kind, ref, note, created_at) VALUES (?1, ?2, 'topup', ?3, 'manual payment', ?4)").bind(p.user_id, p.credited_micro_usd, id, now),
  ]);
  return c.json({ ok: true });
});

manualPay.post("/admin/:id/custom", async (c) => {
  const admin = await requireAdmin(c.env, c.req.header("authorization") ?? "");
  if (!admin) return c.json({ error: "FORBIDDEN" }, 403);
  const id = Number(c.req.param("id"));
  const b = (await c.req.json().catch(() => null)) as any;
  const micro = Number(b?.custom_micro_usd);
  if (!Number.isFinite(micro) || micro <= 0) return c.json({ error: "INVALID_AMOUNT" }, 400);
  
  const p = await c.env.DB.prepare("SELECT * FROM manual_payments WHERE id = ?1").bind(id).first<any>();
  if (!p || p.status !== "pending") return c.json({ error: "ALREADY_DECIDED" }, 400);
  const now = Math.floor(Date.now() / 1000);
  
  const upd = await c.env.DB.prepare("UPDATE manual_payments SET status = 'accepted', credited_micro_usd = ?1, admin_id = ?2, decided_at = ?3 WHERE id = ?4 AND status = 'pending'").bind(micro, admin.id, now, id).run();
  if (upd.meta.changes !== 1) return c.json({ error: "ALREADY_DECIDED" }, 400);

  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET balance = balance + ?1 WHERE id = ?2").bind(micro, p.user_id),
    c.env.DB.prepare("INSERT INTO ledger (user_id, delta, kind, ref, note, created_at) VALUES (?1, ?2, 'topup', ?3, 'manual payment (custom)', ?4)").bind(p.user_id, micro, id, now),
  ]);
  return c.json({ ok: true });
});

manualPay.post("/admin/:id/decline", async (c) => {
  const admin = await requireAdmin(c.env, c.req.header("authorization") ?? "");
  if (!admin) return c.json({ error: "FORBIDDEN" }, 403);
  const id = Number(c.req.param("id"));
  const now = Math.floor(Date.now() / 1000);
  const r = await c.env.DB.prepare("UPDATE manual_payments SET status = 'declined', admin_id = ?1, decided_at = ?2 WHERE id = ?3 AND status = 'pending'").bind(admin.id, now, id).run();
  if (r.meta.changes !== 1) return c.json({ error: "ALREADY_DECIDED" }, 400);
  return c.json({ ok: true });
});

manualPay.get("/admin/methods", async (c) => {
  const admin = await requireAdmin(c.env, c.req.header("authorization") ?? "");
  if (!admin) return c.json({ error: "FORBIDDEN" }, 403);
  const { results } = await c.env.DB.prepare("SELECT * FROM payment_methods ORDER BY id").all();
  return c.json({ methods: results });
});

manualPay.post("/admin/methods", async (c) => {
  const admin = await requireAdmin(c.env, c.req.header("authorization") ?? "");
  if (!admin) return c.json({ error: "FORBIDDEN" }, 403);
  const b = (await c.req.json().catch(() => null)) as any;
  if (!b || !b.name || !b.currency) return c.json({ error: "INVALID_BODY" }, 400);

  if (b.id) {
    await c.env.DB.prepare("UPDATE payment_methods SET name = ?1, currency = ?2, min_amount = ?3, max_amount = ?4, description = ?5, qr_key = ?6, auto_approve = ?7, enabled = ?8 WHERE id = ?9").bind(b.name, b.currency, b.min_amount, b.max_amount, b.description, b.qr_key ?? null, b.auto_approve ? 1 : 0, b.enabled ? 1 : 0, b.id).run();
    return c.json({ ok: true, id: b.id });
  }
  const r = await c.env.DB.prepare("INSERT INTO payment_methods (name, currency, min_amount, max_amount, description, qr_key, auto_approve, enabled) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)").bind(b.name, b.currency, b.min_amount, b.max_amount, b.description, b.qr_key ?? null, b.auto_approve ? 1 : 0, b.enabled ? 1 : 0).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});

manualPay.delete("/admin/methods/:id", async (c) => {
  const admin = await requireAdmin(c.env, c.req.header("authorization") ?? "");
  if (!admin) return c.json({ error: "FORBIDDEN" }, 403);
  await c.env.DB.prepare("DELETE FROM payment_methods WHERE id = ?1").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

// Auth Helpers
async function requireUser(env: Env, auth: string): Promise<{ id: number } | null> {
  if (!auth.startsWith("tma ")) return null;
  const data = await validateInitData(auth.slice(4), env.BOT_TOKEN);
  if (!data?.user) return null;
  const row = await env.DB.prepare("SELECT id FROM users WHERE id = ?1 AND banned = 0").bind(data.user.id).first<{ id: number }>();
  return row ? { id: row.id } : null;
}

async function requireAdmin(env: Env, auth: string): Promise<{ id: number; settings: Settings } | null> {
  const u = await requireUser(env, auth);
  if (!u) return null;
  const s = await getSettings(env);
  if (!isOwner(env, s, u.id)) return null;
  return { id: u.id, settings: s };
}

export default manualPay;TO assets (kind, mime, data, updated_at) VALUES (?1, ?2, ?3, unixepoch()) ON CONFLICT(kind) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at",
    ).bind(key, mime, b64),
    c.env.DB.prepare("UPDATE payment_methods SET qr_key = ?1 WHERE id = ?2").bind(key, id),
  ]);
  return c.json({ ok: true, key });
});

async function requireUser(env: Env, auth: string): Promise<{ id: number } | null> {
  if (!auth.startsWith("tma ")) return null;
  const data = await validateInitData(auth.slice(4), env.BOT_TOKEN);
  if (!data?.user) return null;
  const row = await env.DB.prepare("SELECT id FROM users WHERE id = ?1 AND banned = 0").bind(data.user.id).first<{ id: number }>();
  return row ? { id: row.id } : null;
}

async function requireAdmin(env: Env, auth: string): Promise<{ id: number; settings: Settings } | null> {
  const u = await requireUser(env, auth);
  if (!u) return null;
  const s = await getSettings(env);
  if (!isOwner(env, s, u.id)) return null;
  return { id: u.id, settings: s };
}

export default manualPay;e) return c.json({ error: "INVALID_IMAGE", code: "INVALID_IMAGE" }, 400);

  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x2000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  const b64 = btoa(bin);

  const key = `qr:${id}`;
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO assets (kind, mime, data, updated_at) VALUES (?1, ?2, ?3, unixepoch()) ON CONFLICT(kind) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at",
    ).bind(key, mime, b64),
    c.env.DB.prepare("UPDATE payment_methods SET qr_key = ?1 WHERE id = ?2").bind(key, id),
  ]);
  return c.json({ ok: true, key });
});

// ---------- helpers ----------

async function requireUser(env: Env, auth: string): Promise<{ id: number } | null> {
  if (!auth.startsWith("tma ")) return null;
  const data = await validateInitData(auth.slice(4), env.BOT_TOKEN);
  if (!data?.user) return null;
  const row = await env.DB.prepare("SELECT id FROM users WHERE id = ?1 AND banned = 0").bind(data.user.id).first<{ id: number }>();
  return row ? { id: row.id } : null;
}

async function requireAdmin(env: Env, auth: string): Promise<{ id: number; settings: Settings } | null> {
  const u = await requireUser(env, auth);
  if (!u) return null;
  const s = await getSettings(env);
  if (!isOwner(env, s, u.id)) return null;
  return { id: u.id, settings: s };
}

export default manualPay;
