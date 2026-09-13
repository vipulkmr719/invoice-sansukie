import { z } from 'zod';

import {
  idField,
  optionalEmailField,
  optionalPhoneField,
  optionalText,
  requiredText,
} from './common';

export const clientSchema = z.object({
  name: requiredText('顧客名', 100),
  companyName: optionalText(100),
  address: optionalText(300),
  email: optionalEmailField(),
  phone: optionalPhoneField(),
});

export const clientUpdateSchema = clientSchema.extend({
  id: idField('顧客ID'),
});

export type ClientInput = z.infer<typeof clientSchema>;
export type ClientUpdateInput = z.infer<typeof clientUpdateSchema>;
