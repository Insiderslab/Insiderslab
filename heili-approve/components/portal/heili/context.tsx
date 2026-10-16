"use client";

/**
 * HeiliProvider: lo stato del dock di Heili nel portale cliente.
 *
 * Ogni pagina registra il proprio contesto con `useHeiliPage`; il dock (nel
 * layout) mostra la chat di revisione nelle pagine contenuto e la Guida
 * altrove. Le destinazioni sono già filtrate dal server e vengono rifiltrate
 * qui: Heili non porta mai fuori da `/review/<token>/…`.
 *
 * Le registrazioni vivono in un piccolo store esterno (`useSyncExternalStore`),
 * così la navigazione tra pagine non lascia mai il dock su un contesto vecchio.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import type { AssistantPanelHandle } from "@/components/review/assistant-panel";
import type { HeiliDraftPick } from "./rules";
import {
  dockTabs,
  draftMarker,
  filterDestinations,
  registrationKey,
  resolveDockTab,
  type HeiliDockTab,
} from "./rules";
import type { HeiliPageContext } from "./types";

export interface HeiliRegistration {
  id: number;
  key: string;
  read: () => HeiliPageContext;
}

/** Registrazioni delle pagine: l'ultima registrata vince. */
export class HeiliRegistrationStore {
  current: HeiliRegistration | null = null;
  private lastId = 0;
  private listeners = new Set<() => void>();

  register(entry: HeiliRegistration): void {
    this.current = entry;
    this.lastId = Math.max(this.lastId, entry.id);
    this.emit();
  }

  clear(id: number): void {
    if (this.current?.id !== id) return;
    this.current = null;
    this.emit();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): HeiliRegistration | null => this.current;

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export interface HeiliStore {
  token: string;
  context: HeiliPageContext | null;
  open: boolean;
  tab: HeiliDockTab;
  pick: "point" | "moment" | null;
  /** Riferimento al pannello di revisione (null se non montato/registrato). */
  control: RefObject<AssistantPanelHandle | null>;
  /** True dopo la prima apertura del pannello: tiene vivi bozze e conversazione. */
  panelMounted: boolean;
  /** Heili ha un feedback che «Chiedi modifiche» invierebbe (la pagina ne ricava il pulsante principale). */
  pendingFeedback: boolean;
  setPendingFeedback: (pending: boolean) => void;
  openDock: (tab?: HeiliDockTab) => void;
  closeDock: () => void;
  toggleDock: () => void;
  setTab: (tab: HeiliDockTab) => void;
  beginPick: (kind: "point" | "moment") => void;
  cancelPick: () => void;
  completePick: (pick: HeiliDraftPick) => void;
  /** Solo per `useHeiliPage`: registra / pulisce il contesto della pagina. */
  register: (entry: HeiliRegistration) => void;
  clear: (id: number) => void;
}

const HEILI_NOOP: HeiliStore = {
  token: "",
  context: null,
  open: false,
  tab: "guide",
  pick: null,
  control: { current: null },
  panelMounted: false,
  pendingFeedback: false,
  setPendingFeedback: () => undefined,
  openDock: () => undefined,
  closeDock: () => undefined,
  toggleDock: () => undefined,
  setTab: () => undefined,
  beginPick: () => undefined,
  cancelPick: () => undefined,
  completePick: () => undefined,
  register: () => undefined,
  clear: () => undefined,
};

const HeiliContext = createContext<HeiliStore | null>(null);

let registrationCounter = 0;

export function HeiliProvider({ token, children }: { token: string; children: ReactNode }) {
  const [registrationStore] = useState(() => new HeiliRegistrationStore());
  const registration = useSyncExternalStore(registrationStore.subscribe, registrationStore.getSnapshot, () => null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<HeiliDockTab>("guide");
  const [pick, setPick] = useState<"point" | "moment" | null>(null);
  const [panelMounted, setPanelMounted] = useState(false);
  const [pendingFeedback, setPendingFeedback] = useState(false);
  const control = useRef<AssistantPanelHandle | null>(null);

  const registeredContext = registration ? registration.read() : null;
  const safeContext = useMemo<HeiliPageContext | null>(() => {
    if (!registeredContext) return null;
    return { ...registeredContext, destinations: filterDestinations(token, registeredContext.destinations) };
  }, [registeredContext, token]);

  const readCurrent = useCallback(() => registrationStore.getSnapshot()?.read() ?? null, [registrationStore]);

  const openDock = useCallback(
    (requested?: HeiliDockTab) => {
      const tabs = dockTabs(readCurrent());
      setTab(resolveDockTab(tabs, requested ?? null));
      if (tabs.includes("feedback")) setPanelMounted(true);
      setOpen(true);
    },
    [readCurrent]
  );
  const closeDock = useCallback(() => {
    setOpen(false);
    setPick(null);
  }, []);
  const toggleDock = useCallback(() => {
    setOpen((current) => {
      if (current) {
        setPick(null);
        return false;
      }
      const tabs = dockTabs(readCurrent());
      setTab(resolveDockTab(tabs, null));
      if (tabs.includes("feedback")) setPanelMounted(true);
      return true;
    });
  }, [readCurrent]);
  const changeTab = useCallback((next: HeiliDockTab) => {
    setTab(next);
    if (next === "feedback") setPanelMounted(true);
  }, []);
  const beginPick = useCallback((kind: "point" | "moment") => {
    setOpen(false);
    setPick(kind);
  }, []);
  const cancelPick = useCallback(() => setPick(null), []);
  const completePick = useCallback((chosen: HeiliDraftPick) => {
    setPick(null);
    control.current?.insertMarker(draftMarker(chosen));
    setTab("feedback");
    setOpen(true);
  }, []);
  const register = useCallback((entry: HeiliRegistration) => registrationStore.register(entry), [registrationStore]);
  const clear = useCallback((id: number) => registrationStore.clear(id), [registrationStore]);

  const store = useMemo<HeiliStore>(
    () => ({
      token,
      context: safeContext,
      open,
      tab,
      pick,
      control,
      panelMounted,
      pendingFeedback,
      setPendingFeedback,
      openDock,
      closeDock,
      toggleDock,
      setTab: changeTab,
      beginPick,
      cancelPick,
      completePick,
      register,
      clear,
    }),
    [
      token,
      safeContext,
      open,
      tab,
      pick,
      panelMounted,
      pendingFeedback,
      openDock,
      closeDock,
      toggleDock,
      changeTab,
      beginPick,
      cancelPick,
      completePick,
      register,
      clear,
    ]
  );

  return <HeiliContext.Provider value={store}>{children}</HeiliContext.Provider>;
}

/** Lo stato del dock; fuori dal portale (test, pagine agenzia) è un no-op. */
export function useHeili(): HeiliStore {
  return useContext(HeiliContext) ?? HEILI_NOOP;
}

/**
 * Registra il contesto della pagina nel dock. Si aggiorna quando cambia la
 * chiave (pagina, contenuto, modalità) e si pulisce quando la pagina lascia.
 */
export function useHeiliPage(context: HeiliPageContext): void {
  const store = useContext(HeiliContext);
  const [registrationId] = useState(() => ++registrationCounter);
  const latest = useRef(context);
  const key = registrationKey(context);
  const registration = useMemo<HeiliRegistration>(
    () => ({ id: registrationId, key, read: () => latest.current }),
    [key, registrationId]
  );
  useEffect(() => {
    latest.current = context;
  });
  useEffect(() => {
    if (!store) return;
    store.register(registration);
    return () => store.clear(registrationId);
  }, [store, registration, registrationId]);
}
