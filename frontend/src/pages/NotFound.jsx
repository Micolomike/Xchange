import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <span className="ticket-stub ticket-stub--lg ticket-stub--muted">#404</span>
      <h1 className="mt-6 text-2xl font-bold">Cette page n'existe pas</h1>
      <p className="mt-2 text-ink-mute">L'adresse est peut-être incomplète, ou la page a été déplacée.</p>
      <Link to="/" className="btn btn-primary mt-6">
        Revenir à l'accueil
      </Link>
    </div>
  );
}
