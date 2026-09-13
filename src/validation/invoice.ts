import { z } from 'zod';

import { INVOICE_NUMBER_PATTERN } from '@/domain/invoice-number';
import { VALID_TAX_RATES } from '@/domain/tax';
import { registrationNumberField } from './company';

import {
  dateField,
  emailField,
  idField,
  numericField,
  optionalEmailField,
  optionalText,
  requiredPhoneField,
  requiredText,
  trimmedString,
} from './common';

/**
 * Ceilings that keep every derived amount inside a PostgreSQL `INTEGER`
 * (2,147,483,647) and inside JavaScript's exact-integer range.
 */
export const MAX_QUANTITY = 1_000_000;
export const MAX_UNIT_PRICE = 100_000_000;
export const MAX_INVOICE_TOTAL = 1_000_000_000;
export const MAX_ITEMS_PER_INVOICE = 100;

const QUANTITY_DECIMALS = 3;
const UNIT_PRICE_DECIMALS = 2;

function decimalPlaces(value: number): number {
  const text = String(value);
  const dotIndex = text.indexOf('.');
  if (dotIndex === -1) return 0;
  // Exponential notation ("1e-7") means far more precision than we allow.
  if (text.includes('e') || text.includes('E')) return Number.POSITIVE_INFINITY;
  return text.length - dotIndex - 1;
}

const quantityField = numericField('数量')
  .refine((value) => value >= 0, { message: '数量に負の値は指定できません。' })
  .refine((value) => value > 0, { message: '数量は0より大きい値を入力してください。' })
  .refine((value) => value <= MAX_QUANTITY, {
    message: `数量は${MAX_QUANTITY.toLocaleString('ja-JP')}以下で入力してください。`,
  })
  .refine((value) => decimalPlaces(value) <= QUANTITY_DECIMALS, {
    message: `数量は小数第${QUANTITY_DECIMALS}位まで入力できます。`,
  });

const unitPriceField = numericField('単価')
  .refine((value) => value >= 0, { message: '単価に負の値は指定できません。' })
  .refine((value) => value <= MAX_UNIT_PRICE, {
    message: `単価は${MAX_UNIT_PRICE.toLocaleString('ja-JP')}円以下で入力してください。`,
  })
  .refine((value) => decimalPlaces(value) <= UNIT_PRICE_DECIMALS, {
    message: `単価は小数第${UNIT_PRICE_DECIMALS}位まで入力できます。`,
  });

const taxRateField = numericField('税率')
  .refine((value) => Number.isInteger(value), {
    message: '税率は8%または10%を選択してください。',
  })
  .refine((value) => (VALID_TAX_RATES as readonly number[]).includes(value), {
    message: '税率は8%（軽減税率）または10%（標準税率）のみ指定できます。',
  });

export const invoiceItemSchema = z.object({
  description: requiredText('品目', 200),
  quantity: quantityField,
  unitPrice: unitPriceField,
  taxRate: taxRateField,
});

export const invoiceNumberField = trimmedString
  .min(1, '請求書番号を入力してください。')
  .max(32, '請求書番号は32文字以内で入力してください。')
  .regex(
    INVOICE_NUMBER_PATTERN,
    '請求書番号は英数字とハイフンのみ、3文字以上で入力してください。',
  );

/**
 * 発行者情報 — captured on the invoice itself rather than read from the company
 * profile at print time, so an issued invoice keeps the details it was issued
 * with. The form prefills these from 設定.
 */
export const invoiceIssuerSchema = z.object({
  issuerName: requiredText('発行者の会社名', 100),
  issuerAddress: requiredText('発行者の住所', 300),
  issuerPhone: requiredPhoneField('発行者の電話番号'),
  issuerEmail: emailField('発行者のメールアドレス'),
  issuerRegistrationNumber: registrationNumberField,
});

/** 請求先 — the counterparty as printed on this invoice. */
export const invoiceClientSchema = z.object({
  clientId: idField('顧客ID'),
  clientName: requiredText('請求先名', 100),
  clientAddress: optionalText(300),
  clientEmail: optionalEmailField('請求先のメールアドレス'),
});

export const invoiceSchema = z
  .object({
    ...invoiceIssuerSchema.shape,
    ...invoiceClientSchema.shape,
    invoiceNumber: invoiceNumberField,
    issueDate: dateField('発行日'),
    dueDate: dateField('支払期限'),
    notes: optionalText(2000),
    items: z
      .array(invoiceItemSchema)
      .min(1, '明細を1件以上追加してください。')
      .max(
        MAX_ITEMS_PER_INVOICE,
        `明細は${MAX_ITEMS_PER_INVOICE}件までです。`,
      ),
  })
  .refine(
    (data) => {
      // Zod v4 still runs object-level refinements when a field failed its own
      // check, so a malformed date arrives here untransformed. The field-level
      // error already describes that; skip rather than dereference it.
      if (!(data.issueDate instanceof Date) || !(data.dueDate instanceof Date)) {
        return true;
      }
      return data.dueDate.getTime() >= data.issueDate.getTime();
    },
    {
      message: '支払期限は発行日以降の日付を指定してください。',
      path: ['dueDate'],
    },
  );

export const invoiceUpdateSchema = z.intersection(
  invoiceSchema,
  z.object({ id: idField('請求書ID') }),
);

export type InvoiceItemInput = z.infer<typeof invoiceItemSchema>;
export type InvoiceInput = z.infer<typeof invoiceSchema>;
export type InvoiceUpdateInput = z.infer<typeof invoiceUpdateSchema>;
