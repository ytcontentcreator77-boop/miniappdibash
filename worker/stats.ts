// /stats for admins: sales and profit (today, 7 days, all time), users, open orders, referrals and the Panel balance.
// English only, like the admin panel. Money is micro-USD; sales are also shown in Stars as customers saw them.
import { shownStars } from "../shared/stars";
import { starsText } from "./botMessages";
import type { Env } from "./env";
import { npCall, usdToMicro } from "./notpanel";
import { getSettings } from "./settings";
import { tg, webAppButton } from "./telegram";

const DAY = 86400;
const usd = (micro: number) => "$" + (micro / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n = (v: number) => v.toLocaleString("en-US");

export function dayStartUtc(now = Date.now()): number {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

export async function sendStats(env: Env, chatId: number): Promise<void> {
  const s = await getSettings(env);
  const today = dayStartUtc();
  const week = today - 6 * DAY;
  
  const [orders, users, open, refs] = await env.DB.batch([
    // Failed orders were fully refunded, so they are not sales
    env.DB.prepare(
      `SELECT
         COALESCE(SUM(created_at >= ?1), 0) AS d_orders, COALESCE(SUM(CASE WHEN created_at >= ?1 THEN charge - refund END), 0) AS d_sales,
         COALESCE(SUM(CASE WHEN created_at >= ?1 THEN charge - refund - COALESCE(cost, 0) END), 0) AS d_profit,
         COALESCE(SUM(created_at >= ?2), 0) AS w_orders, COALESCE(SUM(CASE WHEN created_at >= ?2 THEN charge - refund END), 0) AS w_sales,
         COALESCE(SUM(CASE WHEN created_at >= ?2 THEN charge - refund - COALESCE(cost, 0) END), 0) AS w_profit,
         COUNT(*) AS a_orders, COALESCE(SUM(charge - refund), 0) AS a_sales, COALESCE(SUM(charge - refund - COALESCE(cost, 0)), 0) AS a_profit
       FROM orders WHERE status != 'failed'`,
    ).bind(today, week),
    env.DB.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(created_at >= ?1), 0) AS today FROM users").bind(today),
    env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE status IN ('submitting','pending','processing','in_progress')"),
    env.DB.prepare("SELECT COUNT(*) AS joined, COALESCE(SUM(status = 'rewarded' AND rewarded_at >= ?1), 0) AS today FROM referrals WHERE status != 'pending'").bind(today),
  ]);
  
  const o = orders.results[0] as Record<string, number>;
  const u = users.results[0] as { total: number; today: number };
  const r = refs.results[0] as { joined: number; today: number };
  
  let balance = "<i>unavailable</i>";
  try {
    const b = usdToMicro((await npCall<{ balance: string }>(env, "balance")).balance);
    balance = `<b>${usd(b)}</b>${b < s.low_balance ? " ⚠️ low, top up soon" : ""}`;
  } catch {
    /* Panel unreachable: show the rest anyway */
  }
  
  const block = (title: string, p: "d" | "w" | "a") =>
    `<b>${title}</b>\n` +
    `<blockquote>` +
    `  🧾 Orders: <b>${n(o[`${p}_orders`])}</b>\n` +
    `  💰 Sales: <b>${usd(o[`${p}_sales`])}</b> (${starsText(shownStars(o[`${p}_sales`], s.stars_per_usd))})\n` +
    `  📈 Profit: <b>${usd(o[`${p}_profit`])}</b>` +
    `</blockquote>`;
    
  const text =
    "📊 <b>Business Statistics</b>\n\n" +
    `${block("Today (UTC)", "d")}\n\n${block("Last 7 days", "w")}\n\n${block("All time", "a")}\n\n` +
    "<b>General Overview</b>\n" +
    `<blockquote>` +
    `  👥 Users: <b>${n(u.total)}</b> (+${n(u.today)} today)\n` +
    `  ⏳ Open orders: <b>${n((open.results[0] as { n: number }).n)}</b>\n` +
    `  🎁 Referrals: <b>${n(r.joined)}</b> joined (+${n(r.today)} paid today)\n` +
    `  🏦 Panel balance: ${balance}` +
    "</blockquote>";
    
  await tg(env.BOT_TOKEN, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: s.app_url ? { inline_keyboard: [[webAppButton("Open Admin Panel", `${s.app_url}/#/admin`)]] } : undefined,
  });
}

export async function sendAdminLink(env: Env, chatId: number): Promise<void> {
  const s = await getSettings(env);
  await tg(env.BOT_TOKEN, "sendMessage", {
    chat_id: chatId,
    text: "🛠 <b>Admin Panel</b>\n\n<blockquote>Manage your prices, branding, orders, users, manual payments, and settings directly inside the app.</blockquote>\n\n<i>Use /stats to see today's numbers right here in the chat.</i>",
    parse_mode: "HTML",
    reply_markup: s.app_url ? { inline_keyboard: [[webAppButton("Open Admin Panel", `${s.app_url}/#/admin`)]] } : undefined,
  });
}