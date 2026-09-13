import 'server-only';

/**
 * Tenant-scope guard.
 *
 * Data isolation in this application rests on one rule: every read and every
 * write touching `Client`, `Invoice`, `InvoiceItem` or `Company` must name the
 * authenticated user. `findUnique({ where: { id } })` is exactly the shape that
 * quietly breaks it — it looks correct, compiles, and returns another tenant's
 * row.
 *
 * Reviewing for that by eye does not scale, so this Prisma client extension
 * enforces it mechanically: a query on a tenant-owned model that is not scoped
 * by the owning user is refused before it reaches the database. Adding an
 * unscoped query is then not a silent leak but an immediate, loud failure.
 *
 * This sits *behind* the application's own ownership checks and the database's
 * tenant-scoped foreign key. Three independent layers, none of which is the
 * only thing standing between two customers' data.
 */

/** Models whose rows belong to exactly one user. */
const TENANT_MODELS = [
  'Client',
  'Invoice',
  'Company',
  'InvoiceItem',
  'Billing',
] as const;

type TenantModel = (typeof TENANT_MODELS)[number];

function isTenantModel(model: string | undefined): model is TenantModel {
  return (
    model !== undefined && (TENANT_MODELS as readonly string[]).includes(model)
  );
}

/** Operations that read or mutate existing rows, and so need a scope. */
const SCOPED_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
  'count',
  'aggregate',
  'groupBy',
]);

export class TenantScopeError extends Error {
  constructor(model: string, operation: string) {
    super(
      `Refused an unscoped ${operation} on ${model}. Every query on a ` +
        'tenant-owned model must be scoped to the authenticated user — add ' +
        `userId${model === 'InvoiceItem' ? " (via invoice: { userId })" : ''} ` +
        'to the where clause. See src/server/db/tenant-guard.ts.',
    );
    this.name = 'TenantScopeError';
  }
}

function isNonEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

/**
 * Does this `where` clause constrain the query to a single user?
 *
 * Accepted forms:
 *   { userId: 'abc' }                      direct scope
 *   { userId: { in: [...] } }              direct scope, several users
 *   { user: { id: 'abc' } }                scope through the relation
 *   { invoice: { userId: 'abc' } }         InvoiceItem, through its invoice
 *   { AND: [ …, { userId } ] }             nested inside AND
 *
 * `OR` deliberately does not count: one unscoped branch widens the result set,
 * so a scope inside an OR is no scope at all.
 */
function hasTenantScope(where: unknown, model: TenantModel): boolean {
  if (!where || typeof where !== 'object') return false;

  const clause = where as Record<string, unknown>;

  if (isNonEmpty(clause.userId)) return true;

  // Prisma addresses a compound unique key as a single nested object, e.g.
  //   { userId_invoiceNumber: { userId, invoiceNumber } }
  //   { id_userId: { id, userId } }
  // Those are scoped, so look one level in when the key names userId.
  for (const [key, value] of Object.entries(clause)) {
    if (!/(^|_)userId(_|$)/.test(key)) continue;
    if (value && typeof value === 'object') {
      if (isNonEmpty((value as Record<string, unknown>).userId)) return true;
    }
  }

  // Scope expressed through the `user` relation.
  const user = clause.user;
  if (user && typeof user === 'object') {
    const relation = user as Record<string, unknown>;
    if (isNonEmpty(relation.id) || isNonEmpty(relation.email)) return true;
  }

  // Billing carries unique Stripe identifiers. Each belongs to exactly one
  // user, so selecting by one selects at most one tenant's row — which is what
  // the Stripe webhook must do before it knows whose account an event is for.
  if (model === 'Billing') {
    if (isNonEmpty(clause.customerId) || isNonEmpty(clause.subscriptionId)) {
      return true;
    }
  }

  // InvoiceItem has no userId of its own; it is scoped through its invoice.
  if (model === 'InvoiceItem') {
    const invoice = clause.invoice;
    if (invoice && typeof invoice === 'object') {
      const relation = invoice as Record<string, unknown>;
      if (isNonEmpty(relation.userId)) return true;

      const invoiceUser = relation.user;
      if (invoiceUser && typeof invoiceUser === 'object') {
        if (isNonEmpty((invoiceUser as Record<string, unknown>).id)) return true;
      }
    }
  }

  // A scope nested inside AND still constrains every returned row.
  const and = clause.AND;
  if (Array.isArray(and)) {
    return and.some((entry) => hasTenantScope(entry, model));
  }
  if (and && typeof and === 'object') {
    return hasTenantScope(and, model);
  }

  return false;
}

/**
 * Does this create payload attach the row to a user?
 * Creates are checked too: an invoice created without a userId would be
 * unreachable at best and mis-owned at worst.
 */
function createHasOwner(data: unknown, model: TenantModel): boolean {
  if (!data || typeof data !== 'object') return false;

  // createMany passes an array.
  if (Array.isArray(data)) {
    return data.every((entry) => createHasOwner(entry, model));
  }

  const payload = data as Record<string, unknown>;

  if (isNonEmpty(payload.userId)) return true;
  if (payload.user && typeof payload.user === 'object') return true;

  if (model === 'InvoiceItem') {
    // Items are normally written nested inside their invoice's create, where
    // Prisma supplies invoiceId itself.
    if (isNonEmpty(payload.invoiceId)) return true;
    if (payload.invoice && typeof payload.invoice === 'object') return true;
  }

  return false;
}

export interface TenantGuardOptions {
  /**
   * Called when a query is refused. Defaults to throwing. Tests use this to
   * assert the guard fired without unwinding the call stack.
   */
  onViolation?: (model: string, operation: string) => void;
}

/**
 * Build the extension. Applied in `src/server/db/prisma.ts`.
 */
export function tenantGuardExtension(options: TenantGuardOptions = {}) {
  const report =
    options.onViolation ??
    ((model: string, operation: string) => {
      throw new TenantScopeError(model, operation);
    });

  return {
    name: 'tenant-scope-guard',
    query: {
      $allModels: {
        async $allOperations({
          model,
          operation,
          args,
          query,
        }: {
          model?: string;
          operation: string;
          args: unknown;
          query: (args: unknown) => Promise<unknown>;
        }) {
          if (!isTenantModel(model)) {
            return query(args);
          }

          const payload = (args ?? {}) as Record<string, unknown>;

          if (SCOPED_OPERATIONS.has(operation)) {
            // `upsert` also creates, but its `where` is what selects the row.
            if (!hasTenantScope(payload.where, model)) {
              report(model, operation);
            }
          } else if (operation === 'create' || operation === 'createMany') {
            if (!createHasOwner(payload.data, model)) {
              report(model, operation);
            }
          }

          return query(args);
        },
      },
    },
  };
}
