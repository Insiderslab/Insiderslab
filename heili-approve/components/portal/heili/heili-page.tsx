"use client";

/**
 * Registra il contesto della pagina nel dock di Heili senza renderizzare
 * nulla: le pagine server lo montano con i propri titoli e destinazioni.
 */

import { useHeiliPage } from "./context";
import type { HeiliPageContext } from "./types";

export default function HeiliPage({ context }: { context: HeiliPageContext }) {
  useHeiliPage(context);
  return null;
}
