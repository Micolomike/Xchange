import { createContext, useContext } from 'react';

export const ChatContext = createContext(null);

/** Discussions : messages non lus, flux en direct, conversation ouverte. */
export function useChat() {
  return useContext(ChatContext);
}
