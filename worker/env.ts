import type { Settings } from "./settings";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  BOT_TOKEN: string;
  NOTPANEL_API_KEY?: string;
  PANEL_BASE?: string;
  TG_WEBHOOK_SECRET?: string;
  SETUP_SECRET?: string;
  OWNER_IDS?: string;
  DEV_FAKE_USER_ID?: string;
  ALLOW_LIVE_ORDERS?: string;
  /** Optional HTTPS Node gateway backed by one or more MongoDB GridFS databases. */
  MEDIA_GATEWAY_URL?: string;
  /** Shared secret for the private MongoDB media gateway; configure as a Worker secret. */
  MEDIA_GATEWAY_KEY?: string;
}

export function parseIds(v: string | undefined | null): number[] {
  const out: number[] = [];
  for (const part of (v ?? "").split(",")) {
    const n = Number(part.trim());
    if (part.trim() && Number.isSafeInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}
export const envOwners = (env: Env): number[] => parseIds(env.OWNER_IDS);
export const addedOwners = (s: Pick<Settings, "owner_ids">): number[] => parseIds(s.owner_ids);
export const ownerIds = (env: Env, s: Pick<Settings, "owner_ids">): number[] => [...new Set([...envOwners(env), ...addedOwners(s)])];
export function isOwner(env: Env, s: Pick<Settings, "owner_ids">, userId: number): boolean {
  return ownerIds(env, s).includes(userId);
}
