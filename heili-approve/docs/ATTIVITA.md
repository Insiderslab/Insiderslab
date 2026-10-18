# «Attività» — notifiche e compiti dell'agenzia (progetto, 18/10/2026)

Richiesta del titolare: quando un cliente chiede una modifica (o fa altro che richiede un'azione), deve esserci **un posto dove si accumulano le notifiche**, che diventano **compiti assegnati al social media manager di quel cliente**.

Oggi: nessuna casella di notifiche; solo il contatore «N da gestire» nella barra in alto (`components/top-bar.tsx`, porta a `/posts?status=attention`) e le email (`lib/notifications.ts`). Il cliente non ha un responsabile.

## Parole (per l'utente)

- Menu: **«Attività»** con il numero dei compiti aperti assegnati a me.
- Due schede: **«Da fare»** (compiti) e **«Notifiche»** (solo informazione, nessuna azione richiesta).
- Sul cliente: **«Social media manager»** (persona del team responsabile del cliente).
- Azioni sul compito: **«Apri»**, **«Fatto»**, **«Riapri»**, **«Assegna a…»**.

## Modello dati (una migrazione additiva: `20261018120000_agency_activity`)

```prisma
model Client {
  // …campi esistenti…
  /// Social media manager responsabile: riceve i compiti di questo cliente. Null = non assegnato (li vedono tutti).
  ownerUserId String?
  owner       User?   @relation("ClientOwner", fields: [ownerUserId], references: [id], onDelete: SetNull)
}

enum ActivityKind {
  TASK   // serve un'azione dell'agenzia
  INFO   // solo informazione
}

enum ActivityStatus {
  OPEN
  DONE
}

enum ActivityType {
  CHANGES_REQUESTED   // il cliente ha chiesto modifiche a un contenuto        → TASK
  CLIENT_COMMENT      // commento del cliente su contenuto senza decisione     → TASK
  PLAN_COMMENT        // commento del cliente sul piano del mese               → TASK
  WEBSITE_NOTES       // note «Sul sito» inviate con «Chiedi modifiche»         → TASK (stesso flusso di CHANGES_REQUESTED, kind del post WEBSITE)
  SCHEDULE_FAILED     // programmazione Metricool fallita                      → TASK
  APPROVED            // contenuto approvato                                   → INFO
  PLAN_APPROVED       // piano del mese approvato                              → INFO
}

model AgencyActivity {
  id             String         @id @default(cuid())
  workspaceId    String
  clientId       String
  postId         String?
  planId         String?
  type           ActivityType
  kind           ActivityKind
  status         ActivityStatus @default(OPEN)
  title          String         // es. «Modifiche richieste: Post lancio autunno»
  summary        String         @default("") // estratto del commento del cliente, max 500 caratteri, testo semplice
  versionNumber  Int?
  assigneeUserId String?        // copia di Client.ownerUserId alla creazione; modificabile
  /// Chiave di idempotenza: lo stesso fatto non crea due attività (es. "changes:<postId>:v<versione>").
  dedupeKey      String
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt
  doneAt         DateTime?
  doneByUserId   String?
  readAt         DateTime?      // per le INFO: segnata come letta

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  client    Client    @relation(fields: [clientId], references: [id], onDelete: Cascade)
  post      Post?     @relation(fields: [postId], references: [id], onDelete: Cascade)
  plan      ContentPlan? @relation(fields: [planId], references: [id], onDelete: Cascade)
  assignee  User?     @relation("ActivityAssignee", fields: [assigneeUserId], references: [id], onDelete: SetNull)

  @@unique([workspaceId, dedupeKey])
  @@index([workspaceId, status, kind, createdAt])
  @@index([assigneeUserId, status])
  @@index([postId])
}
```
Aggiungi le relazioni inverse necessarie (`User.ownedClients`, `User.assignedActivities`, `Workspace.activities`, `Client.activities`, `Post.activities`, `ContentPlan.activities`). La migrazione deve essere **solo additiva** (nuove colonne nullable, nuove tabelle/enum, indici).

## Servizio `lib/activity.ts` (solo server)

- `recordActivity(input)` — crea con `upsert` sulla `dedupeKey` (mai doppioni; se esiste già ed è DONE e arriva un fatto nuovo con chiave diversa, è un'altra attività). Calcola `assigneeUserId` da `Client.ownerUserId`. Tronca `summary` a 500 caratteri, toglie markup/marcatori interni (riusa le funzioni che i testi email già usano per l'estratto del commento, se esistono).
- `closeTasksForPost(postId, userId?)` — chiude (DONE) i TASK aperti di un post: chiamata quando l'agenzia **invia una nuova versione in revisione** (il problema è stato gestito) o quando il post viene **annullato**.
- `listActivities({ workspaceId, userId, tab: "todo" | "notifications", scope: "mine" | "all", clientId?, cursor? })` — paginata (30), ordinata dal più recente; «mine» = assegnate a me **più** quelle senza assegnatario.
- `countOpenTasks(workspaceId, userId)` — per il numero nel menu (mie + non assegnate).
- `markDone(id, userId)`, `reopen(id)`, `assign(id, assigneeUserId)`, `markAllNotificationsRead(workspaceId, userId)`.
- Ogni funzione controlla che l'attività appartenga al workspace dell'utente (`lib/workspace-access.ts`). Un membro può agire su tutte le attività del suo workspace.

## Dove nascono (agganci, senza cambiare il comportamento esistente)

Chiama `recordActivity` **dopo** che il fatto è salvato, nello stesso punto in cui oggi parte l'email (le funzioni di `lib/notifications.ts`), con try/catch: un errore delle attività non deve mai bloccare l'azione del cliente né l'email.

| Fatto | Punto | Tipo | dedupeKey |
|---|---|---|---|
| Chiedi modifiche (post, articolo, ads, sito) | `notifyChangesRequested(postId)` | CHANGES_REQUESTED (o WEBSITE_NOTES se il post è WEBSITE) | `changes:<postId>:v<versione>` |
| Commento del cliente senza decisione | dove nasce l'evento `COMMENTED` del cliente in `lib/posts.ts` (o la sua notifica) | CLIENT_COMMENT | `comment:<commentId>` |
| Commento sul piano | `notifyPlanComment(commentId)` | PLAN_COMMENT | `plan-comment:<commentId>` |
| Programmazione fallita | `notifyScheduleFailed(postId)` | SCHEDULE_FAILED | `schedule-failed:<postId>:v<versione>` |
| Approvato | `notifyApproved(postId)` | APPROVED (INFO) | `approved:<postId>:v<versione>` |
| Piano approvato | `notifyPlanApproved` / `notifyPlanDecided` | PLAN_APPROVED (INFO) | `plan-approved:<planId>` |
| Approvazione annullata dal cliente (D2) | dove nasce `APPROVAL_UNDONE` | chiude l'INFO `approved:<postId>:v<versione>` (status DONE, o la cancella) | — |

Chiusura automatica: quando l'agenzia invia una nuova versione in revisione (`notifyReviewRequested(postIds)` o dove nasce `SUBMITTED_FOR_REVIEW`) → `closeTasksForPost` per quei post. Quando il post viene annullato → idem.

## Interfaccia

1. **Menu dell'agenzia**: voce «Attività» (tra Dashboard e Post) con il numero dei compiti aperti (mie + non assegnate). Il chip «N da gestire» della barra in alto resta, ma porta a `/attivita`.
2. **Pagina `app/(dashboard)/attivita/page.tsx`**:
   - In alto: schede «Da fare (n)» e «Notifiche (n non lette)»; interruttore «Solo i miei / Tutti»; filtro cliente.
   - Ogni riga: icona del tipo, cliente, titolo, estratto del commento (2 righe), «da: nome del referente» se c'è, data relativa («2 ore fa»), assegnatario; pulsanti «Apri» (porta al post/piano nella scheda «Revisione» con i commenti) e «Fatto» (o «Riapri» nelle chiuse). Menu «Assegna a…» con i membri del workspace.
   - Stato vuoto: «Nessun compito aperto. Quando un cliente chiede modifiche, lo trovi qui.»
   - «Mostra completate» in fondo (ultimi 30 giorni).
   - Notifiche: «Segna tutte come lette».
   - Mobile first: 390 px senza scorrimento orizzontale, aree toccabili 44 px, campi 16 px.
3. **Scheda cliente** (`components/clients/client-form.tsx`): campo «Social media manager» (select dei membri del workspace + «Nessuno»). Elenco clienti: mostra il nome del responsabile.
4. **Dashboard**: se ci sono compiti aperti miei, una riga «Hai N compiti in Attività» con link.

## Fuori da questa consegna (fase 2, solo da annotare)

- Invio dei compiti a Monday/Asana/Slack (connettori già usati dall'agenzia).
- Email solo al responsabile invece che a tutti.
- Scadenze e promemoria sui compiti.

## Test richiesti (vitest, senza server)

- `__tests__/activity.test.ts` (prisma finto come negli altri test, vedi `__tests__/media-queue.test.ts`): dedupe, assegnatario dal cliente, troncamento e pulizia del summary, chiusura automatica, controllo workspace, «mine» include le non assegnate, conteggio.
- Gli agganci: un test per `notifyChangesRequested` che verifichi che un errore di `recordActivity` non blocca la notifica.
- Glossario/etichette se il progetto ha un test del glossario (`__tests__/glossary.test.ts`).
