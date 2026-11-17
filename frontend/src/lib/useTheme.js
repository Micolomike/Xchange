import { useEffect, useState } from 'react';
import { getThemeChoice, onThemeChange, resolvedTheme, setThemeChoice } from './theme';

export function useTheme() {
  const [state, setState] = useState(() => ({ choice: getThemeChoice(), theme: resolvedTheme() }));
  useEffect(() => onThemeChange((choice, theme) => setState({ choice, theme })), []);
  return { ...state, setChoice: setThemeChoice };
}
