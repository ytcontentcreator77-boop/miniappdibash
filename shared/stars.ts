const TOL = 0.001;

export function shownStars(micro: number, starsPerUsd: number): number {
  if (!micro || !(starsPerUsd > 0)) return 0;
  const v = Math.max(1, Math.ceil((Math.abs(micro) * starsPerUsd) / 1_000_000 - TOL));
  return micro < 0 ? -v : v;
}

export function balanceStars(micro: number, starsPerUsd: number): number {
  if (!micro || !(starsPerUsd > 0)) return 0;
  return Math.floor((micro * starsPerUsd) / 1_000_000 + 1e-9);
}

export function underOneStar(micro: number, starsPerUsd: number): boolean {
  return micro > 0 && balanceStars(micro, starsPerUsd) === 0;
}

export function starsCredit(stars: number, starsPerUsd: number): number {
  return starsPerUsd > 0 ? Math.ceil((stars * 1_000_000) / starsPerUsd - 1e-9) : 0;
}

export function starsToCover(micro: number, starsPerUsd: number): number {
  if (!(micro > 0) || !(starsPerUsd > 0)) return 1;
  let n = Math.max(1, Math.ceil((micro * starsPerUsd) / 1_000_000 - 1e-9));
  while (n > 1 && starsCredit(n - 1, starsPerUsd) >= micro) n--;
  while (starsCredit(n, starsPerUsd) < micro) n++;
  return n;
}

export const MAX_STARS_PER_PAYMENT = 10_000;

export interface DisplayCurrency {
  code: string;
  symbol: string;
  rate_micro_usd: number;
}

export function formatCurrency(
  microUsd: number,
  currenciesJson: string | undefined | null,
  activeCurrency: string = "INR",
): string {
  let currencies: DisplayCurrency[] = [];
  try {
    currencies = JSON.parse(currenciesJson || "[]");
  } catch {
    /* empty */
  }
  const cur = currencies.find((c) => c.code === activeCurrency) || {
    symbol: activeCurrency === "INR" ? "₹" : "$",
    rate_micro_usd: activeCurrency === "INR" ? 12000 : 1000000,
  };
  const amount = microUsd / cur.rate_micro_usd;
  return `${cur.symbol}${amount.toFixed(2)}`;
}