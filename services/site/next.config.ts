import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@prism-railway/app-core'],
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
