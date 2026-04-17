import { useEffect, useState } from 'react';
import { API } from '../services/api';
import { saveOfflineTransaction } from '../services/offlineStore';
import {
  ArchiveBoxIcon,
  BanknotesIcon,
  BeakerIcon,
  BuildingStorefrontIcon,
  CheckCircleIcon,
  CubeIcon,
  DocumentTextIcon,
  GiftIcon,
  MagnifyingGlassIcon,
  MinusSmallIcon,
  PlusSmallIcon,
  PrinterIcon,
  ShoppingBagIcon,
  ShoppingCartIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

function formatCurrency(value) {
  return `PHP ${Number(value || 0).toFixed(2)}`;
}

function sanitizeMoneyInput(value) {
  const digitsAndDots = String(value || '').replace(/[^\d.]/g, '');
  const [whole = '', ...decimalParts] = digitsAndDots.split('.');
  const decimal = decimalParts.join('').slice(0, 2);

  return decimalParts.length > 0 ? `${whole}.${decimal}` : whole;
}

const MONEY_CONTROL_KEYS = new Set([
  'Backspace',
  'Delete',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'Tab',
  'Enter',
]);

function preventInvalidMoneyKey(event) {
  if (event.ctrlKey || event.metaKey || event.altKey || MONEY_CONTROL_KEYS.has(event.key)) {
    return;
  }

  if (/^\d$/.test(event.key)) {
    return;
  }

  if (event.key === '.' && !event.currentTarget.value.includes('.')) {
    return;
  }

  event.preventDefault();
}

export default function POS() {
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');

  // Checkout State
  const [discount, setDiscount] = useState(0);
  const [paymentType, setPaymentType] = useState('cash');
  const [amountReceived, setAmountReceived] = useState('');

  // Receipt Modal State
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [receiptData, setReceiptData] = useState(null);

  useEffect(() => {
    API.getProducts().then(setProducts).catch(console.error);
  }, []);

  // --- Cart Logic ---
  const addToCart = (product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        if (existing.qty >= product.stock) {
          window.showToast('Max stock reached!', 'warning');
          return prev;
        }

        return prev.map((item) =>
          item.id === product.id ? { ...item, qty: item.qty + 1 } : item
        );
      }

      return [...prev, { ...product, qty: 1 }];
    });
  };

  const updateQty = (id, newQty) => {
    if (newQty <= 0) {
      const nextCart = cart.filter((item) => item.id !== id);
      setCart(nextCart);
      if (nextCart.length === 0) {
        setShowOrderModal(false);
      }
      return;
    }

    const product = products.find((p) => p.id === id);
    if (!product) {
      return;
    }

    const safeQty = Math.min(newQty, product.stock);
    setCart((prev) => prev.map((item) => (item.id === id ? { ...item, qty: safeQty } : item)));
  };

  const clearCart = () => {
    if (window.confirm('Are you sure you want to clear the cart?')) {
      setCart([]);
      setDiscount(0);
      setAmountReceived('');
      setShowOrderModal(false);
    }
  };

  // --- Calculations ---
  const numericDiscount = Math.max(0, parseFloat(discount || 0) || 0);
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const totalUnits = cart.reduce((sum, item) => sum + item.qty, 0);
  const cartTotal = Math.max(0, subtotal - numericDiscount);
  const numericAmountReceived = parseFloat(amountReceived || 0) || 0;
  const change = paymentType === 'cash' ? Math.max(0, numericAmountReceived - cartTotal) : 0;
  const remainingBalance =
    paymentType === 'cash' ? Math.max(0, cartTotal - numericAmountReceived) : 0;
  const hasCartItems = cart.length > 0;
  const cartQtyByProductId = cart.reduce((acc, item) => {
    acc[item.id] = item.qty;
    return acc;
  }, {});

  const isCheckoutDisabled = !hasCartItems || (paymentType === 'cash' && remainingBalance > 0);

  const handleAmountReceivedChange = (event) => {
    setAmountReceived(sanitizeMoneyInput(event.target.value));
  };

  // --- Filtering ---
  const categories = ['All', ...new Set(products.map((p) => p.category))].sort();
  const filteredProducts = products.filter(
    (p) =>
      p.is_active !== false &&
      (activeCategory === 'All' || p.category === activeCategory) &&
      (p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.category.toLowerCase().includes(search.toLowerCase()))
  );

  // --- Checkout ---
  const handleCheckout = async () => {
    if (isCheckoutDisabled) {
      return;
    }

    const transactionPayload = {
      items: cart.map((item) => ({
        product_id: item.id,
        quantity: item.qty,
        unit_price: item.price,
      })),
      discount: numericDiscount,
      payment_type: paymentType,
    };

    if (!navigator.onLine) {
      const offlineTotal = cartTotal;
      saveOfflineTransaction({ ...transactionPayload, total: offlineTotal });
      setProducts((prev) =>
        prev.map((p) => {
          const cartItem = cart.find((c) => c.id === p.id);
          return cartItem ? { ...p, stock: Math.max(0, p.stock - cartItem.qty) } : p;
        })
      );
      window.showToast('Saved offline. Will sync when back online.', 'warning');
      setReceiptData({
        ...transactionPayload,
        cartDetails: cart,
        total: offlineTotal,
        isOffline: true,
      });
      resetCheckout();
      return;
    }

    try {
      const txn = await API.createTransaction(transactionPayload);

      setProducts((prev) =>
        prev.map((p) => {
          const cartItem = cart.find((c) => c.id === p.id);
          return cartItem ? { ...p, stock: Math.max(0, p.stock - cartItem.qty) } : p;
        })
      );

      window.showToast('Transaction complete!', 'success');
      setReceiptData({
        ...transactionPayload,
        cartDetails: cart,
        total: cartTotal,
        isOffline: false,
        id: txn.id,
      });
      resetCheckout();
    } catch (err) {
      window.showToast(err.message || 'Checkout failed', 'error');
    }
  };

  const resetCheckout = () => {
    setCart([]);
    setDiscount(0);
    setAmountReceived('');
    setShowOrderModal(false);
  };

  const categoryIcon = (cat) => {
    const map = {
      Staple: ArchiveBoxIcon,
      Viand: BuildingStorefrontIcon,
      Soup: BeakerIcon,
      Snacks: ShoppingBagIcon,
      Bread: ArchiveBoxIcon,
      Drinks: BeakerIcon,
      Dessert: GiftIcon,
      General: ShoppingCartIcon,
    };

    return map[cat] || CubeIcon;
  };

  return (
    <div className="relative flex h-full flex-col">
      <div className="mb-4 flex shrink-0 items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Point of Sale</h1>
          <p className="text-sm text-slate-500">Process orders and manage transactions</p>
        </div>

        <button
          type="button"
          onClick={() => hasCartItems && setShowOrderModal(true)}
          disabled={!hasCartItems}
          className={`inline-flex min-w-[220px] items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${
            hasCartItems
              ? 'border-slate-200 bg-white text-slate-900 shadow-sm hover:border-primary hover:shadow-md'
              : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
          }`}
        >
          <div className={`rounded-xl p-2 ${hasCartItems ? 'bg-slate-900 text-white' : 'bg-white text-slate-300'}`}>
            <ShoppingCartIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-widest">
              {hasCartItems ? 'Current Order' : 'Pick Products First'}
            </div>
            <div className="mt-1 truncate text-sm font-black">
              {hasCartItems
                ? `${totalUnits} units • ${formatCurrency(cartTotal)}`
                : 'Select an item to open order review'}
            </div>
          </div>
        </button>
      </div>

      <div className="custom-scrollbar flex-1 overflow-y-auto pb-4">
        <div className="flex min-h-[75vh] flex-col gap-4">
          <div className="shrink-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                placeholder="Search products by name or barcode..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="custom-scrollbar flex gap-2 overflow-x-auto pb-1">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-bold transition-all ${
                    activeCategory === cat
                      ? 'bg-slate-900 text-white shadow-md'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="custom-scrollbar grid flex-1 grid-cols-2 content-start gap-3 overflow-y-auto pr-2 md:grid-cols-3 lg:grid-cols-4">
            {filteredProducts.map((product) => {
              const selectedQty = cartQtyByProductId[product.id] || 0;
              const isSelected = selectedQty > 0;

              return (
                <div
                  key={product.id}
                  className={`relative flex flex-col items-center rounded-xl border p-4 text-center shadow-sm transition-all ${
                    product.stock === 0
                      ? 'border-slate-200 bg-white opacity-50 grayscale'
                      : isSelected
                        ? 'border-primary bg-primary/5 shadow-md ring-2 ring-primary/15'
                        : 'border-slate-200 bg-white hover:-translate-y-1 hover:border-primary hover:shadow-md'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => addToCart(product)}
                    disabled={product.stock === 0}
                    className={`flex w-full flex-1 flex-col items-center text-center ${
                      product.stock === 0 ? 'cursor-not-allowed' : 'cursor-pointer'
                    }`}
                  >
                  {isSelected && (
                    <div className="absolute right-3 top-3 inline-flex min-w-[2.2rem] items-center justify-center rounded-full bg-primary px-2 py-1 text-[11px] font-black text-white shadow-sm">
                      {selectedQty}
                    </div>
                  )}

                  <div
                    className={`mb-2 rounded-2xl p-3 ${
                      isSelected ? 'bg-primary/10 text-primary' : 'text-primary/80'
                    }`}
                  >
                    {(() => {
                      const ProductIcon = categoryIcon(product.category);
                      return <ProductIcon className="h-9 w-9" />;
                    })()}
                  </div>

                  <div
                    className="mb-1 w-full truncate px-1 text-sm font-semibold leading-tight text-slate-800"
                    title={product.name}
                  >
                    {product.name}
                  </div>
                  <div className="font-black text-primary">{formatCurrency(product.price)}</div>

                  <div className="mt-2 flex w-full flex-wrap items-center justify-center gap-2">
                    <div
                      className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                        product.stock <= product.min_stock
                          ? 'bg-red-100 text-red-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {product.stock === 0 ? 'OUT OF STOCK' : `${product.stock} IN STOCK`}
                    </div>

                    {isSelected && (
                      <div className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-primary">
                        Qty {selectedQty}
                      </div>
                    )}
                  </div>
                  </button>

                  <div className="mt-3 flex w-full items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1.5">
                    <button
                      type="button"
                      onClick={() => updateQty(product.id, selectedQty - 1)}
                      disabled={selectedQty === 0}
                      className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm transition hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-slate-500"
                      aria-label={`Decrease ${product.name} quantity`}
                    >
                      <MinusSmallIcon className="h-5 w-5" />
                    </button>

                    <div className="min-w-0 flex-1 text-center">
                      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                        Qty
                      </div>
                      <div className="text-lg font-black text-slate-900">{selectedQty}</div>
                    </div>

                    <button
                      type="button"
                      onClick={() => addToCart(product)}
                      disabled={product.stock === 0 || selectedQty >= product.stock}
                      className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm transition hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-slate-500"
                      aria-label={`Increase ${product.name} quantity`}
                    >
                      <PlusSmallIcon className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              );
            })}

            {filteredProducts.length === 0 && (
              <div className="col-span-full py-12 text-center font-medium text-slate-400">
                No products found.
              </div>
            )}
          </div>
        </div>

      </div>

      {showOrderModal && hasCartItems && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-md sm:items-center sm:p-4">
          <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-[0_30px_80px_rgba(15,23,42,0.35)] sm:h-[94vh] sm:max-h-[94vh] sm:max-w-6xl sm:rounded-[30px] sm:border sm:border-slate-200/80">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.18),_transparent_40%),radial-gradient(circle_at_top_left,_rgba(16,185,129,0.16),_transparent_38%)]" />

            <div className="relative shrink-0 border-b border-slate-200 bg-slate-950 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] text-white sm:px-6 sm:py-5">
              <div className="sm:hidden">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-slate-100">
                      <ShoppingCartIcon className="h-4 w-4" />
                      Current Order
                    </div>
                    <h3 className="mt-2 text-lg font-black tracking-tight">Review order</h3>
                    <p className="mt-1 text-xs font-semibold text-slate-300">
                      {cart.length} item(s) | {totalUnits} unit(s) | {formatCurrency(cartTotal)}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={clearCart}
                      className="inline-flex items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-bold text-white transition hover:border-white/20 hover:bg-white/15"
                    >
                      <TrashIcon className="h-4 w-4" />
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowOrderModal(false)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-white transition hover:border-white/20 hover:bg-white/15"
                      aria-label="Close order modal"
                    >
                      <XMarkIcon className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2.5">
                    <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-300">
                      Items
                    </div>
                    <div className="mt-1 text-base font-black">{cart.length}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2.5">
                    <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-300">
                      Units
                    </div>
                    <div className="mt-1 text-base font-black">{totalUnits}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2.5">
                    <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-300">
                      Subtotal
                    </div>
                    <div className="mt-1 text-sm font-black">{formatCurrency(subtotal)}</div>
                  </div>
                  <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2.5">
                    <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-100">
                      Total
                    </div>
                    <div className="mt-1 text-sm font-black">{formatCurrency(cartTotal)}</div>
                  </div>
                  <div className="rounded-2xl border border-sky-400/20 bg-sky-400/10 px-3 py-2.5">
                    <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-sky-100">
                      Change
                    </div>
                    <div className="mt-1 text-sm font-black">{formatCurrency(change)}</div>
                  </div>
                </div>
              </div>

              <div className="hidden sm:block">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="max-w-3xl">
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.24em] text-slate-100">
                      <ShoppingCartIcon className="h-4 w-4" />
                      Current Order
                    </div>
                    <h3 className="mt-3 text-xl font-black tracking-tight sm:text-3xl">
                      Review order before checkout
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-slate-300">
                      Check item quantities, apply discounts, and confirm the payment details before
                      completing this sale.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row">
                    <button
                      type="button"
                      onClick={clearCart}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-bold text-white transition hover:border-white/20 hover:bg-white/15"
                    >
                      <TrashIcon className="h-4 w-4" />
                      Clear Order
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowOrderModal(false)}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-bold text-white transition hover:border-white/20 hover:bg-white/15"
                    >
                      <XMarkIcon className="h-4 w-4" />
                      Close
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-5 sm:gap-3 xl:grid-cols-5">
                  <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-300">
                      Items
                    </div>
                    <div className="mt-1 text-xl font-black">{cart.length}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-300">
                      Units
                    </div>
                    <div className="mt-1 text-xl font-black">{totalUnits}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-300">
                      Subtotal
                    </div>
                    <div className="mt-1 text-base font-black">{formatCurrency(subtotal)}</div>
                  </div>
                  <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-100">
                      Total Due
                    </div>
                    <div className="mt-1 text-base font-black">{formatCurrency(cartTotal)}</div>
                  </div>
                  <div className="rounded-2xl border border-sky-400/20 bg-sky-400/10 px-4 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-sky-100">
                      Change
                    </div>
                    <div className="mt-1 text-base font-black">{formatCurrency(change)}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1">
              <div className="custom-scrollbar h-full overflow-y-auto overscroll-y-contain bg-slate-50 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] xl:hidden">
                <div className="space-y-3">
                  <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                          Order Items
                        </div>
                        <div className="mt-1 text-base font-black text-slate-900">
                          Edit quantities in this modal
                        </div>
                      </div>
                      <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-500">
                        {totalUnits} units
                      </div>
                    </div>

                    <div className="mt-3 space-y-3">
                      {cart.map((item) => (
                        <div
                          key={`mobile-order-item-${item.id}`}
                          className="rounded-[22px] border border-slate-200 bg-slate-50/90 p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div
                                className="truncate text-sm font-black text-slate-900"
                                title={item.name}
                              >
                                {item.name}
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                                <span className="rounded-full bg-white px-2.5 py-1 text-slate-500">
                                  {item.category || 'General'}
                                </span>
                                <span>{formatCurrency(item.price)} each</span>
                                <span>{item.stock} in stock</span>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => updateQty(item.id, 0)}
                              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-400 transition hover:border-red-200 hover:bg-red-50 hover:text-red-500"
                              aria-label={`Remove ${item.name} from current order`}
                            >
                              <XMarkIcon className="h-4 w-4" />
                            </button>
                          </div>

                          <div className="mt-3 flex items-center justify-between gap-3">
                            <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
                              <button
                                type="button"
                                onClick={() => updateQty(item.id, item.qty - 1)}
                                className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 hover:text-primary"
                                aria-label={`Decrease ${item.name} quantity`}
                              >
                                <MinusSmallIcon className="h-5 w-5" />
                              </button>
                              <div className="min-w-[3rem] text-center">
                                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                                  Qty
                                </div>
                                <div className="text-lg font-black text-slate-900">{item.qty}</div>
                              </div>
                              <button
                                type="button"
                                onClick={() => updateQty(item.id, item.qty + 1)}
                                disabled={item.qty >= item.stock}
                                className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-600"
                                aria-label={`Increase ${item.name} quantity`}
                              >
                                <PlusSmallIcon className="h-5 w-5" />
                              </button>
                            </div>

                            <div className="shrink-0 text-right">
                              <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                                Line Total
                              </div>
                              <div className="mt-1 text-base font-black text-slate-900">
                                {formatCurrency(item.price * item.qty)}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-sm font-black text-slate-900">
                      <DocumentTextIcon className="h-5 w-5 text-slate-400" />
                      Order details
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Apply a discount and choose how the customer will pay.
                    </p>

                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="rounded-[22px] border border-slate-200 bg-slate-50 p-3">
                        <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                          Discount
                        </span>
                        <input
                          type="number"
                          min="0"
                          value={discount}
                          onChange={(e) => setDiscount(e.target.value)}
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-700 outline-none transition focus:border-primary"
                          placeholder="0.00"
                        />
                      </label>

                      <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-3">
                        <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                          Payment
                        </span>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setPaymentType('cash')}
                            className={`rounded-2xl border px-3 py-3 text-sm font-black transition ${
                              paymentType === 'cash'
                                ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            Cash
                          </button>
                          <button
                            type="button"
                            onClick={() => setPaymentType('gcash')}
                            className={`rounded-2xl border px-3 py-3 text-sm font-black transition ${
                              paymentType === 'gcash'
                                ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            GCash
                          </button>
                        </div>
                      </div>
                    </div>

                  </div>

                  {paymentType === 'cash' && (
                    <div className="rounded-[24px] border border-emerald-100 bg-emerald-50/80 p-4 shadow-sm">
                      <div className="flex items-center gap-2 text-sm font-black text-slate-900">
                        <BanknotesIcon className="h-5 w-5 text-emerald-500" />
                        Cash received
                      </div>

                      <input
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*[.]?[0-9]*"
                        min={cartTotal}
                        step="0.01"
                        value={amountReceived}
                        onChange={handleAmountReceivedChange}
                        onKeyDown={preventInvalidMoneyKey}
                        className="mt-3 w-full rounded-2xl border border-emerald-200 bg-white px-3 py-3 text-sm font-bold text-slate-700 outline-none transition focus:border-emerald-400"
                        placeholder="0.00"
                      />

                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <div className="rounded-2xl border border-white/70 bg-white px-3 py-3">
                          <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                            Change
                          </div>
                          <div
                            className={`mt-1 text-base font-black ${
                              change > 0 ? 'text-emerald-600' : 'text-slate-500'
                            }`}
                          >
                            {formatCurrency(change)}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/70 bg-white px-3 py-3">
                          <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                            Balance
                          </div>
                          <div
                            className={`mt-1 text-base font-black ${
                              remainingBalance > 0 ? 'text-red-600' : 'text-slate-700'
                            }`}
                          >
                            {formatCurrency(remainingBalance)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="rounded-[26px] bg-slate-950 p-4 text-white shadow-xl shadow-slate-900/10">
                    <div className="flex items-center justify-between text-sm text-slate-300">
                      <span>Subtotal</span>
                      <span className="font-bold text-white">{formatCurrency(subtotal)}</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-sm text-slate-300">
                      <span>Discount</span>
                      <span className="font-bold text-white">
                        - {formatCurrency(numericDiscount)}
                      </span>
                    </div>
                    <div className="mt-4 flex items-end justify-between border-t border-white/10 pt-4">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                          Total Due
                        </div>
                        <div className="mt-1 text-2xl font-black tracking-tight">
                          {formatCurrency(cartTotal)}
                        </div>
                      </div>
                      <div className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-slate-200">
                        {paymentType}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={handleCheckout}
                      disabled={isCheckoutDisabled}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-4 text-sm font-black text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
                    >
                      <CheckCircleIcon className="h-6 w-6" />
                      Complete Transaction
                    </button>

                    <p className="text-center text-xs font-semibold text-slate-400">
                      {paymentType === 'cash' && remainingBalance > 0
                        ? `Waiting for ${formatCurrency(remainingBalance)} more cash.`
                        : 'Review the full order here, then finish checkout when ready.'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="hidden h-full min-h-0 xl:block">
                <div className="grid h-full min-h-0 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.9fr)]">
                <div className="custom-scrollbar min-h-[240px] bg-slate-50/80 p-4 sm:p-5 xl:min-h-0 xl:overflow-y-auto">
                <div className="mb-4 flex flex-col gap-2 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.24em] text-slate-400">
                      Order Items
                    </div>
                    <div className="mt-1 text-lg font-black text-slate-900">
                      Update quantities before payment
                    </div>
                  </div>
                  <div className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-500 shadow-sm">
                    {totalUnits} total units in cart
                  </div>
                </div>

                <div className="space-y-3">
                  {cart.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4
                              className="truncate text-base font-black text-slate-900"
                              title={item.name}
                            >
                              {item.name}
                            </h4>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                              {item.category || 'General'}
                            </span>
                          </div>

                          <div className="mt-3 grid gap-2 text-xs font-semibold text-slate-500 sm:grid-cols-2">
                            <div className="rounded-2xl bg-slate-50 px-3 py-2">
                              <span className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                                Unit Price
                              </span>
                              <span className="mt-1 block text-sm font-black text-slate-800">
                                {formatCurrency(item.price)}
                              </span>
                            </div>
                            <div className="rounded-2xl bg-slate-50 px-3 py-2">
                              <span className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                                Available
                              </span>
                              <span className="mt-1 block text-sm font-black text-slate-800">
                                {item.stock} in stock
                              </span>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => updateQty(item.id, 0)}
                          className="inline-flex self-start items-center justify-center rounded-2xl border border-slate-200 p-2.5 text-slate-400 transition hover:border-red-200 hover:bg-red-50 hover:text-red-500"
                          aria-label={`Remove ${item.name} from current order`}
                        >
                          <XMarkIcon className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="inline-flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 p-2 sm:w-auto sm:justify-start sm:gap-3">
                          <button
                            type="button"
                            onClick={() => updateQty(item.id, item.qty - 1)}
                            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-lg font-black text-slate-600 shadow-sm transition hover:text-primary"
                          >
                            -
                          </button>
                          <div className="min-w-[3rem] text-center">
                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                              Qty
                            </div>
                            <div className="text-lg font-black text-slate-900">{item.qty}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => updateQty(item.id, item.qty + 1)}
                            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-lg font-black text-slate-600 shadow-sm transition hover:text-primary"
                          >
                            +
                          </button>
                        </div>

                        <div className="rounded-2xl bg-slate-900 px-4 py-3 text-left text-white sm:min-w-[170px] sm:text-right">
                          <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                            Line Total
                          </div>
                          <div className="mt-1 text-xl font-black">
                            {formatCurrency(item.price * item.qty)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="custom-scrollbar border-t border-slate-200 bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:p-5 sm:pb-5 xl:min-h-0 xl:overflow-y-auto xl:border-l xl:border-t-0">
                <div className="space-y-4">
                  <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-sm font-black text-slate-900">
                      <DocumentTextIcon className="h-5 w-5 text-slate-400" />
                      Order details
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Apply discounts and choose how the customer will pay.
                    </p>

                    <div className="mt-4 grid grid-cols-1 gap-4">
                      <label>
                        <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                          Discount
                        </span>
                        <input
                          type="number"
                          min="0"
                          value={discount}
                          onChange={(e) => setDiscount(e.target.value)}
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold text-slate-700 outline-none transition focus:border-primary focus:bg-white"
                          placeholder="0.00"
                        />
                      </label>

                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                          Payment Method
                        </span>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setPaymentType('cash')}
                            className={`rounded-2xl border px-3 py-3 text-sm font-black transition ${
                              paymentType === 'cash'
                                ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                                : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-white'
                            }`}
                          >
                            Cash
                          </button>
                          <button
                            type="button"
                            onClick={() => setPaymentType('gcash')}
                            className={`rounded-2xl border px-3 py-3 text-sm font-black transition ${
                              paymentType === 'gcash'
                                ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                                : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-white'
                            }`}
                          >
                            GCash
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {paymentType === 'cash' && (
                    <div className="rounded-[24px] border border-emerald-100 bg-emerald-50/80 p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-black text-slate-900">Cash received</div>
                          <div className="mt-1 text-xs leading-5 text-slate-500">
                            Enter the amount handed by the customer so the change is calculated
                            automatically.
                          </div>
                        </div>
                        <div className="rounded-2xl bg-white/80 p-2 text-emerald-500 shadow-sm">
                          <BanknotesIcon className="h-5 w-5" />
                        </div>
                      </div>

                      <input
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*[.]?[0-9]*"
                        min={cartTotal}
                        step="0.01"
                        value={amountReceived}
                        onChange={handleAmountReceivedChange}
                        onKeyDown={preventInvalidMoneyKey}
                        className="mt-3 w-full rounded-2xl border border-emerald-200 bg-white px-3 py-3 text-sm font-bold text-slate-700 outline-none transition focus:border-emerald-400"
                        placeholder="0.00"
                      />

                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl border border-white/70 bg-white px-3 py-3">
                          <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                            Change
                          </div>
                          <div
                            className={`mt-1 text-lg font-black ${
                              change > 0 ? 'text-emerald-600' : 'text-slate-500'
                            }`}
                          >
                            {formatCurrency(change)}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/70 bg-white px-3 py-3">
                          <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                            Balance
                          </div>
                          <div
                            className={`mt-1 text-lg font-black ${
                              remainingBalance > 0 ? 'text-red-600' : 'text-slate-700'
                            }`}
                          >
                            {formatCurrency(remainingBalance)}
                          </div>
                        </div>
                      </div>

                      {remainingBalance > 0 && (
                        <p className="mt-3 rounded-2xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
                          Add {formatCurrency(remainingBalance)} more to complete this order.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="rounded-[26px] bg-slate-950 p-4 text-white shadow-xl shadow-slate-900/10">
                    <div className="flex items-center justify-between text-sm text-slate-300">
                      <span>Subtotal</span>
                      <span className="font-bold text-white">{formatCurrency(subtotal)}</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-sm text-slate-300">
                      <span>Discount</span>
                      <span className="font-bold text-white">- {formatCurrency(numericDiscount)}</span>
                    </div>
                    <div className="mt-4 flex items-end justify-between border-t border-white/10 pt-4">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                          Total Due
                        </div>
                        <div className="mt-1 text-3xl font-black tracking-tight">
                          {formatCurrency(cartTotal)}
                        </div>
                      </div>
                      <div className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-slate-200">
                        {paymentType}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 border-t border-slate-200 pt-4">
                    <button
                      type="button"
                      onClick={handleCheckout}
                      disabled={isCheckoutDisabled}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-4 text-sm font-black text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
                    >
                      <CheckCircleIcon className="h-6 w-6" />
                      Complete Transaction
                    </button>

                    <p className="text-center text-xs font-semibold text-slate-400">
                      {paymentType === 'cash' && remainingBalance > 0
                        ? `Waiting for ${formatCurrency(remainingBalance)} more cash.`
                        : 'Everything looks good. Finish checkout when ready.'}
                    </p>
                  </div>
                </div>
              </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {receiptData && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-0 backdrop-blur-sm animate-in fade-in duration-200 sm:items-center sm:p-4">
          <div className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:max-h-[90vh] sm:max-w-sm sm:rounded-2xl">
            <div className="custom-scrollbar flex-1 overflow-y-auto px-5 pb-5 pt-[calc(env(safe-area-inset-top)+1.25rem)] sm:p-6">
              <div className="mb-6 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                  <BanknotesIcon className="h-6 w-6 text-slate-700" />
                </div>
                <h2 className="text-lg font-black text-slate-900">SmartCanteen AI</h2>
                <p className="mt-1 text-xs font-medium text-slate-500">
                  {new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}
                </p>
                {receiptData.id && (
                  <p className="mt-1 font-mono text-[10px] text-slate-400">
                    TXN-{receiptData.id.toString().padStart(6, '0')}
                  </p>
                )}
              </div>

              <div className="mb-6 space-y-3">
                {receiptData.cartDetails.map((item) => (
                  <div key={item.id} className="flex justify-between text-sm">
                    <span className="text-slate-600">
                      <span className="font-bold">{item.qty}x</span> {item.name}
                    </span>
                    <span className="font-bold text-slate-900">
                      {formatCurrency(item.price * item.qty)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="space-y-2 border-t-2 border-dashed border-slate-200 pt-4">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Subtotal</span>
                  <span className="font-bold text-slate-900">
                    {formatCurrency(receiptData.total + Number(receiptData.discount || 0))}
                  </span>
                </div>
                {Number(receiptData.discount || 0) > 0 && (
                  <div className="flex justify-between text-sm text-red-500">
                    <span>Discount</span>
                    <span className="font-bold">
                      - {formatCurrency(receiptData.discount)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between pt-2 text-lg">
                  <span className="font-black text-slate-900">TOTAL</span>
                  <span className="font-black text-primary">{formatCurrency(receiptData.total)}</span>
                </div>
              </div>

              <div className="mt-6 space-y-1 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-500">
                <div className="flex justify-between">
                  <span>Payment Method:</span>
                  <span className="font-bold uppercase text-slate-700">
                    {receiptData.payment_type}
                  </span>
                </div>
                {receiptData.isOffline && (
                  <div className="mt-2 flex items-center justify-center gap-1 border-t border-slate-200 pt-2 font-bold text-amber-600">
                    Saved offline - pending sync
                  </div>
                )}
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-3 border-t border-slate-200 bg-slate-50 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 sm:flex-row sm:p-4">
              <button
                type="button"
                onClick={() => setReceiptData(null)}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 font-bold text-slate-700 transition-colors hover:bg-slate-100"
              >
                <XMarkIcon className="h-5 w-5" />
                Close
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-2.5 font-bold text-white shadow-sm transition-colors hover:bg-primary-dark"
              >
                <PrinterIcon className="h-5 w-5" />
                Print
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
