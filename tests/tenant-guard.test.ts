import { describe, expect, it } from 'vitest';

import { tenantGuardExtension, TenantScopeError } from '@/server/db/tenant-guard';

/**
 * Unit tests for the tenant-scope guard.
 *
 * The guard is the mechanical enforcement of the isolation rule: a query on a
 * tenant-owned model that does not name the owning user never reaches the
 * database. These tests drive the extension's interceptor directly, so they
 * cover the exact predicate without needing a connection.
 */

type Interceptor = (input: {
  model?: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}) => Promise<unknown>;

function buildInterceptor(): { run: Interceptor; reached: () => number } {
  let reachedDatabase = 0;

  const extension = tenantGuardExtension();
  const run = extension.query.$allModels.$allOperations as Interceptor;

  return {
    run: (input) =>
      run({
        ...input,
        query: async (args) => {
          reachedDatabase += 1;
          return args;
        },
      }),
    reached: () => reachedDatabase,
  };
}

const TENANT_MODELS = ['Client', 'Invoice', 'Company'] as const;

const READ_OPERATIONS = [
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
] as const;

const WRITE_OPERATIONS = [
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
] as const;

describe('テナントガード: スコープなしのクエリを拒否する', () => {
  it.each(TENANT_MODELS)(
    'refuses an unscoped findUnique on %s — the classic IDOR shape',
    async (model) => {
      const { run, reached } = buildInterceptor();

      await expect(
        run({ model, operation: 'findUnique', args: { where: { id: 'someone-elses-id' } }, query: async () => null }),
      ).rejects.toThrow(TenantScopeError);

      // The query never reached the database.
      expect(reached()).toBe(0);
    },
  );

  it.each(READ_OPERATIONS)('refuses an unscoped %s on Invoice', async (operation) => {
    const { run, reached } = buildInterceptor();

    await expect(
      run({ model: 'Invoice', operation, args: { where: { id: 'x' } }, query: async () => null }),
    ).rejects.toThrow(/Refused an unscoped/);
    expect(reached()).toBe(0);
  });

  it.each(WRITE_OPERATIONS)('refuses an unscoped %s on Client', async (operation) => {
    const { run, reached } = buildInterceptor();

    await expect(
      run({ model: 'Client', operation, args: { where: { id: 'x' } }, query: async () => null }),
    ).rejects.toThrow(/Refused an unscoped/);
    expect(reached()).toBe(0);
  });

  it('refuses a query with no where clause at all', async () => {
    const { run } = buildInterceptor();

    await expect(
      run({ model: 'Invoice', operation: 'findMany', args: {}, query: async () => null }),
    ).rejects.toThrow(TenantScopeError);
  });

  it('refuses a scope hidden inside OR — one unscoped branch widens the result', async () => {
    const { run } = buildInterceptor();

    await expect(
      run({
        model: 'Invoice',
        operation: 'findMany',
        args: { where: { OR: [{ userId: 'a' }, { id: 'anything' }] } },
        query: async () => null,
      }),
    ).rejects.toThrow(TenantScopeError);
  });

  it('refuses an empty-string userId', async () => {
    const { run } = buildInterceptor();

    await expect(
      run({ model: 'Invoice', operation: 'findFirst', args: { where: { userId: '' } }, query: async () => null }),
    ).rejects.toThrow(TenantScopeError);
  });

  it('refuses a create with no owner attached', async () => {
    const { run } = buildInterceptor();

    await expect(
      run({
        model: 'Invoice',
        operation: 'create',
        args: { data: { invoiceNumber: 'INV-1' } },
        query: async () => null,
      }),
    ).rejects.toThrow(TenantScopeError);
  });

  it('refuses a createMany where any row lacks an owner', async () => {
    const { run } = buildInterceptor();

    await expect(
      run({
        model: 'Client',
        operation: 'createMany',
        args: { data: [{ userId: 'a', name: 'ok' }, { name: 'missing owner' }] },
        query: async () => null,
      }),
    ).rejects.toThrow(TenantScopeError);
  });

  it('refuses a direct InvoiceItem query that is not scoped through its invoice', async () => {
    const { run } = buildInterceptor();

    await expect(
      run({
        model: 'InvoiceItem',
        operation: 'findMany',
        args: { where: { invoiceId: 'someone-elses-invoice' } },
        query: async () => null,
      }),
    ).rejects.toThrow(TenantScopeError);
  });
});

describe('テナントガード: 正しくスコープされたクエリは通す', () => {
  it('allows a direct userId scope', async () => {
    const { run, reached } = buildInterceptor();

    await run({
      model: 'Invoice',
      operation: 'findFirst',
      args: { where: { id: 'inv_1', userId: 'user_1' } },
      query: async () => null,
    });

    expect(reached()).toBe(1);
  });

  it('allows a userId "in" scope', async () => {
    const { run, reached } = buildInterceptor();

    await run({
      model: 'Client',
      operation: 'findMany',
      args: { where: { userId: { in: ['a', 'b'] } } },
      query: async () => null,
    });

    expect(reached()).toBe(1);
  });

  it('allows a scope through the user relation', async () => {
    const { run, reached } = buildInterceptor();

    await run({
      model: 'Company',
      operation: 'findFirst',
      args: { where: { user: { id: 'user_1' } } },
      query: async () => null,
    });

    expect(reached()).toBe(1);
  });

  it('allows a scope nested inside AND', async () => {
    const { run, reached } = buildInterceptor();

    await run({
      model: 'Invoice',
      operation: 'findMany',
      args: { where: { AND: [{ issueDate: { gte: new Date() } }, { userId: 'user_1' }] } },
      query: async () => null,
    });

    expect(reached()).toBe(1);
  });

  it('allows a compound unique key that contains userId', async () => {
    const { run, reached } = buildInterceptor();

    await run({
      model: 'Invoice',
      operation: 'findUnique',
      args: { where: { userId_invoiceNumber: { userId: 'user_1', invoiceNumber: 'INV-1' } } },
      query: async () => null,
    });
    await run({
      model: 'Client',
      operation: 'findUnique',
      args: { where: { id_userId: { id: 'cl_1', userId: 'user_1' } } },
      query: async () => null,
    });

    expect(reached()).toBe(2);
  });

  it('allows an InvoiceItem query scoped through its invoice', async () => {
    const { run, reached } = buildInterceptor();

    await run({
      model: 'InvoiceItem',
      operation: 'findMany',
      args: { where: { invoice: { userId: 'user_1' } } },
      query: async () => null,
    });

    expect(reached()).toBe(1);
  });

  it('allows a create that attaches an owner', async () => {
    const { run, reached } = buildInterceptor();

    await run({
      model: 'Client',
      operation: 'create',
      args: { data: { userId: 'user_1', name: '取引先' } },
      query: async () => null,
    });

    expect(reached()).toBe(1);
  });

  it('leaves the User model alone — it is the tenant, not tenant-owned', async () => {
    const { run, reached } = buildInterceptor();

    await run({
      model: 'User',
      operation: 'findUnique',
      args: { where: { id: 'user_1' } },
      query: async () => null,
    });
    await run({
      model: 'User',
      operation: 'findUnique',
      args: { where: { email: 'a@example.com' } },
      query: async () => null,
    });

    expect(reached()).toBe(2);
  });
});
