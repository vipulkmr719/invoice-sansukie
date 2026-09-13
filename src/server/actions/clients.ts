'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import {
  actionFailure,
  actionSuccess,
  collectValues,
  type ActionResult,
} from '@/lib/action-result';
import { toPublicErrorMessage } from '@/lib/errors';
import { requireUserForAction } from '@/server/auth/guard';
import {
  createClientForUser,
  deleteClientForUser,
  updateClientForUser,
} from '@/server/db/clients';
import { clientSchema, clientUpdateSchema } from '@/validation/client';

function fieldErrorsOf(error: z.ZodError): Record<string, string[] | undefined> {
  return z.flattenError(error).fieldErrors;
}

const CLIENT_FIELDS = ['name', 'companyName', 'address', 'email', 'phone'] as const;

function readClientFields(formData: FormData) {
  return {
    name: formData.get('name'),
    companyName: formData.get('companyName'),
    address: formData.get('address'),
    email: formData.get('email'),
    phone: formData.get('phone'),
  };
}

export async function createClientAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const values = collectValues(formData, CLIENT_FIELDS);
  const parsed = clientSchema.safeParse(readClientFields(formData));

  if (!parsed.success) {
    return actionFailure('入力内容をご確認ください。', {
      fieldErrors: fieldErrorsOf(parsed.error),
      values,
    });
  }

  try {
    const user = await requireUserForAction();
    await createClientForUser(user.id, parsed.data);
  } catch (error) {
    return actionFailure(toPublicErrorMessage(error, 'createClientAction'), { values });
  }

  revalidatePath('/clients');
  revalidatePath('/dashboard');
  redirect('/clients?created=1');
}

export async function updateClientAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const values = collectValues(formData, CLIENT_FIELDS);
  const parsed = clientUpdateSchema.safeParse({
    ...readClientFields(formData),
    id: formData.get('id'),
  });

  if (!parsed.success) {
    return actionFailure('入力内容をご確認ください。', {
      fieldErrors: fieldErrorsOf(parsed.error),
      values,
    });
  }

  const { id, ...fields } = parsed.data;

  try {
    const user = await requireUserForAction();
    await updateClientForUser(user.id, id, fields);
  } catch (error) {
    return actionFailure(toPublicErrorMessage(error, 'updateClientAction'), { values });
  }

  revalidatePath('/clients');
  return actionSuccess();
}

export async function deleteClientAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const id = formData.get('id');

  if (typeof id !== 'string' || id.length === 0) {
    return actionFailure('顧客を指定してください。');
  }

  try {
    const user = await requireUserForAction();
    await deleteClientForUser(user.id, id);
  } catch (error) {
    return actionFailure(toPublicErrorMessage(error, 'deleteClientAction'));
  }

  revalidatePath('/clients');
  revalidatePath('/dashboard');
  redirect('/clients?deleted=1');
}
