import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/server/auth/guard';
import { getInvoiceForUser } from '@/server/db/invoices';
import { invoicePdfFilename } from '@/server/pdf/invoice-template';
import { renderInvoicePdf } from '@/server/pdf/render';

/**
 * GET /invoices/:id/pdf — server-side PDF of one invoice.
 *
 * Authorisation is the same rule the rest of the app uses: the lookup is scoped
 * to the session's user, so another account's invoice id is indistinguishable
 * from one that does not exist. An anonymous request gets 401, never a
 * redirect — this endpoint is fetched, not navigated.
 */

// Rendering runs Chrome; it must never be prerendered or cached.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: 'ログインが必要です。' },
      { status: 401 },
    );
  }

  const { id } = await params;

  const invoice = await getInvoiceForUser(user.id, id);
  if (!invoice) {
    return NextResponse.json(
      { error: '請求書が見つかりませんでした。' },
      { status: 404 },
    );
  }

  try {
    const { pdf } = await renderInvoicePdf(invoice);

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.byteLength),
        'Content-Disposition': `attachment; filename="${invoicePdfFilename(
          invoice.invoiceNumber,
        )}"`,
        // A rendered invoice is private and cheap to regenerate.
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    // The renderer's error can name binary paths and launch flags; log it
    // server-side and return a generic message.
    console.error('[invoices/pdf] render failed', error);
    return NextResponse.json(
      { error: 'PDFの生成に失敗しました。しばらくしてからお試しください。' },
      { status: 500 },
    );
  }
}
