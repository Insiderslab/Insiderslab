import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import InvitationAcceptCard from "@/components/invitation-accept-card";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { ROLE_LABELS } from "@/components/settings/helpers";

type InvitePageProps = {
  params: Promise<{ token: string }>;
};

export const metadata: Metadata = {
  title: "Invito al team - Approve by Heili",
  robots: { index: false, follow: false },
};

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const [session, invitation] = await Promise.all([
    auth(),
    prisma.workspaceInvitation.findUnique({
      where: { token },
      include: {
        workspace: { select: { name: true } },
      },
    }),
  ]);

  if (!invitation || invitation.status !== "PENDING") {
    notFound();
  }

  const expired = invitation.expiresAt <= new Date();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-5 py-12">
        <Link href="/" className="mb-8 text-sm font-semibold text-foreground">
          Approve by Heili
        </Link>
        <section className="panel rounded p-6 sm:p-8">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Invito al team</p>
          <h1 className="mt-3 text-2xl font-semibold leading-tight text-foreground">
            Entra in {invitation.workspace.name}
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            Sei stato invitato come {ROLE_LABELS[invitation.role].toLowerCase()} con l&apos;indirizzo{" "}
            {invitation.email}.
          </p>
          <div className="mt-8">
            {expired ? (
              <p className="text-sm text-error">
                Questo invito è scaduto. Chiedi a chi ti ha invitato di mandartene uno nuovo.
              </p>
            ) : (
              <InvitationAcceptCard
                token={token}
                isSignedIn={Boolean(session?.user?.id)}
                invitedEmail={invitation.email}
              />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

