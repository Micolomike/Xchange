import { FiMonitor, FiMoon, FiSun } from 'react-icons/fi';
import { THEMES } from '../lib/theme';
import { useTheme } from '../lib/useTheme';

const ICONS = { light: FiSun, dark: FiMoon, system: FiMonitor };
const NEXT = { light: 'dark', dark: 'system', system: 'light' };

/** Bouton de la barre de navigation : clair, puis sombre, puis automatique (thème du système). */
export default function ThemeToggle() {
  const { choice, setChoice } = useTheme();
  const Icon = ICONS[choice];
  const current = THEMES.find((t) => t.value === choice).label;
  const next = THEMES.find((t) => t.value === NEXT[choice]).label;
  return (
    <button
      type="button"
      className="btn btn-ghost px-2"
      onClick={() => setChoice(NEXT[choice])}
      aria-label={`Thème : ${current.toLowerCase()}. Passer en ${next.toLowerCase()}`}
      title={`Thème : ${current.toLowerCase()} (cliquer pour ${next.toLowerCase()})`}
    >
      <Icon className="text-lg" aria-hidden="true" />
    </button>
  );
}
