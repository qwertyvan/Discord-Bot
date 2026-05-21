import { redirect } from 'next/navigation';
import { ApiError, serverFetch } from './api';

export interface SessionUser {
  sessionId: string;
  userId: string;
  username: string;
  globalName: string | null;
  avatarUrl: string | null;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const { user } = await serverFetch<{ user: SessionUser }>('/auth/me');
    return user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}
