import { balanceStars, shownStars, underOneStar, formatCurrency } from "../shared/stars";
import { getLang } from "./i18n";
import { meStore } from "./store";

export const starsRate = () => meStore.get()?.starsPerUsd ?? 0;

/** Converts a micro-USD amount to the user's local currency (INR, USD, etc.) */
export function money(micro: number): string {
  const me = meStore.get();
  if (!me || !me.currency) return `$${(micro / 1000000).toFixed(2)}`;
  return formatCurrency(micro, me.display_currencies, me.currency);
}

/** A micro-USD price, charge, refund or credit → "$1.50" or "₹120" */
export function amount(micro: number, opts: { sign?: boolean } = {}): string {
  const val = money(micro);
  return opts.sign && micro > 0 ? `+${val}` : val;
}

/** A micro-USD balance → "$1.50" or "₹120" */
export function balance(micro: number): string {
  return money(micro);
}

/** Whole Telegram Stars → "1,250 ⭐" (used only where Stars are explicitly needed) */
export function stars(n: number, opts: { sign?: boolean } = {}): string {
  const v = Math.round(Math.abs(n));
  const sign = n < 0 ? "−" : opts.sign && n > 0 ? "+" : "";
  return `${sign}${num(v)} ⭐`;
}

export function locale(): string {
  const l = getLang();
  if (l === "zh") return "zh-CN";
  if (l === "ar" || l === "fa" || l === "ur" || l === "bn") return `${l}-u-nu-latn`;
  return l;
}

export function lower(s: string): string {
  try { return s.toLocaleLowerCase(getLang()); } catch { return s.toLowerCase(); }
}

export function num(n: number): string {
  return n.toLocaleString(locale());
}

export function short(n: number): string {
  if (n >= 1_000_000) return +(n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return +(n / 1000).toFixed(1) + "K";
  return String(n);
}

export function dateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString(locale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function dayKey(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(ts: number, today: string, yesterday: string): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return today;
  if (d.toDateString() === y.toDateString()) return yesterday;
  return d.toLocaleDateString(locale(), { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

export function duration(minutes: number, units: { m: string; h: string; d: string }): string {
  if (minutes < 60) return `${minutes} ${units.m}`;
  if (minutes <= 2880) return `${+(minutes / 60).toFixed(1)} ${units.h}`;
  return `${Math.round(minutes / 1440)} ${units.d}`;
}

export const iso = (s: string) => `⁦${s}⁩`;
export const isoIds = (s: string) => s.replace(/#\d+/g, (m) => iso(m));
export const lrm = (s: string) => `‎${s}`;

export function prettyLink(link: string): string {
  return link.replace(/^https?:\/\/(www\.)?/, "");
}
