import { DEFAULT_PRESET } from "../shared/brand";
import { brandName, parseButtonIcons, parseEmojiMap } from "./brand";
import type { Env } from "./env";
import { setBotBrand } from "./i18n";
import { setCustomization } from "./telegram";

export const DEFAULTS = {
  default_markup_pct: 30,
  stars_per_usd: 77,
  stars_per_inr: 6400,
  min_topup_stars: 50,
  max_topup_stars: 10_000,
  sync_enabled: 1,
  sync_every_hours: 6,
  auto_enable_new: 1,
  only_timed: 1,
  low_balance: 5_000_000,
  support_username: "",
  channel_url: "",
  channel_id: "",
  channel_gate: 1,
  referral_enabled: 1,
  referral_reward_stars: 3,
  referral_daily_cap: 50,
  terms_text:
    "📄 <b>Terms of Service</b>\n\nBalance top-ups are processed in Telegram Stars or via manual payment (admin approval). Undelivered portions are automatically refunded to your balance. Public profiles only.",
  last_sync_at: 0,
  last_sync_summary: "",
  sync_state: "",
  last_catalog_at: "",
  catalog_version: 1,
  app_url: "",
  welcome_photo: "",
  bot_username: "",
  np_webhook_id: "",
  np_webhook_secret: "",
  brand_name: "",
  brand_preset: DEFAULT_PRESET,
  brand_accent: "#2457ff",
  website_url: "",
  terms_url: "",
  welcome_text: "",
  custom_emoji: "{}",
  button_icons: '{"open":"","viewOrder":"","terms":"","invite":""}',
  owner_ids: "",
  claim_code_hash: "",
  claim_expires: 0,
  np_api_key: "",
  panel_base: "",
  panel_api_key: "",
  default_currency: "INR",
  display_currencies:
    '[{"code":"INR","symbol":"₹","rate_micro_usd":12000},{"code":"USD","symbol":"$","rate_micro_usd":1000000},{"code":"EUR","symbol":"€","rate_micro_usd":1080000},{"code":"GBP","symbol":"£","rate_micro_usd":1260000},{"code":"AED","symbol":"د.إ","rate_micro_usd":272300},{"code":"SAR","symbol":"﷼","rate_micro_usd":266600},{"code":"PKR","symbol":"₨","rate_micro_usd":3600},{"code":"BDT","symbol":"৳","rate_micro_usd":8400},{"code":"NGN","symbol":"₦","rate_micro_usd":1500},{"code":"IDR","symbol":"Rp","rate_micro_usd":62},{"code":"MYR","symbol":"RM","rate_micro_usd":213000},{"code":"TRY","symbol":"₺","rate_micro_usd":29000}]',
  logo_ver: 0,
  banner_ver: 0,
  setup_done: 0,
  commands_key: "",
  commands_step: 0,
  commands_admins: "",
  setup_steps: "",
};

export type Settings = typeof DEFAULTS;
export type SettingKey = keyof Settings;

let memo: { at: number; value: Settings } | null = null;
const MEMO_MS = 15_000;

export async function getSettings(env: Env, opts: { fresh?: boolean } = {}): Promise<Settings> {
  if (!opts.fresh && memo && Date.now() - memo.at < MEMO_MS) return memo.value;
  const value = await loadSettings(env);
  memo = { at: Date.now(), value };
  applyBranding(value);
  return value;
}

let applied = "";
function applyBranding(s: Settings): void {
  const sig = `${s.brand_name}\u0000${s.custom_emoji}\u0000${s.button_icons}`;
  if (sig === applied) return;
  applied = sig;
  setBotBrand(brandName(s));
  setCustomization(parseEmojiMap(s.custom_emoji), parseButtonIcons(s.button_icons));
}

async function loadSettings(env: Env): Promise<Settings> {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const s: any = { ...DEFAULTS };
  for (const r of results) {
    if (!(r.key in DEFAULTS)) continue;
    s[r.key] = typeof (DEFAULTS as any)[r.key] === "number" ? Number(r.value) : r.value;
  }
  return s as Settings;
}

export function bustSettings(): void {
  memo = null;
}

export function setSettingsStmts(env: Env, values: Partial<Settings>): D1PreparedStatement[] {
  memo = null;
  return Object.entries(values).map(([k, v]) =>
    env.DB.prepare("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(
      k,
      String(v),
    ),
  );
}

export async function setSettings(env: Env, values: Partial<Settings>): Promise<void> {
  memo = null;
  const stmts = setSettingsStmts(env, values);
  if (stmts.length) await env.DB.batch(stmts);
}

export function bumpCatalogStmt(env: Env): D1PreparedStatement {
  memo = null;
  return env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('catalog_version', '2') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1",
  );
}