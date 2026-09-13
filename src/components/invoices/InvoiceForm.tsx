'use client';

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';

import type { ActionResult } from '@/lib/action-result';
import type { ClientDTO } from '@/server/db/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, FieldError, Select, TextArea, TextInput } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { TAX_RATE_REDUCED, TAX_RATE_STANDARD, calculateInvoiceTotals } from '@/domain/tax';
import { formatYen } from '@/domain/money';
import { MAX_ITEMS_PER_INVOICE } from '@/validation/invoice';

/**
 * 新しい請求書 form.
 *
 * The totals shown here are a *preview*. They are computed with the very same
 * `calculateInvoiceTotals` the server action uses, so what the user sees
 * matches what gets stored — but the server recomputes from the submitted line
 * items regardless, and its result is the one that is persisted.
 */

interface DraftItem {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
}

function emptyItem(): DraftItem {
  return {
    key: `item-${Math.random().toString(36).slice(2, 10)}`,
    description: '',
    quantity: '1',
    unitPrice: '',
    taxRate: String(TAX_RATE_STANDARD),
  };
}

/** Parse a draft field for preview purposes only; invalid input previews as 0. */
function toPreviewNumber(value: string): number {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function InvoiceForm({
  clients,
  defaultInvoiceNumber,
  defaultIssueDate,
  defaultDueDate,
  action,
}: {
  clients: ClientDTO[];
  defaultInvoiceNumber: string;
  defaultIssueDate: string;
  defaultDueDate: string;
  action: (
    previous: ActionResult<undefined> | null,
    formData: FormData,
  ) => Promise<ActionResult<undefined>>;
}) {
  const [state, formAction] = useActionState<ActionResult<undefined> | null, FormData>(
    action,
    null,
  );
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);

  const failed = state && !state.ok ? state : null;
  const fieldErrors = failed?.fieldErrors ?? {};

  // React resets an uncontrolled form once its action resolves, so a rejected
  // submit must restore what the user typed. The line items below are React
  // state and survive on their own; these header fields are not.
  const submitted = failed?.values;

  const totals = useMemo(() => {
    try {
      return calculateInvoiceTotals(
        items.map((item) => ({
          quantity: toPreviewNumber(item.quantity),
          unitPrice: toPreviewNumber(item.unitPrice),
          taxRate: Number(item.taxRate) === TAX_RATE_REDUCED
            ? TAX_RATE_REDUCED
            : TAX_RATE_STANDARD,
        })),
      );
    } catch {
      return null;
    }
  }, [items]);

  function updateItem(key: string, patch: Partial<DraftItem>) {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  }

  function addItem() {
    setItems((current) =>
      current.length >= MAX_ITEMS_PER_INVOICE ? current : [...current, emptyItem()],
    );
  }

  function removeItem(key: string) {
    setItems((current) =>
      current.length <= 1 ? current : current.filter((item) => item.key !== key),
    );
  }

  if (clients.length === 0) {
    return (
      <Card>
        <CardBody className="py-12 text-center">
          <h2 className="text-base font-semibold text-ink-900">
            先に顧客を登録してください
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-500">
            請求書には請求先が必要です。顧客を1件登録すると請求書を作成できます。
          </p>
          <Link
            href="/clients/new"
            className="mt-6 inline-flex rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            顧客を登録する
          </Link>
        </CardBody>
      </Card>
    );
  }

  return (
    <form action={formAction} className="space-y-6">
      {failed ? <Alert tone="error">{failed.message}</Alert> : null}

      <Card>
        <CardHeader title="請求書情報" />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field
            label="請求先"
            htmlFor="clientId"
            required
            errors={fieldErrors.clientId}
            className="sm:col-span-2"
          >
            <Select
              id="clientId"
              name="clientId"
              required
              defaultValue={submitted?.clientId ?? clients[0]?.id ?? ''}
              invalid={Boolean(fieldErrors.clientId)}
            >
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.companyName ? `${client.companyName} / ` : ''}
                  {client.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="請求書番号"
            htmlFor="invoiceNumber"
            required
            errors={fieldErrors.invoiceNumber}
          >
            <TextInput
              id="invoiceNumber"
              name="invoiceNumber"
              defaultValue={submitted?.invoiceNumber ?? defaultInvoiceNumber}
              required
              maxLength={32}
              className="tabular"
              invalid={Boolean(fieldErrors.invoiceNumber)}
            />
          </Field>

          <div className="hidden sm:block" />

          <Field label="発行日" htmlFor="issueDate" required errors={fieldErrors.issueDate}>
            <TextInput
              id="issueDate"
              name="issueDate"
              type="date"
              defaultValue={submitted?.issueDate ?? defaultIssueDate}
              required
              invalid={Boolean(fieldErrors.issueDate)}
            />
          </Field>

          <Field label="支払期限" htmlFor="dueDate" required errors={fieldErrors.dueDate}>
            <TextInput
              id="dueDate"
              name="dueDate"
              type="date"
              defaultValue={submitted?.dueDate ?? defaultDueDate}
              required
              invalid={Boolean(fieldErrors.dueDate)}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="明細"
          description="軽減税率（8%）の対象品目は税率を切り替えてください。"
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={addItem}
              disabled={items.length >= MAX_ITEMS_PER_INVOICE}
            >
              行を追加
            </Button>
          }
        />
        <CardBody className="space-y-4">
          <FieldError id="items-error" messages={fieldErrors.items} />

          {items.map((item, index) => {
            const amount = totals?.lineAmounts[index] ?? 0;

            return (
              <div
                key={item.key}
                className="rounded-lg border border-ink-200/70 bg-ink-50/50 p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink-500">
                    {index + 1}行目
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeItem(item.key)}
                    disabled={items.length <= 1}
                    aria-label={`${index + 1}行目を削除`}
                  >
                    削除
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-12">
                  <div className="sm:col-span-12 lg:col-span-4">
                    <label
                      htmlFor={`${item.key}-description`}
                      className="block text-xs font-medium text-ink-600"
                    >
                      品目
                    </label>
                    <TextInput
                      id={`${item.key}-description`}
                      name="itemDescription"
                      value={item.description}
                      onChange={(event) =>
                        updateItem(item.key, { description: event.target.value })
                      }
                      required
                      maxLength={200}
                      placeholder="ウェブサイト制作費"
                      className="mt-1"
                    />
                  </div>

                  <div className="sm:col-span-4 lg:col-span-2">
                    <label
                      htmlFor={`${item.key}-quantity`}
                      className="block text-xs font-medium text-ink-600"
                    >
                      数量
                    </label>
                    <TextInput
                      id={`${item.key}-quantity`}
                      name="itemQuantity"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.001"
                      value={item.quantity}
                      onChange={(event) =>
                        updateItem(item.key, { quantity: event.target.value })
                      }
                      required
                      className="mt-1 tabular"
                    />
                  </div>

                  <div className="sm:col-span-4 lg:col-span-2">
                    <label
                      htmlFor={`${item.key}-unitPrice`}
                      className="block text-xs font-medium text-ink-600"
                    >
                      単価（円）
                    </label>
                    <TextInput
                      id={`${item.key}-unitPrice`}
                      name="itemUnitPrice"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={item.unitPrice}
                      onChange={(event) =>
                        updateItem(item.key, { unitPrice: event.target.value })
                      }
                      required
                      placeholder="0"
                      className="mt-1 tabular"
                    />
                  </div>

                  <div className="sm:col-span-4 lg:col-span-2">
                    <label
                      htmlFor={`${item.key}-taxRate`}
                      className="block text-xs font-medium text-ink-600"
                    >
                      税率
                    </label>
                    <Select
                      id={`${item.key}-taxRate`}
                      name="itemTaxRate"
                      value={item.taxRate}
                      onChange={(event) =>
                        updateItem(item.key, { taxRate: event.target.value })
                      }
                      className="mt-1"
                    >
                      <option value={String(TAX_RATE_STANDARD)}>10%</option>
                      <option value={String(TAX_RATE_REDUCED)}>8%（軽減）</option>
                    </Select>
                  </div>

                  <div className="sm:col-span-12 lg:col-span-2 lg:text-right">
                    <span className="block text-xs font-medium text-ink-600">
                      金額（税抜）
                    </span>
                    <span className="tabular mt-1 block py-2 text-sm font-semibold text-ink-900">
                      {formatYen(amount)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="min-w-0 lg:col-span-3">
          <CardHeader title="備考" description="振込先や支払条件などを記載できます。" />
          <CardBody>
            <TextArea
              id="notes"
              name="notes"
              defaultValue={submitted?.notes ?? ''}
              maxLength={2000}
              placeholder={'お振込手数料は貴社にてご負担ください。\n振込先：○○銀行 ○○支店 普通 1234567'}
              aria-label="備考"
            />
            <FieldError id="notes-error" messages={fieldErrors.notes} />
          </CardBody>
        </Card>

        <Card className="min-w-0 lg:col-span-2">
          <CardHeader title="合計" />
          <CardBody>
            {totals ? (
              <dl className="space-y-2.5 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-ink-600">小計（税抜）</dt>
                  <dd className="tabular font-medium text-ink-900">
                    {formatYen(totals.subtotal)}
                  </dd>
                </div>
                {totals.subtotal8 > 0 ? (
                  <div className="flex items-center justify-between">
                    <dt className="text-ink-500">
                      8%対象 {formatYen(totals.subtotal8)} の消費税
                    </dt>
                    <dd className="tabular text-ink-700">{formatYen(totals.tax8)}</dd>
                  </div>
                ) : null}
                {totals.subtotal10 > 0 ? (
                  <div className="flex items-center justify-between">
                    <dt className="text-ink-500">
                      10%対象 {formatYen(totals.subtotal10)} の消費税
                    </dt>
                    <dd className="tabular text-ink-700">{formatYen(totals.tax10)}</dd>
                  </div>
                ) : null}
                <div className="flex items-center justify-between border-t border-ink-200/70 pt-3">
                  <dt className="font-semibold text-ink-900">合計（税込）</dt>
                  <dd className="tabular text-lg font-bold text-ink-900">
                    {formatYen(totals.total)}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-ink-500">
                明細を正しく入力すると合計が表示されます。
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Link
          href="/invoices"
          className="inline-flex items-center justify-center rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-50"
        >
          キャンセル
        </Link>
        <SubmitButton pendingLabel="保存中…">保存</SubmitButton>
      </div>
    </form>
  );
}
