import 'server-only';

import { prisma } from './prisma';

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, passwordHash: true },
  });
}

export async function findUserById(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, createdAt: true },
  });
}

export async function createUser(email: string, passwordHash: string) {
  return prisma.user.create({
    data: { email, passwordHash },
    select: { id: true, email: true },
  });
}

export async function userExists(id: string): Promise<boolean> {
  const count = await prisma.user.count({ where: { id } });
  return count > 0;
}
