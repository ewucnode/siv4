'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/format';
import { toast } from '@/hooks/use-toast';
import { Plus, X, CreditCard as Edit, Trash2, ExternalLink } from 'lucide-react';
import type { Account } from '@/lib/types';
import Link from 'next/link';

const typeColors: Record<string, string> = {
  asset: 'text-blue-600 bg-blue-50',
  liability: 'text-red-600 bg-red-50',
  equity: 'text-purple-600 bg-purple-50',
  revenue: 'text-green-600 bg-green-50',
  expense: 'text-orange-600 bg-orange-50',
};

const accountTypes = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [deletingAccount, setDeletingAccount] = useState<Account | null>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const { data } = await supabase.from('accounts').select('*').order('code');
    setAccounts(data || []);
    setLoading(false);
  }

  async function handleDelete() {
    if (!deletingAccount) return;
    const { error } = await supabase.from('accounts').update({ is_active: false }).eq('id', deletingAccount.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Account deactivated successfully' });
      loadData();
    }
    setDeletingAccount(null);
  }

  const activeAccounts = accounts.filter(a => a.is_active);
  const totalAssets = activeAccounts.filter(a => a.account_type === 'asset').reduce((s, a) => s + a.balance, 0);
  const totalLiabilities = activeAccounts.filter(a => a.account_type === 'liability').reduce((s, a) => s + a.balance, 0);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Chart of Accounts</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Manage all accounting ledger accounts</p>
        </div>
        <button onClick={() => setShowCreateModal(true)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition"><Plus className="w-4 h-4" />Add Account</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Assets', value: formatCurrency(totalAssets), color: 'text-blue-600' },
          { label: 'Total Liabilities', value: formatCurrency(totalLiabilities), color: 'text-red-600' },
          { label: 'Total Accounts', value: activeAccounts.length, color: 'text-foreground' },
          { label: 'Cash/Bank', value: activeAccounts.filter(a => a.is_cash || a.is_bank).length, color: 'text-green-600' },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={`text-xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="table-wrapper">
        <table className="w-full">
          <thead><tr className="bg-muted/40 border-b border-border">
            {['Code', 'Account Name', 'Type', 'Balance', 'Cash/Bank', 'Actions'].map(h => <th key={h} className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">{h}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-border">
            {loading ? Array.from({ length: 8 }).map((_, i) => <tr key={i}>{Array.from({ length: 6 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>)}</tr>) :
              accounts.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground text-sm">No accounts found</td></tr>
              ) : accounts.map(a => (
                <tr key={a.id} className={`hover:bg-muted/30 transition-colors ${!a.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 font-mono text-sm text-muted-foreground">{a.code}</td>
                  <td className="px-4 py-3">
                    <Link href={`/accounting/accounts/${a.id}`} className="text-sm font-semibold text-foreground hover:text-blue-600 transition">{a.name}</Link>
                  </td>
                  <td className="px-4 py-3"><span className={`badge-status ${typeColors[a.account_type] || 'bg-gray-100 text-gray-600'} capitalize`}>{a.account_type}</span></td>
                  <td className={`px-4 py-3 text-sm font-bold ${a.account_type === 'expense' || a.account_type === 'liability' ? 'text-red-600' : 'text-green-600'}`}>
                    <Link href={`/accounting/accounts/${a.id}`} className="hover:underline">{formatCurrency(a.balance)}</Link>
                  </td>
                  <td className="px-4 py-3 text-sm">{a.is_cash ? 'Cash' : a.is_bank ? 'Bank' : '-'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Link href={`/accounting/accounts/${a.id}`} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-blue-50 text-muted-foreground hover:text-blue-600 transition" title="View Details"><ExternalLink className="w-3.5 h-3.5" /></Link>
                      <button onClick={() => setEditingAccount(a)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-blue-50 text-muted-foreground hover:text-blue-600 transition"><Edit className="w-3.5 h-3.5" /></button>
                      <button onClick={() => setDeletingAccount(a)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-600 transition"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>

      {showCreateModal && (
        <AccountModal onClose={() => setShowCreateModal(false)} onSaved={loadData} />
      )}
      {editingAccount && (
        <AccountModal account={editingAccount} onClose={() => setEditingAccount(null)} onSaved={loadData} />
      )}
      {deletingAccount && (
        <DeleteConfirmModal name={deletingAccount.name} onClose={() => setDeletingAccount(null)} onConfirm={handleDelete} />
      )}
    </div>
  );
}

function AccountModal({ account, onClose, onSaved }: { account?: Account | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!account;
  const [form, setForm] = useState({
    code: account?.code || '',
    name: account?.name || '',
    account_type: account?.account_type || 'asset',
    is_cash: account?.is_cash || false,
    is_bank: account?.is_bank || false,
    bank_name: account?.bank_name || '',
    account_number: account?.account_number || '',
    balance: account?.balance?.toString() || '0',
    is_active: account?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');

    const data = {
      code: form.code,
      name: form.name,
      account_type: form.account_type as 'asset' | 'liability' | 'equity' | 'revenue' | 'expense',
      is_cash: form.is_cash,
      is_bank: form.is_bank,
      bank_name: form.is_bank ? form.bank_name || null : null,
      account_number: form.is_bank ? form.account_number || null : null,
      balance: Number(form.balance) || 0,
      is_active: form.is_active,
    };

    const { error } = isEdit
      ? await supabase.from('accounts').update(data).eq('id', account!.id)
      : await supabase.from('accounts').insert(data);

    if (error) { setError(error.message); setSaving(false); return; }

    toast({ title: 'Success', description: isEdit ? 'Account updated successfully' : 'Account created successfully' });
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-bold">{isEdit ? 'Edit Account' : 'Add Account'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSave} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Code *</label>
              <input required value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="1000" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Account Type *</label>
              <select required value={form.account_type} onChange={e => setForm({ ...form, account_type: e.target.value as typeof accountTypes[number] })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none">
                {accountTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Account Name *</label>
            <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Cash on Hand" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Opening Balance</label>
            <input type="number" value={form.balance} onChange={e => setForm({ ...form, balance: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.is_cash} onChange={e => setForm({ ...form, is_cash: e.target.checked, is_bank: false })} className="rounded" />
              <span className="text-sm">Cash Account</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.is_bank} onChange={e => setForm({ ...form, is_bank: e.target.checked, is_cash: false })} className="rounded" />
              <span className="text-sm">Bank Account</span>
            </label>
          </div>
          {form.is_bank && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1">Bank Name</label>
                <input value={form.bank_name} onChange={e => setForm({ ...form, bank_name: e.target.value })} placeholder="e.g. City Bank" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Account Number</label>
                <input value={form.account_number} onChange={e => setForm({ ...form, account_number: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
              </div>
            </div>
          )}
          {isEdit && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="rounded" />
              <span className="text-sm">Active</span>
            </label>
          )}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-60">
              {saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteConfirmModal({ name, onClose, onConfirm }: { name: string; onClose: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="p-6">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Trash2 className="w-6 h-6 text-red-600" />
          </div>
          <h2 className="text-lg font-bold text-center mb-2">Deactivate Account?</h2>
          <p className="text-sm text-muted-foreground text-center mb-6">Deactivate <span className="font-semibold text-foreground">{name}</span>?</p>
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition">Cancel</button>
            <button onClick={onConfirm} className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition">Deactivate</button>
          </div>
        </div>
      </div>
    </div>
  );
}
