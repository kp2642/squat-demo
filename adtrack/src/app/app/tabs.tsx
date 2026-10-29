'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/app', label: '성과', adminOnly: true },
  { href: '/app/inquiries', label: '문의함', adminOnly: false },
  { href: '/app/spend', label: '광고비', adminOnly: true },
  { href: '/app/setup', label: '설치', adminOnly: true },
];

export function Tabs({ isAdmin, newCount }: { isAdmin: boolean; newCount: number }) {
  const path = usePathname();
  return (
    <nav className="tabs">
      {TABS.filter((t) => isAdmin || !t.adminOnly).map((t) => (
        <Link key={t.href} href={t.href} className={(t.href === '/app' ? path === t.href : path.startsWith(t.href)) ? 'active' : undefined}>
          {t.label}
          {t.href === '/app/inquiries' && newCount > 0 && (
            <span className="tab-badge" aria-label={`새 문의 ${newCount}건`}>{newCount > 99 ? '99+' : newCount}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
