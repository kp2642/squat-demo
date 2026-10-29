import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 로컬·테스트에서 DB 에 직접 붙을 때만 쓴다 (src/lib/server-db.ts)
  serverExternalPackages: ['pg'],
  // 네이버 키워드 보고서 CSV 올리기 (최대 5MB)
  experimental: { serverActions: { bodySizeLimit: '6mb' } },
};

export default nextConfig;
