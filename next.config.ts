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

  experimental: {
    /*
     * Server Actions reject a request whose Origin does not match the Host,
     * which is what makes them CSRF-safe by default. Behind a proxy that
     * rewrites Host, the real public origins must be listed or legitimate
     * submissions are refused. Read from the environment so a deployment
     * declares its own origins rather than this file hard-coding one.
     */
    serverActions: {
      allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
      bodySizeLimit: '1mb',
    },
  },

  // Security headers are set per request in src/proxy.ts, because the CSP
  // carries a fresh nonce each time and a static header cannot. Keeping a
  // second, weaker copy here would only invite the two to drift apart.
};

export default nextConfig;
