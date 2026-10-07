/**
 * Navigation after picking another client in the menu (components/client-switcher.tsx).
 * Pure, so it can be tested without a browser.
 */

/** Where to go after switching, from the current page. Null: stay and refresh. */
export function hrefAfterSwitch(pathname: string, params: URLSearchParams, clientId: string | null): string | null {
  const clientPage = pathname.match(/^\/clients\/([^/]+)$/);
  if (clientPage && clientPage[1] !== "new") return clientId ? `/clients/${clientId}` : "/clients";
  if (/^\/posts\/(?!new$)[^/]+/.test(pathname)) {
    const kind = params.get("kind");
    return kind ? `/posts?kind=${encodeURIComponent(kind)}` : "/posts";
  }
  if (params.has("clientId")) {
    const next = new URLSearchParams(params);
    next.delete("clientId");
    next.delete("pagina");
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  }
  return null;
}
