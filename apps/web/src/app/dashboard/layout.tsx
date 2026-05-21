import { Topbar } from '@/components/topbar';
import { requireSessionUser } from '@/lib/auth';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSessionUser();
  return (
    <>
      <Topbar user={user} />
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </>
  );
}
