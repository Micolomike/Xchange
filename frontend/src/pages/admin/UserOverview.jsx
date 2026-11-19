import { createElement, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FiActivity, FiArrowLeft, FiBell, FiCheck, FiDatabase, FiFileText, FiLock, FiMail, FiShield, FiUsers, FiX } from 'react-icons/fi';
import { api } from '../../lib/api';
import { ROLES, notifyState } from '../../lib/constants';
import { formatDate, formatDateTime, formatRelative } from '../../lib/format';
import { Avatar, PriorityBadge, StatusBadge } from '../../components/Badges';
import { ErrorState, Spinner } from '../../components/ui';
import { NotifyBadge } from './UsersPanel';

const LEVEL_STYLES = { info: 'text-ink-mute', warn: 'text-progress', error: 'text-danger' };
const REQUEST_STATUS = { pending: 'En attente', approved: 'Acceptée', rejected: 'Refusée', cancelled: 'Annulée', done: 'Traitée' };

function Section({ icon, title, id, action, children }) {
  return (
    <section className="panel" aria-labelledby={id}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 id={id} className="flex items-center gap-2 font-bold">
          {createElement(icon, { 'aria-hidden': true, className: 'text-ink-mute' })} {title}
        </h2>
        {action}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function Facts({ items }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items
        .filter(Boolean)
        .map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs font-semibold text-ink-mute">{label}</dt>
            <dd className="break-words text-sm">{value ?? <span className="text-ink-mute">-</span>}</dd>
          </div>
        ))}
    </dl>
  );
}

function Stat({ label, value, to }) {
  const body = (
    <>
      <span className="block text-2xl font-bold tabular-nums">{value}</span>
      <span className="block text-xs text-ink-mute">{label}</span>
    </>
  );
  return to ? (
    <Link to={to} className="rounded-md border border-line px-3 py-2 hover:border-accent">
      {body}
    </Link>
  ) : (
    <div className="rounded-md border border-line px-3 py-2">{body}</div>
  );
}

function TicketList({ items, empty }) {
  if (!items.length) return <p className="text-sm text-ink-mute">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((t, i) => (
        <li key={t.id ?? `h${i}`} className="flex flex-wrap items-center gap-2 py-2 text-sm">
          {t.hidden ? (
            <span className="flex items-center gap-1.5 text-ink-mute" title="Vous ne faites pas partie de cette demande confidentielle">
              <FiLock aria-hidden="true" /> Demande confidentielle
            </span>
          ) : (
            <Link to={`/tickets/${t.id}`} className="min-w-0 flex-1 truncate font-semibold hover:text-accent-strong hover:underline">
              <span className="text-ink-mute">#{String(t.id).padStart(4, '0')}</span> {t.title}
            </Link>
          )}
          <span className="ml-auto flex items-center gap-2">
            <PriorityBadge priority={t.priority} showLabel={false} />
            <StatusBadge status={t.status} />
            <time className="w-20 text-right text-xs text-ink-mute" dateTime={t.updated_at || t.created_at} title={formatDateTime(t.updated_at || t.created_at)}>
              {formatRelative(t.updated_at || t.created_at)}
            </time>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Fiche complète d'un compte, pour l'administrateur. */
export default function UserOverview() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    return api(`/api/users/${id}/overview`).then(setData).catch(setError);
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <Spinner />;
  const { user: u, security: sec, notifications: n, tickets: t } = data;
  const st = notifyState(u);
  const realName = [u.real_firstname, u.real_lastname].filter(Boolean).join(' ');

  return (
    <div className="space-y-6">
      <Link to="/admin?tab=users" className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent-strong hover:underline">
        <FiArrowLeft aria-hidden="true" /> Utilisateurs
      </Link>

      <header className="panel flex flex-wrap items-center gap-4 p-5">
        <Avatar user={u} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">{realName || u.username}</h1>
          <p className="text-sm text-ink-mute">
            @{u.username}, {ROLES[u.role]?.toLowerCase()}
            {u.hide_real_name && ', pseudonyme seul pour les autres membres'}
            {u.anonymized_at && `, anonymisé le ${formatDate(u.anonymized_at)}`}
          </p>
        </div>
        <Link to={`/admin?tab=log&user=${u.id}`} className="btn btn-secondary">
          <FiActivity aria-hidden="true" /> Journal du compte
        </Link>
      </header>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section icon={FiUsers} id="uo-id" title="Identité">
          <Facts
            items={[
              ["Nom d'utilisateur", u.username],
              ['Prénom et nom', realName || null],
              ['Adresse e-mail', u.email || 'Non renseignée'],
              ['Rôle', ROLES[u.role]],
              ['Affichage pour les autres', u.hide_real_name ? 'Pseudonyme seul' : 'Prénom et nom'],
              ['Inscrit le', formatDateTime(u.created_at)],
              ['Dernière activité', u.last_seen_at ? `${formatDateTime(u.last_seen_at)} (${formatRelative(u.last_seen_at)})` : 'Jamais'],
              ['Charte acceptée', u.terms_accepted_at ? `Version ${u.terms_version}, le ${formatDate(u.terms_accepted_at)}` : 'Pas encore'],
              ['Discussions gardées', u.chat_retention_days ? `${u.chat_retention_days} jours` : 'Tant que le compte existe'],
              u.inactivity_warned_at && ["Avertissement d'inactivité", formatDateTime(u.inactivity_warned_at)],
            ]}
          />
        </Section>

        <Section icon={FiBell} id="uo-notif" title="Notifications par e-mail" action={<NotifyBadge user={u} />}>
          <p className="mb-3 text-sm">{st.detail}</p>
          {!n.global_enabled && (
            <p className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
              Les e-mails sont coupés pour tout le monde dans Paramètres &gt; Notifications.
            </p>
          )}
          <ul className="space-y-1.5 text-sm">
            {n.prefs.map((p) => {
              const on = n.has_email && n.email_enabled && p.on;
              return (
                <li key={p.key} className="flex items-center gap-2">
                  {on ? <FiCheck aria-label="Reçu" className="shrink-0 text-resolved" /> : <FiX aria-label="Pas reçu" className="shrink-0 text-danger" />}
                  <span className={on ? '' : 'text-ink-mute'}>{p.label}</span>
                  {!p.on && <span className="text-xs text-ink-mute">(désactivé par la personne)</span>}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-ink-mute">
            Seule la personne peut changer ces choix, dans « Mon compte ». On n'est jamais prévenu de ses propres actions.
          </p>
        </Section>

        <Section icon={FiShield} id="uo-sec" title="Sécurité">
          <Facts
            items={[
              ['Double authentification', sec.mfa_enabled ? 'Activée' : sec.mfa_exempt ? (u.mfa_exempt_by === 'self' ? 'Refusée par la personne' : 'Dispensé par un administrateur') : 'À configurer'],
              ['Codes de secours restants', sec.mfa_enabled ? sec.recovery_codes_left : null],
              ['Dernière connexion', sec.last_login ? `${formatDateTime(sec.last_login.created_at)}, ${sec.last_login.message.charAt(0).toLowerCase()}${sec.last_login.message.slice(1)}` : 'Aucune trace'],
              ['Échecs de connexion (30 jours)', sec.failed_logins_30d],
            ]}
          />
          <h3 className="mb-2 mt-4 text-sm font-semibold">Navigateurs de confiance</h3>
          {sec.trusted_devices.length ? (
            <ul className="space-y-1 text-sm">
              {sec.trusted_devices.map((d, i) => (
                <li key={i}>
                  {d.label || 'Navigateur'} <span className="text-ink-mute">(ajouté le {formatDate(d.created_at)}, expire le {formatDate(d.expires_at)})</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-mute">Aucun.</p>
          )}
          {sec.events.length > 0 && (
            <>
              <h3 className="mb-2 mt-4 text-sm font-semibold">Historique de sécurité</h3>
              <ul className="space-y-1 text-sm">
                {sec.events.map((e, i) => (
                  <li key={i}>
                    <span className="text-ink-mute">{formatDateTime(e.created_at)}</span> {e.label}
                    {e.detail && <span className="text-ink-mute"> ({e.detail})</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {sec.impersonations.length > 0 && (
            <>
              <h3 className="mb-2 mt-4 text-sm font-semibold">Prises de contrôle par un administrateur</h3>
              <ul className="space-y-1 text-sm">
                {sec.impersonations.map((p, i) => (
                  <li key={i}>
                    <span className="text-ink-mute">{formatDateTime(p.started_at)}</span> par {p.admin || 'un administrateur supprimé'}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>

        <Section icon={FiUsers} id="uo-groups" title="Groupes">
          {data.groups.length ? (
            <ul className="flex flex-wrap gap-2">
              {data.groups.map((g) => (
                <li key={g.id} className="rounded-full border border-line px-3 py-1 text-sm">
                  {g.name} <span className="text-ink-mute">({g.members} membres)</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-mute">Membre d'aucun groupe : ne reçoit donc aucune nouvelle demande de groupe.</p>
          )}
          {data.group_requests.length > 0 && (
            <>
              <h3 className="mb-2 mt-4 text-sm font-semibold">Demandes d'adhésion</h3>
              <ul className="space-y-1 text-sm">
                {data.group_requests.map((r, i) => (
                  <li key={i}>
                    <span className="text-ink-mute">{formatDate(r.created_at)}</span> {r.group_name} : {REQUEST_STATUS[r.status] || r.status}
                    {r.reason && <span className="text-ink-mute"> ({r.reason})</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      </div>

      <Section icon={FiFileText} id="uo-tickets" title="Demandes">
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="créées" value={t.created_total} />
          <Stat label="créées, en cours" value={t.created_open} />
          <Stat label="en charge, en cours" value={t.assigned_open} />
          <Stat label="traitées (résolues ou fermées)" value={t.resolved_by} />
          <Stat label="messages écrits" value={t.comments} />
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <div>
            <h3 className="mb-1 text-sm font-semibold">Dernières demandes créées</h3>
            <TicketList items={t.recent_created} empty="Aucune." />
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold">Demandes en charge</h3>
            <TicketList items={t.assigned} empty="Aucune en cours." />
          </div>
        </div>
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section icon={FiMail} id="uo-mails" title="E-mails reçus" action={<span className="text-xs text-ink-mute">30 derniers jours : {n.sent_30d} envoyés, {n.errors_30d} en échec</span>}>
          {n.recent.length ? (
            <ul className="divide-y divide-line text-sm">
              {n.recent.map((m, i) => (
                <li key={i} className="py-1.5">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-xs text-ink-mute">{formatDateTime(m.created_at)}</span>
                    <span className={m.status === 'sent' ? 'font-semibold' : 'font-semibold text-danger'}>{m.status === 'sent' ? 'Envoyé' : 'Échec'}</span>
                    <span className="text-ink-mute">{m.event_label}</span>
                  </span>
                  <span className="block truncate" title={m.subject}>
                    {m.subject}
                  </span>
                  {m.error && <span className="block text-xs text-danger">{m.error}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-mute">Aucun e-mail envoyé à ce compte.</p>
          )}
        </Section>

        <Section icon={FiActivity} id="uo-activity" title="Activité récente" action={<Link to={`/admin?tab=log&user=${u.id}`} className="text-sm font-semibold text-accent-strong hover:underline">Tout voir</Link>}>
          {data.activity.length ? (
            <ul className="divide-y divide-line text-sm">
              {data.activity.map((a, i) => (
                <li key={i} className="py-1.5">
                  <span className="text-xs text-ink-mute">{formatDateTime(a.created_at)}</span>{' '}
                  <span className={LEVEL_STYLES[a.level]}>{a.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-mute">Rien dans le journal.</p>
          )}
        </Section>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section icon={FiDatabase} id="uo-analyses" title="Analyses">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="rapports" value={data.analyses.reports} />
            <Stat label="tableaux de bord" value={data.analyses.dashboards} />
            <Stat label="envois programmés actifs" value={data.analyses.schedules} />
          </div>
        </Section>
        <Section icon={FiLock} id="uo-rgpd" title="Données personnelles (RGPD)" action={<Link to="/admin?tab=settings&section=rgpd" className="text-sm font-semibold text-accent-strong hover:underline">Onglet RGPD</Link>}>
          {data.rgpd.length ? (
            <ul className="space-y-1 text-sm">
              {data.rgpd.map((r, i) => (
                <li key={i}>
                  <span className="text-ink-mute">{formatDate(r.created_at)}</span> {r.label} : {REQUEST_STATUS[r.status] || r.status}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-mute">Aucune demande.</p>
          )}
        </Section>
      </div>
    </div>
  );
}
