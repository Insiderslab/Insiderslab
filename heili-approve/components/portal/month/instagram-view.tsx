/**
 * «Anteprima Instagram» of a plan in the client portal (K-13): the profile as
 * it will look with the plan's feed posts on top of the ones already
 * published. Title and one line that says what it is for, then the shared
 * InstagramGrid (the agency's plan page shows the same grid).
 */

import InstagramGrid, { type GridTile } from "@/components/plans/instagram-grid";

export function instagramViewIntro(hasPublished: boolean): string {
  return hasPublished
    ? "Come apparirà il tuo profilo: i post Instagram del piano dal più recente e, sotto, quelli già pubblicati. Serve a giudicare l'armonia del feed. Storie e altre reti sono nella Griglia."
    : "Come apparirà il tuo profilo: i post Instagram del piano, dal più recente, nelle proporzioni del feed. Serve a giudicare l'armonia del feed. Storie e altre reti sono nella Griglia.";
}

export default function InstagramView({
  tiles,
  published,
  accountName,
  logoUrl,
}: {
  tiles: GridTile[];
  published: GridTile[];
  accountName: string;
  logoUrl: string | null;
}) {
  return (
    <section className="space-y-3" aria-labelledby="instagram-view-title" data-testid="instagram-view">
      <div className="space-y-1">
        <h2 id="instagram-view-title" className="text-lg font-semibold">
          Anteprima Instagram
        </h2>
        <p className="text-sm text-muted">{instagramViewIntro(published.length > 0)}</p>
      </div>
      <InstagramGrid
        tiles={tiles}
        published={published}
        accountName={accountName}
        logoUrl={logoUrl}
        caption={tiles.length === 1 ? "1 post del piano" : `${tiles.length} post del piano`}
      />
    </section>
  );
}
