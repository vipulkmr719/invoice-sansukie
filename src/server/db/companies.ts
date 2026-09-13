import 'server-only';

import type { CompanyDTO } from './types';
import { prisma } from './prisma';

interface CompanyRow {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  registrationNumber: string;
}

function toCompanyDTO(row: CompanyRow): CompanyDTO {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    phone: row.phone,
    email: row.email,
    registrationNumber: row.registrationNumber,
  };
}

export async function getCompanyForUser(userId: string): Promise<CompanyDTO | null> {
  const company = await prisma.company.findUnique({
    where: { userId },
    select: {
      id: true,
      name: true,
      address: true,
      phone: true,
      email: true,
      registrationNumber: true,
    },
  });

  return company ? toCompanyDTO(company) : null;
}

export interface CompanyWriteInput {
  name: string;
  address: string;
  phone: string;
  email: string;
  registrationNumber: string;
}

/** Create or replace the single company record belonging to `userId`. */
export async function upsertCompanyForUser(
  userId: string,
  input: CompanyWriteInput,
): Promise<CompanyDTO> {
  const company = await prisma.company.upsert({
    where: { userId },
    create: { userId, ...input },
    update: input,
    select: {
      id: true,
      name: true,
      address: true,
      phone: true,
      email: true,
      registrationNumber: true,
    },
  });

  return toCompanyDTO(company);
}
