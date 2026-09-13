'use client';

import { useState } from 'react';
import Link from 'next/link';

import { Logo } from './Logo';
import { NavLink } from './NavLink';
import {
  ClientIcon,
  DashboardIcon,
  InvoiceIcon,
  LogoutIcon,
  PlanIcon,
  PlusIcon,
  SettingsIcon,
} from './icons';

/**
 * The authenticated layout: a fixed sidebar from `lg` up, a slide-over drawer
 * below it. `logoutAction` is passed in from the server layout as a bound
 * server action — this component never imports server code.
 */
export function AppShell({
  email,
  logoutAction,
  children,
}: {
  email: string;
  logoutAction: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = () => setDrawerOpen(false);

  const navigation = (
    <nav className="flex flex-col gap-1" aria-label="メインナビゲーション">
      <NavLink href="/dashboard" icon={<DashboardIcon />} onNavigate={closeDrawer}>
        ダッシュボード
      </NavLink>
      <NavLink href="/invoices/new" icon={<PlusIcon />} onNavigate={closeDrawer}>
        請求書を作成
      </NavLink>
      <NavLink href="/invoices" icon={<InvoiceIcon />} onNavigate={closeDrawer}>
        請求書一覧
      </NavLink>
      <NavLink href="/clients" icon={<ClientIcon />} onNavigate={closeDrawer}>
        顧客
      </NavLink>
      <NavLink href="/upgrade" icon={<PlanIcon />} onNavigate={closeDrawer}>
        プラン
      </NavLink>
      <NavLink href="/settings" icon={<SettingsIcon />} onNavigate={closeDrawer}>
        設定
      </NavLink>
    </nav>
  );

  const accountPanel = (
    <div className="border-t border-ink-200/70 pt-4">
      <p className="truncate px-3 text-xs text-ink-500" title={email}>
        {email}
      </p>
      <form action={logoutAction} className="mt-2">
        <button
          type="submit"
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900"
        >
          <span className="shrink-0 text-ink-400">
            <LogoutIcon />
          </span>
          ログアウト
        </button>
      </form>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="no-print hidden w-60 shrink-0 border-r border-ink-200/70 bg-white lg:flex lg:flex-col">
        <div className="px-5 py-5">
          <Link href="/dashboard" className="inline-flex">
            <Logo />
          </Link>
        </div>
        <div className="flex flex-1 flex-col justify-between px-3 pb-5">
          {navigation}
          {accountPanel}
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-ink-200/70 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
        <Link href="/dashboard">
          <Logo />
        </Link>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="メニューを開く"
          aria-expanded={drawerOpen}
          className="rounded-lg p-2 text-ink-600 hover:bg-ink-100"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </header>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="メニューを閉じる"
            onClick={closeDrawer}
            className="absolute inset-0 bg-ink-900/40"
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between px-5 py-4">
              <Logo />
              <button
                type="button"
                onClick={closeDrawer}
                aria-label="メニューを閉じる"
                className="rounded-lg p-2 text-ink-600 hover:bg-ink-100"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div className="flex flex-1 flex-col justify-between px-3 pb-5">
              {navigation}
              {accountPanel}
            </div>
          </div>
        </div>
      ) : null}

      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
