import { Hono } from "hono";
import { platformName } from "../../shared/platforms";
import { balanceStars, MAX_STARS_PER_PAYMENT, shownStars } from "../../shared/stars";
import { type Lang } from "../../shared/types";
import { LIMITS } from "../../shared/brand";
import { checkImageUpload, deleteAssetStmts, detectImageMime, isAssetKind, putAssetStmts } from "../assets";
import { sendPreviews } from "../botMessages";
import { BRAND_KEYS, normalizeBrandSettings } from "../brandSettings";
import { MARKUP_SQL, rebuildSummaryStmts, RULE_JOINS } from "../catalog";
import { connectAll, registerNotPanelWebhook, syncBotTexts } from "../connect";
import { addedOwners, envOwners, isOwner } from "../env";
import { npCall, npKey, usdToMicro, verifyPanelKey } from "../notpanel";
import { orderView, type OrderRow } from "../orders";
import { refundPayment } from "../payments";
import { sellRate } from "../pricing";
import { bumpCatalogStmt, DEFAULTS, getSettings, setSettings, setSettingsStmts, type Settings } from "../settings";
import { startSync, syncProgress } from "../sync";
import { type AppEnv, err, readBody } from "./app";

export const admin = new Hono<AppEnv>();

admin.use("*", async (c, next) => {
  if (!isOwner(c.env, c.get("settings"), c.get("user").id)) return err(c, 403, "FORBIDDEN");
  await next();
});

const dayStart = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
};

admin.get("/overview", async (c) => {
  const s = c.get("settings");
  const since = dayStart();
  const [today, users, pending, attention, joined] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(charge - refund), 0) AS sales, COALESCE(SUM(charge - refund - COALESCE(cost, 0)), 0) AS profit
       FROM orders WHERE created_at >= ?1 AND status != 'failed'`,
    ).bind(since),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM users"),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE status IN ('submitting','pending','processing','in_progress')"),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM services WHERE present = 1 AND enabled = 1 AND fixed_rate IS NOT NULL AND fixed_rate < rate"),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM referrals WHERE status != 'pending'"),
  ]);
  let npBalance: number | null = null;
  let npError: string | null = null;
  try {
    npBalance = usdToMicro((await npCall<{ balance: string }>(c.env, "balance")).balance);
  } catch (e) {
    npError = (e as Error).message;
  }
  const r = today.results[0] as { orders: number; sales: number; profit: number };
  const t = { ...r, salesStars: shownStars(r.sales, s.stars_per_usd) };
  return c.json({
    npBalance,
    npError,
    lowBalance: s.low_balance,
    today: t,
    users: (users.results[0] as { n: number }).n,
    referralsJoined: (joined.results[0] as { n: number }).n,
    openOrders: (pending.results[0] as { n: number }).n,
    needsAttention: (attention.results[0] as { n: number }).n,
    defaultMarkup: s.default_markup_pct,
    lastSync: s.last_sync_summary ? JSON.parse(s.last_sync_summary) : null,
  });
});

const EDITABLE: (keyof Settings)[] = [
  "default_markup_pct",
  "stars_per_usd",
  "stars_per_inr",
  "min_topup_stars",
  "max_topup_stars",
  "sync_enabled",
  "sync_every_hours",
  "auto_enable_new",
  "only_timed",
  "low_balance",
  "support_username",
  "channel_url",
  "channel_id",
  "channel_gate",
  "referral_enabled",
  "referral_reward_stars",
  "referral_daily_cap",
  "terms_text",
  "default_currency",
  "display_currencies",
  ...BRAND_KEYS,
];

const keyHint = (env: AppEnv["Bindings"], s: Settings) => {
  const k = npKey(env, s);
  return k ? "…" + k.slice(-4) : null;
};

admin.get("/settings", (c) => {
  const s = c.get("settings");
  return c.json({
    ...Object.fromEntries(EDITABLE.map((k) => [k, s[k]])),
    last_sync_at: s.last_sync_at,
    last_sync_summary: s.last_sync_summary ? JSON.parse(s.last_sync_summary) : null,
    sync: syncProgress(s),
    webhook_connected: !!s.np_webhook_id,
    app_url: s.app_url,
    bot_username: s.bot_username,
    key_hint: keyHint(c.env, s),
    panel_base: s.panel_base,
    notpanel_key_source: s.panel_api_key ? "saved" : s.np_api_key ? "saved" : "env",
    owners: { env: envOwners(c.env), added: addedOwners(s) },
  });
});

admin.put("/settings", async (c) => {
  const body = await readBody<Partial<Settings>>(c);
  if (!body) return err(c, 400, "INVALID_BODY");
  const values: Partial<Settings> = {};
  for (const k of EDITABLE) {
    if (body[k] === undefined) continue;
    const v = body[k] as never;
    if (typeof DEFAULTS[k] === "number") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return err(c, 400, "INVALID_VALUE", { key: k });
      (values as Record<string, unknown>)[k] = n;
    } else (values as Record<string, unknown>)[k] = (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)).slice(0, 8000);
  }
  if (values.default_markup_pct !== undefined && values.default_markup_pct > 1000) return err(c, 400, "INVALID_VALUE", { key: "default_markup_pct" });
  const bad = (key: string) => err(c, 400, "INVALID_VALUE", { key });
  const inRange = (key: keyof Settings, lo: number, hi: number) => {
    const v = values[key] as number | undefined;
    return v === undefined || (v >= lo && v <= hi);
  };
  if (!inRange("stars_per_usd", 1, 1000)) return bad("stars_per_usd");
  if (!inRange("stars_per_inr", 1, 1_000_000)) return bad("stars_per_inr");
  if (!inRange("referral_reward_stars", 0, 100) || (values.referral_reward_stars !== undefined && !Number.isInteger(values.referral_reward_stars)))
    return bad("referral_reward_stars");
  if (!inRange("referral_daily_cap", 0, 10000)) return bad("referral_daily_cap");
  if (!inRange("sync_every_hours", 1, 168)) return bad("sync_every_hours");
  if (!inRange("low_balance", 0, Number.MAX_SAFE_INTEGER)) return bad("low_balance");
  const cur = c.get("settings");
  const minTopup = values.min_topup_stars ?? cur.min_topup_stars;
  const maxTopup = values.max_topup_stars ?? cur.max_topup_stars;
  if (!Number.isInteger(minTopup) || minTopup < 1) return bad("min_topup_stars");
  if (!Number.isInteger(maxTopup) || maxTopup < minTopup || maxTopup > MAX_STARS_PER_PAYMENT) return bad("max_topup_stars");
  if (values.support_username) values.support_username = values.support_username.replace(/^@/, "");
  if (values.channel_url && !/^https:\/\/t\.me\//.test(values.channel_url)) return err(c, 400, "INVALID_VALUE", { key: "channel_url" });
  if (values.channel_id && !/^-100\d{5,}$/.test(values.channel_id)) return err(c, 400, "INVALID_VALUE", { key: "channel_id" });
  const badBrand = normalizeBrandSettings(values);
  if (badBrand) return bad(badBrand);
  await c.env.DB.batch([...setSettingsStmts(c.env, values), bumpCatalogStmt(c.env)]);
  const s = await getSettings(c.env);
  if (values.default_markup_pct !== undefined) await c.env.DB.batch(rebuildSummaryStmts(c.env, s));
  if (values.only_timed !== undefined && values.only_timed !== c.get("settings").only_timed) await startSync(c.env, { force: true, strict: true });
  return c.json({ ok: true });
});

admin.put("/owners", async (c) => {
  const b = await readBody<{ added?: unknown }>(c);
  if (!b || !Array.isArray(b.added) || b.added.length > 20) return err(c, 400, "INVALID_BODY");
  const ids: number[] = [];
  for (const v of b.added) {
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n <= 0) return err(c, 400, "INVALID_VALUE", { key: "added" });
    if (!ids.includes(n)) ids.push(n);
  }
  const fixed = envOwners(c.env);
  const added = ids.filter((n) => !fixed.includes(n));
  if (!fixed.length && !added.length) return err(c, 400, "LAST_OWNER");
  await setSettings(c.env, { owner_ids: added.join(",") });
  return c.json({ ok: true, owners: { env: fixed, added } });
});

admin.post("/panel/config", async (c) => {
  const b = await readBody<{ base: string; key: string }>(c);
  if (!b || !b.base || !b.key) return err(c, 400, "MISSING_DATA");

  const check = await verifyPanelKey(b.base, b.key);
  if (!check.ok) return err(c, 400, check.code, { message: check.message });

  await setSettings(c.env, { panel_base: b.base.trim().replace(/\/+$/, ""), panel_api_key: b.key.trim() });
  return c.json({ ok: true, message: "Panel connected and saved successfully!" });
});

admin.put("/assets/:kind", async (c) => {
  const kind = c.req.param("kind");
  if (!isAssetKind(kind)) return err(c, 404, "NOT_FOUND");
  const len = Number(c.req.header("content-length") ?? 0);
  if (len > LIMITS.imageBytes) return err(c, 413, "TOO_LARGE", { max: LIMITS.imageBytes });
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const bad = checkImageUpload(c.req.header("content-type"), bytes);
  if (bad) return err(c, bad === "TOO_LARGE" ? 413 : 400, bad, bad === "TOO_LARGE" ? { max: LIMITS.imageBytes } : undefined);
  const s = await getSettings(c.env, { fresh: true });
  await c.env.DB.batch(putAssetStmts(c.env, s, kind, detectImageMime(bytes)!, bytes));
  const next = await getSettings(c.env, { fresh: true });
  return c.json({ ok: true, version: kind === "logo" ? next.logo_ver : next.banner_ver });
});

admin.delete("/assets/:kind", async (c) => {
  const kind = c.req.param("kind");
  if (!isAssetKind(kind)) return err(c, 404, "NOT_FOUND");
  await c.env.DB.batch(deleteAssetStmts(c.env, await getSettings(c.env, { fresh: true }), kind));
  return c.json({ ok: true });
});

admin.post("/sync", async (c) => {
  if (!syncProgress(c.get("settings")).running) await startSync(c.env, { force: true });
  return c.json({ ok: true, ...syncProgress(await getSettings(c.env)) });
});

admin.get("/platforms", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.platform AS slug, COUNT(*) AS count, SUM(s.enabled) AS enabled, pr.enabled AS rule_enabled, pr.markup_pct
     FROM services s LEFT JOIN category_rules pr ON pr.platform = s.platform AND pr.category = ''
     WHERE s.present = 1 GROUP BY s.platform ORDER BY count DESC`,
  ).all<{ slug: string; count: number; enabled: number; rule_enabled: number | null; markup_pct: number | null }>();
  return c.json(
    results.map((r) => ({
      slug: r.slug,
      name: platformName(r.slug),
      count: r.count,
      enabledServices: r.enabled,
      enabled: r.rule_enabled !== 0,
      markupPct: r.markup_pct,
    })),
  );
});

admin.get("/categories", async (c) => {
  const platform = c.req.query("platform") ?? "";
  const { results } = await c.env.DB.prepare(
    `SELECT s.category AS name, COUNT(*) AS count, SUM(s.enabled) AS enabled, MIN(s.sort) AS sort, cr.enabled AS rule_enabled, cr.markup_pct
     FROM services s LEFT JOIN category_rules cr ON cr.platform = s.platform AND cr.category = s.category
     WHERE s.present = 1 AND s.platform = ?1 GROUP BY s.category ORDER BY sort`,
  )
    .bind(platform)
    .all<{ name: string; count: number; enabled: number; rule_enabled: number | null; markup_pct: number | null }>();
  return c.json(
    results.map((r) => ({ name: r.name, count: r.count, enabledServices: r.enabled, enabled: r.rule_enabled !== 0, markupPct: r.markup_pct })),
  );
});

admin.put("/rule", async (c) => {
  const b = await readBody<{ platform: string; category?: string; enabled?: boolean; markupPct?: number | null }>(c);
  if (!b) return err(c, 400, "INVALID_BODY");
  if (!b.platform || typeof b.platform !== "string") return err(c, 400, "MISSING_PLATFORM");
  const markup = b.markupPct === undefined ? undefined : b.markupPct === null ? null : Number(b.markupPct);
  if (markup !== undefined && markup !== null && (!Number.isFinite(markup) || markup < 0 || markup > 1000)) return err(c, 400, "INVALID_VALUE");
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO category_rules (platform, category, enabled, markup_pct) VALUES (?1, ?2, COALESCE(?3, 1), ?4)
       ON CONFLICT(platform, category) DO UPDATE SET enabled = COALESCE(?3, enabled), markup_pct = CASE WHEN ?5 THEN ?4 ELSE markup_pct END`,
    ).bind(b.platform, b.category ?? "", b.enabled === undefined ? null : b.enabled ? 1 : 0, markup ?? null, markup !== undefined ? 1 : 0),
    ...rebuildSummaryStmts(c.env, c.get("settings")),
    bumpCatalogStmt(c.env),
  ]);
  return c.json({ ok: true });
});

const PAGE = 50;
const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, "")}%`;
const intParam = (v: string | undefined) => {
  const n = Number(v);
  return v && Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};
function page<T>(rows: T[], cursor: (last: T) => string | number) {
  const more = rows.length > PAGE;
  const items = more ? rows.slice(0, PAGE) : rows;
  return { items, next: more ? cursor(items[PAGE - 1]) : null };
}

admin.get("/services", async (c) => {
  const s = c.get("settings");
  const platform = c.req.query("platform");
  const category = c.req.query("category");
  const q = (c.req.query("q") ?? "").trim();
  const attention = c.req.query("attention") === "1";
  const where = ["s.present = 1"];
  const vals: unknown[] = [s.default_markup_pct];
  if (platform) {
    vals.push(platform);
    where.push(`s.platform = ?${vals.length}`);
  }
  if (category) {
    vals.push(category);
    where.push(`s.category = ?${vals.length}`);
  }
  if (q) {
    vals.push(/^\d+$/.test(q) ? Number(q) : -1, likeOf(q));
    where.push(`(s.id = ?${vals.length - 1} OR s.name LIKE ?${vals.length} OR s.custom_name LIKE ?${vals.length})`);
  }
  if (attention) where.push("s.fixed_rate IS NOT NULL AND s.fixed_rate < s.rate");
  const offset = Math.min(intParam(c.req.query("offset")) ?? 0, 100_000);
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.custom_name, s.platform, s.category, s.rate, s.min, s.max, s.enabled, s.markup_pct, s.fixed_rate,
       ${MARKUP_SQL} AS markup, (SELECT old_rate FROM price_changes p WHERE p.service_id = s.id ORDER BY p.id DESC LIMIT 1) AS prev_rate
     FROM services s ${RULE_JOINS} WHERE ${where.join(" AND ")} ORDER BY s.sort, s.id LIMIT ${PAGE + 1} OFFSET ${offset}`,
  )
    .bind(...vals)
    .all<{ id: number; name: string; custom_name: string | null; platform: string; category: string; rate: number; min: number; max: number; enabled: number; markup_pct: number | null; fixed_rate: number | null; markup: number; prev_rate: number | null }>();
  const pg = page(results, () => offset + PAGE);
  return c.json({
    next: pg.next,
    items: pg.items.map((r) => ({
      id: r.id,
      name: r.name,
      customName: r.custom_name,
      platform: r.platform,
      category: r.category,
      cost: r.rate,
      prevCost: r.prev_rate,
      sell: sellRate(r.rate, r.markup, r.fixed_rate),
      sellStars: shownStars(sellRate(r.rate, r.markup, r.fixed_rate), s.stars_per_usd),
      starsPerUsd: s.stars_per_usd,
      markup: r.markup,
      markupPct: r.markup_pct,
      fixedRate: r.fixed_rate,
      min: r.min,
      max: r.max,
      enabled: !!r.enabled,
    })),
  });
});

admin.put("/services/:id", async (c) => {
  const b = await readBody<{ enabled?: boolean; markupPct?: number | null; fixedRate?: number | null; customName?: string | null }>(c);
  if (!b) return err(c, 400, "INVALID_BODY");
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (col: string, v: unknown) => {
    vals.push(v);
    sets.push(`${col} = ?${vals.length}`);
  };
  if (b.enabled !== undefined) set("enabled", b.enabled ? 1 : 0);
  if (b.markupPct !== undefined) {
    if (b.markupPct !== null && (!Number.isFinite(b.markupPct) || b.markupPct < 0 || b.markupPct > 1000)) return err(c, 400, "INVALID_VALUE");
    set("markup_pct", b.markupPct);
  }
  if (b.fixedRate !== undefined) {
    if (b.fixedRate !== null && (!Number.isFinite(b.fixedRate) || b.fixedRate <= 0)) return err(c, 400, "INVALID_VALUE");
    set("fixed_rate", b.fixedRate === null ? null : Math.round(b.fixedRate));
  }
  if (b.customName !== undefined) set("custom_name", b.customName?.trim() ? b.customName.trim().slice(0, 200) : null);
  if (!sets.length) return c.json({ ok: true });
  vals.push(Number(c.req.param("id")));
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE services SET ${sets.join(", ")} WHERE id = ?${vals.length}`).bind(...vals),
    ...rebuildSummaryStmts(c.env, c.get("settings")),
    bumpCatalogStmt(c.env),
  ]);
  return c.json({ ok: true });
});

admin.get("/price-changes", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  const before = intParam(c.req.query("before"));
  const where: string[] = [];
  const vals: unknown[] = [];
  if (before) {
    vals.push(before);
    where.push(`p.id < ?${vals.length}`);
  }
  if (q) {
    vals.push(/^\d+$/.test(q) ? Number(q) : -1, likeOf(q));
    where.push(`(p.service_id = ?${vals.length - 1} OR s.name LIKE ?${vals.length})`);
  }
  const sql = `SELECT p.id, p.service_id, p.old_rate, p.new_rate, p.changed_at, s.name, s.platform, s.category
    FROM price_changes p LEFT JOIN services s ON s.id = p.service_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY p.id DESC LIMIT ${PAGE + 1}`;
  const { results } = await c.env.DB.prepare(sql).bind(...vals).all();
  return c.json(page(results, (r: any) => r.id));
});

admin.get("/payments", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  const status = c.req.query("status") ?? "";
  const before = intParam(c.req.query("before"));
  const where: string[] = [];
  const vals: unknown[] = [];
  if (before) {
    vals.push(before);
    where.push(`p.id < ?${vals.length}`);
  }
  if (status === "paid" || status === "refunded") {
    vals.push(status);
    where.push(`p.status = ?${vals.length}`);
  }
  if (q) {
    const n = /^\d+$/.test(q) ? Number(q) : -1;
    vals.push(n, n, `%${q.replace(/[\\%_]/g, "").replace(/^@/, "")}%`);
    where.push(`(p.id = ?${vals.length - 2} OR p.user_id = ?${vals.length - 1} OR u.username LIKE ?${vals.length})`);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.user_id, p.stars, p.amount, p.status, p.order_id, p.paid_at, u.first_name, u.username
     FROM payments p LEFT JOIN users u ON u.id = p.user_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY p.id DESC LIMIT ${PAGE + 1}`,
  ).bind(...vals).all();
  const [totals] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT COALESCE(SUM(stars), 0) AS stars, COALESCE(SUM(amount), 0) AS amount FROM payments WHERE status = 'paid'"),
  ]);
  return c.json({
    items: results.slice(0, PAGE),
    next: results.length > PAGE ? (results[PAGE - 1] as any).id : null,
    totals: totals.results[0],
    starsPerUsd: c.get("settings").stars_per_usd,
  });
});

admin.post("/payments/:id/refund", async (c) => {
  try {
    await refundPayment(c.env, Number(c.req.param("id")));
    return c.json({ ok: true });
  } catch (e) {
    return err(c, 400, (e as Error).message);
  }
});

admin.get("/referrals", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  const before = intParam(c.req.query("before"));
  const s = c.get("settings");
  const [totals, top, recent] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS invited, SUM(CASE WHEN status != 'pending' THEN 1 ELSE 0 END) AS joined,
              SUM(CASE WHEN status = 'rewarded' THEN 1 ELSE 0 END) AS rewarded,
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN status = 'capped' THEN 1 ELSE 0 END) AS capped,
              COALESCE(SUM(reward), 0) AS paid,
              SUM(CASE WHEN created_at >= strftime('%s','now','start of day') THEN 1 ELSE 0 END) AS todayInvited,
              COALESCE(SUM(CASE WHEN status = 'rewarded' AND rewarded_at >= strftime('%s','now','start of day') THEN reward ELSE 0 END), 0) AS todayPaid
       FROM referrals`,
    ),
    c.env.DB.prepare(
      `SELECT u.id, u.first_name, u.last_name, u.username,
              COUNT(r.referred_id) AS invited,
              SUM(CASE WHEN r.status != 'pending' THEN 1 ELSE 0 END) AS joined,
              COALESCE(SUM(r.reward), 0) AS earned
       FROM referrals r JOIN users u ON u.id = r.referrer_id
       GROUP BY u.id ORDER BY earned DESC LIMIT 5`,
    ),
    c.env.DB.prepare(
      `SELECT r.referred_id, r.referrer_id, r.status, r.reward, r.created_at, r.rewarded_at,
              f.first_name AS f_first, f.last_name AS f_last, f.username AS f_user,
              p.first_name AS r_first, p.last_name AS r_last, p.username AS r_user
       FROM referrals r
       LEFT JOIN users f ON f.id = r.referred_id
       LEFT JOIN users p ON p.id = r.referrer_id
       ${q || before ? "WHERE" : ""} ${before ? "r.referred_id < ?1" : ""} ${before && q ? "AND" : ""} ${q ? "(f.first_name LIKE ?2 OR f.username LIKE ?2 OR p.first_name LIKE ?2 OR p.username LIKE ?2 OR CAST(r.referrer_id AS TEXT) LIKE ?2)" : ""}
       ORDER BY r.created_at DESC LIMIT ${PAGE + 1}`,
    ).bind(...[before ?? 0, q ? `%${q.replace(/[\\%_]/g, "")}%` : "%"]),
  ]);
  const recentRows = recent.results as any[];
  return c.json({
    totals: totals.results[0],
    top: top.results,
    recent: recentRows.slice(0, PAGE),
    next: recentRows.length > PAGE ? recentRows[PAGE - 1].referred_id : null,
    settings: {
      enabled: !!s.referral_enabled,
      rewardStars: s.referral_reward_stars,
      dailyCap: s.referral_daily_cap,
      starsPerUsd: s.stars_per_usd,
    },
  });
});

admin.get("/users", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  const before = intParam(c.req.query("before"));
  const where: string[] = [];
  const vals: unknown[] = [];
  if (before) {
    vals.push(before);
    where.push(`u.id < ?${vals.length}`);
  }
  if (q) {
    vals.push(/^\d+$/.test(q) ? Number(q) : -1, likeOf(q.replace(/^@/, "")));
    where.push(`(u.id = ?${vals.length - 1} OR u.first_name LIKE ?${vals.length} OR u.username LIKE ?${vals.length})`);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.first_name, u.last_name, u.username, u.balance, u.banned, u.last_seen_at,
            (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders,
            (SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.user_id = u.id AND p.status = 'paid') AS paid
     FROM users u ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY u.id DESC LIMIT ${PAGE + 1}`,
  ).bind(...vals).all();
  return c.json(page(results, (u: any) => u.id));
});

admin.post("/users/:id/balance", async (c) => {
  const b = await readBody<{ amount: number; note?: string }>(c);
  if (!b || !Number.isFinite(b.amount) || b.amount === 0) return err(c, 400, "INVALID_AMOUNT");
  const id = Number(c.req.param("id"));
  const s = c.get("settings");
  const micro = Math.round((Math.abs(b.amount) * 1_000_000) / s.stars_per_usd) * (b.amount < 0 ? -1 : 1);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET balance = balance + ?1 WHERE id = ?2").bind(micro, id),
    c.env.DB.prepare("INSERT INTO ledger (user_id, delta, kind, note, created_at) VALUES (?1, ?2, 'admin', ?3, unixepoch())").bind(id, micro, b.note ?? "admin"),
  ]);
  return c.json({ ok: true });
});

admin.post("/users/:id/ban", async (c) => {
  const b = await readBody<{ banned: boolean }>(c);
  if (!b) return err(c, 400, "INVALID_BODY");
  await c.env.DB.prepare("UPDATE users SET banned = ?1 WHERE id = ?2").bind(b.banned ? 1 : 0, Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

admin.get("/orders", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  const status = c.req.query("status") ?? "";
  const before = intParam(c.req.query("before"));
  const where: string[] = [];
  const vals: unknown[] = [];
  if (before) {
    vals.push(before);
    where.push(`o.id < ?${vals.length}`);
  }
  if (status === "open") where.push("o.status IN ('submitting','pending','processing','in_progress')");
  else if (status) {
    vals.push(status);
    where.push(`o.status = ?${vals.length}`);
  }
  if (q) {
    const n = /^\d+$/.test(q) ? Number(q) : -1;
    vals.push(n, n, `%${q.replace(/[\\%_]/g, "")}%`);
    where.push(`(o.id = ?${vals.length - 2} OR o.np_order_id = ?${vals.length - 1} OR o.link LIKE ?${vals.length})`);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT o.*, u.first_name AS user_name, u.username FROM orders o LEFT JOIN users u ON u.id = o.user_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY o.id DESC LIMIT ${PAGE + 1}`,
  ).bind(...vals).all<OrderRow & { user_name: string; username: string | null }>();
  const pg = page(results, (o) => o.id);
  return c.json({
    items: pg.items.map((o) => ({ ...orderView(o), npOrderId: o.np_order_id, cost: o.cost, rate: o.rate, userId: o.user_id, userName: o.user_name, username: o.username, error: o.error })),
    next: pg.next,
    starsPerUsd: c.get("settings").stars_per_usd,
  });
});

export async function connect(c: any) {
  const r = await connectAll(c.env, new URL(c.req.url).origin);
  for (let batch: number | null = 0; batch !== null; ) batch = (await syncBotTexts(c.env, batch)).next;
  await registerNotPanelWebhook(c.env);
  return c.json({ ok: true, ...r });
}

admin.post("/connect", async (c) => {
  const r = await connectAll(c.env, new URL(c.req.url).origin);
  const np = await registerNotPanelWebhook(c.env);
  return c.json({ ok: true, bot: c.get("settings").bot_username, notpanelWebhook: np ?? true });
});

admin.post("/bot-texts/:batch", async (c) => {
  const next = await syncBotTexts(c.env, Number(c.req.param("batch")) || 0);
  return c.json({ next });
});

admin.post("/preview-messages", async (c) => {
  const me = c.get("user");
  const s = c.get("settings");
  const lang = (c.get("lang") ?? "en") as Lang;
  let sent = 0;
  sent += await sendPreviews(c.env, me.id, lang, me.first_name, ["en", "es", "pt"] as any);
  void s;
  return c.json({ sent });
});