import { z } from 'zod';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/domain/limits';

import { emailField, trimmedString } from './common';

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH };

const passwordField = trimmedString
  .min(
    PASSWORD_MIN_LENGTH,
    `パスワードは${PASSWORD_MIN_LENGTH}文字以上で入力してください。`,
  )
  .max(
    PASSWORD_MAX_LENGTH,
    `パスワードは${PASSWORD_MAX_LENGTH}文字以内で入力してください。`,
  )
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), {
    message: 'パスワードには英字と数字の両方を含めてください。',
  });

export const registerSchema = z
  .object({
    email: emailField(),
    password: passwordField,
    confirmPassword: trimmedString,
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'パスワードが一致しません。',
    path: ['confirmPassword'],
  });

export const loginSchema = z.object({
  email: emailField(),
  // Deliberately lenient: the login form must not tell an attacker what the
  // password policy is, and an existing password may predate a policy change.
  password: z.string().min(1, 'パスワードを入力してください。').max(PASSWORD_MAX_LENGTH),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
