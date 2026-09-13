import 'server-only';

/**
 * Serialisable DTOs.
 *
 * Prisma returns `Decimal` and `Date` instances. React Server Components can
 * only hand plain, structured-cloneable values to client components, so every
 * repository in this folder maps rows to the shapes below before returning
 * them. It also means the database's row shape is not part of the UI's
 * contract.
 */

export interface CompanyDTO {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  registrationNumber: string;
}

export interface ClientDTO {
  id: string;
  name: string;
  companyName: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
}

export interface ClientWithStatsDTO extends ClientDTO {
  invoiceCount: number;
  billedTotal: number;
}

export interface InvoiceItemDTO {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  amount: number;
}

export interface InvoiceSummaryDTO {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  subtotal: number;
  tax8: number;
  tax10: number;
  total: number;
  clientId: string;
  clientName: string;
  clientCompanyName: string | null;
}

/**
 * The parties exactly as they appear on one invoice.
 *
 * Built from the invoice's own snapshot columns; for invoices issued before
 * those columns existed the repository falls back to the live Company / Client
 * rows, so every consumer sees the same shape either way.
 */
export interface InvoicePartyDTO {
  issuer: {
    name: string;
    address: string;
    phone: string;
    email: string;
    registrationNumber: string;
  } | null;
  billTo: {
    name: string;
    address: string | null;
    email: string | null;
  };
}

export interface InvoiceDetailDTO extends InvoiceSummaryDTO {
  notes: string | null;
  createdAt: string;
  client: ClientDTO;
  items: InvoiceItemDTO[];
  parties: InvoicePartyDTO;
}

export interface DashboardStatsDTO {
  invoiceCount: number;
  clientCount: number;
  totalBilled: number;
  currentMonthBilled: number;
  currentMonthCount: number;
  taxTotal: number;
  overdueCount: number;
  overdueTotal: number;
  monthlyTotals: { month: string; total: number }[];
  recentInvoices: InvoiceSummaryDTO[];
}
