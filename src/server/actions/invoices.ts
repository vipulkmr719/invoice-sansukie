'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import {
  actionFailure,
  collectValues,
  type ActionResult,
} from '@/lib/action-result';
import { calculateInvoiceTotals } from '@/domain/tax';
import { MAX_INVOICE_TOTAL } from '@/validation/invoice';
import { toPublicErrorMessage } from '@/lib/errors';
import { requireUserForAction } from '@/server/auth/guard';
import { createInvoiceForUser, deleteInvoiceForUser } from '@/server/db/invoices';
import { invoiceSchema } from '@/validation/invoice';

/**
 * Invoice actions.
 *
 * Two rules hold here and are the reason this file exists at all:
 *
 *  1. The client submits *line inputs only*. Every yen figure that reaches the
 *     database — line amounts, per-rate tax, subtotal, total — is recomputed
 *     here by `calculateInvoiceTotals`. A tampered payload claiming a ¥1 total
 *     on ¥900,000 of line items is simply overwritten with the real number
 *     (security requirement #7).
 *
 *  2. Ownership comes from the session, never from the form. `userId` is read
 *     from the verified session cookie; a `userId` field in the payload is
 *     ignored.
 */

/** Pull the repeated `items[n][field]` groups out of a FormData payload. */
function readItems(formData: FormData): unknown[] {
  const descriptions = formData.getAll('itemDescription');
  const quantities = formData.getAll('itemQuantity');
  const unitPrices = formData.getAll('itemUnitPrice');
  const taxRates = formData.getAll('itemTaxRate');

  const length = Math.max(
    descriptions.length,
    quantities.length,
    unitPrices.length,
    taxRates.length,
  );

  const items: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    items.push({
      description: descriptions[index] ?? '',
      quantity: quantities[index] ?? '',
      unitPrice: unitPrices[index] ?? '',
      taxRate: taxRates[index] ?? '',
    });
  }

  return items;
}

const INVOICE_FIELDS = [
  'clientId',
  'invoiceNumber',
  'issueDate',
  'dueDate',
  'notes',
] as const;

export async function createInvoiceAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  // Line items live in React state on the client, so only the header fields
  // need echoing back to survive React's post-action form reset.
  const values = collectValues(formData, INVOICE_FIELDS);

  const parsed = invoiceSchema.safeParse({
    clientId: formData.get('clientId'),
    invoiceNumber: formData.get('invoiceNumber'),
    issueDate: formData.get('issueDate'),
    dueDate: formData.get('dueDate'),
    notes: formData.get('notes'),
    items: readItems(formData),
  });

  if (!parsed.success) {
    const flattened = z.flattenError(parsed.error);
    const itemIssues = parsed.error.issues
      .filter((issue) => issue.path[0] === 'items')
      .map((issue) => {
        const index = typeof issue.path[1] === 'number' ? issue.path[1] + 1 : null;
        return index ? `${index}行目: ${issue.message}` : issue.message;
      });

    return actionFailure('入力内容をご確認ください。', {
      fieldErrors: {
        ...flattened.fieldErrors,
        ...(itemIssues.length > 0 ? { items: itemIssues } : {}),
      },
      values,
    });
  }

  let invoiceId: string;

  try {
    const user = await requireUserForAction();

    // Authoritative recomputation — the client's arithmetic is never trusted.
    const totals = calculateInvoiceTotals(parsed.data.items);

    if (totals.total > MAX_INVOICE_TOTAL) {
      return actionFailure(
        `請求合計が上限（${MAX_INVOICE_TOTAL.toLocaleString('ja-JP')}円）を超えています。`,
        { values },
      );
    }

    const invoice = await createInvoiceForUser(user.id, {
      clientId: parsed.data.clientId,
      invoiceNumber: parsed.data.invoiceNumber,
      issueDate: parsed.data.issueDate,
      dueDate: parsed.data.dueDate,
      notes: parsed.data.notes,
      subtotal: totals.subtotal,
      tax8: totals.tax8,
      tax10: totals.tax10,
      total: totals.total,
      items: parsed.data.items.map((item, index) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate,
        amount: totals.lineAmounts[index] ?? 0,
      })),
    });

    invoiceId = invoice.id;
  } catch (error) {
    return actionFailure(toPublicErrorMessage(error, 'createInvoiceAction'), { values });
  }

  revalidatePath('/invoices');
  revalidatePath('/dashboard');
  redirect(`/invoices/${invoiceId}?created=1`);
}

export async function deleteInvoiceAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const id = formData.get('id');

  if (typeof id !== 'string' || id.length === 0) {
    return actionFailure('請求書を指定してください。');
  }

  try {
    const user = await requireUserForAction();
    await deleteInvoiceForUser(user.id, id);
  } catch (error) {
    return actionFailure(toPublicErrorMessage(error, 'deleteInvoiceAction'));
  }

  revalidatePath('/invoices');
  revalidatePath('/dashboard');
  redirect('/invoices?deleted=1');
}
