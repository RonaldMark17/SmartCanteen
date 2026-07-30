import { useEffect, useRef, useState } from 'react';
import { API } from '../services/api';
import { saveOfflineTransaction } from '../services/offlineStore';
import { requestAlertRefresh } from '../services/realtimeAlerts';
import { BULK_UNIT_TYPE, formatProductQuantity, formatQuantity, formatUnit, getBulkSaleOptions, getProductBaseUnit, getProductUnitType, getUnitMultiplier } from '../utils/units';
import {
  ArchiveBoxIcon,
  BanknotesIcon,
  BeakerIcon,
  BuildingStorefrontIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
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
  StarIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

function formatCurrency(value) {
  return `PHP ${Number(value || 0).toFixed(2)}`;
}

function formatCount(value) {
  return Number(value || 0).toLocaleString('en-PH');
}

function isBelowMinimumStock(product) {
  return Number(product?.stock || 0) < Number(product?.min_stock || 0);
}

const MIN_POS_ITEMS_PER_PAGE = 12;
const DEFAULT_POS_ITEMS_PER_PAGE = 18;
const MAX_POS_ITEMS_PER_PAGE = 48;
const MAX_PAGE_BUTTONS = 5;
const CASH_PAYMENT_TYPE = 'cash';
const CASH_PAYMENT_LABEL = 'Cash Payment';
const QUICK_SALE_PRODUCT_LIMIT = 24;
const POS_MODE_STORAGE_KEY = 'sc_pos_mode';

function estimateProductCardHeight(width) {
  if (width >= 1280) {
    return 198;
  }

  if (width >= 1024) {
    return 206;
  }

  if (width >= 768) {
    return 214;
  }

  return 226;
}

function formatPaymentMethod(value) {
  return String(value || CASH_PAYMENT_TYPE).toLowerCase() === CASH_PAYMENT_TYPE
    ? CASH_PAYMENT_LABEL
    : 'Legacy payment';
}

function getPageNumbers(currentPage, totalPages) {
  const visibleCount = Math.min(MAX_PAGE_BUTTONS, totalPages);
  let start = Math.max(1, currentPage - Math.floor(visibleCount / 2));
  const end = Math.min(totalPages, start + visibleCount - 1);
  start = Math.max(1, end - visibleCount + 1);

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function sanitizeMoneyInput(value) {
  const digitsAndDots = String(value || '').replace(/[^\d.]/g, '');
  const [whole = '', ...decimalParts] = digitsAndDots.split('.');
  const decimal = decimalParts.join('').slice(0, 2);

  return decimalParts.length > 0 ? `${whole}.${decimal}` : whole;
}

function sanitizeQuantityInput(value) {
  return String(value || '').replace(/\D/g, '');
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

const QUANTITY_CONTROL_KEYS = new Set([
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

function preventInvalidQuantityKey(event) {
  if (event.ctrlKey || event.metaKey || event.altKey || QUANTITY_CONTROL_KEYS.has(event.key)) {
    return;
  }

  if (/^\d$/.test(event.key)) {
    return;
  }

  event.preventDefault();
}

function getInitialPosMode() {
  try {
    return localStorage.getItem(POS_MODE_STORAGE_KEY) === 'full' ? 'full' : 'quick';
  } catch {
    return 'quick';
  }
}

export default function POS() {
  const productGridRef = useRef(null);
  const productSearchRef = useRef(null);
  const [products, setProducts] = useState([]);
  const [quickSaleProducts, setQuickSaleProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(DEFAULT_POS_ITEMS_PER_PAGE);
  const [posMode, setPosMode] = useState(getInitialPosMode);
  const [bulkPortions, setBulkPortions] = useState({});

  // Checkout State
  const [amountReceived, setAmountReceived] = useState('');

  // Receipt Modal State
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [receiptData, setReceiptData] = useState(null);

  useEffect(() => {
    let isActive = true;

    async function loadProductCatalog() {
      const [productsResult, quickSaleResult] = await Promise.allSettled([
        API.getProducts(),
        API.getQuickSaleProducts(),
      ]);
      if (!isActive) {
        return;
      }

      const productRows = productsResult.status === 'fulfilled' && Array.isArray(productsResult.value)
        ? productsResult.value
        : [];
      setProducts(productRows);

      if (quickSaleResult.status === 'fulfilled' && Array.isArray(quickSaleResult.value)) {
        setQuickSaleProducts(quickSaleResult.value);
      } else {
        setQuickSaleProducts(productRows);
      }

      if (productsResult.status === 'rejected') {
        console.error(productsResult.reason);
      }
    }

    loadProductCatalog();
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 768px)');
    const closeMobileOrderModal = (event) => {
      if (event.matches) {
        setShowOrderModal(false);
      }
    };

    closeMobileOrderModal(mediaQuery);
    mediaQuery.addEventListener('change', closeMobileOrderModal);

    return () => mediaQuery.removeEventListener('change', closeMobileOrderModal);
  }, []);

  useEffect(() => {
    const grid = productGridRef.current;
    if (!grid) {
      return undefined;
    }

    let frameId = null;
    const updateItemsPerPage = () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        const styles = window.getComputedStyle(grid);
        const columns = styles.gridTemplateColumns
          .split(' ')
          .filter((column) => column && column !== 'none').length;
        const fallbackColumns = Math.max(2, Math.floor(grid.clientWidth / 184));
        const columnCount = Math.max(2, columns || fallbackColumns);
        const rowGap = Number.parseFloat(styles.rowGap) || 10;
        const availableHeight = grid.clientHeight || Math.round(window.innerHeight * 0.58);
        const estimatedCardHeight = estimateProductCardHeight(window.innerWidth);
        const minimumRows = window.innerWidth >= 768 ? 3 : 4;
        const rowCount = Math.max(
          minimumRows,
          Math.floor((availableHeight + rowGap) / (estimatedCardHeight + rowGap))
        );
        const nextItemsPerPage = Math.min(
          MAX_POS_ITEMS_PER_PAGE,
          Math.max(MIN_POS_ITEMS_PER_PAGE, columnCount * rowCount)
        );

        setItemsPerPage((currentValue) =>
          currentValue === nextItemsPerPage ? currentValue : nextItemsPerPage
        );
      });
    };

    updateItemsPerPage();

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateItemsPerPage);
    resizeObserver?.observe(grid);
    window.addEventListener('resize', updateItemsPerPage);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateItemsPerPage);
    };
  }, []);

  // --- Cart Logic ---
  const getBulkPortionKey = (portion) => `${portion.quantity}:${portion.saleUnit}`;

  const getSelectedBulkPortion = (product) => {
    const portions = getBulkSaleOptions(product);
    const selectedKey = bulkPortions[product.id];
    return portions.find((portion) => getBulkPortionKey(portion) === selectedKey) || portions[0];
  };

  const buildCartItem = (product) => {
    const unitType = getProductUnitType(product);
    const portion = unitType === BULK_UNIT_TYPE ? getSelectedBulkPortion(product) : {
      quantity: 1,
      saleUnit: 'pcs',
    };
    const inventoryMultiplier = getUnitMultiplier(getProductBaseUnit(product), portion.saleUnit);

    return {
      ...product,
      qty: portion.quantity,
      sale_unit: portion.saleUnit,
      inventory_multiplier: inventoryMultiplier,
      inventory_quantity: portion.quantity * inventoryMultiplier,
      price: Number(product.price || 0) * inventoryMultiplier,
    };
  };

  const addToCart = (product) => {
    const nextCartItem = buildCartItem(product);
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        const nextInventoryQuantity = Number(existing.inventory_quantity || existing.qty) + nextCartItem.inventory_quantity;
        if (nextInventoryQuantity > Number(product.stock || 0) + 0.000001) {
          window.showToast('Max stock reached!', 'warning');
          return prev;
        }

        return prev.map((item) =>
          item.id === product.id
            ? {
                ...item,
                qty: Number(item.qty) + nextCartItem.inventory_quantity / item.inventory_multiplier,
                inventory_quantity: nextInventoryQuantity,
              }
            : item
        );
      }

      return [...prev, nextCartItem];
    });
  };

  const updateQty = (id, newQty) => {
    const product = products.find((p) => p.id === id);
    if (!product) {
      return;
    }

    const numericQty = Number(newQty);

    if (!Number.isFinite(numericQty) || numericQty <= 0) {
      const nextCart = cart.filter((item) => item.id !== id);
      setCart(nextCart);
      if (nextCart.length === 0) {
        setShowOrderModal(false);
      }
      return;
    }

    if (getProductUnitType(product) !== BULK_UNIT_TYPE && !Number.isInteger(numericQty)) {
      window.showToast('PCS products must use whole numbers.', 'warning');
      return;
    }

    setCart((prev) => {
      const existing = prev.find((item) => item.id === id);
      const inventoryMultiplier = existing?.inventory_multiplier || 1;
      const safeQty = Math.min(numericQty, Number(product.stock || 0) / inventoryMultiplier);
      if (safeQty <= 0) {
        return prev;
      }

      if (!existing) {
        return [...prev, { ...buildCartItem(product), qty: safeQty, inventory_quantity: safeQty * inventoryMultiplier }];
      }

      return prev.map((item) =>
        item.id === id
          ? { ...item, qty: safeQty, inventory_quantity: safeQty * inventoryMultiplier }
          : item
      );
    });
  };

  const handleQuantityInputChange = (id, value) => {
    const product = products.find((item) => item.id === id);
    const numericText = getProductUnitType(product) === BULK_UNIT_TYPE
      ? sanitizeMoneyInput(value)
      : sanitizeQuantityInput(value);

    if (!numericText) {
      return;
    }

    updateQty(id, numericText);
  };

  const getQuantityStep = (product, selectedQty) => {
    if (getProductUnitType(product) !== BULK_UNIT_TYPE) {
      return 1;
    }

    const cartItem = cart.find((item) => item.id === product.id);
    if (!cartItem) {
      return getSelectedBulkPortion(product).quantity;
    }
    const selectedPortion = getSelectedBulkPortion(product);
    const portionInventoryQuantity = selectedPortion.quantity * getUnitMultiplier(
      getProductBaseUnit(product),
      selectedPortion.saleUnit
    );
    return portionInventoryQuantity / cartItem.inventory_multiplier || selectedQty;
  };

  const getCartItemStep = (item) =>
    getQuantityStep(products.find((product) => product.id === item.id) || item, item.qty);
  const canIncreaseCartItem = (item) =>
    Number(item.inventory_quantity || item.qty) + getCartItemStep(item) * Number(item.inventory_multiplier || 1)
      <= Number(item.stock || 0) + 0.000001;

  const clearCart = () => {
    if (window.confirm('Are you sure you want to clear the cart?')) {
      setCart([]);
      setAmountReceived('');
      setShowOrderModal(false);
    }
  };

  // --- Calculations ---
  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const numericAmountReceived = parseFloat(amountReceived || 0) || 0;
  const change = Math.max(0, numericAmountReceived - cartTotal);
  const remainingBalance = Math.max(0, cartTotal - numericAmountReceived);
  const hasCartItems = cart.length > 0;
  const cartQtyByProductId = cart.reduce((acc, item) => {
    acc[item.id] = item.qty;
    return acc;
  }, {});

  const isCheckoutDisabled = !hasCartItems || remainingBalance > 0;

  const handleAmountReceivedChange = (event) => {
    setAmountReceived(sanitizeMoneyInput(event.target.value));
  };

  const setPOSMode = (nextMode) => {
    setPosMode(nextMode);
    setCurrentPage(1);
    setActiveCategory('All');
    try {
      localStorage.setItem(POS_MODE_STORAGE_KEY, nextMode);
    } catch {
      // The POS remains usable when browser storage is unavailable.
    }
    window.requestAnimationFrame(() => productSearchRef.current?.focus());
  };

  // --- Filtering ---
  const categories = ['All', ...new Set(products.map((p) => p.category))].sort();
  const normalizedSearch = search.trim().toLowerCase();
  const hasSearch = Boolean(normalizedSearch);
  const matchesSearch = (product) =>
    String(product.name || '').toLowerCase().includes(normalizedSearch);
  const isAvailableProduct = (product) =>
    product.is_active !== false && Number(product.stock || 0) > 0;
  const filteredProducts = products.filter((product) =>
    isAvailableProduct(product) &&
    (hasSearch
      ? matchesSearch(product)
      : activeCategory === 'All' || product.category === activeCategory)
  );
  const quickSaleSource = quickSaleProducts.length > 0 ? quickSaleProducts : products;
  const rankedQuickSaleProducts = quickSaleSource.filter(
    (product) => isAvailableProduct(product) && (!hasSearch || matchesSearch(product))
  );
  const bestSellerIds = new Set(
    [...rankedQuickSaleProducts]
      .filter((product) => Number(product.sales_last_30_days || 0) > 0)
      .sort((left, right) => Number(right.sales_last_30_days || 0) - Number(left.sales_last_30_days || 0))
      .slice(0, 8)
      .map((product) => product.id)
  );
  const frequentProductIds = new Set(
    [...rankedQuickSaleProducts]
      .filter((product) => Number(product.orders_last_30_days || 0) > 0)
      .sort((left, right) => Number(right.orders_last_30_days || 0) - Number(left.orders_last_30_days || 0))
      .slice(0, 8)
      .map((product) => product.id)
  );
  const recentProductIds = new Set(
    [...rankedQuickSaleProducts]
      .filter((product) => product.last_sold_at)
      .sort((left, right) => new Date(right.last_sold_at) - new Date(left.last_sold_at))
      .slice(0, 8)
      .map((product) => product.id)
  );
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / itemsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStartIndex = filteredProducts.length === 0 ? 0 : (safeCurrentPage - 1) * itemsPerPage;
  const paginatedProducts = filteredProducts.slice(pageStartIndex, pageStartIndex + itemsPerPage);
  const visibleProducts =
    posMode === 'quick'
      ? (hasSearch ? filteredProducts : rankedQuickSaleProducts.slice(0, QUICK_SALE_PRODUCT_LIMIT))
      : paginatedProducts;
  const pageStartCount = filteredProducts.length === 0 ? 0 : pageStartIndex + 1;
  const pageEndCount = Math.min(pageStartIndex + paginatedProducts.length, filteredProducts.length);
  const pageNumbers = getPageNumbers(safeCurrentPage, totalPages);

  const getQuickSaleLabel = (product) => {
    if (product.is_favorite) return 'Favorite';
    if (bestSellerIds.has(product.id)) return 'Best seller';
    if (frequentProductIds.has(product.id)) return 'Frequent';
    if (recentProductIds.has(product.id)) return 'Recent';
    return 'Quick access';
  };

  const applyCartStockReduction = (productList) =>
    productList.map((product) => {
      const cartItem = cart.find((item) => item.id === product.id);
      if (!cartItem) {
        return product;
      }

      return { ...product, stock: Math.max(0, product.stock - Number(cartItem.inventory_quantity || cartItem.qty)) };
    });

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
        sale_unit: item.sale_unit,
      })),
      payment_type: CASH_PAYMENT_TYPE,
    };

    if (!navigator.onLine) {
      const offlineTotal = cartTotal;
      saveOfflineTransaction({ ...transactionPayload, total: offlineTotal });
      setProducts(applyCartStockReduction);
      setQuickSaleProducts(applyCartStockReduction);
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

      setProducts(applyCartStockReduction);
      setQuickSaleProducts(applyCartStockReduction);

      requestAlertRefresh({ source: 'pos', reason: 'transaction-created' });
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
    <div className="view-shell-static relative">
      <div className="view-header shrink-0 gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="min-w-0">
          <h1 className="view-title">Point of Sale</h1>
          <p className="view-subtitle">Process orders and manage transactions</p>
        </div>

        <button
          type="button"
          onClick={() => hasCartItems && setShowOrderModal(true)}
          disabled={!hasCartItems}
          className={`pos-order-review-trigger inline-flex w-full max-w-full min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left shadow-sm transition sm:w-[18rem] sm:max-w-[18rem] md:ml-auto md:w-[19rem] md:max-w-[19rem] lg:w-[20rem] lg:max-w-[20rem] ${
            hasCartItems
              ? 'border-slate-200 bg-white text-slate-900 hover:border-primary hover:shadow-md'
              : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
          }`}
        >
          <div className={`pos-order-review-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${hasCartItems ? 'theme-emphasis-surface' : 'bg-white text-slate-300'}`}>
            <ShoppingCartIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-black uppercase leading-tight tracking-[0.16em]">
              {hasCartItems ? 'CURRENT ORDER' : 'PICK PRODUCTS FIRST'}
            </div>
            <div className="mt-0.5 truncate text-xs font-semibold leading-5">
              {hasCartItems
                ? `${formatCount(cart.length)} item type${cart.length === 1 ? '' : 's'} | ${formatCurrency(cartTotal)}`
                : 'Select an item to open order review'}
            </div>
          </div>
        </button>
      </div>

      <div className="custom-scrollbar flex-1 overflow-y-auto pb-4">
        <div className="pos-workspace-grid grid min-h-full grid-cols-1 gap-3">
          <div className="pos-products-section flex min-h-0 flex-col gap-3">
          <div className="control-surface shrink-0 space-y-3 p-4">
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="POS mode">
              <button
                type="button"
                role="tab"
                aria-selected={posMode === 'quick'}
                onClick={() => setPOSMode('quick')}
                className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-md px-4 text-base font-black transition ${
                  posMode === 'quick'
                    ? 'bg-white text-primary shadow-sm'
                    : 'text-slate-600 hover:bg-white/70'
                }`}
              >
                <StarIcon className="h-5 w-5" />
                Quick Sale
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={posMode === 'full'}
                onClick={() => setPOSMode('full')}
                className={`min-h-12 rounded-md px-4 text-base font-black transition ${
                  posMode === 'full'
                    ? 'bg-white text-primary shadow-sm'
                    : 'text-slate-600 hover:bg-white/70'
                }`}
              >
                Full POS
              </button>
            </div>

            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                ref={productSearchRef}
                type="search"
                placeholder="Search products by name..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCurrentPage(1);
                }}
              />
            </div>

            {posMode === 'full' ? (
              <div className="custom-scrollbar flex gap-2 overflow-x-auto pb-1">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      setActiveCategory(cat);
                      setCurrentPage(1);
                    }}
                    className={`min-h-11 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-bold transition-all ${
                      activeCategory === cat
                        ? 'theme-emphasis-surface shadow-md'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div ref={productGridRef} className={`pos-product-grid custom-scrollbar grid content-start gap-3 pb-3 pr-0 md:min-h-0 md:flex-1 md:overflow-y-auto md:pr-2 ${
            posMode === 'quick'
              ? 'grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(13.5rem,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(14.5rem,1fr))]'
              : 'grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]'
          }`}>
            {visibleProducts.map((product) => {
              const selectedCartItem = cart.find((item) => item.id === product.id);
              const selectedQty = selectedCartItem?.qty || cartQtyByProductId[product.id] || 0;
              const selectedInventoryQuantity = Number(selectedCartItem?.inventory_quantity || 0);
              const isSelected = selectedQty > 0;

              return (
                <div
                  key={product.id}
                  className={`pos-product-card relative flex flex-col items-center rounded-xl border text-center transition-[border-color,box-shadow,transform] duration-200 ease-out ${posMode === 'quick' ? 'min-h-[14rem] p-4' : 'p-3'} ${
                    product.stock === 0
                      ? 'pos-product-card-disabled border-slate-200 bg-white opacity-50 grayscale shadow-none'
                      : isSelected
                        ? 'pos-product-card-selected border-primary bg-white shadow-[0_10px_24px_rgba(15,118,110,0.12)]'
                        : 'pos-product-card-idle border-slate-200 bg-white shadow-sm'
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
                  {posMode === 'quick' && !hasSearch && (
                    <div className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-700">
                      <StarIcon className="h-3.5 w-3.5" />
                      {getQuickSaleLabel(product)}
                    </div>
                  )}
                  {isSelected && (
                    <div className="pos-selected-qty absolute right-3 top-3 inline-flex min-w-[2.2rem] items-center justify-center rounded-full bg-primary px-2 py-1 text-[11px] font-semibold text-white shadow-sm">
                      {formatQuantity(selectedQty, selectedCartItem?.sale_unit || getProductBaseUnit(product), getProductUnitType(product))}
                    </div>
                  )}

                  <div
                    className={`pos-product-icon mb-2 rounded-xl ${posMode === 'quick' ? `${hasSearch ? '' : 'mt-6 '}p-3.5` : 'p-2.5'} ${
                      isSelected ? 'bg-primary/10 text-primary' : 'text-primary/80'
                    }`}
                  >
                    {(() => {
                      const ProductIcon = categoryIcon(product.category);
                      return <ProductIcon className={posMode === 'quick' ? 'h-9 w-9' : 'h-7 w-7 sm:h-8 sm:w-8'} />;
                    })()}
                  </div>

                  <div
                    className={`mb-1 w-full truncate px-1 font-semibold leading-tight text-slate-800 ${posMode === 'quick' ? 'text-base' : 'text-sm'}`}
                    title={product.name}
                  >
                    {product.name}
                  </div>
                  <div className={`font-semibold text-primary ${posMode === 'quick' ? 'text-base' : 'text-sm'}`}>{formatCurrency(product.price)}</div>

                  <div className="mt-2 flex w-full flex-wrap items-center justify-center gap-2">
                    <div
                      className={`pos-stock-chip max-w-full truncate rounded-md px-2 py-0.5 text-[10px] font-bold ${
                        isBelowMinimumStock(product)
                          ? 'bg-red-100 text-red-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {product.stock === 0 ? 'OUT OF STOCK' : `${formatProductQuantity(product)} IN STOCK`}
                    </div>

                    {isSelected && (
                      <div className="pos-selected-chip rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                        Qty {formatQuantity(selectedQty, selectedCartItem?.sale_unit || getProductBaseUnit(product), getProductUnitType(product))}
                      </div>
                    )}
                  </div>
                  </button>

                  {getProductUnitType(product) === BULK_UNIT_TYPE ? (
                    <select
                      value={bulkPortions[product.id] || getBulkPortionKey(getSelectedBulkPortion(product))}
                      onChange={(event) => setBulkPortions((current) => ({ ...current, [product.id]: event.target.value }))}
                      className="mt-3 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                      aria-label={`Portion size for ${product.name}`}
                    >
                      {getBulkSaleOptions(product).map((portion) => (
                        <option key={getBulkPortionKey(portion)} value={getBulkPortionKey(portion)}>{portion.label}</option>
                      ))}
                    </select>
                  ) : null}

                  <div className="pos-qty-stepper mt-3 flex w-full items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-1.5">
                    <button
                      type="button"
                      onClick={() => updateQty(product.id, selectedQty - getQuantityStep(product, selectedQty))}
                      disabled={selectedQty === 0}
                      className={`pos-qty-button flex shrink-0 items-center justify-center rounded-lg bg-white text-slate-500 shadow-sm transition-[background-color,color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:text-primary hover:shadow disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:bg-white disabled:hover:text-slate-500 disabled:hover:shadow-sm ${posMode === 'quick' ? 'h-12 w-12' : 'h-10 w-10'}`}
                      aria-label={`Decrease ${product.name} quantity`}
                    >
                      <MinusSmallIcon className="h-5 w-5" />
                    </button>

                    <div className="min-w-0 flex-1 text-center">
                      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                        Qty
                      </div>
                      <input
                        type="text"
                        inputMode={getProductUnitType(product) === BULK_UNIT_TYPE ? 'decimal' : 'numeric'}
                        pattern={getProductUnitType(product) === BULK_UNIT_TYPE ? '[0-9]*[.]?[0-9]*' : '[0-9]*'}
                        value={selectedQty}
                        onFocus={(event) => event.currentTarget.select()}
                        onChange={(event) => handleQuantityInputChange(product.id, event.target.value)}
                        onKeyDown={getProductUnitType(product) === BULK_UNIT_TYPE ? preventInvalidMoneyKey : preventInvalidQuantityKey}
                        aria-label={`Set ${product.name} quantity`}
                        className="pos-qty-input mx-auto block h-6 w-12 rounded-lg border border-transparent bg-transparent text-center text-base font-semibold text-slate-900 outline-none transition focus:border-primary/30 focus:bg-white focus:ring-2 focus:ring-primary/15"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => addToCart(product)}
                      disabled={product.stock === 0 || selectedInventoryQuantity + buildCartItem(product).inventory_quantity > Number(product.stock || 0) + 0.000001}
                      className={`pos-qty-button flex shrink-0 items-center justify-center rounded-lg bg-white text-slate-500 shadow-sm transition-[background-color,color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:text-primary hover:shadow disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:bg-white disabled:hover:text-slate-500 disabled:hover:shadow-sm ${posMode === 'quick' ? 'h-12 w-12' : 'h-10 w-10'}`}
                      aria-label={`Increase ${product.name} quantity`}
                    >
                      <PlusSmallIcon className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              );
            })}

            {visibleProducts.length === 0 && (
              <div className="col-span-full py-12 text-center font-medium text-slate-400">
                No products found.
              </div>
            )}
          </div>

          {posMode === 'full' && filteredProducts.length > 0 && (
            <div className="data-card flex shrink-0 flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-semibold text-slate-600">
                Showing {formatCount(pageStartCount)}-{formatCount(pageEndCount)} of {formatCount(filteredProducts.length)} products
              </div>

              {totalPages > 1 && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCurrentPage(Math.max(1, safeCurrentPage - 1))}
                    disabled={safeCurrentPage === 1}
                    aria-label="Previous product page"
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                    <span className="hidden sm:inline">Previous</span>
                  </button>

                  {pageNumbers.map((pageNumber) => (
                    <button
                      key={pageNumber}
                      type="button"
                      onClick={() => setCurrentPage(pageNumber)}
                      aria-current={pageNumber === safeCurrentPage ? 'page' : undefined}
                      className={`inline-flex h-10 min-w-10 items-center justify-center rounded-xl px-3 text-sm font-black transition ${
                        pageNumber === safeCurrentPage
                          ? 'theme-emphasis-surface'
                          : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {formatCount(pageNumber)}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => setCurrentPage(Math.min(totalPages, safeCurrentPage + 1))}
                    disabled={safeCurrentPage === totalPages}
                    aria-label="Next product page"
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="hidden sm:inline">Next</span>
                    <ChevronRightIcon className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          )}
          </div>

          <aside className="hidden" aria-hidden="true">
            <div className="pos-cart-panel sticky top-0 flex max-h-[calc(100dvh-9rem)] min-h-[28rem] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="pos-cart-header shrink-0 border-b border-slate-200 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                      Cart / Order Review
                    </div>
                    <div className="pos-cart-title mt-1 truncate text-lg font-black text-slate-900">
                      {hasCartItems ? 'Current order' : 'Pick products first'}
                    </div>
                    <div className="pos-cart-meta mt-1 text-xs font-semibold text-slate-500">
                      {hasCartItems
                        ? `${cart.length} item type${cart.length === 1 ? '' : 's'}`
                        : 'Selected products will appear here.'}
                    </div>
                  </div>

                  <div className="pos-cart-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                    <ShoppingCartIcon className="h-5 w-5" />
                  </div>
                </div>

                {hasCartItems && (
                  <button
                    type="button"
                    onClick={clearCart}
                    className="pos-cart-clear-button mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-100 px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50"
                  >
                    <TrashIcon className="h-4 w-4" />
                    Clear Order
                  </button>
                )}
              </div>

              {hasCartItems ? (
                <>
                  <div className="pos-cart-items custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50/70 p-3">
                    {cart.map((item) => (
                      <div
                        key={`cart-panel-item-${item.id}`}
                        className="pos-cart-item rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-black text-slate-900" title={item.name}>
                              {item.name}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-500">
                              <span>{item.category || 'General'}</span>
                              <span>{formatCurrency(item.price)} / {formatUnit(item.sale_unit)}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => updateQty(item.id, 0)}
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-400 transition hover:border-red-200 hover:bg-red-50 hover:text-red-500"
                            aria-label={`Remove ${item.name} from current order`}
                          >
                            <XMarkIcon className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-3">
                          <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-1">
                            <button
                              type="button"
                              onClick={() => updateQty(item.id, item.qty - getCartItemStep(item))}
                              className="flex h-9 w-9 items-center justify-center rounded-md bg-white text-slate-600 shadow-sm transition hover:text-primary"
                              aria-label={`Decrease ${item.name} quantity`}
                            >
                              <MinusSmallIcon className="h-5 w-5" />
                            </button>
                            <input
                              type="text"
                              inputMode={getProductUnitType(item) === BULK_UNIT_TYPE ? 'decimal' : 'numeric'}
                              pattern={getProductUnitType(item) === BULK_UNIT_TYPE ? '[0-9]*[.]?[0-9]*' : '[0-9]*'}
                              value={item.qty}
                              onFocus={(event) => event.currentTarget.select()}
                              onChange={(event) => handleQuantityInputChange(item.id, event.target.value)}
                              onKeyDown={getProductUnitType(item) === BULK_UNIT_TYPE ? preventInvalidMoneyKey : preventInvalidQuantityKey}
                              aria-label={`Set ${item.name} quantity`}
                              className="mx-1 h-9 w-11 rounded-md border border-transparent bg-transparent text-center text-base font-black text-slate-900 outline-none transition focus:border-primary/30 focus:bg-white focus:ring-2 focus:ring-primary/15"
                            />
                            <button
                              type="button"
                              onClick={() => updateQty(item.id, item.qty + getCartItemStep(item))}
                              disabled={!canIncreaseCartItem(item)}
                              className="flex h-9 w-9 items-center justify-center rounded-md bg-white text-slate-600 shadow-sm transition hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                              aria-label={`Increase ${item.name} quantity`}
                            >
                              <PlusSmallIcon className="h-5 w-5" />
                            </button>
                          </div>

                          <div className="text-right">
                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                              Line Total
                            </div>
                            <div className="mt-1 text-sm font-black text-slate-900">
                              {formatCurrency(item.price * item.qty)}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="pos-cart-checkout shrink-0 space-y-3 border-t border-slate-200 bg-white p-4">
                    <div className="pos-cart-cash-card rounded-lg border border-emerald-100 bg-emerald-50/80 p-3">
                      <label className="text-xs font-black text-slate-900" htmlFor="pos-desktop-cash-received">
                        Cash received
                      </label>
                      <input
                        id="pos-desktop-cash-received"
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*[.]?[0-9]*"
                        min={cartTotal}
                        step="0.01"
                        value={amountReceived}
                        onChange={handleAmountReceivedChange}
                        onKeyDown={preventInvalidMoneyKey}
                        className="mt-2 w-full rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 outline-none transition focus:border-emerald-400"
                        placeholder="0.00"
                      />

                      <div className="pos-cart-payment-grid mt-3 grid grid-cols-2 gap-2">
                        <div className="rounded-lg border border-white/70 bg-white px-3 py-2">
                          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                            Change
                          </div>
                          <div className={`mt-1 text-sm font-black ${change > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                            {formatCurrency(change)}
                          </div>
                        </div>
                        <div className="rounded-lg border border-white/70 bg-white px-3 py-2">
                          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                            Balance
                          </div>
                          <div className={`mt-1 text-sm font-black ${remainingBalance > 0 ? 'text-red-600' : 'text-slate-700'}`}>
                            {formatCurrency(remainingBalance)}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pos-cart-total-card theme-total-card rounded-lg p-4">
                      <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                        Total Due
                      </div>
                      <div className="pos-cart-total-amount mt-1 text-2xl font-black tracking-tight">
                        {formatCurrency(cartTotal)}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleCheckout}
                      disabled={isCheckoutDisabled}
                      className="pos-complete-button pos-cart-complete-button flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
                    >
                      <CheckCircleIcon className="h-5 w-5" />
                      Complete Transaction
                    </button>
                  </div>
                </>
              ) : (
                <div className="pos-cart-empty flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
                  <div className="pos-cart-empty-icon flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                    <ShoppingCartIcon className="h-7 w-7" />
                  </div>
                  <div className="mt-4 text-sm font-black uppercase tracking-[0.22em] text-slate-400">
                    Pick Products First
                  </div>
                  <p className="mt-2 max-w-[16rem] text-sm leading-6 text-slate-500">
                    Add items from the product list to start reviewing the order here.
                  </p>
                </div>
              )}
            </div>
          </aside>
        </div>

      </div>

      {showOrderModal && hasCartItems && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-md sm:items-center">
          <div className="order-review-panel relative flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-[0_30px_80px_rgba(15,23,42,0.35)] sm:h-[min(94dvh,900px)] sm:max-h-[94dvh] sm:w-[min(96vw,1200px)] sm:max-w-none sm:rounded-2xl sm:border sm:border-slate-200/80">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.18),_transparent_40%),radial-gradient(circle_at_top_left,_rgba(16,185,129,0.16),_transparent_38%)]" />

            <div className="order-review-header theme-modal-header relative shrink-0 border-b border-slate-200 px-3 pb-2.5 pt-[calc(env(safe-area-inset-top)+0.625rem)] sm:px-4 sm:py-3 lg:px-5">
              <div className="sm:hidden">
                <div className="flex items-start justify-between gap-2.5">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-100">
                      <ShoppingCartIcon className="h-3.5 w-3.5" />
                      Current Order
                    </div>
                    <h3 className="mt-1.5 text-base font-black tracking-tight">Review order</h3>
                    <p className="mt-0.5 text-xs font-semibold text-slate-300">
                      {cart.length} item type{cart.length === 1 ? '' : 's'} | {formatCurrency(cartTotal)}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={clearCart}
                      className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/10 px-2.5 py-1.5 text-xs font-bold text-white transition hover:border-white/20 hover:bg-white/15"
                    >
                      <TrashIcon className="h-4 w-4" />
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowOrderModal(false)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/10 text-white transition hover:border-white/20 hover:bg-white/15"
                      aria-label="Close order modal"
                    >
                      <XMarkIcon className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                <div className="order-summary-grid mt-2.5 grid grid-cols-2 gap-2">
                  <div className="order-summary-card rounded-xl border border-white/10 bg-white/10 px-2.5 py-2">
                    <div className="order-summary-card-label text-[9px] font-bold uppercase tracking-[0.16em] text-slate-300">
                      Items
                    </div>
                    <div className="order-summary-card-value mt-0.5 text-sm font-black">{cart.length}</div>
                  </div>
                  <div className="order-summary-card rounded-xl border border-white/10 bg-white/10 px-2.5 py-2">
                    <div className="order-summary-card-label text-[9px] font-bold uppercase tracking-[0.16em] text-slate-300">
                      Lines
                    </div>
                    <div className="order-summary-card-value mt-0.5 text-sm font-black">{cart.length}</div>
                  </div>
                  <div className="order-summary-card rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-2">
                    <div className="order-summary-card-label text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-100">
                      Total
                    </div>
                    <div className="order-summary-card-value mt-0.5 text-sm font-black">{formatCurrency(cartTotal)}</div>
                  </div>
                  <div className="order-summary-card rounded-xl border border-sky-400/20 bg-sky-400/10 px-2.5 py-2">
                    <div className="order-summary-card-label text-[9px] font-bold uppercase tracking-[0.16em] text-sky-100">
                      Change
                    </div>
                    <div className="order-summary-card-value mt-0.5 text-sm font-black">{formatCurrency(change)}</div>
                  </div>
                </div>
              </div>

              <div className="hidden sm:block">
                <div className="order-review-tablet-copy flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 max-w-3xl">
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-100">
                      <ShoppingCartIcon className="h-3.5 w-3.5" />
                      Current Order
                    </div>
                    <h3 className="order-review-title mt-1.5 text-lg font-black tracking-tight">
                      Review order before checkout
                    </h3>
                    <p className="order-review-description mt-1 text-xs leading-5 text-slate-300">
                      Check item quantities and confirm the payment details before completing this sale.
                    </p>
                  </div>

                  <div className="order-review-actions grid grid-cols-2 gap-2 sm:flex sm:flex-row">
                    <button
                      type="button"
                      onClick={clearCart}
                      className="order-action-button inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs font-bold text-white transition hover:border-white/20 hover:bg-white/15"
                    >
                      <TrashIcon className="h-4 w-4" />
                      Clear Order
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowOrderModal(false)}
                      className="order-action-button inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs font-bold text-white transition hover:border-white/20 hover:bg-white/15"
                    >
                      <XMarkIcon className="h-4 w-4" />
                      Close
                    </button>
                  </div>
                </div>

                <div className="order-summary-grid mt-3 grid grid-cols-2 gap-2">
                  <div className="order-summary-card rounded-xl border border-white/10 bg-white/10 px-3 py-2">
                    <div className="order-summary-card-label text-[10px] font-bold uppercase tracking-[0.16em] text-slate-300">
                      Items
                    </div>
                    <div className="order-summary-card-value mt-0.5 text-base font-black">{cart.length}</div>
                  </div>
                  <div className="order-summary-card rounded-xl border border-white/10 bg-white/10 px-3 py-2">
                    <div className="order-summary-card-label text-[10px] font-bold uppercase tracking-[0.16em] text-slate-300">
                      Units
                    </div>
                    <div className="order-summary-card-value mt-0.5 text-base font-black">{cart.length}</div>
                  </div>
                  <div className="order-summary-card rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2">
                    <div className="order-summary-card-label text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-100">
                      Total Due
                    </div>
                    <div className="order-summary-card-value mt-0.5 text-sm font-black sm:text-base">{formatCurrency(cartTotal)}</div>
                  </div>
                  <div className="order-summary-card rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2">
                    <div className="order-summary-card-label text-[10px] font-bold uppercase tracking-[0.16em] text-sky-100">
                      Change
                    </div>
                    <div className="order-summary-card-value mt-0.5 text-sm font-black sm:text-base">{formatCurrency(change)}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="order-review-body min-h-0 flex-1">
              <div className="order-review-body-scroll custom-scrollbar h-full overflow-y-auto overscroll-y-contain bg-slate-50 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:p-4 lg:hidden">
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
                        {cart.length} item type{cart.length === 1 ? '' : 's'}
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
                                <span>{formatCurrency(item.price)} / {formatUnit(item.sale_unit)}</span>
                                <span>{formatProductQuantity(item)} in stock</span>
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
                                onClick={() => updateQty(item.id, item.qty - getCartItemStep(item))}
                                className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 hover:text-primary"
                                aria-label={`Decrease ${item.name} quantity`}
                              >
                                <MinusSmallIcon className="h-5 w-5" />
                              </button>
                              <div className="min-w-[3rem] text-center">
                                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                                  Qty
                                </div>
                                <input
                                  type="text"
                                  inputMode={getProductUnitType(item) === BULK_UNIT_TYPE ? 'decimal' : 'numeric'}
                                  pattern={getProductUnitType(item) === BULK_UNIT_TYPE ? '[0-9]*[.]?[0-9]*' : '[0-9]*'}
                                  value={item.qty}
                                  onFocus={(event) => event.currentTarget.select()}
                                  onChange={(event) => handleQuantityInputChange(item.id, event.target.value)}
                                  onKeyDown={getProductUnitType(item) === BULK_UNIT_TYPE ? preventInvalidMoneyKey : preventInvalidQuantityKey}
                                  aria-label={`Set ${item.name} quantity`}
                                  className="mx-auto block h-7 w-14 rounded-lg border border-transparent bg-transparent text-center text-lg font-black text-slate-900 outline-none transition focus:border-primary/30 focus:bg-white focus:ring-2 focus:ring-primary/15"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => updateQty(item.id, item.qty + getCartItemStep(item))}
                                disabled={!canIncreaseCartItem(item)}
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
                      Cash is the available payment method for student canteen transactions.
                    </p>

                    <div className="mt-4 grid grid-cols-1 gap-3">
                      <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-3">
                        <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                          Payment
                        </span>
                        <div className="theme-emphasis-surface mt-2 flex items-center gap-3 rounded-2xl px-3 py-3 shadow-sm">
                          <BanknotesIcon className="h-5 w-5 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm font-black">{CASH_PAYMENT_LABEL}</div>
                            <div className="mt-0.5 text-[11px] font-semibold text-slate-300">
                              Enter the cash received below.
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                  </div>

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

                  <div className="theme-total-card rounded-[26px] p-4 shadow-xl shadow-slate-900/10">
                    <div className="flex items-end justify-between">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                          Total Due
                        </div>
                        <div className="mt-1 text-2xl font-black tracking-tight">
                          {formatCurrency(cartTotal)}
                        </div>
                      </div>
                      <div className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-slate-200">
                        {CASH_PAYMENT_LABEL}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={handleCheckout}
                      disabled={isCheckoutDisabled}
                      className="pos-complete-button flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
                    >
                      <CheckCircleIcon className="h-5 w-5" />
                      Complete Transaction
                    </button>

                    <p className="text-center text-xs font-semibold text-slate-400">
                      {remainingBalance > 0
                        ? `Waiting for ${formatCurrency(remainingBalance)} more cash.`
                        : 'Review the full order here, then finish checkout when ready.'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="hidden h-full min-h-0 lg:block">
                <div className="grid h-full min-h-0 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.9fr)]">
                <div className="custom-scrollbar min-h-[240px] bg-slate-50/80 p-4 lg:min-h-0 lg:overflow-y-auto">
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
                    {cart.length} item type{cart.length === 1 ? '' : 's'} in cart
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
                                {formatProductQuantity(item)} in stock
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
                            onClick={() => updateQty(item.id, item.qty - getCartItemStep(item))}
                            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-lg font-black text-slate-600 shadow-sm transition hover:text-primary"
                          >
                            -
                          </button>
                          <div className="min-w-[3rem] text-center">
                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                              Qty
                            </div>
                            <input
                              type="text"
                              inputMode={getProductUnitType(item) === BULK_UNIT_TYPE ? 'decimal' : 'numeric'}
                              pattern={getProductUnitType(item) === BULK_UNIT_TYPE ? '[0-9]*[.]?[0-9]*' : '[0-9]*'}
                              value={item.qty}
                              onFocus={(event) => event.currentTarget.select()}
                              onChange={(event) => handleQuantityInputChange(item.id, event.target.value)}
                              onKeyDown={getProductUnitType(item) === BULK_UNIT_TYPE ? preventInvalidMoneyKey : preventInvalidQuantityKey}
                              aria-label={`Set ${item.name} quantity`}
                              className="mx-auto block h-7 w-14 rounded-lg border border-transparent bg-transparent text-center text-lg font-black text-slate-900 outline-none transition focus:border-primary/30 focus:bg-white focus:ring-2 focus:ring-primary/15"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => updateQty(item.id, item.qty + getCartItemStep(item))}
                            disabled={!canIncreaseCartItem(item)}
                            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-lg font-black text-slate-600 shadow-sm transition hover:text-primary"
                          >
                            +
                          </button>
                        </div>

                        <div className="theme-total-card rounded-2xl px-4 py-3 text-left sm:min-w-[170px] sm:text-right">
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

              <div className="custom-scrollbar border-t border-slate-200 bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
                <div className="space-y-3">
                  <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-sm font-black text-slate-900">
                      <DocumentTextIcon className="h-5 w-5 text-slate-400" />
                      Order details
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Cash is the available payment method for student canteen transactions.
                    </p>

                    <div className="mt-4 grid grid-cols-1 gap-4">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                          Payment Method
                        </span>
                        <div className="theme-emphasis-surface mt-2 flex items-center gap-3 rounded-2xl px-3 py-3 shadow-sm">
                          <BanknotesIcon className="h-5 w-5 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm font-black">{CASH_PAYMENT_LABEL}</div>
                            <div className="mt-0.5 text-[11px] font-semibold text-slate-300">
                              Enter the cash received below.
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

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

                  <div className="rounded-[26px] bg-slate-950 p-4 text-white shadow-xl shadow-slate-900/10">
                    <div className="flex items-end justify-between">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                          Total Due
                        </div>
                        <div className="mt-1 text-3xl font-black tracking-tight">
                          {formatCurrency(cartTotal)}
                        </div>
                      </div>
                      <div className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-slate-200">
                        {CASH_PAYMENT_LABEL}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 border-t border-slate-200 pt-4">
                    <button
                      type="button"
                      onClick={handleCheckout}
                      disabled={isCheckoutDisabled}
                      className="pos-complete-button flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
                    >
                      <CheckCircleIcon className="h-5 w-5" />
                      Complete Transaction
                    </button>

                    <p className="text-center text-xs font-semibold text-slate-400">
                      {remainingBalance > 0
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
                <h2 className="text-lg font-black text-slate-900">MEALS Receipt</h2>
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
                      <span className="font-bold">{formatQuantity(item.qty, item.sale_unit, getProductUnitType(item))}</span> {item.name}
                    </span>
                    <span className="font-bold text-slate-900">
                      {formatCurrency(item.price * item.qty)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="space-y-2 border-t-2 border-dashed border-slate-200 pt-4">
                <div className="flex justify-between pt-2 text-lg">
                  <span className="font-black text-slate-900">TOTAL</span>
                  <span className="font-black text-primary">{formatCurrency(receiptData.total)}</span>
                </div>
              </div>

              <div className="mt-6 space-y-1 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-500">
                <div className="flex justify-between">
                  <span>Payment Method:</span>
                  <span className="font-bold text-slate-700">
                    {formatPaymentMethod(receiptData.payment_type)}
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
