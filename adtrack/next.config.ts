import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 로컬·테스트에서 DB 에 직접 붙을 때만 쓴다 (src/lib/server-db.ts)
  serverExternalPackages: ['pg'],
};

export default nextConfig;
