import 'server-only';

import { nextInvoiceNumber } from '@/domain/invoice-number';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { startOfMonthUtc, todayUtc, addMonthsUtc } from '@/lib/date';

import type {
  DashboardStatsDTO,
  InvoiceDetailDTO,
  InvoiceItemDTO,
  InvoiceSummaryDTO,
} from './types';
import { prisma } from './prisma';

/** Prisma `Decimal` (or anything with a `toString`) → plain `number`. */
function decimalToNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  return Number(String(value));
}

const SUMMARY_SELECT = {
  id: true,
  invoiceNumber: true,
  issueDate: true,
  dueDate: true,
  subtotal: true,
  tax8: true,
  tax10: true,
  total: true,
  clientId: true,
  client: { select: { name: true, companyName: true } },
} as const;

interface SummaryRow {
  id: string;
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date;
  subtotal: number;
  tax8: number;
  tax10: number;
  total: number;
  clientId: string;
  client: { name: string; companyName: string | null };
}

function toSummaryDTO(row: SummaryRow): InvoiceSummaryDTO {
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    issueDate: row.issueDate.toISOString().slice(0, 10),
    dueDate: row.dueDate.toISOString().slice(0, 10),
    subtotal: row.subtotal,
    tax8: row.tax8,
    tax10: row.tax10,
    total: row.total,
    clientId: row.clientId,
    clientName: row.client.name,
    clientCompanyName: row.client.companyName,
  };
}

export async function listInvoicesForUser(
  userId: string,
  options: { clientId?: string | undefined } = {},
): Promise<InvoiceSummaryDTO[]> {
  const invoices = await prisma.invoice.findMany({
    where: {
      userId,
      ...(options.clientId ? { clientId: options.clientId } : {}),
    },
    select: SUMMARY_SELECT,
    orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
  });

  return invoices.map(toSummaryDTO);
}

export async function getInvoiceForUser(
  userId: string,
  invoiceId: string,
): Promise<InvoiceDetailDTO | null> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, userId },
    select: {
      ...SUMMARY_SELECT,
      notes: true,
      createdAt: true,
      client: {
        select: {
          id: true,
          name: true,
          companyName: true,
          address: true,
          email: true,
          phone: true,
          createdAt: true,
        },
      },
      items: {
        select: {
          id: true,
          description: true,
          quantity: true,
          unitPrice: true,
          taxRate: true,
          amount: true,
        },
        orderBy: { position: 'asc' },
      },
    },
  });

  if (!invoice) return null;

  const items: InvoiceItemDTO[] = invoice.items.map((item) => ({
    id: item.id,
    description: item.description,
    quantity: decimalToNumber(item.quantity),
    unitPrice: decimalToNumber(item.unitPrice),
    taxRate: item.taxRate,
    amount: item.amount,
  }));

  return {
    ...toSummaryDTO({ ...invoice, client: invoice.client }),
    notes: invoice.notes,
    createdAt: invoice.createdAt.toISOString(),
    client: {
      id: invoice.client.id,
      name: invoice.client.name,
      companyName: invoice.client.companyName,
      address: invoice.client.address,
      email: invoice.client.email,
      phone: invoice.client.phone,
      createdAt: invoice.client.createdAt.toISOString(),
    },
    items,
  };
}

export interface InvoiceItemWriteInput {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  amount: number;
}

export interface InvoiceWriteInput {
  clientId: string;
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date;
  notes: string | null;
  subtotal: number;
  tax8: number;
  tax10: number;
  total: number;
  items: InvoiceItemWriteInput[];
}

/**
 * Insert an invoice and its line items atomically, after confirming the client
 * belongs to the same user — otherwise an account could attach its invoices to
 * a stranger's client id.
 */
export async function createInvoiceForUser(
  userId: string,
  input: InvoiceWriteInput,
): Promise<InvoiceDetailDTO> {
  const client = await prisma.client.count({
    where: { id: input.clientId, userId },
  });

  if (client === 0) {
    throw new NotFoundError('顧客が見つかりませんでした。');
  }

  const duplicate = await prisma.invoice.count({
    where: { userId, invoiceNumber: input.invoiceNumber },
  });

  if (duplicate > 0) {
    throw new ConflictError('この請求書番号はすでに使用されています。');
  }

  const created = await prisma.invoice.create({
    data: {
      userId,
      clientId: input.clientId,
      invoiceNumber: input.invoiceNumber,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      notes: input.notes,
      subtotal: input.subtotal,
      tax8: input.tax8,
      tax10: input.tax10,
      total: input.total,
      items: {
        create: input.items.map((item, index) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRate: item.taxRate,
          amount: item.amount,
          position: index,
        })),
      },
    },
    select: { id: true },
  });

  const invoice = await getInvoiceForUser(userId, created.id);
  if (!invoice) {
    throw new NotFoundError('請求書の作成に失敗しました。');
  }

  return invoice;
}

export async function deleteInvoiceForUser(
  userId: string,
  invoiceId: string,
): Promise<void> {
  const result = await prisma.invoice.deleteMany({ where: { id: invoiceId, userId } });

  if (result.count === 0) {
    throw new NotFoundError('請求書が見つかりませんでした。');
  }
}

/** Next unused `INV-<year>-NNNN` for this user. */
export async function suggestInvoiceNumber(
  userId: string,
  year: number = todayUtc().getUTCFullYear(),
): Promise<string> {
  const existing = await prisma.invoice.findMany({
    where: { userId, invoiceNumber: { startsWith: `INV-${year}-` } },
    select: { invoiceNumber: true },
  });

  return nextInvoiceNumber(
    year,
    existing.map((invoice) => invoice.invoiceNumber),
  );
}

const MONTHS_ON_CHART = 6;

export async function getDashboardStats(userId: string): Promise<DashboardStatsDTO> {
  const today = todayUtc();
  const monthStart = startOfMonthUtc(today);
  const chartStart = addMonthsUtc(monthStart, -(MONTHS_ON_CHART - 1));

  const [
    aggregate,
    clientCount,
    monthAggregate,
    overdueAggregate,
    chartInvoices,
    recent,
  ] = await Promise.all([
    prisma.invoice.aggregate({
      where: { userId },
      _count: { _all: true },
      _sum: { total: true, tax8: true, tax10: true },
    }),
    prisma.client.count({ where: { userId } }),
    prisma.invoice.aggregate({
      where: { userId, issueDate: { gte: monthStart } },
      _count: { _all: true },
      _sum: { total: true },
    }),
    prisma.invoice.aggregate({
      where: { userId, dueDate: { lt: today } },
      _count: { _all: true },
      _sum: { total: true },
    }),
    prisma.invoice.findMany({
      where: { userId, issueDate: { gte: chartStart } },
      select: { issueDate: true, total: true },
    }),
    prisma.invoice.findMany({
      where: { userId },
      select: SUMMARY_SELECT,
      orderBy: [{ createdAt: 'desc' }],
      take: 5,
    }),
  ]);

  const totalsByMonth = new Map<string, number>();
  for (let index = 0; index < MONTHS_ON_CHART; index += 1) {
    const month = addMonthsUtc(chartStart, index);
    totalsByMonth.set(month.toISOString().slice(0, 7), 0);
  }

  for (const invoice of chartInvoices) {
    const key = invoice.issueDate.toISOString().slice(0, 7);
    const current = totalsByMonth.get(key);
    if (current !== undefined) {
      totalsByMonth.set(key, current + invoice.total);
    }
  }

  return {
    invoiceCount: aggregate._count._all,
    clientCount,
    totalBilled: aggregate._sum.total ?? 0,
    currentMonthBilled: monthAggregate._sum.total ?? 0,
    currentMonthCount: monthAggregate._count._all,
    taxTotal: (aggregate._sum.tax8 ?? 0) + (aggregate._sum.tax10 ?? 0),
    overdueCount: overdueAggregate._count._all,
    overdueTotal: overdueAggregate._sum.total ?? 0,
    monthlyTotals: [...totalsByMonth.entries()].map(([month, total]) => ({
      month,
      total,
    })),
    recentInvoices: recent.map(toSummaryDTO),
  };
}
