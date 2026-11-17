import { API_BASE_URL, tokenStore } from '../lib/api';

/**
 * Flux en direct des discussions. EventSource ne sait pas envoyer l'en-tête Authorization :
 * on lit donc le flux avec fetch, et on se reconnecte tout seul en cas de coupure.
 * Renvoie une fonction d'arrêt.
 */
export function openChatStream({ onEvent, onStatus }) {
  let stopped = false;
  let ctrl = null;
  let delay = 2000;
  let timer = null;

  const schedule = () => {
    if (stopped) return;
    onStatus?.('offline');
    timer = setTimeout(connect, delay);
    delay = Math.min(delay * 2, 30_000);
  };

  async function connect() {
    if (stopped) return;
    const token = tokenStore.get();
    if (!token) return;
    ctrl = new AbortController();
    let res;
    try {
      res = await fetch(`${API_BASE_URL}/api/chat/stream`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        signal: ctrl.signal,
        cache: 'no-store',
      });
    } catch {
      schedule();
      return;
    }
    if (!res.ok || !res.body) {
      // Session expirée ou accès refusé : inutile d'insister.
      if (res.status === 401 || res.status === 403) {
        onStatus?.('off');
        return;
      }
      schedule();
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let i;
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const event = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (!event) continue;
          if (event === 'ready') {
            delay = 2000;
            onStatus?.('online');
          }
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            parsed = null;
          }
          onEvent(event, parsed);
        }
      }
    } catch {
      /* coupure réseau ou arrêt volontaire */
    }
    schedule();
  }

  connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    ctrl?.abort();
  };
}
