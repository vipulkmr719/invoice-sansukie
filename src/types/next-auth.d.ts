import type { DefaultSession } from 'next-auth';

/**
 * Auth.js module augmentation.
 *
 * `session.user.id` is the tenant key every repository query is scoped by, so
 * it is typed as a required string rather than the library's optional default —
 * a missing id would otherwise silently produce an unscoped query.
 */
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
    } & DefaultSession['user'];
  }

  interface User {
    id?: string;
    email?: string | null;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    sub?: string;
  }
}
