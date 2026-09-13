import { z } from 'zod';

/** Trim first, then validate — " " must not pass a `min(1)` check. */
export const trimmedString = z.string().trim();

export const requiredText = (label: string, max = 200) =>
  trimmedString
    .min(1, `${label}を入力してください。`)
    .max(max, `${label}は${max}文字以内で入力してください。`);

export const optionalText = (max = 200) =>
  trimmedString
    .max(max, `${max}文字以内で入力してください。`)
    .optional()
    .transform((value) => (value === undefined || value === '' ? null : value));

export const emailField = (label = 'メールアドレス') =>
  trimmedString
    .min(1, `${label}を入力してください。`)
    .max(254, `${label}が長すぎます。`)
    .pipe(z.email({ message: `${label}の形式が正しくありません。` }))
    .transform((value) => value.toLowerCase());

export const optionalEmailField = (label = 'メールアドレス') =>
  trimmedString
    .max(254, `${label}が長すぎます。`)
    .optional()
    .transform((value) => (value === undefined || value === '' ? null : value.toLowerCase()))
    .refine(
      (value) => value === null || z.email().safeParse(value).success,
      { message: `${label}の形式が正しくありません。` },
    );

/** Japanese phone numbers: digits, hyphens, parentheses and a leading +. */
const PHONE_PATTERN = /^[+()\d\s-]{6,20}$/;

export const optionalPhoneField = (label = '電話番号') =>
  trimmedString
    .optional()
    .transform((value) => (value === undefined || value === '' ? null : value))
    .refine((value) => value === null || PHONE_PATTERN.test(value), {
      message: `${label}の形式が正しくありません。`,
    });

export const requiredPhoneField = (label = '電話番号') =>
  trimmedString
    .min(1, `${label}を入力してください。`)
    .refine((value) => PHONE_PATTERN.test(value), {
      message: `${label}の形式が正しくありません。`,
    });

/** A cuid produced by Prisma's `@default(cuid())`. */
export const idField = (label = 'ID') =>
  trimmedString
    .min(1, `${label}を指定してください。`)
    .max(64, `${label}が不正です。`)
    .regex(/^[A-Za-z0-9_-]+$/, `${label}が不正です。`);

/** `YYYY-MM-DD` as produced by `<input type="date">`, parsed in UTC. */
export const dateField = (label: string) =>
  trimmedString
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label}は YYYY-MM-DD 形式で入力してください。`)
    .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), {
      message: `${label}が不正な日付です。`,
    })
    .transform((value) => new Date(`${value}T00:00:00.000Z`));

/**
 * Coerce a form value to a finite number without `z.coerce.number()`, which
 * happily turns "" into 0 and " " into 0 — both of which would silently zero
 * out a price.
 */
export const numericField = (label: string) =>
  z.union([z.number(), z.string()]).transform((value, ctx) => {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        ctx.addIssue({ code: 'custom', message: `${label}を数値で入力してください。` });
        return z.NEVER;
      }
      return value;
    }

    const trimmed = value.trim();
    if (trimmed === '') {
      ctx.addIssue({ code: 'custom', message: `${label}を入力してください。` });
      return z.NEVER;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      ctx.addIssue({ code: 'custom', message: `${label}を数値で入力してください。` });
      return z.NEVER;
    }

    return parsed;
  });
