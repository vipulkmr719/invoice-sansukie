import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Fail the production build on type errors instead of shipping them.
  // (Next 16 removed `next lint`; ESLint runs as its own `npm run lint` step.)
  typescript: { ignoreBuildErrors: false },

  // Never leak framework details in response headers.
  poweredByHeader: false,

  // `next dev` otherwise writes AGENTS.md / CLAUDE.md into the repo root on
  // every run. Nothing in this project depends on them, so keep them out.
  agentRules: false,

  // Baseline security headers for every route.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
