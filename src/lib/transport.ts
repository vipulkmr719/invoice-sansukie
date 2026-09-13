/**
 * Is this deployment actually served over TLS?
 *
 * Three separate decisions depend on the answer, and they must never disagree:
 *
 *   - the `Secure` attribute and `__Secure-`/`__Host-` prefixes on session
 *     cookies (`auth.config.ts`),
 *   - the `Strict-Transport-Security` header,
 *   - the CSP's `upgrade-insecure-requests` directive.
 *
 * Deriving them from NODE_ENV is the usual mistake: a staging or internal
 * deployment built in production mode but served over plain HTTP would then
 * set cookies the browser refuses to store, and would upgrade its own
 * subresource requests to a scheme nothing is listening on. The deployment's
 * declared public origin is the honest signal, so that is what all three use.
 *
 * Edge-safe: reads `process.env` directly rather than importing the validated
 * env module, because the proxy runs on the Edge runtime.
 */
export function isSecureDeployment(appUrl: string | undefined = process.env.APP_URL): boolean {
  return (appUrl ?? '').startsWith('https://');
}
