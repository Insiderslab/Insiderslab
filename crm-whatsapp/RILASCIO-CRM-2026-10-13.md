# Registro del rilascio CRM del 13/10/2026

- **Esecutore:** Stefano, sul VPS `srv1899808`, con `rilascio-crm.sh`.
- **Da `e23332e` a `65f06f3`:** PR #7 (livello canali R1), #8 (assistente interno), #11 (Sintesi e Primi passi), #12 (usabilità E1–E10).
- **Backup:** `/root/backup/vocero-pre-rilascio-20261013T210159Z.dump` (84K).
- **Migrazioni:** 13 → 16.
- **Livello canali**, prima riga del log: `canali (avvisa): V1=0 V2=0 V3=0 V4=0 V5=0 V6=0 V7=0 | faseA_ms=115 faseB_ms=27 post_sync_ms=10 post_sync_messages_ms=5`.
- **Indici e vincoli** della fase B: validi.
- **Messaggi nel database:** 44. Il primo avvio di R1 è durato meno di un secondo.
- **Diagnosi WhatsApp:** tutto OK.
  - Webhook: risponde alla verifica GET; con la firma risponde 200, senza firma 401.
  - Meta: token valido, callback diretto al CRM, WABA iscritto all'app 609974691965875.
- **Nota:** anche l'app «Clientify Inbox» (735132587797436) è iscritta al WABA del +1 555. Secondo la decisione di Stefano (niente Clientify sui numeri InsidersLab) si può togliere.
- **Torna indietro senza ripristinare il backup:** `git checkout e23332e && docker compose build app && docker compose up -d app`, sempre fermando prima il CRM (stop-first). Le colonne e le tabelle nuove restano e il codice vecchio le ignora.
