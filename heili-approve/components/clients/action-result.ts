/**
 * Result shape of the server actions in app/(dashboard)/clients and
 * app/(dashboard)/settings. Errors carry an Italian message safe to show.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | {
      ok: false;
      error: string;
      /** Metricool save only: the credentials failed the test and can be saved anyway. */
      canForce?: boolean;
    };

export interface MetricoolBrandOption {
  blogId: string;
  label: string;
  timezone: string | null;
  networks: string[];
  /** Logo URL (Metricool's brand image). */
  imageUrl: string | null;
  /** Account name per network (e.g. instagram: "pharmera.it"). */
  accounts: Record<string, string>;
  /** Name of another client of the workspace that already uses this brand. */
  usedBy: string | null;
}

/** Metricool brands for the client form, or why they are not available. */
export type BrandsState =
  | { status: "ok"; brands: MetricoolBrandOption[]; fake: boolean }
  | { status: "not_configured" }
  | { status: "error"; message: string };
