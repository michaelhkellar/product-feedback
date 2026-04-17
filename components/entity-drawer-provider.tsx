"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export type EntityKind = "theme" | "account" | "feature" | "customer";

export interface EntityTarget {
  kind: EntityKind;
  name: string;
  id?: string;
}

interface EntityDrawerContextValue {
  entity: EntityTarget | null;
  openEntity: (target: EntityTarget) => void;
  closeEntity: () => void;
}

const EntityDrawerContext = createContext<EntityDrawerContextValue>({
  entity: null,
  openEntity: () => {},
  closeEntity: () => {},
});

export function EntityDrawerProvider({ children }: { children: ReactNode }) {
  const [entity, setEntity] = useState<EntityTarget | null>(null);

  const openEntity = useCallback((target: EntityTarget) => setEntity(target), []);
  const closeEntity = useCallback(() => setEntity(null), []);

  return (
    <EntityDrawerContext.Provider value={{ entity, openEntity, closeEntity }}>
      {children}
    </EntityDrawerContext.Provider>
  );
}

export function useEntityDrawer() {
  return useContext(EntityDrawerContext);
}
