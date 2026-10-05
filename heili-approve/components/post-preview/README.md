# Anteprime dei post (`components/post-preview`)

Mockup sobri e realistici di come apparirà il post su ogni rete. Li vede il
**cliente** quando approva (quasi sempre dal telefono, funzionano da 360 px) e
l'**agenzia** mentre modifica il post.

```ts
import { PostPreview, NetworkPreviewTabs, VideoPlayer } from "@/components/post-preview";
```

## Reti e formati

| Rete | Formato (`<rete>Data.type`) | Mockup |
|---|---|---|
| Instagram | `POST` (default) · `REEL` · `STORY` | feed 4:5…1,91:1 con carosello · Reel 9:16 · Storia 9:16 (senza testo) |
| Facebook | `POST` · `REEL` · `STORY` | post con griglia 2–4 immagini · Reel · Storia |
| LinkedIn | `post` | post aziendale con "…altro" dopo 3 righe |
| TikTok | — | 9:16, video o foto |
| X / Threads / Bluesky | — | scheda di testo, media sotto |
| YouTube | `video` · `short` | player 16:9 con titolo/descrizione · Short 9:16 |
| Pinterest, Google Business | — | pin · aggiornamento |

Titolo per YouTube/Pinterest = prima riga del testo. Il primo commento compare
sotto i post Instagram, Facebook, LinkedIn e sotto i Reel.

## `PostPreview`

| Prop | Tipo | Note |
|---|---|---|
| `network` | `Network` | |
| `format?` | `string` | `<rete>Data.type`; se manca, il primo formato della rete |
| `text` | `string` | troncato come sulla rete, con "altro"; #hashtag, @menzioni e link evidenziati |
| `firstCommentText?` | `string \| null` | |
| `media` | `MediaItem[]` | `alt` usato come testo alternativo |
| `accountName`, `accountAvatarUrl?` | | senza avatar: iniziali |
| `publishAt?` | `Date \| string` | mostrata nello stile della rete, fuso `timeZone` (default `Europe/Rome`) |
| `pins?` | `PreviewPin[]` | `{ id, mediaIndex, x, y, label, timeSec?, timeEndSec? }`, x/y 0..1 sul riquadro mostrato. Etichette fino a 3 caratteri nel cerchio, altrimenti il numero |
| `onMediaClick?` | `({ mediaIndex, x, y }) => void` | **immagini**: clic → punto relativo (0..1). Le frecce del carosello non lo attivano. Da tastiera (Invio) → centro |
| `markers?` | `PreviewVideoMarker[]` | `{ id, timeSec, timeEndSec?, label, tone?: "client" \| "assistant" \| "agency", mediaIndex? }` — senza `mediaIndex` vanno sul primo video |
| `onRequestComment?` | `({ mediaIndex, timeSec, x?, y? }) => void` | **video**: pulsante "Commenta a m:ss" (solo tempo) o tocco sul fotogramma in pausa (tempo + punto) |
| `onTimeChange?` | `(sec, mediaIndex) => void` | |
| `registerTimeGetter?` | `(get: () => number) => void` | riceve una funzione che legge il tempo del video sullo schermo (es. chip "Usa il momento attuale" dell'assistente) |
| `seekTo?` | `{ timeSec, nonce, mediaIndex? }` | salta a un momento (cambia `nonce` per ripetere); nel carosello porta prima in vista quel media |

I pin dei video si vedono solo in pausa, al loro momento (`timeSec`/`timeEndSec`).

`PostPreview` non è un client component: si può usare anche da un server
component (senza le callback). Le parti interattive (testo espandibile,
carosello, player) sono client component.

## `NetworkPreviewTabs`

Stesse prop di `PostPreview` senza `network`/`format`, più `networks: Network[]`,
`networkOptions?` (il JSON di `Post.networkOptions`, anche così com'è da Prisma),
e facoltativi `activeNetwork` / `onNetworkChange` per controllare la scheda.
Una scheda per rete ("Instagram · Reel"), frecce/Home/Fine per spostarsi.

## `VideoPlayer`

Controlli propri sopra `<video playsInline preload="metadata">`: play/pausa,
barra con marcatori numerati (intervalli come bande, tocco = salta lì),
tempo corrente/durata, −1s/+1s, velocità 0,5×, frecce ← → = un fotogramma
(1/30 s; con Maiusc un secondo), Spazio = play/pausa, pulsante grande
"Commenta a m:ss" (solo con `onRequestComment`). Pulsanti da 44 px.
Prop: `src`, `poster?`, `markers?`, `onRequestComment?({ timeSec, x?, y? })`,
`onTimeChange?(sec)`, `registerTimeGetter?`, `seekTo?: { timeSec, nonce }`,
più `durationSec?`, `aspectRatio?` (default 9/16), `fit?`, `label?`, `overlay?`, `pins?`.

## Esempio (portale cliente)

```tsx
"use client";

const [seek, setSeek] = useState<{ timeSec: number; nonce: number }>();
const timeGetter = useRef<() => number>(() => 0);

<NetworkPreviewTabs
  networks={post.networks}
  networkOptions={post.networkOptions}
  text={version.text}
  firstCommentText={version.firstCommentText}
  media={parseMediaItems(version.media)}
  accountName={client.name}
  publishAt={post.publishAt}
  pins={comments.filter((c) => c.pinX != null).map((c, i) => ({
    id: c.id, mediaIndex: c.mediaIndex ?? 0, x: c.pinX!, y: c.pinY!,
    label: String(i + 1), timeSec: c.timeSec,
  }))}
  markers={comments.filter((c) => c.timeSec != null).map((c, i) => ({
    id: c.id, timeSec: c.timeSec!, timeEndSec: c.timeEndSec, label: String(i + 1),
    tone: "client", mediaIndex: c.mediaIndex ?? undefined,
  }))}
  onMediaClick={({ mediaIndex, x, y }) => openCommentForm({ mediaIndex, pinX: x, pinY: y })}
  onRequestComment={({ mediaIndex, timeSec, x, y }) =>
    openCommentForm({ mediaIndex, timeSec, pinX: x, pinY: y })}
  registerTimeGetter={(get) => { timeGetter.current = get; }}
  seekTo={seek}
/>

// Chip del timecode nell'elenco commenti:
<button onClick={() => setSeek({ timeSec: c.timeSec!, nonce: Date.now() })}>
  {formatTimecode(c.timeSec!)}
</button>
```
