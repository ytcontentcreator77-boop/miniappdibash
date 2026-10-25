import { Hono } from "hono";
import { LANGS, pickLang } from "../shared/types";
import { timingSafeEqual } from "./auth";
import { sendPreviews } from "./botMessages";
import { checkChannel } from "./growth";
import { connectAll, syncBotTexts } from "./connect";
import { ownerIds } from "./env";
import { mediaResponse } from "./assets";
import { pub, setup } from "./routes/setup";
import { getSettings } from "./settings";
import { emojiFallbacks, tg } from "./telegram";
import type { Env } from "./env";
import { pollOpenOrders } from "./orders";
import { cleanupPendingPayments } from "./payments";
import { admin } from "./routes/admin";
import { app as api } from "./routes/app";
import { bot } from "./routes/bot";
import { cleanupWebhookEvents, hooks } from "./routes/hooks";
import { commandsTick } from "./commands";
import { cleanupRateLimits } from "./rateLimit";
import { syncTick } from "./sync";
import manualPay from "./manualPay";

api.route("/admin", admin);
// Mount manualPay INSIDE the api router so it gets the auth middleware
api.route("/pay", manualPay);

const app = new Hono<{ Bindings: Env }>();

const setupOk = (env: Env, given: string) => !!env.SETUP_SECRET && timingSafeEqual(given, env.SETUP_SECRET);

app.route("/api", pub);
app.route("/api/setup", setup);
app.route("/api", api);
app.get("/media/:kind", (c) => mediaResponse(c.env, c.req.param("kind"), c.req.query("v")));
app.get("/media/qr", async (c) => {
  const id = c.req.query("id");
  if (!id) return c.text("Not found", 404);
  const row = await c.env.DB.prepare("SELECT qr_key FROM payment_methods WHERE id = ?1").bind(Number(id)).first<{ qr_key: string | null }>();
  if (!row?.qr_key) return c.text("Not found", 404);
  const asset = await c.env.DB.prepare("SELECT mime, data FROM assets WHERE kind = ?1").bind(row.qr_key).first<{ mime: string; data: string }>();
  if (!asset) return c.text("Not found", 404);
  const bytes = Uint8Array.from(atob(asset.data), (ch) => ch.charCodeAt(0));
  return new Response(bytes, {
    headers: { "content-type": asset.mime, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" },
  });
});
app.route("/bot", bot);
app.route("/hooks", hooks);

app.get("/setup/:secret", async (c) => {
  if (!setupOk(c.env, c.req.param("secret"))) return c.text("Not found", 404);
  try {
    const r = await connectAll(c.env, new URL(c.req.url).origin);
    return c.json({ ok: true, ...r, next: "Open your bot in Telegram and press Start." });
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message }, 500);
  }
});

app.get("/setup/:secret/texts/:batch", async (c) => {
  if (!setupOk(c.env, c.req.param("secret"))) return c.text("Not found", 404);
  try {
    return c.json({ ok: true, next: await syncBotTexts(c.env, Number(c.req.param("batch")) || 0) });
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message }, 500);
  }
});

app.get("/setup/:secret/preview", async (c) => {
  if (!setupOk(c.env, c.req.param("secret"))) return c.text("Not found", 404);
  const lang = pickLang(c.req.query("lang"));
  const owners = ownerIds(c.env, await getSettings(c.env));
  let sent = 0;
  const before = emojiFallbacks.count;
  for (const id of owners) {
    const u = await c.env.DB.prepare("SELECT first_name FROM users WHERE id = ?1").bind(id).first<{ first_name: string }>();
    sent += await sendPreviews(c.env, id, lang, u?.first_name ?? "", LANGS);
  }
  const fallbacks = emojiFallbacks.count - before;
  return c.json({ ok: true, owners: owners.length, sent, customEmoji: fallbacks ? `refused ${fallbacks}x: ${emojiFallbacks.last}` : "accepted" });
});

app.get("/setup/:secret/channel", async (c) => {
  if (!setupOk(c.env, c.req.param("secret"))) return c.text("Not found", 404);
  const s = await getSettings(c.env, { fresh: true });
  try {
    const chat = await tg<{ id: number; title: string; type: string }>(c.env.BOT_TOKEN, "getChat", { chat_id: s.channel_id });
    const me = await tg<{ id: number }>(c.env.BOT_TOKEN, "getMe");
    const bot = await tg<{ status: string }>(c.env.BOT_TOKEN, "getChatMember", { chat_id: s.channel_id, user_id: me.id });
    const owners = ownerIds(c.env, s);
    const ownerCheck = owners.length ? await checkChannel(c.env, s, owners[0]) : null;
    return c.json({ ok: true, channel: { id: chat.id, title: chat.title, type: chat.type }, botStatus: bot.status, ownerMembership: ownerCheck });
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message }, 500);
  }
});

app.onError((e, c) => {
  console.error(e);
  return c.json({ error: "INTERNAL", code: "INTERNAL" }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    const jobs: Promise<unknown>[] = [pollOpenOrders(env), syncTick(env), commandsTick(env)];
    if (new Date(controller.scheduledTime).getUTCMinutes() === 7) jobs.push(cleanupWebhookEvents(env), cleanupPendingPayments(env), cleanupRateLimits(env));
    ctx.waitUntil(
      Promise.allSettled(jobs).then((rs) => {
        for (const r of rs) if (r.status === "rejected") console.error("cron job failed", r.reason);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
