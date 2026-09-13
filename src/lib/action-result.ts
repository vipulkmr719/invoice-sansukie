/**
 * The single result shape every server action returns.
 *
 * Actions never throw across the server/client boundary: an uncaught error in a
 * server action reaches the browser as an opaque digest in production and can
 * surface a stack trace in development tooling. Returning a typed result
 * instead keeps error text deliberate and translated (security requirement
 * #10).
 *
 * A failure also carries `values` — the raw strings the user submitted. React
 * resets an uncontrolled form once its action resolves, so without echoing the
 * input back a single typo would wipe out everything the user had entered.
 * Forms feed these straight into `defaultValue`; React escapes them on render,
 * and passwords are deliberately never included.
 */

export interface FieldErrors {
  [field: string]: string[] | undefined;
}

export type SubmittedValues = Record<string, string>;

export type ActionResult<TData = undefined> =
  | { ok: true; data: TData }
  | {
      ok: false;
      message: string;
      fieldErrors?: FieldErrors;
      values?: SubmittedValues;
      /**
       * Set when a plan limit — not the input — caused the failure, so the UI
       * can offer an upgrade instead of asking the user to correct a field.
       */
      upgradeRequired?: boolean;
    };

export function actionSuccess(): ActionResult<undefined>;
export function actionSuccess<TData>(data: TData): ActionResult<TData>;
export function actionSuccess<TData>(data?: TData): ActionResult<TData | undefined> {
  return { ok: true, data };
}

export function actionFailure<TData = undefined>(
  message: string,
  options: {
    fieldErrors?: FieldErrors;
    values?: SubmittedValues;
    upgradeRequired?: boolean;
  } = {},
): ActionResult<TData> {
  return {
    ok: false,
    message,
    ...(options.fieldErrors ? { fieldErrors: options.fieldErrors } : {}),
    ...(options.values ? { values: options.values } : {}),
    ...(options.upgradeRequired ? { upgradeRequired: true } : {}),
  };
}

/**
 * Pull the named text fields out of a FormData payload so a failed action can
 * hand them back to the form. Only the fields listed are echoed — never a
 * password, and never a field a caller did not ask for.
 */
export function collectValues(
  formData: FormData,
  fields: readonly string[],
): SubmittedValues {
  const values: SubmittedValues = {};

  for (const field of fields) {
    const value = formData.get(field);
    if (typeof value === 'string') {
      values[field] = value;
    }
  }

  return values;
}
