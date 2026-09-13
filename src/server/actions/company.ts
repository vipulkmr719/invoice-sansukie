'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  actionFailure,
  actionSuccess,
  collectValues,
  type ActionResult,
} from '@/lib/action-result';
import { toPublicErrorMessage } from '@/lib/errors';
import { requireUserForAction } from '@/server/auth/guard';
import { upsertCompanyForUser } from '@/server/db/companies';
import { companySchema } from '@/validation/company';

const COMPANY_FIELDS = [
  'name',
  'address',
  'phone',
  'email',
  'registrationNumber',
] as const;

export async function saveCompanyAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const values = collectValues(formData, COMPANY_FIELDS);

  const parsed = companySchema.safeParse({
    name: formData.get('name'),
    address: formData.get('address'),
    phone: formData.get('phone'),
    email: formData.get('email'),
    registrationNumber: formData.get('registrationNumber'),
  });

  if (!parsed.success) {
    return actionFailure('入力内容をご確認ください。', {
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
      values,
    });
  }

  try {
    const user = await requireUserForAction();
    await upsertCompanyForUser(user.id, parsed.data);
  } catch (error) {
    return actionFailure(toPublicErrorMessage(error, 'saveCompanyAction'), { values });
  }

  revalidatePath('/settings');
  revalidatePath('/invoices');
  return actionSuccess();
}
