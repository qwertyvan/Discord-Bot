import Link from 'next/link';
import { PUBLIC_API_BASE_URL } from '@/lib/api';
import type { SessionUser } from '@/lib/auth';

export function Topbar({ user }: { user: SessionUser }) {
  const displayName = user.globalName ?? user.username;
  return (
    <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
            Discord Bot Admin
          </Link>
          <Link
            href="/dashboard/health"
            className="text-xs text-slate-400 transition hover:text-slate-200"
          >
            Health
          </Link>
        </div>
        <div className="flex items-center gap-3">
          {user.avatarUrl && (
            <img
              src={user.avatarUrl}
              alt=""
              className="h-7 w-7 rounded-full border border-slate-700"
            />
          )}
          <span className="text-sm text-slate-300">{displayName}</span>
          <form action={`${PUBLIC_API_BASE_URL}/auth/logout`} method="post">
            <button
              type="submit"
              className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition hover:bg-slate-800"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
