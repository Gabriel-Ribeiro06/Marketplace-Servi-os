import React, { createContext, useContext, useState } from 'react';

export type ActiveUserRole = 'customer' | 'provider';

export interface RoleContextValue {
  activeRole: ActiveUserRole;
  switchRole: (nextRole: ActiveUserRole) => void;
  toggleRole: () => void;
}

const RoleContext = createContext<RoleContextValue | null>(null);

/**
 * Gerencia a alternância entre perfil Cliente e Prestador na mesma conta (RF-03, ADR-05, E1-04).
 */
export function RoleProvider({
  initialRole = 'customer',
  children,
}: {
  initialRole?: ActiveUserRole;
  children: React.ReactNode;
}) {
  const [activeRole, setActiveRole] = useState<ActiveUserRole>(initialRole);

  const switchRole = (nextRole: ActiveUserRole) => {
    setActiveRole(nextRole);
  };

  const toggleRole = () => {
    setActiveRole((prev) => (prev === 'customer' ? 'provider' : 'customer'));
  };

  return (
    <RoleContext.Provider value={{ activeRole, switchRole, toggleRole }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useActiveRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) {
    throw new Error('useActiveRole deve ser usado dentro de um RoleProvider.');
  }
  return ctx;
}
