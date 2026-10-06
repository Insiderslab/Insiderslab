import Link from "next/link";
import { connection } from "next/server";
import { productName } from "@/lib/variant";

export async function generateMetadata() {
  await connection();
  return {
    title: `Controlla la tua email - ${productName()}`,
    description: "Ti abbiamo inviato un link di accesso.",
  };
}

// Rendered per request: the product name depends on APP_VARIANT at runtime.
export default async function VerifyRequestPage() {
  await connection();
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-foreground">
            {productName()}
          </h1>
        </div>

        <div className="panel rounded p-8 text-center">
          <h2 className="text-lg font-semibold mb-2">Controlla la tua email</h2>
          <p className="text-sm text-muted">
            Ti abbiamo inviato un link di accesso sicuro. Aprilo su questo
            dispositivo per continuare.
          </p>
          <p className="mt-6 text-sm">
            <Link href="/login" className="text-accent hover:underline">
              Torna al login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
