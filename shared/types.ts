import type { BrandInfo } from "./brand";

export const LANGS = [
  "en", "es", "pt", "ru", "tr", "ar", "hi", "id", "fr", "zh",
  "de", "it", "pl", "uk", "ja", "ko", "vi", "fa", "ur", "bn",
] as const;
export type Lang = (typeof LANGS)[number];

export const NP_LANGS: readonly Lang[] = ["en", "es", "pt", "ru", "tr", "ar", "hi", "id", "fr", "zh"];
export const RTL_LANGS: readonly Lang[] = ["ar", "fa", "ur"];

export const LANG_NAMES: Record<Lang, string> = {
  en: "English", es: "Español", pt: "Português", ru: "Русский", tr: "Türkçe", ar: "العربية",
  hi: "हिन्दी", id: "Bahasa Indonesia", fr: "Français", zh: "中文", de: "Deutsch", it: "Italiano",
  pl: "Polski", uk: "Українська", ja: "日本語", ko: "한국어", vi: "Tiếng Việt", fa: "فارسی",
  ur: "اردو", bn: "বাংলা",
};

export const LANG_FLAGS: Record<Lang, string> = {
  en: "🌐", es: "🇪🇸", pt: "🇧🇷", ru: "🇷🇺", tr: "🇹🇷", ar: "🇸🇦", hi: "🇮🇳", id: "🇮🇩", fr: "🇫🇷", zh: "🇨🇳",
  de: "🇩🇪", it: "🇮🇹", pl: "🇵🇱", uk: "🇺🇦", ja: "🇯🇵", ko: "🇰🇷", vi: "🇻🇳", fa: "🇮🇷", ur: "🇵🇰", bn: "🇧🇩",
};

export const langLabel = (l: Lang) => `${LANG_FLAGS[l]} ${LANG_NAMES[l]}`;

export function pickLang(code: string | null | undefined): Lang {
  const base = (code || "en").toLowerCase().split(/[-_]/)[0];
  return (LANGS as readonly string[]).includes(base) ? (base as Lang) : "en";
}

export const MICRO = 1_000_000;

export type OrderStatus =
  | "submitting" | "pending" | "processing" | "in_progress"
  | "completed" | "partial" | "cancelled" | "failed";

export const FINAL_STATUSES: OrderStatus[] = ["completed", "partial", "cancelled", "failed"];

export interface Me {
  id: number;
  firstName: string;
  lastName: string;
  username: string | null;
  photoUrl: string | null;
  lang: Lang;
  langChosen: boolean;
  balance: number;
  notify: boolean;
  canMessage: boolean;
  termsAccepted: boolean;
  isAdmin: boolean;
  starsPerUsd: number;
  minTopup: number;
  maxTopup: number;
  supportUsername: string | null;
  channelUrl: string | null;
  channelRequired: boolean;
  referralEnabled: boolean;
  referralReward: number;
  botUsername: string | null;
  recent: RecentOrder[];
  brand: BrandInfo;
  currency: string;
  display_currencies: string;
}

export interface RecentOrder {
  id: number;
  serviceId: number;
  serviceName: string;
  platform: string;
  link: string;
  quantity: number;
}

export interface PlatformItem { slug: string; name: string; count: number; }
export interface CategoryItem { name: string; count: number; fromRate: number; }

export interface ServiceItem {
  id: number;
  name: string;
  platform: string;
  category: string;
  rate: number;
  min: number;
  max: number;
  refill: boolean;
  cancel: boolean;
  avgMinutes: number | null;
}

export type FieldKind = "integer" | "text" | "lines" | "choice" | "url" | "reactions";
export interface ServiceField {
  key: string;
  kind: FieldKind;
  required: boolean;
  label: string;
  min?: number;
  max?: number;
  max_length?: number;
  choices?: string[];
  allowed?: string[];
  max_distinct?: number;
  modes?: string[];
}

export interface DripFeed { mode: "batches" | "unit_delay"; max_total_minutes: number; }
export type QuantityMode = "free" | "fixed" | "lines";

export interface ServiceDetail extends ServiceItem {
  typeKey: string;
  quantityMode: QuantityMode;
  linesField: string | null;
  step: number;
  fields: ServiceField[];
  dripFeed: DripFeed | null;
  description: string | null;
}

export interface OrderView {
  id: number;
  number: number;
  serviceId: number;
  serviceName: string;
  platform: string;
  category: string;
  link: string;
  quantity: number;
  charge: number;
  refund: number;
  status: OrderStatus;
  startCount: number | null;
  remains: number | null;
  reasonCode: string | null;
  canCancel: boolean;
  canRefill: boolean;
  refillStatus: string | null;
  paidWithStars: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface LedgerItem {
  id: number;
  delta: number;
  kind: "topup" | "order" | "refund" | "admin" | "stars_refund" | "referral";
  ref: number | null;
  orderNumber: number | null;
  note: string | null;
  createdAt: number;
}

export interface OrderDraft {
  serviceId: number;
  link: string;
  quantity?: number;
  fields?: Record<string, string>;
  dripMinutes?: number;
}

export interface Quote { quantity: number; charge: number; }
export interface ApiError { error: string; code: string; details?: Record<string, unknown>; }

export interface ReferralStats {
  link: string | null;
  enabled: boolean;
  rewardStars: number;
  reward: number;
  invited: number;
  joined: number;
  earned: number;
  recent: { name: string; status: "pending" | "rewarded" | "capped"; at: number }[];
}

export type ChannelVerify = { result: "member" | "not_member" | "unavailable"; me: Me };

export interface PaymentMethod {
  id: number;
  name: string;
  currency: string;
  min_amount: number;
  max_amount: number;
  description: string;
  qr_key: string | null;
  auto_approve: number;
  enabled: number;
}

export interface ManualPayment {
  id: number;
  user_id: number;
  method_id: number;
  amount: number;
  currency: string;
  utr: string;
  status: "pending" | "accepted" | "declined" | "auto";
  credited_micro_usd: number;
  admin_id?: number | null;
  created_at: number;
  decided_at: number | null;
  method_name?: string;
  first_name?: string;
  username?: string | null;
  qr_key?: string | null;
}