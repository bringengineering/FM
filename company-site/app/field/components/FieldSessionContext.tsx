"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { FieldSession } from "../lib/auth.client";

const FieldSessionContext = createContext<FieldSession | null>(null);

type FieldSessionProviderProps = {
  session: FieldSession;
  children: ReactNode;
};

export function FieldSessionProvider({ session, children }: FieldSessionProviderProps) {
  return (
    <FieldSessionContext.Provider value={session}>
      {children}
    </FieldSessionContext.Provider>
  );
}

export function useFieldSession(): FieldSession {
  const session = useContext(FieldSessionContext);
  if (!session) {
    throw new Error("field_session_provider_required");
  }
  return session;
}
