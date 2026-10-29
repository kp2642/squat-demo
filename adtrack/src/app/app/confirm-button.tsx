'use client';

// 지우기처럼 되돌릴 수 없는 버튼. 확인을 누르지 않으면 제출하지 않는다.
export function ConfirmButton({ message, children, className }: { message: string; children: React.ReactNode; className?: string }) {
  return (
    <button className={className} onClick={(e) => { if (!confirm(message)) e.preventDefault(); }}>
      {children}
    </button>
  );
}
