import { createContext, useContext } from 'react';
import type { Role, User } from '../../shared/types.ts';

export interface Session {
  user: User;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
}

export const SessionCtx = createContext<Session | null>(null);
export const useSession = () => useContext(SessionCtx)!;

const RANK: Record<Role, number> = { operator: 1, manager: 2, admin: 3 };
export const can = (user: User | null | undefined, min: Role) => Boolean(user && RANK[user.role] >= RANK[min]);
