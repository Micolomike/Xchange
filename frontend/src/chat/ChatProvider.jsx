import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/context';
import { api, impersonation } from '../lib/api';
import { ChatContext } from './context';
import { openChatStream } from './stream';

/**
 * Tient le flux en direct ouvert tant qu'une personne est connectée : le compteur de messages non lus
 * de la barre de navigation reste à jour sur toutes les pages, et la page Discussions s'y abonne.
 */
export default function ChatProvider({ children }) {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const [status, setStatus] = useState('off');
  const listeners = useRef(new Set());
  const active = useRef(null);
  const userId = user?.id || null;
  const enabled = Boolean(userId) && !impersonation.active() && !user?.impersonator;

  const refreshUnread = useCallback(async () => {
    try {
      setUnread((await api('/api/chat/unread')).unread);
    } catch {
      /* compteur indisponible : il sera rafraîchi plus tard */
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setUnread(0);
      setStatus('off');
      return undefined;
    }
    refreshUnread();
    const stop = openChatStream({
      onStatus: (s) => {
        setStatus(s);
        // Après une coupure, des messages ont pu arriver.
        if (s === 'online') refreshUnread();
      },
      onEvent: (event, data) => {
        if (event === 'message' && data && data.author?.id !== userId && data.conversationId !== active.current) {
          setUnread((n) => n + 1);
        }
        if (event === 'deleted' || event === 'purged' || (event === 'conversation' && data?.removed)) refreshUnread();
        for (const fn of listeners.current) fn(event, data);
      },
    });
    return stop;
  }, [enabled, userId, refreshUnread]);

  const subscribe = useCallback((fn) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  const setActiveConversation = useCallback((id) => {
    active.current = id;
  }, []);

  const value = useMemo(
    () => ({ enabled, unread, status, subscribe, refreshUnread, setActiveConversation }),
    [enabled, unread, status, subscribe, refreshUnread, setActiveConversation]
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
