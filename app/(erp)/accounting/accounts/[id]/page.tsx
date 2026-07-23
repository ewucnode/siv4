'use client';

import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate } from '@/lib/format';
import { toast } from '@/hooks/use-toast';
import Link from 'next/link';
import { ArrowLeft, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownLeft, Calendar, Filter, ExternalLink, ChevronLeft, ChevronRight, Wallet, ChartBar as BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import type { Account } from '@/lib/types';

const typeColors: Record<string, string> = {
  asset: 'text-blue-600 bg-blue-50',
  liability: 'text-red-600 bg-red-50',
  equity: 'text-purple-600 bg-purple-50',
  revenue: 'text-green-600 bg-green-50',
  expense: 'text-orange-600 bg-orange-50',
};

interface JournalLineWithEntry {
  id: string;
  journal_entry_id: string;
  account_id: string;
  debit: number;
  credit: number;
  description: string | null;
  sort_order: number;
  journal_entry: {
    id: string;
    entry_number: string;
    entry_date: string;
    description: string;
    reference_type: string | null;
    reference_id: string | null;
    customer_id: string | null;
  };
}

const PAGE_SIZE = 20;

export default function AccountDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [allLines, setAllLines] = useState<JournalLineWithEntry[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [period, setPeriod] = useState<'all' | 'this_month' | 'this_quarter' | 'this_year' | 'custom'>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [refFilter, setRefFilter] = useState<string>('all');

  useEffect(() => { loadAccount(); loadTransactions(); }, [id]);

  async function loadAccount() {
    const { data } = await supabase.from('accounts').select('*').eq('id', id).maybeSingle();
    if (data) setAccount(data as Account);
  }

  async function loadTransactions() {
    setLoading(true);
    const { data } = await supabase
      .from('journal_lines')
      .select(`
        id, journal_entry_id, account_id, debit, credit, description, sort_order,
        journal_entry:journal_entries(
          id, entry_number, entry_date, description, reference_type, reference_id, customer_id
        )
      `)
      .eq('account_id', id)
      .order('journal_entry_id', { foreignTable: 'journal_entries', ascending: false })
      .order('sort_order', { ascending: true });

    const lines = (data || []) as unknown as JournalLineWithEntry[];
    lines.sort((a, b) => {
      const dA = new Date(a.journal_entry.entry_date).getTime();
      const dB = new Date(b.journal_entry.entry_date).getTime();
      if (dB !== dA) return dB - dA;
      return b.journal_entry.entry_number.localeCompare(a.journal_entry.entry_number);
    });
    setAllLines(lines);
    setLoading(false);
  }

  const dateRange = useMemo(() => {
    const today = new Date();
    const end = today.toISOString().split('T')[0];
    let start = '';

    if (period === 'this_month') {
      const s = new Date(today.getFullYear(), today.getMonth(), 1);
      start = s.toISOString().split('T')[0];
    } else if (period === 'this_quarter') {
      const q = Math.floor(today.getMonth() / 3);
      const s = new Date(today.getFullYear(), q * 3, 1);
      start = s.toISOString().split('T')[0];
    } else if (period === 'this_year') {
      const s = new Date(today.getFullYear(), 0, 1);
      start = s.toISOString().split('T')[0];
    } else if (period === 'custom') {
      start = customStart;
      return { start, end: customEnd || end };
    }

    return { start, end };
  }, [period, customStart, customEnd]);

  const filteredLines = useMemo(() => {
    return allLines.filter(l => {
      const entryDate = l.journal_entry.entry_date;
      if (dateRange.start && entryDate < dateRange.start) return false;
      if (dateRange.end && entryDate > dateRange.end) return false;
      if (refFilter !== 'all' && l.journal_entry.reference_type !== refFilter) return false;
      return true;
    });
  }, [allLines, dateRange, refFilter]);

  const totalPages = Math.ceil(filteredLines.length / PAGE_SIZE);
  const paginatedLines = filteredLines.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const periodStats = useMemo(() => {
    let totalDebit = 0, totalCredit = 0, count = 0;
    for (const l of filteredLines) {
      totalDebit += Number(l.debit);
      totalCredit += Number(l.credit);
      count++;
    }
    const isDebitNormal = account?.account_type === 'asset' || account?.account_type === 'expense';
    const netActivity = isDebitNormal ? totalDebit - totalCredit : totalCredit - totalDebit;
    return { totalDebit, totalCredit, count, netActivity };
  }, [filteredLines, account]);

  const monthlyChart = useMemo(() => {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const map = new Map<string, { debit: number; credit: number }>();
    for (const l of filteredLines) {
      const d = new Date(l.journal_entry.entry_date);
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`;
      const label = `${monthNames[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
      if (!map.has(key)) map.set(key, { debit: 0, credit: 0 });
      const entry = map.get(key)!;
      entry.debit += Number(l.debit);
      entry.credit += Number(l.credit);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([key, val]) => {
        const [year, month] = key.split('-');
        return { month: `${monthNames[parseInt(month)]} ${year.slice(2)}`, debit: val.debit, credit: val.credit };
      });
  }, [filteredLines]);

  const cumulativeBalance = useMemo(() => {
    const isDebitNormal = account?.account_type === 'asset' || account?.account_type === 'expense';
    let running = 0;
    const points: { label: string; balance: number }[] = [];
    const reversed = [...filteredLines].reverse();
    for (const l of reversed) {
      const delta = isDebitNormal ? Number(l.debit) - Number(l.credit) : Number(l.credit) - Number(l.debit);
      running += delta;
      const d = new Date(l.journal_entry.entry_date);
      points.push({
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        balance: running,
      });
    }
    return points.slice(-30);
  }, [filteredLines, account]);

  const referenceTypes = useMemo(() => {
    const set = new Set<string>();
    allLines.forEach(l => { if (l.journal_entry.reference_type) set.add(l.journal_entry.reference_type); });
    return Array.from(set).sort();
  }, [allLines]);

  const isDebitNormal = account?.account_type === 'asset' || account?.account_type === 'expense';

  if (!account && !loading) {
    return (
      <div className="space-y-5 animate-fade-in">
        <Link href="/accounting/accounts" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back to Accounts
        </Link>
        <div className="text-center py-20 text-muted-foreground">Account not found</div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Breadcrumb + Header */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/accounting/accounts" className="hover:text-foreground flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" /> Chart of Accounts
          </Link>
          <span>/</span>
          <span className="text-foreground font-medium">{account?.code} - {account?.name}</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${typeColors[account?.account_type || ''] || 'bg-gray-100 text-gray-600'}`}>
              <Wallet className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{account?.name}</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm font-mono text-muted-foreground">{account?.code}</span>
                <span className={`badge-status ${typeColors[account?.account_type || '']} capitalize`}>{account?.account_type}</span>
                {account?.is_cash && <span className="badge-status bg-green-50 text-green-600">Cash</span>}
                {account?.is_bank && <span className="badge-status bg-blue-50 text-blue-600">Bank</span>}
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Current Balance</p>
            <p className={`text-3xl font-bold ${Number(account?.balance) < 0 ? 'text-red-600' : isDebitNormal ? 'text-foreground' : 'text-foreground'}`}>
              {formatCurrency(Math.abs(Number(account?.balance || 0)))}
            </p>
            {Number(account?.balance) < 0 && <p className="text-xs text-red-500">Negative balance</p>}
          </div>
        </div>
      </div>

      {/* Period Filter Bar */}
      <div className="bg-white rounded-xl border border-border p-4 shadow-sm">
        <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Period:</span>
            {[
              { key: 'all', label: 'All Time' },
              { key: 'this_month', label: 'This Month' },
              { key: 'this_quarter', label: 'This Quarter' },
              { key: 'this_year', label: 'This Year' },
              { key: 'custom', label: 'Custom' },
            ].map(p => (
              <button
                key={p.key}
                onClick={() => { setPeriod(p.key as typeof period); setCurrentPage(1); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  period === p.key
                    ? 'bg-blue-600 text-white'
                    : 'bg-muted/40 text-muted-foreground hover:bg-muted'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {period === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customStart}
                onChange={e => { setCustomStart(e.target.value); setCurrentPage(1); }}
                className="border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={e => { setCustomEnd(e.target.value); setCurrentPage(1); }}
                className="border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          )}

          {referenceTypes.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Type:</span>
              <select
                value={refFilter}
                onChange={e => { setRefFilter(e.target.value); setCurrentPage(1); }}
                className="border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="all">All Types</option>
                {referenceTypes.map(rt => (
                  <option key={rt} value={rt}>{rt.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="flex items-center justify-between mb-2">
            <div className="w-9 h-9 rounded-full flex items-center justify-center bg-green-50">
              <ArrowUpRight className="w-4.5 h-4.5 text-green-600" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Total Debits</p>
          <p className="text-xl font-bold mt-0.5 text-green-600">{formatCurrency(periodStats.totalDebit)}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{periodStats.count} entries</p>
        </div>
        <div className="stat-card">
          <div className="flex items-center justify-between mb-2">
            <div className="w-9 h-9 rounded-full flex items-center justify-center bg-red-50">
              <ArrowDownLeft className="w-4.5 h-4.5 text-red-600" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Total Credits</p>
          <p className="text-xl font-bold mt-0.5 text-red-600">{formatCurrency(periodStats.totalCredit)}</p>
        </div>
        <div className="stat-card">
          <div className="flex items-center justify-between mb-2">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center ${periodStats.netActivity >= 0 ? 'bg-blue-50' : 'bg-orange-50'}`}>
              {periodStats.netActivity >= 0 ? <TrendingUp className="w-4.5 h-4.5 text-blue-600" /> : <TrendingDown className="w-4.5 h-4.5 text-orange-600" />}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Net Activity</p>
          <p className={`text-xl font-bold mt-0.5 ${periodStats.netActivity >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
            {formatCurrency(Math.abs(periodStats.netActivity))}
          </p>
        </div>
        <div className="stat-card">
          <div className="flex items-center justify-between mb-2">
            <div className="w-9 h-9 rounded-full flex items-center justify-center bg-purple-50">
              <BarChart3 className="w-4.5 h-4.5 text-purple-600" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Avg / Entry</p>
          <p className="text-xl font-bold mt-0.5 text-foreground">
            {formatCurrency(periodStats.count > 0 ? (periodStats.totalDebit + periodStats.totalCredit) / periodStats.count : 0)}
          </p>
        </div>
      </div>

      {/* Charts */}
      {monthlyChart.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-foreground mb-1">Monthly Activity</h3>
            <p className="text-xs text-muted-foreground mb-4">Debits vs Credits by month</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyChart} barSize={18} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)} />
                <Tooltip formatter={(v: number) => [formatCurrency(v), '']} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="debit" fill="#10b981" radius={[4, 4, 0, 0]} name="Debit" />
                <Bar dataKey="credit" fill="#ef4444" radius={[4, 4, 0, 0]} name="Credit" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-foreground mb-1">Cumulative Balance Trend</h3>
            <p className="text-xs text-muted-foreground mb-4">Running balance over time</p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={cumulativeBalance}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)} />
                <Tooltip formatter={(v: number) => [formatCurrency(v), 'Balance']} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Line type="monotone" dataKey="balance" stroke="#3b82f6" strokeWidth={2} dot={false} name="Balance" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Transaction History Table */}
      <div className="bg-white rounded-xl border border-border shadow-sm">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Transaction History</h3>
          </div>
          <span className="text-xs text-muted-foreground">
            {filteredLines.length} {filteredLines.length === 1 ? 'entry' : 'entries'}
            {dateRange.start && ` · ${dateRange.start}${dateRange.end ? ` to ${dateRange.end}` : ''}`}
          </span>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 bg-muted rounded-lg animate-pulse" />
            ))}
          </div>
        ) : paginatedLines.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground text-sm">
            <Wallet className="w-10 h-10 mx-auto mb-2 opacity-20" />
            No transactions found for this period
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/40 border-b border-border">
                  <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Entry #</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Date</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Description</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Type</th>
                  <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Debit</th>
                  <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Credit</th>
                  <th className="text-center text-xs font-semibold text-muted-foreground px-4 py-3">JE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginatedLines.map(line => {
                  const refType = line.journal_entry.reference_type;
                  const refId = line.journal_entry.reference_id;
                  const isInvoice = refType === 'invoice' && refId;
                  const isReceivable = refType === 'receivable' && refId;
                  const isPayment = refType === 'payment' && refId;
                  return (
                    <tr key={line.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 text-sm font-mono text-blue-600">
                        {line.journal_entry.entry_number}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                        {formatDate(line.journal_entry.entry_date)}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground max-w-xs">
                        <div className="truncate">{line.description || line.journal_entry.description || '—'}</div>
                        {isInvoice && (
                          <Link href={`/sales?highlight=${refId}`} className="text-[10px] text-blue-500 hover:underline">
                            View invoice
                          </Link>
                        )}
                        {isReceivable && (
                          <Link href="/accounting" className="text-[10px] text-purple-500 hover:underline">
                            View receivable
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {refType && (
                          <span className="badge-status bg-gray-100 text-gray-600 text-[10px] capitalize">
                            {refType.replace(/_/g, ' ')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-semibold">
                        {Number(line.debit) > 0 ? (
                          <span className="text-green-600">{formatCurrency(Number(line.debit))}</span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-semibold">
                        {Number(line.credit) > 0 ? (
                          <span className="text-red-600">{formatCurrency(Number(line.credit))}</span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Link
                          href="/accounting/journal"
                          className="text-muted-foreground hover:text-blue-600 transition"
                          title="View in journal"
                        >
                          <ExternalLink className="w-3.5 h-3.5 mx-auto" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {filteredLines.length > 0 && (
                <tfoot>
                  <tr className="bg-muted/40 border-t-2 border-border">
                    <td colSpan={4} className="px-4 py-3 text-sm font-semibold text-muted-foreground">Period Total</td>
                    <td className="px-4 py-3 text-sm text-right font-bold text-green-600">{formatCurrency(periodStats.totalDebit)}</td>
                    <td className="px-4 py-3 text-sm text-right font-bold text-red-600">{formatCurrency(periodStats.totalCredit)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-border flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Page {currentPage} of {totalPages} · Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredLines.length)} of {filteredLines.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-sm hover:bg-muted transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: Math.min(totalPages, 7) }).map((_, i) => {
                let page = i + 1;
                if (totalPages > 7) {
                  if (currentPage > 4) page = currentPage - 3 + i;
                  if (currentPage > totalPages - 3) page = totalPages - 6 + i;
                }
                if (page < 1 || page > totalPages) return null;
                return (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm font-medium transition ${
                      currentPage === page
                        ? 'bg-blue-600 text-white'
                        : 'border border-border text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {page}
                  </button>
                );
              })}
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-sm hover:bg-muted transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
