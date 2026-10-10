# Cosa serve da Stefano — il percorso più veloce (10/10/2026)

Cinque blocchi, circa 45 minuti in tutto. Il blocco **A** e il blocco **B** si possono fare **in parallelo**: il VPS lavora da solo mentre Chrome lavora su Meta.

## A. Rilascio sul VPS (10 minuti, quasi tutti di attesa)
Sul VPS, come root:
```bash
mkdir -p /root/heili-diag && cd /root/heili-diag && curl -fsSLO https://raw.githubusercontent.com/Insiderslab/Insiderslab/claude/exciting-rubin-mow1yu/crm-whatsapp/rilascio-crm.sh && bash rilascio-crm.sh
```
Lo script fa, in ordine:
- controlli;
- backup del database;
- aggiornamento al codice nuovo;
- ricostruzione e riavvio;
- verifica che le modifiche al database siano applicate (9 → 13);
- diagnosi WhatsApp.

Se qualcosa non torna scrive **STOP**, non tocca niente e tu mi incolli l'output. Alla fine scrive **RILASCIO FATTO**.

## B. Chrome su Meta (15 minuti)
Incolla il contenuto di `PROMPT-CHROME-ADESSO.md` nella sessione Chrome e dai gli "ok". Alla fine ti scrive il **Configuration ID**: è un numero, e non è segreto.

## C. Pulsante e App Secret nuovo (5 minuti, dopo A e B)
1. Sul VPS:
   ```bash
   bash /root/heili-diag/rilascio-crm.sh attiva-pulsante <CONFIGURATION_ID>
   ```
2. Su Meta, nell'app → Impostazioni → Di base → App Secret → **Reimposta**. Subito dopo, sul VPS:
   ```bash
   cd /root/heili-diag && bash correggi-app-secret.sh && bash diagnosi-whatsapp.sh
   ```

## D. Collegare il +39 347 (5 minuti, con il telefono in mano)
1. Sul telefono: aggiorna **WhatsApp Business** e aprila.
2. `https://crm.heili.cloud/admin` → crea l'organizzazione **InsidersLab**, con te come proprietario.
3. Entra in InsidersLab → **Agente** → spento.
4. **Impostazioni → WhatsApp → Collega con Meta** → entra con Facebook → scegli **Insiderlabs Business** e il numero **+39 347 718 5235** → conferma sul telefono → **condividi lo storico**.
5. Prova: scrivi al +39 347 da un altro telefono. Il messaggio deve arrivare sia sull'app sia nella Posta del CRM.

## E. La Bambola (2 minuti per mandare il messaggio; il resto lo fanno loro)
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

Cuando respondan, incolla le risposte qui. Io aggiorno la base di conoscenza dell'agente (`LA-BAMBOLA-AGENTE-KB.md`) e il prompt Chrome per La Bambola.

---
**Cosa faccio io intanto:** unisco la fase 2 del livello canali appena il rilascio A è fatto, poi passo alla fase 3 (WhatsApp sullo schema comune, poi Instagram).
