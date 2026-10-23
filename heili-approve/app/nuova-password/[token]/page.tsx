import Link from "next/link";
import { HeiliAppIcon } from "@/components/brand";
import NewPasswordForm from "@/components/login/new-password-form";
import { isResetTokenUsable } from "@/lib/password-login";
import { productName } from "@/lib/variant";

export function generateMetadata() {
  return { title: `Nuova password - ${productName()}`, robots: { index: false, follow: false } };
}

export default async function NewPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const usable = await isResetTokenUsable(token);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <HeiliAppIcon className="mb-4 h-14 w-14" />
          <h1 className="text-[28px] font-semibold leading-tight">Scegli la password</h1>
          <p className="mt-2 text-muted">Dopo il salvataggio entri subito in {productName()}.</p>
        </div>
        <div className="panel p-6 sm:p-8">
          {usable ? (
            <NewPasswordForm token={token} />
          ) : (
            <div className="space-y-4 text-center">
              <p className="text-foreground">
                Questo link non è più valido: dura un&apos;ora e si usa una volta sola.
              </p>
              <Link href="/login?reset=1" className="btn btn-primary w-full !min-h-11">
                Chiedi un nuovo link
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
