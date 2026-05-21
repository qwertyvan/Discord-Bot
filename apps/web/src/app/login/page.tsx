import { PUBLIC_API_BASE_URL } from '@/lib/api';

export default function LoginPage() {
  const loginUrl = `${PUBLIC_API_BASE_URL}/auth/discord/login`;
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/60 p-8 shadow-xl">
        <h1 className="text-2xl font-semibold tracking-tight">Discord Bot Admin</h1>
        <p className="mt-2 text-sm text-slate-400">
          Sign in with Discord to manage servers where you have the{' '}
          <span className="font-medium text-slate-200">Manage Server</span> permission.
        </p>
        <a
          href={loginUrl}
          className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-discord px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-discord-dark"
        >
          Sign in with Discord
        </a>
      </div>
    </main>
  );
}
