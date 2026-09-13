import 'server-only';

import { NotFoundError } from '@/lib/errors';

import type { ClientDTO, ClientWithStatsDTO } from './types';
import { prisma } from './prisma';

interface ClientRow {
  id: string;
  name: string;
  companyName: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  createdAt: Date;
}

function toClientDTO(row: ClientRow): ClientDTO {
  return {
    id: row.id,
    name: row.name,
    companyName: row.companyName,
    address: row.address,
    email: row.email,
    phone: row.phone,
    createdAt: row.createdAt.toISOString(),
  };
}

const CLIENT_SELECT = {
  id: true,
  name: true,
  companyName: true,
  address: true,
  email: true,
  phone: true,
  createdAt: true,
} as const;

/**
 * Every read and write below filters on `userId`. Ownership is enforced in the
 * `where` clause rather than checked afterwards, so a request for someone
 * else's row returns nothing instead of returning data and relying on a
 * follow-up comparison that could be forgotten.
 */

export async function listClientsForUser(userId: string): Promise<ClientDTO[]> {
  const clients = await prisma.client.findMany({
    where: { userId },
    select: CLIENT_SELECT,
    orderBy: { createdAt: 'desc' },
  });

  return clients.map(toClientDTO);
}

export async function listClientsWithStats(
  userId: string,
): Promise<ClientWithStatsDTO[]> {
  const clients = await prisma.client.findMany({
    where: { userId },
    select: {
      ...CLIENT_SELECT,
      invoices: { select: { total: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return clients.map((client) => ({
    ...toClientDTO(client),
    invoiceCount: client.invoices.length,
    billedTotal: client.invoices.reduce((sum, invoice) => sum + invoice.total, 0),
  }));
}

export async function getClientForUser(
  userId: string,
  clientId: string,
): Promise<ClientDTO | null> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, userId },
    select: CLIENT_SELECT,
  });

  return client ? toClientDTO(client) : null;
}

export interface ClientWriteInput {
  name: string;
  companyName: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
}

export async function createClientForUser(
  userId: string,
  input: ClientWriteInput,
): Promise<ClientDTO> {
  const client = await prisma.client.create({
    data: { userId, ...input },
    select: CLIENT_SELECT,
  });

  return toClientDTO(client);
}

export async function updateClientForUser(
  userId: string,
  clientId: string,
  input: ClientWriteInput,
): Promise<ClientDTO> {
  const result = await prisma.client.updateMany({
    where: { id: clientId, userId },
    data: input,
  });

  if (result.count === 0) {
    throw new NotFoundError('顧客が見つかりませんでした。');
  }

  const client = await getClientForUser(userId, clientId);
  if (!client) {
    throw new NotFoundError('顧客が見つかりませんでした。');
  }

  return client;
}

/**
 * Delete a client. Refuses while invoices still reference it — an issued
 * invoice must keep pointing at a real counterparty.
 */
export async function deleteClientForUser(
  userId: string,
  clientId: string,
): Promise<void> {
  const invoiceCount = await prisma.invoice.count({
    where: { clientId, userId },
  });

  if (invoiceCount > 0) {
    throw new NotFoundError(
      'この顧客には請求書が紐づいているため削除できません。',
    );
  }

  const result = await prisma.client.deleteMany({ where: { id: clientId, userId } });

  if (result.count === 0) {
    throw new NotFoundError('顧客が見つかりませんでした。');
  }
}

export async function countClientsForUser(userId: string): Promise<number> {
  return prisma.client.count({ where: { userId } });
}
