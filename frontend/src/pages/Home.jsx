import { useAuth } from '../auth/context';
import { Spinner } from '../components/ui';
import Dashboard from './Dashboard';
import Landing from './Landing';

export default function Home() {
  const { user, status } = useAuth();
  if (status === 'loading') return <Spinner />;
  return user ? <Dashboard /> : <Landing />;
}
