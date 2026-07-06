'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/format';
import { Calendar, Download, Printer, RefreshCw, Building2 } from 'lucide-react';

interface PnLData {
  // Revenue
  salesRevenue: number;
  serviceRevenue: number;
  totalRevenue: number;

  // COGS - from stock movements only
  costOfGoodsSold: number;

  // Profit levels
  grossProfit: number;

  // Operating expenses
  operatingExpenses: { name: string; amount: number }[];
  totalOperatingExpenses: number;
  operatingProfit: number;

  // Other income/expenses
  otherIncome: number;
  otherExpenses: number;
  netOtherIncome: number;

  // Final
  profitBeforeTax: number;
  incomeTaxExpense: number;
  netProfit: number;
}

export default function PLPage() {
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'month' | 'quarter' | 'year'>('month');
  const [periodLabel, setPeriodLabel] = useState('');

  const [data, setData] = useState<PnLData>({
    salesRevenue: 0,
    serviceRevenue: 0,
    totalRevenue: 0,
    costOfGoodsSold: 0,
    grossProfit: 0,
    operatingExpenses: [],
    totalOperatingExpenses: 0,
    operatingProfit: 0,
    otherIncome: 0,
    otherExpenses: 0,
    netOtherIncome: 0,
    profitBeforeTax: 0,
    incomeTaxExpense: 0,
    netProfit: 0,
  });

  const [companySettings, setCompanySettings] = useState({ name: 'SI Building Solutions.', address: '' });

  useEffect(() => { loadData(); loadSettings(); }, [period]);

  async function loadSettings() {
    const { data } = await supabase.from('app_settings').select('setting_value').eq('setting_key', 'company').maybeSingle();
    if (data?.setting_value) {
      setCompanySettings(prev => ({ ...prev, ...data.setting_value }));
    }
  }

  async function loadData() {
    setLoading(true);

    const now = new Date();
    let startDate: string;
    let endDate: string;
    let label: string;

    if (period === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
      label = `For the Month Ended ${new Date(now.getFullYear(), now.getMonth() + 1, 0).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
    } else if (period === 'quarter') {
      const quarterStart = Math.floor(now.getMonth() / 3) * 3;
      startDate = new Date(now.getFullYear(), quarterStart, 1).toISOString().split('T')[0];
      endDate = new Date(now.getFullYear(), quarterStart + 3, 0).toISOString().split('T')[0];
      const quarterNum = Math.floor(now.getMonth() / 3) + 1;
      label = `For the Quarter Ended ${new Date(now.getFullYear(), quarterStart + 3, 0).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
    } else {
      startDate = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
      endDate = new Date(now.getFullYear(), 11, 31).toISOString().split('T')[0];
      label = `For the Year Ended December 31, ${now.getFullYear()}`;
    }

    setPeriodLabel(label);

    // Fetch all data in parallel
    const [invoicesRes, stockMovementsRes, accountsRes] = await Promise.all([
      supabase.from('invoices').select('total_amount').gte('invoice_date', startDate).lte('invoice_date', endDate).neq('status', 'cancelled'),
      supabase.from('stock_movements').select('quantity, unit_cost, movement_type').eq('movement_type', 'sale').gte('created_at', startDate).lte('created_at', endDate),
      supabase.from('accounts').select('id, code, name, account_type, balance'),
    ]);

    // Calculate sales revenue
    const salesRevenue = (invoicesRes.data || []).reduce((sum, inv) => sum + Number(inv.total_amount), 0);

    // Calculate COGS from actual stock movements (sales)
    const costOfGoodsSold = (stockMovementsRes.data || [])
      .reduce((sum, m) => sum + (Math.abs(Number(m.quantity)) * Number(m.unit_cost || 0)), 0);

    // Service revenue (other operating revenue)
    let serviceRevenue = 0;
    const revenueAccounts = (accountsRes.data || []).filter(a =>
      a.account_type === 'revenue' && a.code !== '4000' && a.code !== '4100'
    );
    for (const acc of revenueAccounts) {
      const { data: lines } = await supabase.from('journal_lines').select('debit, credit').eq('account_id', acc.id);
      const netCredit = (lines || []).reduce((s, l) => s + Number(l.credit || 0) - Number(l.debit || 0), 0);
      if (netCredit > 0) serviceRevenue += netCredit;
    }

    const totalRevenue = salesRevenue + serviceRevenue;
    const grossProfit = totalRevenue - costOfGoodsSold;

    // Operating expenses - EXCLUDE cost_of_sales/COGS type accounts
    const expenseAccounts = (accountsRes.data || []).filter(a =>
      a.account_type === 'expense' && a.account_type !== 'cost_of_sales'
    );
    const operatingExpenses: { name: string; amount: number }[] = [];
    let totalOperatingExpenses = 0;

    for (const acc of expenseAccounts) {
      // Skip COGS-related accounts
      if (acc.name.toLowerCase().includes('cost of goods') ||
          acc.name.toLowerCase().includes('cogs') ||
          acc.name.toLowerCase().includes('cost of sales')) {
        continue;
      }
      const { data: lines } = await supabase.from('journal_lines').select('debit, credit').eq('account_id', acc.id);
      const netDebit = (lines || []).reduce((s, l) => s + Number(l.debit || 0) - Number(l.credit || 0), 0);
      if (netDebit > 0) {
        operatingExpenses.push({ name: acc.name, amount: netDebit });
        totalOperatingExpenses += netDebit;
      }
    }

    const operatingProfit = grossProfit - totalOperatingExpenses;

    // Other income/expenses
    let otherIncome = 0;
    let otherExpenses = 0;
    const otherIncomeAccounts = (accountsRes.data || []).filter(a => a.account_type === 'other_income');
    const otherExpenseAccounts = (accountsRes.data || []).filter(a => a.account_type === 'other_expense');

    for (const acc of otherIncomeAccounts) {
      const { data: lines } = await supabase.from('journal_lines').select('debit, credit').eq('account_id', acc.id);
      const net = (lines || []).reduce((s, l) => s + Number(l.credit || 0) - Number(l.debit || 0), 0);
      if (net > 0) otherIncome += net;
    }

    for (const acc of otherExpenseAccounts) {
      const { data: lines } = await supabase.from('journal_lines').select('debit, credit').eq('account_id', acc.id);
      const net = (lines || []).reduce((s, l) => s + Number(l.debit || 0) - Number(l.credit || 0), 0);
      if (net > 0) otherExpenses += net;
    }

    const netOtherIncome = otherIncome - otherExpenses;
    const profitBeforeTax = operatingProfit + netOtherIncome;

    // Income tax (estimate 20% if positive)
    const incomeTaxExpense = profitBeforeTax > 0 ? profitBeforeTax * 0.20 : 0;
    const netProfit = profitBeforeTax - incomeTaxExpense;

    setData({
      salesRevenue,
      serviceRevenue,
      totalRevenue,
      costOfGoodsSold,
      grossProfit,
      operatingExpenses,
      totalOperatingExpenses,
      operatingProfit,
      otherIncome,
      otherExpenses,
      netOtherIncome,
      profitBeforeTax,
      incomeTaxExpense,
      netProfit,
    });

    setLoading(false);
  }

  function exportToCSV() {
    const rows = [
      ['PROFIT & LOSS STATEMENT'],
      [periodLabel],
      [''],
      ['REVENUE'],
      ['Sales Revenue', data.salesRevenue],
      ['Service Revenue', data.serviceRevenue],
      ['Total Revenue', data.totalRevenue],
      [''],
      ['COST OF GOODS SOLD (COGS)'],
      ['Cost of Goods Sold', data.costOfGoodsSold],
      [''],
      ['GROSS PROFIT', data.grossProfit],
      [''],
      ['OPERATING EXPENSES'],
      ...data.operatingExpenses.map(e => [e.name, e.amount]),
      ['Total Operating Expenses', data.totalOperatingExpenses],
      [''],
      ['OPERATING PROFIT', data.operatingProfit],
      [''],
      ['OTHER INCOME / EXPENSES'],
      ['Interest Income', data.otherIncome],
      ['Interest Expense', -data.otherExpenses],
      ['Net Other Income', data.netOtherIncome],
      [''],
      ['Profit Before Tax', data.profitBeforeTax],
      ['Income Tax Expense', -data.incomeTaxExpense],
      [''],
      ['NET PROFIT', data.netProfit],
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'profit_loss_statement.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handlePrint() {
    window.print();
  }

  function formatMoney(amount: number, showParens = false): string {
    const formatted = formatCurrency(Math.abs(amount));
    if (amount < 0) return `(${formatted.replace('৳', '').trim()})`;
    return formatted;
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Profit & Loss Statement</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Standard accounting format</p>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <select value={period} onChange={e => setPeriod(e.target.value as 'month' | 'quarter' | 'year')} className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none bg-white">
            <option value="month">This Month</option>
            <option value="quarter">This Quarter</option>
            <option value="year">This Year</option>
          </select>
          <button onClick={loadData} className="flex items-center gap-1.5 border border-border px-3 py-2 rounded-lg text-sm hover:bg-muted transition">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button onClick={handlePrint} className="flex items-center gap-1.5 border border-border px-3 py-2 rounded-lg text-sm hover:bg-muted transition">
            <Printer className="w-3.5 h-3.5" />
          </button>
          <button onClick={exportToCSV} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition">
            <Download className="w-4 h-4" />Export
          </button>
        </div>
      </div>

      {/* P&L Statement Document */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm max-w-3xl mx-auto print:shadow-none print:border-none">
        {/* Header */}
        <div className="text-center py-6 border-b border-gray-200">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Building2 className="w-5 h-5 text-gray-600" />
            <h2 className="text-lg font-bold text-gray-900 tracking-wide">{companySettings.name}</h2>
          </div>
          <h3 className="text-base font-semibold text-gray-800 mt-2">PROFIT & LOSS STATEMENT</h3>
          <p className="text-sm text-gray-500 mt-1">{periodLabel}</p>
        </div>

        {loading ? (
          <div className="px-8 py-12 text-center text-gray-400">Loading financial data...</div>
        ) : (
          <div className="px-6 py-4">
            {/* REVENUE Section */}
            <SectionHeader title="REVENUE" />
            <table className="w-full text-sm">
              <tbody>
                <StatementRow label="Sales Revenue" amount={data.salesRevenue} />
                <StatementRow label="Service Revenue" amount={data.serviceRevenue} />
                <TotalRow label="Total Revenue" amount={data.totalRevenue} variant="blue" />
              </tbody>
            </table>

            {/* COGS Section */}
            <SectionHeader title="COST OF GOODS SOLD (COGS)" className="mt-4" />
            <table className="w-full text-sm">
              <tbody>
                <StatementRow label="Cost of Goods Sold" amount={data.costOfGoodsSold} />
              </tbody>
            </table>
            <TotalRow label="Total COGS" amount={data.costOfGoodsSold} variant="orange" />

            {/* GROSS PROFIT */}
            <ProfitRow label="GROSS PROFIT" amount={data.grossProfit} />

            {/* OPERATING EXPENSES Section */}
            <SectionHeader title="OPERATING EXPENSES" className="mt-4" />
            <table className="w-full text-sm">
              <tbody>
                {data.operatingExpenses.length > 0 ? (
                  data.operatingExpenses.map((exp, i) => (
                    <StatementRow key={i} label={exp.name} amount={exp.amount} />
                  ))
                ) : (
                  <StatementRow label="No operating expenses recorded" amount={0} />
                )}
                <TotalRow label="Total Operating Expenses" amount={data.totalOperatingExpenses} variant="orange" />
              </tbody>
            </table>

            {/* OPERATING PROFIT */}
            <ProfitRow label="OPERATING PROFIT" amount={data.operatingProfit} />

            {/* OTHER INCOME/EXPENSES Section */}
            <SectionHeader title="OTHER INCOME / EXPENSES" className="mt-4" />
            <table className="w-full text-sm">
              <tbody>
                <StatementRow label="Interest Income" amount={data.otherIncome} />
                <StatementRow label="Interest Expense" amount={-data.otherExpenses} isDeduction />
                <TotalRow label="Net Other Income" amount={data.netOtherIncome} variant="blue" />
              </tbody>
            </table>

            {/* Profit Before Tax */}
            <div className="flex justify-between items-center py-3 px-4 bg-gray-50 border-y border-gray-200 mt-2">
              <span className="text-sm font-semibold text-gray-700">Profit Before Tax</span>
              <span className="text-sm font-bold text-gray-800">{formatMoney(data.profitBeforeTax)}</span>
            </div>

            {/* Income Tax */}
            <div className="flex justify-between items-center py-2 px-4">
              <span className="text-sm text-gray-600">Income Tax Expense</span>
              <span className="text-sm text-red-600">({formatCurrency(data.incomeTaxExpense).replace('৳', '').trim()})</span>
            </div>

            {/* NET PROFIT */}
            <div className={`flex justify-between items-center py-4 px-4 mt-2 rounded-lg ${data.netProfit >= 0 ? 'bg-green-600' : 'bg-red-600'}`}>
              <span className="text-base font-bold text-white tracking-wide">NET PROFIT</span>
              <span className="text-xl font-bold text-white">{formatCurrency(data.netProfit)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Component: Section Header
function SectionHeader({ title, className = '' }: { title: string; className?: string }) {
  return (
    <div className={`py-2 px-4 bg-blue-50 border-b border-t border-gray-200 ${className}`}>
      <h4 className="text-xs font-bold text-blue-700 tracking-wide">{title}</h4>
    </div>
  );
}

// Component: Statement Row
function StatementRow({ label, amount, isDeduction = false }: { label: string; amount: number; isDeduction?: boolean }) {
  const displayAmount = amount < 0 || isDeduction;
  const absAmount = Math.abs(amount);

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50/50">
      <td className="py-2.5 pl-4 text-gray-700">{label}</td>
      <td className="py-2.5 pr-4 text-right font-medium tabular-nums">
        {displayAmount ? (
          <span className="text-red-600">({formatCurrency(absAmount).replace('৳', '').trim()})</span>
        ) : (
          <span className="text-gray-800">{formatCurrency(absAmount)}</span>
        )}
      </td>
    </tr>
  );
}

// Component: Total Row
function TotalRow({ label, amount, variant }: { label: string; amount: number; variant: 'blue' | 'orange' }) {
  const bgClass = variant === 'blue' ? 'bg-blue-100' : 'bg-orange-50';
  const textClass = variant === 'blue' ? 'text-blue-800' : 'text-orange-800';

  return (
    <tr className={`${bgClass} border-b border-gray-200`}>
      <td className="py-2.5 pl-4 font-semibold text-gray-800">{label}</td>
      <td className="py-2.5 pr-4 text-right font-bold tabular-nums">
        <span className={textClass}>{formatCurrency(amount)}</span>
      </td>
    </tr>
  );
}

// Component: Profit Row (highlighted)
function ProfitRow({ label, amount }: { label: string; amount: number }) {
  const isPositive = amount >= 0;

  return (
    <div className={`flex justify-between items-center py-3 px-4 mt-3 rounded-lg ${isPositive ? 'bg-green-100 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
      <span className="text-sm font-bold text-gray-800 tracking-wide">{label}</span>
      <span className={`text-lg font-bold tabular-nums ${isPositive ? 'text-green-700' : 'text-red-700'}`}>
        {formatCurrency(amount)}
      </span>
    </div>
  );
}
