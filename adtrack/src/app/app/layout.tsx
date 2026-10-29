import { requireMember } from '@/lib/session';
import { Tabs } from './tabs';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { db, member, workspace } = await requireMember();
  const newCount = await db.rpc<number>('inbox_new_count');
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="topbar-title">
            <strong>{workspace.name}</strong>
            <form action="/auth/signout" method="post" className="row">
              <span className="muted">{member.name || member.email}</span>
              <button className="secondary">로그아웃</button>
            </form>
          </div>
          <Tabs isAdmin={member.role === 'admin'} newCount={newCount} />
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
