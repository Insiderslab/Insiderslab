import { redirect } from "next/navigation";
import { EMAIL_PROVIDER_ID, auth, signIn } from "@/lib/auth";
import { HeiliAppIcon } from "@/components/brand";
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
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <HeiliAppIcon className="mb-4 h-14 w-14" />
          <h1 className="text-[28px] font-semibold leading-tight">{productName()}</h1>
          <p className="mt-2 text-muted">
            Accesso per il team dell&apos;agenzia. I clienti approvano dal proprio link personale, senza password.
          </p>
        </div>

        <div className="panel p-6 sm:p-8">
          {checkEmail ? (
            <div className="py-2 text-center">
              <h2 className="mb-2 text-xl font-semibold">Controlla la tua email</h2>
              <p className="text-muted">
                Ti abbiamo inviato un link di accesso sicuro. Aprilo su questo dispositivo per continuare. Se non lo
                trovi, guarda anche nello spam.
              </p>
            </div>
          ) : (
            <form action={sendMagicLink} className="space-y-5">
              <div className="space-y-1.5">
                <label htmlFor="email" className="block text-sm font-semibold text-foreground">
                  Email di lavoro
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="nome@agenzia.it"
                  className="field !min-h-11 !text-base"
                />
              </div>

              <button type="submit" className="btn btn-primary w-full !min-h-11">
                Inviami il link di accesso
              </button>
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-muted">Heili by 3Runes</p>
      </div>
    </div>
  );
}
