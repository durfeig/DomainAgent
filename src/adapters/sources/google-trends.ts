/**
 * Google Trends: the official Trends API is in ALPHA (application-only since 2025-07).
 * There is no stable, sanctioned programmatic access we can rely on today, and scraping
 * the website is fragile and against our "no fragile scraping" principle.
 *
 * This adapter is a placeholder for the future momentum validator: once API access is
 * granted, implement `interestOverTime(term)` and use it inside trend momentum.
 * Until then it returns null (unknown), and nothing downstream treats null as a signal.
 */
export interface GoogleTrendsProvider {
  readonly enabled: boolean;
  interestOverTime(term: string): Promise<{ date: string; value: number }[] | null>;
}

export class DisabledGoogleTrends implements GoogleTrendsProvider {
  readonly enabled = false;
  async interestOverTime(_term: string) {
    return null;
  }
}
