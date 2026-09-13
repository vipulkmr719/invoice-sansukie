import { NextResponse } from 'next/server';

import { checkDatabaseConnection } from '@/server/db/prisma';

export const dynamic = 'force-dynamic';

/**
 * Liveness/readiness probe.
 *
 * Reports only `ok` / `error` — never the driver's message, which would name
 * the host, port and user from DATABASE_URL (security requirement #10).
 */
export async function GET() {
  try {
    await checkDatabaseConnection();
    return NextResponse.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    console.error('[api/health] database check failed', error);
    return NextResponse.json(
      { status: 'error', database: 'unavailable' },
      { status: 503 },
    );
  }
}
