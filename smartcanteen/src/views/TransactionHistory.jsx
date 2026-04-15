import { useEffect, useState } from 'react';
import { API } from '../services/api';
import { Skeleton, SkeletonText } from '../components/Skeleton';
import {
  BanknotesIcon,
  CalendarIcon,
  EyeIcon,
  MagnifyingGlassIcon,
  PrinterIcon,
} from '@heroicons/react/24/outline';

function formatCurrency(value) {
  return `PHP ${Number(value || 0).toFixed(2)}`;
}

function createDefaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 7);

  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
}

function getItemName(item) {
  return item.product?.name || `Product #${item.product_id}`;
}

export default function TransactionHistory() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedTxn, setSelectedTxn] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [dateRange, setDateRange] = useState(createDefaultDateRange);

  useEffect(() => {
    let cancelled = false;

    async function fetchHistory() {
      setLoading(true);
      setError('');
      try {
        const data = await API.getTransactions(dateRange.start, dateRange.end, { limit: 200 });
        if (!cancelled) {
          setTransactions(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        if (!cancelled) {
          setTransactions([]);
          setError(err.message || 'Failed to load transactions.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchHistory();

    return () => {
      cancelled = true;
    };
  }, [dateRange, reloadKey]);

  const searchTerm = search.trim().toLowerCase();
  const filteredTxns = transactions.filter((transaction) => {
    const txnId = `txn-${String(transaction.id || '').padStart(6, '0')}`.toLowerCase();
    const payment = (transaction.payment_type || '').toLowerCase();
    const productMatch = (transaction.items || []).some((item) =>
      getItemName(item).toLowerCase().includes(searchTerm)
    );

    return (
      txnId.includes(searchTerm) ||
      payment.includes(searchTerm) ||
      productMatch
    );
  });

  const totalRevenue = filteredTxns.reduce((sum, transaction) => sum + Number(transaction.total || 0), 0);

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Transaction History</h1>
          <p className="text-sm text-slate-500">Review past sales and inspect transaction details.</p>
        </div>

        <div className="flex w-full flex-wrap items-center gap-3 md:w-auto md:flex-nowrap">
          <button
            type="button"
            onClick={() => setReloadKey((value) => value + 1)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            Refresh
          </button>
          <div className="flex flex-1 items-center gap-4 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm md:flex-none">
            <div className="border-r border-slate-100 px-4 text-center">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Total Sales</p>
              <p className="text-lg font-black text-primary">{formatCurrency(totalRevenue)}</p>
            </div>
            <div className="px-4 text-center">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Count</p>
              <p className="text-lg font-black text-slate-900">{filteredTxns.length}</p>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-4">
        <div className="relative md:col-span-2">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search TXN ID, payment, or product..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-10 pr-4 outline-none focus:border-primary"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <CalendarIcon className="h-5 w-5 text-slate-400" />
          <input
            type="date"
            value={dateRange.start}
            onChange={(e) => setDateRange((current) => ({ ...current, start: e.target.value }))}
            className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase text-slate-400">To</span>
          <input
            type="date"
            value={dateRange.end}
            onChange={(e) => setDateRange((current) => ({ ...current, end: e.target.value }))}
            className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none"
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="hidden flex-1 md:block">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase text-slate-500">
              <tr>
                <th className="px-6 py-4">TXN ID</th>
                <th className="px-6 py-4">Date & Time</th>
                <th className="px-6 py-4">Items</th>
                <th className="px-6 py-4">Method</th>
                <th className="px-6 py-4">Total</th>
                <th className="px-6 py-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                Array.from({ length: 6 }, (_, index) => (
                  <tr key={`txn-skeleton-${index}`}>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-6 py-4"><SkeletonText lines={['h-4 w-28', 'h-3 w-20']} /></td>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-16" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-6 w-16 rounded-full" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-20" /></td>
                    <td className="px-6 py-4 text-right"><Skeleton className="ml-auto h-9 w-9 rounded-lg" /></td>
                  </tr>
                ))
              ) : filteredTxns.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-10 text-center text-slate-400">
                    No transactions found for the selected filters.
                  </td>
                </tr>
              ) : (
                filteredTxns.map((transaction) => (
                  <tr key={transaction.id} className="transition-colors hover:bg-slate-50">
                    <td className="px-6 py-4 font-mono font-bold text-slate-900">
                      TXN-{String(transaction.id).padStart(6, '0')}
                    </td>
                    <td className="px-6 py-4 text-xs">
                      <div className="font-bold">
                        {transaction.created_at
                          ? new Date(transaction.created_at).toLocaleDateString('en-PH')
                          : 'N/A'}
                      </div>
                      <div className="text-slate-400">
                        {transaction.created_at
                          ? new Date(transaction.created_at).toLocaleTimeString('en-PH')
                          : ''}
                      </div>
                    </td>
                    <td className="px-6 py-4">{(transaction.items || []).length} items</td>
                    <td className="px-6 py-4">
                      <span
                        className={`rounded px-2 py-1 text-[10px] font-black uppercase ${
                          transaction.payment_type === 'cash'
                            ? 'bg-emerald-50 text-emerald-600'
                            : 'bg-blue-50 text-blue-600'
                        }`}
                      >
                        {transaction.payment_type || 'cash'}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-black text-slate-900">
                      {formatCurrency(transaction.total)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => setSelectedTxn(transaction)}
                        className="rounded-lg p-2 text-slate-400 transition-all hover:bg-primary/5 hover:text-primary"
                      >
                        <EyeIcon className="h-5 w-5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="custom-scrollbar flex-1 overflow-y-auto p-4 md:hidden">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }, (_, index) => (
                <div key={`txn-mobile-skeleton-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <SkeletonText lines={['h-4 w-24', 'h-4 w-28', 'h-3 w-20']} className="flex-1" />
                    <Skeleton className="h-6 w-16 rounded-full" />
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-4">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-6 w-24" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredTxns.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-10 text-center text-slate-500">
              No transactions found for the selected filters.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTxns.map((transaction) => (
                <div key={transaction.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-xs font-bold text-slate-900">
                        TXN-{String(transaction.id).padStart(6, '0')}
                      </div>
                      <div className="mt-1 text-sm font-bold text-slate-700">
                        {transaction.created_at
                          ? new Date(transaction.created_at).toLocaleDateString('en-PH')
                          : 'N/A'}
                      </div>
                      <div className="text-xs text-slate-400">
                        {transaction.created_at
                          ? new Date(transaction.created_at).toLocaleTimeString('en-PH')
                          : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => setSelectedTxn(transaction)}
                      className="rounded-lg border border-slate-200 p-2 text-slate-500 transition-all hover:bg-primary/5 hover:text-primary"
                    >
                      <EyeIcon className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Items</div>
                      <div className="mt-1 font-black text-slate-900">{(transaction.items || []).length}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Total</div>
                      <div className="mt-1 font-black text-slate-900">{formatCurrency(transaction.total)}</div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <span
                      className={`rounded px-2 py-1 text-[10px] font-black uppercase ${
                        transaction.payment_type === 'cash'
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-blue-50 text-blue-600'
                      }`}
                    >
                      {transaction.payment_type || 'cash'}
                    </span>
                    <span className="max-w-[12rem] truncate text-xs text-slate-500">
                      {(transaction.items || []).map(getItemName).slice(0, 2).join(', ') || 'No items'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedTxn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="custom-scrollbar flex-1 overflow-y-auto p-6">
              <div className="mb-6 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                  <BanknotesIcon className="h-6 w-6 text-slate-600" />
                </div>
                <h2 className="text-lg font-black text-slate-900">Transaction Details</h2>
                <p className="font-mono text-xs text-slate-400">
                  TXN-{String(selectedTxn.id).padStart(6, '0')}
                </p>
              </div>

              <div className="mb-6 space-y-3">
                {(selectedTxn.items || []).map((item, index) => (
                  <div key={`${item.product_id}-${index}`} className="flex justify-between text-sm">
                    <span className="text-slate-600">
                      <span className="font-bold">{item.quantity}x</span> {getItemName(item)}
                    </span>
                    <span className="font-bold text-slate-900">
                      {formatCurrency(Number(item.unit_price || 0) * Number(item.quantity || 0))}
                    </span>
                  </div>
                ))}
                {(selectedTxn.items || []).length === 0 && (
                  <div className="text-sm text-slate-400">No item details available for this transaction.</div>
                )}
              </div>

              <div className="space-y-2 border-t-2 border-dashed border-slate-200 pt-4">
                <div className="flex justify-between text-sm font-bold text-slate-900">
                  <span>TOTAL PAID</span>
                  <span className="text-lg font-black text-primary">
                    {formatCurrency(selectedTxn.total)}
                  </span>
                </div>
              </div>

              <div className="mt-6 space-y-1 rounded-lg border border-slate-100 bg-slate-50 p-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <p>
                  Date:{' '}
                  {selectedTxn.created_at
                    ? new Date(selectedTxn.created_at).toLocaleString('en-PH')
                    : 'N/A'}
                </p>
                <p>Payment: {selectedTxn.payment_type || 'cash'}</p>
              </div>
            </div>

            <div className="flex gap-3 border-t border-slate-100 bg-white p-4">
              <button
                onClick={() => setSelectedTxn(null)}
                className="flex-1 rounded-xl bg-slate-100 py-3 font-bold text-slate-700 transition-all hover:bg-slate-200"
              >
                Close
              </button>
              <button
                onClick={() => window.print()}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-3 font-bold text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary-dark"
              >
                <PrinterIcon className="h-5 w-5" /> Print
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
