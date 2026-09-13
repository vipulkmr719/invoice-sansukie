import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'インボイス作成 | 適格請求書対応の請求書作成サービス',
    template: '%s | インボイス作成',
  },
  description:
    'インボイス制度（適格請求書等保存方式）に対応した請求書の作成・管理サービス。8%・10%の税率区分、登録番号の記載、顧客管理、PDF出力に対応しています。',
  applicationName: 'インボイス作成',
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#4f5bd5',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className="antialiased">{children}</body>
    </html>
  );
}
