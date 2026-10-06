import { redirect } from "next/navigation";
import { EMAIL_PROVIDER_ID, auth, signIn } from "@/lib/auth";
import { productName } from "@/lib/variant";

/** Same-origin path only ("/posts/x"), never "//evil.com" or an absolute URL. */
function safeCallbackUrl(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/dashboard";
  return value;
}

export function generateMetadata() {
  return {
    title: `Accedi - ${productName()}`,
    description: "Accesso riservato al team dell'agenzia.",
  };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    checkEmail?: string;
    callbackUrl?: string;
  }>;
}) {
  const params = await searchParams;
  const checkEmail = params.checkEmail === "1";
  const callbackUrl = safeCallbackUrl(params.callbackUrl);

  // A real session (not just a cookie, which may be stale) goes straight on.
  const session = await auth();
  if (session?.user?.id) redirect(callbackUrl);

  async function sendMagicLink(formData: FormData) {
    "use server";
    await signIn(EMAIL_PROVIDER_ID, {
      email: String(formData.get("email") ?? ""),
      redirectTo: callbackUrl,
    });
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-foreground">
            {productName()}
          </h1>
          <p className="text-muted text-sm leading-relaxed mt-2">
            Accesso per il team dell&apos;agenzia. I clienti approvano dal
            proprio link personale, senza login.
          </p>
        </div>

        <div className="panel rounded p-8">
          {checkEmail ? (
            <div className="text-center py-4">
              <h2 className="text-lg font-semibold mb-2">Controlla la tua email</h2>
              <p className="text-sm text-muted">
                Ti abbiamo inviato un link di accesso sicuro. Aprilo su questo
                dispositivo per continuare.
              </p>
            </div>
          ) : (
            <form action={sendMagicLink} className="space-y-5">
              <div className="space-y-2">
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-foreground"
                >
                  Email di lavoro
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="nome@agenzia.it"
                  className="w-full px-4 py-3 rounded bg-background border border-border text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none transition-colors"
                />
              </div>

              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-2 rounded bg-accent px-6 py-3.5 text-sm font-semibold text-white hover:bg-accent-hover"
              >
                Inviami il link di accesso
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
