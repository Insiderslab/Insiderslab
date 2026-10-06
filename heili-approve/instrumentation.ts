/**
 * Runs once when the server process starts (Next.js instrumentation hook).
 * Reads APP_VARIANT so a misconfigured instance (e.g. APP_VARIANT=blgo)
 * fails at boot with a clear message, instead of on the first request.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getAppVariant, productName } = await import("@/lib/variant");
  const variant = getAppVariant();
  console.log(`[approve] variante: ${variant} (${productName(variant)})`);
}
