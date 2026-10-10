# Cosa serve da Stefano: domattina, 11/10/2026 (circa 45 minuti)

Il piano completo e le 8 prove sono in `PIANO-FINE-PIATTAFORMA.md`. Qui ci sono solo i passi, in ordine. I blocchi **A** e **B** si possono fare **in parallelo**.

## A. Rilascio sul VPS (10 minuti, quasi tutti di attesa)
Sul VPS, come root:
```bash
cd /root/heili-diag && curl -fsSLO https://raw.githubusercontent.com/Insiderslab/Insiderslab/claude/exciting-rubin-mow1yu/crm-whatsapp/rilascio-crm.sh && bash rilascio-crm.sh
```

Porta in produzione due cose:
- il **livello canali** (fase R1, invisibile: prepara Instagram e Facebook);
- l'**assistente interno**: accesso riservato, «Rimuovi dati demo», rinomina delle organizzazioni, pagina Agente corretta, limite di token.

Lo script fa, in ordine:
- controlli, compresa nessuna transazione lunga sul database;
- backup;
- aggiornamento del codice al commit `0bc731e`;
- build e riavvio;
- migrazioni 13 → **15**;
- controllo del livello canali V1–V7.

Se scrive **STOP**, non tocca niente: incollami l'output. Se scrive **ATTENZIONE** sul livello canali, il CRM funziona lo stesso, ma incollami l'output.

Alla fine scrive **RILASCIO FATTO**. Poi, se vuoi, `reboot`: il VPS lo chiede da ieri. Dopo il riavvio il CRM riparte da solo.

## B. Chrome su Meta (15 minuti)
Incolla `PROMPT-CHROME-ADESSO.md` nella sessione Chrome e dai gli "ok". Alla fine ti scrive il **Configuration ID**: è un numero, e non è segreto.

## C. Pulsante e App Secret nuovo (5 minuti, dopo A e B)
1. Sul VPS:
   ```bash
   bash /root/heili-diag/rilascio-crm.sh attiva-pulsante <CONFIGURATION_ID>
   ```
2. Su Meta, nell'app → Impostazioni → Di base → App Secret → **Reimposta**. Subito dopo, sul VPS:
   ```bash
   cd /root/heili-diag && curl -fsSLO https://raw.githubusercontent.com/Insiderslab/Insiderslab/claude/exciting-rubin-mow1yu/crm-whatsapp/correggi-app-secret.sh && bash correggi-app-secret.sh && bash diagnosi-whatsapp.sh
   ```

## D. Assistente interno: solo il team (5 minuti)
1. `https://crm.heili.cloud/admin` → «Negocio de Stefano Finoti» → **Rinomina** → `InsidersLab · Interno`.
2. Entra in quell'organizzazione → **Posta** → **Rimuovi dati demo** → conferma. Spariscono i contatti finti; la base di conoscenza resta.
3. **Agente** → sezione **Accesso riservato**:
   - accendi;
   - inserisci i numeri del team, uno per riga, **con il + davanti** (es. `+39 347 718 5235`);
   - nella risposta per gli esterni, per esempio: *«Hola, este número es solo para el equipo de InsidersLab. Para contactarnos escribe al +39 347 718 5235.»*
   - Salva.

   Dopo il rilascio la pagina non perde più quello che scrivi.

D'ora in poi, per ricaricare la base di conoscenza:
```bash
bash /root/heili-diag/carica-assistente.sh "InsidersLab · Interno"
```

## E. Collegare il +39 347 (5 minuti, con il telefono in mano)
1. Sul telefono: aggiorna **WhatsApp Business** e aprila.
2. `https://crm.heili.cloud/admin` → crea l'organizzazione **InsidersLab**, con te come proprietario.
3. Entra in InsidersLab → **Agente** → spento.
4. **Impostazioni → WhatsApp → Collega con Meta**:
   - entra con Facebook;
   - scegli **Insiderlabs Business** e il numero **+39 347 718 5235**;
   - conferma sul telefono;
   - **condividi lo storico**.

Poi le 8 prove di `PIANO-FINE-PIATTAFORMA.md` §3.3. Incollami i risultati.

## F. La Bambola (2 minuti per mandare il messaggio; il resto lo fanno loro)
Manda questo messaggio al contatto di La Bambola:

> ¡Hola! Estamos preparando el nuevo sistema de atención de La Bambola: WhatsApp, Instagram, Facebook y la web en un solo lugar, con un asistente que responde al momento y pasa a una persona del equipo las reservas y los pagos. Para dejarlo listo necesitamos:
> 1. **Precios vigentes** por modalidad (tour abierto adulto/niño, alquiler privado, por cubierta, eventos), en $ o Bs., con fecha de validez.
> 2. **Horario**: llegada al muelle, zarpe y regreso; ¿qué días salen?
> 3. **Qué incluye** cada modalidad (almuerzo, bebidas, hielo, DJ, entrada al parque…) y la **ruta** habitual.
> 4. **Cómo se reserva**: anticipo, plazo de pago, métodos de pago aceptados.
> 5. **Políticas**: cancelación, mal tiempo, niños (edad para tarifa de niño), qué traer, si se pueden llevar bebidas propias.
> 6. **Quién atiende** cuando el asistente pasa la conversación a una persona, y en qué horario. ¿Alguien atiende en inglés?
> 7. El número **0414-432-4032**: ¿lo usan en la app **WhatsApp Business** del teléfono? ¿Quién lo tiene?
> 8. **Nombre y perfil de Facebook** de la persona que administra la página de Facebook y el Instagram @labambolamorrocoy (le enviaremos una invitación como *tester* de nuestra app).
>
> ¡Gracias! Con esto lo dejamos funcionando.

Quando rispondono, incolla le risposte qui. Io aggiorno la base di conoscenza dell'agente (`LA-BAMBOLA-AGENTE-KB.md`) e il prompt Chrome per La Bambola.
