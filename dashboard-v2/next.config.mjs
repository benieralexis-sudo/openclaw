/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  outputFileTracingRoot: process.cwd(),
  // En attendant DNS app-v2.ifind.fr, on sert sous /preview-v2 de ifind.fr
  basePath: process.env.BASE_PATH || '',
  assetPrefix: process.env.BASE_PATH || undefined,
  // Expose le basePath au client (utilisé par auth-client.ts)
  env: {
    NEXT_PUBLIC_BASE_PATH: process.env.BASE_PATH || '',
  },
  experimental: {
    optimizePackageImports: ['lucide-react', '@tabler/icons-react'],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
