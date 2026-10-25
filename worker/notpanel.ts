// Minimal SMM Panel API client (NotPanel v3-compatible).
// The base URL and API key are now dynamically loaded from settings (Admin Panel) 
// so you can connect any reseller panel.
import type { Env } from "./env";
import { getSettings, type Settings } from "./settings";

export class NotPanelError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryable: boolean,
    public status: number,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface NpService {
  service: string;
  name: string;
  type: string;
  category: string;
  rate: string;
  min: string | number;
  max: string | number;
  refill: boolean;
  cancel: boolean;
  dripfeed: boolean;
  type_key: string;
  platform: string | null;
  fields: unknown[];
  drip_feed: unknown;
  step: number;
  availability: string;
  average_time_minutes: number | null;
}

export interface NpStatus {
  order?: number;
  status: string;
  status_key: string;
  charge?: string;
  start_count?: string | number | null;
  remains?: string | number | null;
  refund?: string;
  reason_code?: string | null;
  can_cancel?: boolean;
  cancel_available?: boolean;
  can_refill?: boolean;
  error?: string;
  error_code?: string;
}

export interface NpAddResult {
  order: number;
  status_key: string;
  charge: string;
  cancel_available?: boolean;
  cancel_before?: string;
  replayed?: boolean;
}

/** 
 * Resolves the base URL from settings, env, or falls back to default.
 */
export function resolveBase(env: Env, s: Settings): string {
  const raw = (s.panel_base || env.PANEL_BASE || "https://notpanel.com/api/v3").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(raw)) throw new NotPanelError("Panel base URL must start with https://", "BAD_BASE", false, 0);
  return raw;
}

/** 
 * The key in use: the one saved in admin panel, else the environment secret.
 */
export const npKey = (env: Pick<Env, "NOTPANEL_API_KEY">, s: Pick<Settings, "np_api_key" | "panel_api_key">): string => {
  return (s.panel_api_key || s.np_api_key || env.NOTPANEL_API_KEY || "").trim();
};

/** 
 * Checks if a string looks like a valid API key.
 * Removed the strict "np_live_" check so other panels work.
 */
export function looksLikePanelKey(key: string): boolean {
  if (typeof key !== "string") return false;
  const k = key.trim();
  return k.length >= 10 && !/[\s\x00-\x1f\x7f]/.test(k);
}

/** 
 * Kept for backwards compatibility with any existing imports.
 */
export const looksLikeNotPanelKey = looksLikePanelKey;

/** 
 * Core fetch request to the panel.
 */
export async function npRaw<T = unknown>(
  base: string,
  key: string,
  action: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T> {
  if (!looksLikePanelKey(key)) throw new NotPanelError("Invalid API key format", "INVALID_KEY", false, 0);
  key = key.trim();
  
  const body = new URLSearchParams({ key, action });
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") body.set(k, String(v));
  
  let res: Response;
  try {
    res = await fetch(base, { method: "POST", body, redirect: "manual", signal: AbortSignal.timeout(25_000) });
  } catch (e) {
    throw new NotPanelError(`Panel unreachable: ${(e as Error).message}`, "NETWORK", true, 0);
  }
  
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new NotPanelError(`Bad response from panel (${res.status})`, "BAD_RESPONSE", true, res.status);
  }
  
  if (data && typeof data === "object" && !Array.isArray(data) && data.error && data.error_code) {
    throw new NotPanelError(data.error, data.error_code, !!data.retryable, res.status, data.details);
  }
  if (!res.ok) throw new NotPanelError(`Panel error ${res.status}`, "HTTP_" + res.status, res.status >= 500, res.status);
  return data as T;
}

/** 
 * Legacy function signature. Kept so existing sync/orders code doesn't break.
 */
export async function np<T = unknown>(key: string, action: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  return npRaw<T>("https://notpanel.com/api/v3", key, action, params);
}

/** 
 * The main function your worker uses. Dynamically resolves the base URL and key.
 */
export async function npCall<T = unknown>(env: Env, action: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const s = await getSettings(env);
  const base = resolveBase(env, s);
  const key = npKey(env, s);
  return npRaw<T>(base, key, action, params);
}

/** Parses "0.40625" USD → micro-USD integer */
export function usdToMicro(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  return Math.round(Number(v) * 1_000_000);
}

export type KeyCheck = { ok: true } | { ok: false; code: string; message: string };

/**
 * Verifies a candidate (base, key) pair against the live panel.
 * Tries the `balance` action first. If it fails, tries `catalog` to ensure compatibility.
 */
export async function verifyPanelKey(base: string, key: string): Promise<KeyCheck> {
  if (!looksLikePanelKey(key)) {
    return { ok: false, code: "BAD_KEY_FORMAT", message: "Key is empty or malformed." };
  }
  
  try {
    const bal = await npRaw<{ balance?: unknown }>(base, key, "balance");
    if (bal && typeof bal === "object" && (typeof bal.balance === "string" || typeof bal.balance === "number")) {
      return { ok: true };
    }
  } catch (e) {
    // Fall through to catalog check if balance fails (some panels don't support balance API)
  }
  
  try {
    const cat = await npRaw<{ items?: unknown[] }>(base, key, "catalog", { page: 1, limit: 1 });
    if (cat && Array.isArray(cat.items)) {
      return { ok: true };
    }
  } catch (e) {
    if (e instanceof NotPanelError) {
      return { ok: false, code: e.code, message: e.message };
    }
  }
  
  return { ok: false, code: "UNEXPECTED_SHAPE", message: "Panel did not respond like a standard SMM API." };
}

/**
 * Legacy verify function. Now points to the new dynamic one.
 */
export async function verifyNotPanelKey(key: string): Promise<KeyCheck> {
  return verifyPanelKey("https://notpanel.com/api/v3", key);
}