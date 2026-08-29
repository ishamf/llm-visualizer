import type { ReactNode } from 'react';

import { PortalTargetContext } from './portal-target-context.ts';

type PortalTargetProviderProps = {
  children: ReactNode;
  target: HTMLElement;
};

export function PortalTargetProvider({
  children,
  target,
}: PortalTargetProviderProps) {
  return (
    <PortalTargetContext.Provider value={target}>
      {children}
    </PortalTargetContext.Provider>
  );
}
