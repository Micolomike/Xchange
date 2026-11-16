import { createContext, useContext } from 'react';

export const SettingsContext = createContext(null);

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings doit être utilisé dans <SettingsProvider>.');
  return ctx;
}
