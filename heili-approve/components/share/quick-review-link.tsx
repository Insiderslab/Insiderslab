"use client";

import { useId, useState, useTransition } from "react";
import { quickReviewLinksAction } from "@/app/(dashboard)/share-actions";
import type { QuickReviewChoice } from "@/lib/review-links";

export default function QuickReviewLink({ kind, id }: { kind: "post" | "plan"; id: string }) {
  const pickerId = useId();
  const [choices, setChoices] = useState<QuickReviewChoice[]>([]);
  const [selected, setSelected] = useState("");
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();
  const choice = choices.find(c => c.id === selected);
  async function copy(item: QuickReviewChoice) {
    if (!item.url) { setNotice("Link non leggibile: rigeneralo nella scheda cliente."); return; }
    try { await navigator.clipboard.writeText(item.url); setNotice(`Link di ${item.name} copiato.`); }
    catch { setNotice("Seleziona e copia il link qui sotto."); setOpen(true); }
  }
  return <div className="space-y-2" onClick={event => event.stopPropagation()}>
    <button type="button" className="btn btn-sm min-h-11" disabled={pending} aria-expanded={open} onClick={() => startTransition(async () => {
      setNotice("");
      try {
        const result = await quickReviewLinksAction({ kind, id });
        if (!result.ok) { setNotice(result.error); return; }
        setChoices(result.data);
        setSelected(result.data.length === 1 ? result.data[0].id : "");
        setOpen(true);
        if (result.data.length === 1) await copy(result.data[0]);
        else if (!result.data.length) setNotice("Aggiungi un referente nella scheda cliente per ottenere il link.");
      } catch { setNotice("Connessione interrotta. Riprova a preparare il link."); }
    })}>{pending ? "Preparazione…" : "Copia link cliente"}</button>
    {open && choices.length > 0 && <div className="space-y-2 rounded-xl bg-surface-sunken p-3">
      {choices.length > 1 && <label htmlFor={pickerId} className="block text-xs text-muted">Scegli il referente
        <select id={pickerId} className="field mt-1" value={selected} onChange={event => { setSelected(event.target.value); setNotice(""); }}>
          <option value="">Seleziona una persona</option>
          {choices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>}
      {choice?.url && <>
        <input className="field text-xs" aria-label={`Link personale di ${choice.name}`} value={choice.url} readOnly onFocus={event => event.target.select()} />
        <div className="flex flex-wrap gap-2"><button type="button" className="btn btn-sm" onClick={() => void copy(choice)}>Copia link</button><a className="btn btn-sm" href={choice.url} target="_blank" rel="noopener noreferrer">Apri vista cliente</a></div>
      </>}
      {choice && !choice.url && <p className="text-xs text-warning">Link non leggibile: rigeneralo nella scheda cliente.</p>}
      <button type="button" className="text-xs text-muted underline" onClick={() => setOpen(false)}>Chiudi</button>
    </div>}
    {notice && <p role="status" className="max-w-xs text-xs text-muted">{notice}</p>}
  </div>;
}
