import { Link } from 'react-router-dom';
import { useAuth } from '../auth/context';
import { PriorityBadge } from '../components/Badges';
import { useSettings } from '../settings/context';

const STEPS = ['Ouvert', 'En cours', 'Résolu'];

const TIMELINE = [
  { who: 'Inès', what: 'a ouvert le ticket', when: 'lundi, 9 h 12' },
  { who: 'Karim', what: "s'est assigné le ticket", when: 'lundi, 9 h 40' },
  { who: 'Karim', what: 'a joint « config-vpn.pdf »', when: 'lundi, 11 h 05' },
  { who: 'Karim', what: 'a passé le statut à Résolu', when: 'lundi, 14 h 31' },
];

/** Page d'accueil des visiteurs non connectés. */
export default function Landing() {
  const { registrationOpen } = useAuth();
  const { settings } = useSettings();

  return (
    <section className="grid items-center gap-12 py-6 lg:grid-cols-[1.05fr_1fr] lg:py-14">
      <div className="max-w-xl">
        <h1 className="text-[2.25rem] font-extrabold leading-[1.1] tracking-tight text-ink sm:text-5xl">
          {settings.homeTitle || "Chaque demande de l'équipe, suivie jusqu'à sa résolution."}
        </h1>
        <p className="mt-5 whitespace-pre-line text-lg leading-relaxed text-ink-soft">
          {settings.homeText ||
            `${settings.appName} regroupe les tickets au même endroit : on les décrit, on les assigne, on en discute avec les fichiers utiles, et chacun sait où en est sa demande.`}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          {registrationOpen && (
            <Link to="/register" className="btn btn-primary px-5 py-2.5 text-base">
              Créer un compte
            </Link>
          )}
          <Link to="/login" className="btn btn-secondary px-5 py-2.5 text-base">
            Se connecter
          </Link>
        </div>
      </div>

      {/* Un ticket d'exemple qui parcourt son cycle de vie. */}
      <div className="relative mx-auto w-full max-w-md" aria-hidden="true">
        <div className="panel overflow-hidden shadow-[0_18px_40px_-24px_rgba(27,36,48,0.45)]">
          <div className="flex items-start justify-between gap-4 border-b border-dashed border-line-strong px-5 py-4">
            <div>
              <span className="ticket-stub ticket-stub--lg">#0127</span>
              <p className="mt-3 font-bold text-ink">Le VPN se coupe toutes les dix minutes</p>
              <p className="mt-1 text-sm text-ink-mute">Support, ouvert par Inès</p>
            </div>
            <PriorityBadge priority="high" />
          </div>

          <ol className="landing-steps grid grid-cols-3 gap-2 px-5 pt-4 text-xs font-semibold">
            {STEPS.map((label, i) => (
              <li key={label} style={{ '--i': i }}>
                <span className="landing-step-bar block h-1.5 rounded-full bg-line" />
                <span className="landing-step-label mt-2 block text-ink-mute">{label}</span>
              </li>
            ))}
          </ol>

          <ul className="space-y-3 px-5 py-5 text-sm">
            {TIMELINE.map((e) => (
              <li key={e.what} className="flex gap-3">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-line-strong" />
                <span className="text-ink-soft">
                  <span className="font-semibold text-ink">{e.who}</span> {e.what}
                  <span className="block text-xs text-ink-mute">{e.when}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
