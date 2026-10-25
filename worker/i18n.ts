// Messages the bot sends in chat. Placeholders: {name}, {brand} (filled automatically, see setBotBrand). Missing translations fall back to English.
import type { Lang } from "../shared/types";
import bot from "./bot-strings.json";

const en = {
  welcome:
    "👋 <b>Welcome to {brand}, {name}!</b>\n\n" +
    "Grow your social media presence quickly and securely. We provide premium services for all major platforms.\n\n" +
    "🚀 <b>What we offer:</b>\n" +
    "  • Followers, Likes, Views & Comments\n" +
    "  • Fast delivery and real-time tracking\n" +
    "  • Secure payments with Telegram Stars\n\n" +
    "<blockquote>Tap the button below to open the app and start your first order.</blockquote>",
  
  open: "🚀 Open App",
  
  chooseLanguage: "🌐 <b>Select Your Language</b>\n\nPlease choose a language from the options below. You can change this at any time using /language.",
  
  viewOrder: "🔍 View Order",
  
  orderPlaced:
    "✅ <b>Order Placed Successfully</b>\n\n" +
    "<describe>Your order has been received and added to the queue. We are processing it now.</describe>\n\n" +
    "<blockquote>" +
    "  • <b>ID:</b> #{id}\n" +
    "  • <b>Service:</b> {service}\n" +
    "  • <b>Quantity:</b> {quantity}\n" +
    "  • <b>Link:</b> {link}" +
    "</blockquote>\n\n" +
    "<i>We will notify you here as soon as it is completed.</i>",
  
  orderCompleted:
    "🎉 <b>Order Completed</b>\n\n" +
    "<describe>Your order has been successfully delivered. Thank you for choosing {brand}!</describe>\n\n" +
    "<blockquote>" +
    "  • <b>ID:</b> #{id}\n" +
    "  • <b>Service:</b> {service}\n" +
    "  • <b>Quantity:</b> {quantity}\n" +
    "  • <b>Link:</b> {link}" +
    "</blockquote>\n\n" +
    "<i>We hope to see you again soon.</i>",
  
  orderPartial:
    "⚠️ <b>Order Partially Completed</b>\n\n" +
    "<describe>We could only complete part of your order. The remaining balance has been automatically refunded to your wallet.</describe>\n\n" +
    "<blockquote>" +
    "  • <b>ID:</b> #{id}\n" +
    "  • <b>Service:</b> {service}\n" +
    "  • <b>Quantity:</b> {quantity}\n" +
    "  • <b>Refunded:</b> {refund}" +
    "</blockquote>",
  
  orderCancelled:
    "🚫 <b>Order Cancelled</b>\n\n" +
    "<describe>Your order has been cancelled. The full amount has been refunded to your balance.</describe>\n\n" +
    "<blockquote>" +
    "  • <b>ID:</b> #{id}\n" +
    "  • <b>Service:</b> {service}\n" +
    "  • <b>Quantity:</b> {quantity}\n" +
    "  • <b>Refunded:</b> {refund}" +
    "</blockquote>",
  
  orderFailed:
    "❌ <b>Order Failed to Start</b>\n\n" +
    "<describe>The order could not be placed, and your payment has been fully refunded.</describe>\n\n" +
    "<blockquote>" +
    "  • <b>ID:</b> #{id}\n" +
    "  • <b>Service:</b> {service}\n" +
    "  • <b>Refunded:</b> {refund}" +
    "</blockquote>\n\n" +
    "<i>Please ensure the link is correct and your profile is public, then try again.</i>",
  
  topupDone:
    "💳 <b>Balance Topped Up</b>\n\n" +
    "<describe>Your payment was successful, and your balance has been updated.</describe>\n\n" +
    "<blockquote>" +
    "  • <b>Amount Added:</b> {amount}\n" +
    "  • <b>New Balance:</b> {balance}" +
    "</blockquote>\n\n" +
    "🛍 <i>You are ready to place your next order!</i>",
  
  orderNotPlaced:
    "⚠️ <b>Payment Received</b>\n\n" +
    "<describe>Your payment was successful, but the order could not be placed. Your funds are safe in your balance.</describe>\n\n" +
    "<blockquote>" +
    "  • <b>Added to balance:</b> {amount}\n" +
    "  • <b>Order Status:</b> Failed (<i>{reason}</i>)" +
    "</blockquote>\n\n" +
    "<i>Please try again from the app.</i>",
  
  help:
    "ℹ️ <b>Help & Support</b>\n\n" +
    "  • <b>App:</b> Open using the button below\n" +
    "  • <b>Language:</b> Change via /language\n" +
    "  • <b>Support:</b> {support}\n\n" +
    "<blockquote>💬 <b>Questions about a payment?</b>\n" +
    "Please contact {support} with your payment date, amount, and screenshots if available. Telegram support cannot assist with purchases made inside this bot.</blockquote>",
  
  paysupport:
    "💳 <b>Payment Support</b>\n\n" +
    "If you have an issue with a payment, please contact us:\n" +
    "  • <b>Support:</b> {support}\n\n" +
    "<blockquote>📝 Please include your payment date, amount, and transaction ID (UTR) so we can assist you faster.</blockquote>",
  
  termsButton: "📄 Terms of Service",
  
  referralReward:
    "🎁 <b>Referral Bonus Received!</b>\n\n" +
    "<describe>You earned a reward because your friend joined using your link.</describe>\n\n" +
    "<blockquote>" +
    "  • <b>Friend:</b> {name} joined using your link\n" +
    "  • <b>Added:</b> {amount}\n" +
    "  • <b>New Balance:</b> {balance}" +
    "</blockquote>\n\n" +
    "<i>Invite more friends to keep earning!</i>",
  
  inviteMore: "Invite more friends",
  cmdStart: "Open {brand}",
  cmdLanguage: "Change language",
  cmdHelp: "Help and support",
  cmdOrders: "My orders",
  cmdWallet: "Balance and top-up",
  ordersReply: "📦 <b>Your Orders</b>\n\n<blockquote>Track every order live in the app.</blockquote>",
  walletReply: "👛 <b>Balance: {balance}</b>\n\n<blockquote>Top up with Telegram Stars in the app.</blockquote>",
  invoiceTitle: "{brand} balance",
  invoiceTopup: "Add {amount} to your {brand} balance",
  invoiceOrder: "{service} · {quantity}",
};

export type BotKey = keyof typeof en;
const all = bot as Partial<Record<Lang, Partial<Record<BotKey, string>>>>;

let botBrand = "NotBot";

/** Sets the brand name that fills {brand} in every bot text (call whenever settings load). */
export function setBotBrand(name: string) {
  if (name.trim()) botBrand = name.trim();
}

export function botText(lang: Lang, key: BotKey, vars: Record<string, string> = {}): string {
  const tpl = all[lang]?.[key] ?? en[key];
  return tpl.replace(/\{(\w+)\}/g, (_, k) => escapeHtml(vars[k] ?? (k === "brand" ? botBrand : "")));
}

/** Same, without HTML escaping, for plain-text places like invoice titles */
export function botPlain(lang: Lang, key: BotKey, vars: Record<string, string> = {}): string {
  const tpl = all[lang]?.[key] ?? en[key];
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? (k === "brand" ? botBrand : ""));
}

export const BOT_EN = en;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}