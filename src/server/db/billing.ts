import 'server-only';

import {
  resolveEntitlement,
  resolveInvoiceQuota,
  type BillingPlanName,
  type BillingStatusName,
  type Entitlement,
  type InvoiceQuota,
} from '@/domain/entitlement';

import { prisma } from './prisma';

/**
 * Billing data access.
 *
 * Every read is scoped to one user, like the rest of the repository layer.
 * Writes happen only from the Stripe webhook handler; nothing reachable from a
 * browser request can change a billing row.
 */

export interface BillingRecord {
  userId: string;
  customerId: string | null;
  subscriptionId: string | null;
  status: BillingStatusName;
  plan: BillingPlanName;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  updatedAt: string;
}

const BILLING_SELECT = {
  userId: true,
  customerId: true,
  subscriptionId: true,
  status: true,
  plan: true,
  currentPeriodEnd: true,
  cancelAtPeriodEnd: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface BillingRow {
  userId: string;
  customerId: string | null;
  subscriptionId: string | null;
  status: string;
  plan: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(row: BillingRow): BillingRecord {
  return {
    userId: row.userId,
    customerId: row.customerId,
    subscriptionId: row.subscriptionId,
    status: row.status as BillingStatusName,
    plan: row.plan as BillingPlanName,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getBillingForUser(
  userId: string,
): Promise<BillingRecord | null> {
  const row = await prisma.billing.findUnique({
    where: { userId },
    select: BILLING_SELECT,
  });

  return row ? toRecord(row) : null;
}

/**
 * The authoritative entitlement for a user.
 *
 * Read from the database on every call. There is deliberately no cache: a
 * cancelled subscription must stop granting access at the moment the webhook
 * lands, not when a TTL happens to expire.
 */
export async function getEntitlementForUser(
  userId: string,
): Promise<Entitlement> {
  const row = await prisma.billing.findUnique({
    where: { userId },
    select: {
      status: true,
      plan: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
    },
  });

  return resolveEntitlement(
    row
      ? {
          status: row.status as BillingStatusName,
          plan: row.plan as BillingPlanName,
          currentPeriodEnd: row.currentPeriodEnd,
          cancelAtPeriodEnd: row.cancelAtPeriodEnd,
        }
      : null,
  );
}

/** Entitlement plus the account's invoice usage against the free limit. */
export async function getInvoiceQuotaForUser(
  userId: string,
): Promise<InvoiceQuota> {
  const [entitlement, invoiceCount] = await Promise.all([
    getEntitlementForUser(userId),
    prisma.invoice.count({ where: { userId } }),
  ]);

  return resolveInvoiceQuota(entitlement, invoiceCount);
}

/**
 * Find the user a Stripe customer belongs to.
 *
 * The webhook handler uses this to map an incoming event back to an account
 * without trusting any user id carried in the event payload.
 */
export async function findUserIdByStripeCustomerId(
  customerId: string,
): Promise<string | null> {
  const row = await prisma.billing.findUnique({
    where: { customerId },
    select: { userId: true },
  });

  return row?.userId ?? null;
}

export interface BillingWriteInput {
  customerId?: string | null;
  subscriptionId?: string | null;
  status?: BillingStatusName;
  plan?: BillingPlanName;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  priceId?: string | null;
}

/** Read the Stripe customer already recorded for this account, if any. */
export async function getStripeCustomerId(userId: string): Promise<string | null> {
  const row = await prisma.billing.findUnique({
    where: { userId },
    select: { customerId: true },
  });

  return row?.customerId ?? null;
}

/** Record the Stripe customer for this account, creating the row if needed. */
export async function setStripeCustomerId(
  userId: string,
  customerId: string,
): Promise<void> {
  await prisma.billing.upsert({
    where: { userId },
    create: { userId, customerId },
    update: { customerId },
  });
}

// ---------------------------------------------------------------------------
// Webhook application
// ---------------------------------------------------------------------------

/**
 * The narrow database view a webhook handler is given.
 *
 * Deliberately small: an event handler may look up which account a Stripe
 * customer belongs to and what plan it already has, and nothing else. It never
 * receives a Prisma client, so it cannot reach past billing into invoices or
 * another tenant's data.
 */
export interface WebhookDbContext {
  /** Which account owns this Stripe customer, if we have seen it before. */
  findUserIdByCustomerId(customerId: string): Promise<string | null>;
  /** Whether a user id refers to a real account. */
  userExists(userId: string): Promise<boolean>;
  /** The plan currently recorded for an account. */
  getPlanForUser(userId: string): Promise<BillingPlanName | null>;
  /** The subscription id currently recorded for an account. */
  getSubscriptionIdForUser(userId: string): Promise<string | null>;
}

export interface WebhookEventMeta {
  id: string;
  type: string;
  createdAt: Date;
}

export type BillingPatch = { userId: string; data: BillingWriteInput } | null;

export type WebhookPersistOutcome =
  | { result: 'applied'; detail: string }
  | { result: 'duplicate'; detail: string };

/** Postgres unique-violation, i.e. we have seen this event before. */
function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 'P2002' || code === '23505';
}

/**
 * Record a Stripe event and apply its billing change, exactly once.
 *
 * The event id is inserted first, inside the same transaction as the billing
 * write. A redelivery hits the primary key, the transaction rolls back, and
 * billing is untouched — there is no window in which one half happened and the
 * other did not.
 */
export async function persistWebhookEvent(
  event: WebhookEventMeta,
  buildPatch: (db: WebhookDbContext) => Promise<BillingPatch>,
): Promise<WebhookPersistOutcome> {
  try {
    return await prisma.$transaction(async (tx) => {
      // Claim the event. If this throws, nothing below it runs.
      await tx.processedWebhookEvent.create({
        data: { id: event.id, type: event.type, eventCreatedAt: event.createdAt },
      });

      const db: WebhookDbContext = {
        async findUserIdByCustomerId(customerId) {
          const row = await tx.billing.findUnique({
            where: { customerId },
            select: { userId: true },
          });
          return row?.userId ?? null;
        },
        async userExists(userId) {
          const count = await tx.user.count({ where: { id: userId } });
          return count > 0;
        },
        async getPlanForUser(userId) {
          const row = await tx.billing.findUnique({
            where: { userId },
            select: { plan: true },
          });
          return (row?.plan as BillingPlanName | undefined) ?? null;
        },
        async getSubscriptionIdForUser(userId) {
          const row = await tx.billing.findUnique({
            where: { userId },
            select: { subscriptionId: true },
          });
          return row?.subscriptionId ?? null;
        },
      };

      const patch = await buildPatch(db);

      if (!patch) {
        return {
          result: 'applied' as const,
          detail: `${event.type}: no billing change required`,
        };
      }

      await tx.billing.upsert({
        where: { userId: patch.userId },
        create: { userId: patch.userId, ...patch.data },
        update: patch.data,
      });

      return {
        result: 'applied' as const,
        detail: `${event.type}: updated billing for ${patch.userId}`,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { result: 'duplicate', detail: `event ${event.id} already processed` };
    }
    throw error;
  }
}
