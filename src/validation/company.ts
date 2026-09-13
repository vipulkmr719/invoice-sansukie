import { z } from 'zod';

import {
  normalizeRegistrationNumber,
  hasRegistrationNumberFormat,
  hasValidCheckDigit,
  REGISTRATION_NUMBER_CHECK_DIGIT_MESSAGE,
  REGISTRATION_NUMBER_FORMAT_MESSAGE,
} from '@/domain/registration-number';

import { emailField, requiredPhoneField, requiredText, trimmedString } from './common';

/**
 * 登録番号: normalised (full-width folded, hyphens stripped, upper-cased) and
 * then checked for both shape and check digit.
 */
export const registrationNumberField = trimmedString
  .min(1, '登録番号を入力してください。')
  .transform(normalizeRegistrationNumber)
  .superRefine((value, ctx) => {
    if (!hasRegistrationNumberFormat(value)) {
      ctx.addIssue({ code: 'custom', message: REGISTRATION_NUMBER_FORMAT_MESSAGE });
      return;
    }
    if (!hasValidCheckDigit(value)) {
      ctx.addIssue({ code: 'custom', message: REGISTRATION_NUMBER_CHECK_DIGIT_MESSAGE });
    }
  });

export const companySchema = z.object({
  name: requiredText('会社名', 100),
  address: requiredText('住所', 300),
  phone: requiredPhoneField(),
  email: emailField(),
  registrationNumber: registrationNumberField,
});

export type CompanyInput = z.infer<typeof companySchema>;
