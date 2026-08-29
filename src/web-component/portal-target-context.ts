import { createContext, useContext } from 'react';

export const PortalTargetContext = createContext<HTMLElement | undefined>(
  undefined,
);

export function usePortalTarget() {
  return useContext(PortalTargetContext);
}
