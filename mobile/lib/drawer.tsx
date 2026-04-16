import React, { createContext, useCallback, useContext, useState } from 'react';

interface DrawerContextValue {
  open: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
}

const DrawerContext = createContext<DrawerContextValue>({
  open: false,
  show: () => {},
  hide: () => {},
  toggle: () => {},
});

export function DrawerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen(o => !o), []);
  return (
    <DrawerContext.Provider value={{ open, show, hide, toggle }}>
      {children}
    </DrawerContext.Provider>
  );
}

export function useDrawer() {
  return useContext(DrawerContext);
}
