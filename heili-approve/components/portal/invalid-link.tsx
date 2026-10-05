/**
 * Shown for unknown, rotated or deactivated review links (and archived
 * clients). Deliberately says nothing about which case it is.
 */

export default function InvalidLink() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-12">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Questo link non funziona più</h1>
        <p className="text-base leading-relaxed text-muted">
          Può succedere quando l&apos;agenzia ti ha mandato un link nuovo, oppure se l&apos;indirizzo è stato
          copiato solo in parte.
        </p>
        <p className="text-base leading-relaxed text-muted">
          Cerca l&apos;email più recente dell&apos;agenzia o chiedi di inviarti di nuovo il link per rivedere i
          post.
        </p>
      </div>
      <p className="mt-10 text-xs text-muted">Approve by Heili</p>
    </main>
  );
}
