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

// Mount manualPay directly on the app so it bypasses the strict /api auth
const app = new Hono<{ Bindings: Env }>();
app.route("/api/pay", manualPay);

api.route("/admin", admin);
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
  return new Response(bytes, { headers: { "content-type": asset.mime, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
});

app.route("/bot", bot);
app.route("/hooks", hooks);

app.onError((e, c) => {
  console.error(e);
  return c.json({ error: "INTERNAL", code: "INTERNAL" }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    const jobs: Promise<unknown>[] = [pollOpenOrders(env), syncTick(env), commandsTick(env)];
    if (new Date(controller.scheduledTime).getUTCMinutes() === 7) jobs.push(cleanupWebhookEvents(env), cleanupPendingPayments(env), cleanupRateLimits(env));
    ctx.waitUntil(Promise.allSettled(jobs).then((rs) => { for (const r of rs) if (r.status === "rejected") console.error("cron job failed", r.reason); }));
  },
} satisfies ExportedHandler<Env>;
