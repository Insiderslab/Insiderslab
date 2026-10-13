import { describe, expect, it } from "vitest";
import { sendBlocked, visiblePendingMessage } from "@/components/review/assistant-panel";

/**
 * U-01: il messaggio del cliente compare una volta sola. Il test copre i tre
 * casi visti nella schermata del test dell'11/10: bolla ottimistica più quella
 * del server, invio doppio (Invio + clic) e nuovo tentativo.
 */
describe("messaggi del cliente mai duplicati", () => {
  it("nasconde la bolla ottimistica appena arriva la copia del server", () => {
    expect(visiblePendingMessage("Ciao", [])).toBe("Ciao");
    expect(visiblePendingMessage("Ciao", [{ role: "ASSISTANT", content: "Dimmi" }])).toBe("Ciao");
    // La copia del server è l'ultimo messaggio: una sola bolla.
    expect(visiblePendingMessage("Ciao", [{ role: "CLIENT", content: "Ciao" }])).toBeNull();
    expect(
      visiblePendingMessage("Ciao", [
        { role: "CLIENT", content: "Ciao" },
        { role: "ASSISTANT", content: "Dimmi" },
        { role: "CLIENT", content: "Ciao" },
      ])
    ).toBeNull();
    // Un vecchio messaggio uguale non nasconde quello appena inviato.
    expect(
      visiblePendingMessage("Nuovo", [
        { role: "CLIENT", content: "Vecchio" },
        { role: "ASSISTANT", content: "Ok" },
      ])
    ).toBe("Nuovo");
    expect(visiblePendingMessage(null, [])).toBeNull();
  });

  it("blocca il secondo invio finché il primo è in corso (Invio + clic, doppio clic)", () => {
    expect(sendBlocked({ sending: true, busy: false, voiceBusy: false, retry: false, message: "Ciao" })).toBe(true);
    expect(sendBlocked({ sending: false, busy: true, voiceBusy: false, retry: false, message: "Ciao" })).toBe(true);
    expect(sendBlocked({ sending: false, busy: false, voiceBusy: true, retry: false, message: "Ciao" })).toBe(true);
    expect(sendBlocked({ sending: false, busy: false, voiceBusy: false, retry: false, message: "" })).toBe(true);
    // Il nuovo tentativo può partire senza testo, ma mai mentre un invio è in corso.
    expect(sendBlocked({ sending: false, busy: false, voiceBusy: false, retry: true, message: "" })).toBe(false);
    expect(sendBlocked({ sending: true, busy: false, voiceBusy: false, retry: true, message: "" })).toBe(true);
  });
});
