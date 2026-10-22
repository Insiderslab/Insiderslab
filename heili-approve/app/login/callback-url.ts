/** Same-origin path only ("/posts/x"), never "//evil.com" or an absolute URL. */
export function safeCallbackUrl(value: string | undefined | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/dashboard";
  return value;
}
