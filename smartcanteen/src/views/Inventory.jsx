import { useCallback, useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { API } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import DismissibleAlert from '../components/DismissibleAlert';
import { Skeleton, SkeletonText } from '../components/Skeleton';
import { formatPhilippineDateTime, getPhilippineDateKey } from '../utils/dateTime';
import {
  BULK_UNIT_TYPE,
  PCS_UNIT_TYPE,
  formatProductQuantity,
  formatQuantity,
  formatUnit,
  getProductBaseUnit,
  getProductUnitType,
} from '../utils/units';
import { requestAlertRefresh } from '../services/realtimeAlerts';
import {
  ArrowDownTrayIcon,
  ArchiveBoxIcon,
  ArrowPathIcon,
  BanknotesIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
  CubeIcon,
  ExclamationTriangleIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusCircleIcon,
  PlusIcon,
  ScaleIcon,
  SparklesIcon,
  Squares2X2Icon,
  TagIcon,
  TrashIcon,
  XCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

const ITEMS_PER_PAGE = 10;
const HISTORY_ITEMS_PER_PAGE = 15;
const MAX_PAGE_BUTTONS = 5;

function formatCount(value) {
  return Number(value || 0).toLocaleString('en-PH');
}

function formatCurrency(amount) {
  return Number(amount || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function isOutOfStock(product) {
  return Number(product?.stock || 0) <= 0;
}

function isLowStock(product) {
  const stock = Number(product?.stock || 0);
  const minStock = Number(product?.min_stock || 0);
  return stock > 0 && stock <= minStock;
}

function isProductActive(product) {
  return product?.is_active !== false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stock Status Badge Component
// ─────────────────────────────────────────────────────────────────────────────
function StockStatusBadge({ product, isInactive = false }) {
  if (isInactive || !isProductActive(product)) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
        <ArchiveBoxIcon className="h-3.5 w-3.5 text-slate-400" />
        Inactive
      </span>
    );
  }

  if (isOutOfStock(product)) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-400">
        <XCircleIcon className="h-4 w-4 text-rose-600 dark:text-rose-400" />
        Out of Stock
      </span>
    );
  }

  if (isLowStock(product)) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-400">
        <ExclamationTriangleIcon className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        Low Stock
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-400">
      <CheckCircleIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
      In Stock
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pagination Controls
// ─────────────────────────────────────────────────────────────────────────────
function PaginationControls({
  currentPage,
  totalItems,
  itemsPerPage,
  onPageChange,
  label = 'items',
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  if (totalItems === 0) return null;

  const startCount = (currentPage - 1) * itemsPerPage + 1;
  const endCount = Math.min(currentPage * itemsPerPage, totalItems);

  const visibleCount = Math.min(MAX_PAGE_BUTTONS, totalPages);
  let startPage = Math.max(1, currentPage - Math.floor(visibleCount / 2));
  const endPage = Math.min(totalPages, startPage + visibleCount - 1);
  startPage = Math.max(1, endPage - visibleCount + 1);

  const pageNumbers = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i);

  return (
    <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50/70 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900/60">
      <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        Showing {formatCount(startCount)}–{formatCount(endCount)} of {formatCount(totalItems)} {label}
      </div>

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <ChevronLeftIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Prev</span>
          </button>

          {pageNumbers.map((page) => (
            <button
              key={page}
              type="button"
              onClick={() => onPageChange(page)}
              className={`inline-flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-xs font-bold shadow-2xs transition ${
                page === currentPage
                  ? 'bg-slate-900 text-white dark:bg-emerald-600 dark:text-white'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {page}
            </button>
          ))}

          <button
            type="button"
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Inventory Component
// ─────────────────────────────────────────────────────────────────────────────
export default function Inventory() {
  const location = useLocation();
  const { role } = useAuth();
  const isAdmin = ['admin', 'administrator'].includes(String(role || '').toLowerCase());
  const canManageInventory = ['admin', 'administrator', 'staff'].includes(String(role || '').toLowerCase());

  // Data states
  const [activeProducts, setActiveProducts] = useState([]);
  const [inactiveProducts, setInactiveProducts] = useState([]);
  const [historyLogs, setHistoryLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [notificationFocus, setNotificationFocus] = useState(null);

  // Active view tab: 'products' | 'alerts' | 'history' | 'inactive'
  const [activeTab, setActiveTab] = useState('products');

  // Products Tab Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [stockStatusFilter, setStockStatusFilter] = useState('All'); // 'All' | 'in_stock' | 'low_stock' | 'out_of_stock'
  const [unitTypeFilter, setUnitTypeFilter] = useState('All'); // 'All' | 'pcs' | 'bulk'
  const [sortBy, setSortBy] = useState('name_asc'); // 'name_asc' | 'name_desc' | 'stock_asc' | 'stock_desc' | 'price_asc' | 'price_desc'
  const [currentPage, setCurrentPage] = useState(1);

  // Inactive Tab Page
  const [inactivePage, setInactivePage] = useState(1);

  // History Tab Filters
  const [historySearch, setHistorySearch] = useState('');
  const [historyTypeFilter, setHistoryTypeFilter] = useState('all'); // 'all' | 'replenishment' | 'adjustment' | 'sale' | 'correction'
  const [historyPage, setHistoryPage] = useState(1);

  // Modals state
  const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
  const [productForm, setProductForm] = useState(initialProductForm());
  const [productFormError, setProductFormError] = useState('');
  const [savingProduct, setSavingProduct] = useState(false);

  // Replenish Modal state
  const [isReplenishModalOpen, setIsReplenishModalOpen] = useState(false);
  const [replenishDraft, setReplenishDraft] = useState({
    productId: '',
    quantity: '',
    date: getPhilippineDateKey(new Date()),
    remarks: '',
  });
  const [replenishError, setReplenishError] = useState('');
  const [savingReplenish, setSavingReplenish] = useState(false);

  // Adjust Modal state
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [adjustDraft, setAdjustDraft] = useState({
    productId: '',
    adjustmentType: 'deduct', // 'deduct' | 'add' | 'set'
    quantity: '',
    reason: 'Damaged',
    remarks: '',
  });
  const [adjustError, setAdjustError] = useState('');
  const [savingAdjust, setSavingAdjust] = useState(false);

  function initialProductForm() {
    return {
      id: null,
      name: '',
      category: 'General',
      price: '',
      stock: 0,
      min_stock: 5,
      unit_type: 'pcs',
      base_unit: 'pcs',
      is_favorite: false,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Fetch Products & History
  // ─────────────────────────────────────────────────────────────────────────
  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await API.getProducts(false);
      const list = Array.isArray(data) ? data : [];
      const actives = list.filter(isProductActive);
      const inactives = list.filter((p) => !isProductActive(p));

      setActiveProducts(actives);
      setInactiveProducts(inactives);
    } catch (err) {
      console.error('Failed to fetch products:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await API.getInventoryHistory({ limit: 300 });
      setHistoryLogs(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch inventory history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  useEffect(() => {
    if (activeTab === 'history') {
      fetchHistory();
    }
  }, [activeTab, fetchHistory]);

  // Handle incoming notification highlight and URL query params
  useEffect(() => {
    const alertState = location.state;
    if (alertState?.highlightProductName || alertState?.highlightProductId) {
      setNotificationFocus({
        id: alertState.highlightProductId ?? null,
        name: alertState.highlightProductName || '',
        type: alertState.notificationType || 'notification',
      });
      if (alertState.notificationType === 'low-stock') {
        setActiveTab('alerts');
      }
    } else {
      setNotificationFocus(null);
    }

    if (location.search) {
      const params = new URLSearchParams(location.search);
      const tabParam = params.get('tab');
      const actionParam = params.get('action');
      const filterParam = params.get('filter');
      const productIdParam = params.get('productId');

      if (tabParam && ['products', 'alerts', 'history', 'inactive'].includes(tabParam)) {
        setActiveTab(tabParam);
      }
      if (filterParam === 'low_stock') {
        setStockStatusFilter('low_stock');
        setActiveTab('products');
      } else if (filterParam === 'out_of_stock') {
        setStockStatusFilter('out_of_stock');
        setActiveTab('products');
      }

      if (actionParam === 'replenish') {
        setIsReplenishModalOpen(true);
        if (productIdParam) {
          setReplenishDraft((prev) => ({ ...prev, productId: productIdParam }));
        }
      } else if (actionParam === 'adjust') {
        setIsAdjustModalOpen(true);
        if (productIdParam) {
          setAdjustDraft((prev) => ({ ...prev, productId: productIdParam }));
        }
      } else if (actionParam === 'new') {
        setIsAddEditModalOpen(true);
        setProductForm(initialProductForm());
      }
    }
  }, [location.key, location.state, location.search]);

  // ─────────────────────────────────────────────────────────────────────────
  // Derived Overview Metrics
  // ─────────────────────────────────────────────────────────────────────────
  const totalProductsCount = activeProducts.length;

  const totalStockCount = useMemo(() => {
    return activeProducts.reduce((sum, p) => sum + Number(p.stock || 0), 0);
  }, [activeProducts]);

  const lowStockProducts = useMemo(() => {
    return activeProducts.filter(isLowStock);
  }, [activeProducts]);

  const outOfStockProducts = useMemo(() => {
    return activeProducts.filter(isOutOfStock);
  }, [activeProducts]);

  const allAlertProducts = useMemo(() => {
    return activeProducts.filter((p) => isOutOfStock(p) || isLowStock(p));
  }, [activeProducts]);

  const totalStockValue = useMemo(() => {
    return activeProducts.reduce((sum, p) => {
      const price = Number(p.price || 0);
      const stock = Number(p.stock || 0);
      return sum + (price * stock);
    }, 0);
  }, [activeProducts]);

  const categories = useMemo(() => {
    const all = [...activeProducts, ...inactiveProducts];
    const unique = new Set(all.map((p) => p.category).filter(Boolean));
    return ['All', ...Array.from(unique).sort((a, b) => a.localeCompare(b))];
  }, [activeProducts, inactiveProducts]);

  // ─────────────────────────────────────────────────────────────────────────
  // Filter & Sort Products
  // ─────────────────────────────────────────────────────────────────────────
  const filteredActiveProducts = useMemo(() => {
    let result = [...activeProducts];

    // Search query
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      result = result.filter((p) =>
        String(p.name || '').toLowerCase().includes(query) ||
        String(p.category || '').toLowerCase().includes(query)
      );
    }

    // Category filter
    if (categoryFilter !== 'All') {
      result = result.filter((p) => p.category === categoryFilter);
    }

    // Stock status filter
    if (stockStatusFilter === 'in_stock') {
      result = result.filter((p) => !isOutOfStock(p) && !isLowStock(p));
    } else if (stockStatusFilter === 'low_stock') {
      result = result.filter(isLowStock);
    } else if (stockStatusFilter === 'out_of_stock') {
      result = result.filter(isOutOfStock);
    }

    // Unit type filter
    if (unitTypeFilter === 'pcs') {
      result = result.filter((p) => getProductUnitType(p) === PCS_UNIT_TYPE);
    } else if (unitTypeFilter === 'bulk') {
      result = result.filter((p) => getProductUnitType(p) === BULK_UNIT_TYPE);
    }

    // Sorting
    result.sort((a, b) => {
      if (sortBy === 'name_asc') {
        return String(a.name || '').localeCompare(String(b.name || ''));
      }
      if (sortBy === 'name_desc') {
        return String(b.name || '').localeCompare(String(a.name || ''));
      }
      if (sortBy === 'stock_asc') {
        return Number(a.stock || 0) - Number(b.stock || 0);
      }
      if (sortBy === 'stock_desc') {
        return Number(b.stock || 0) - Number(a.stock || 0);
      }
      if (sortBy === 'price_asc') {
        return Number(a.price || 0) - Number(b.price || 0);
      }
      if (sortBy === 'price_desc') {
        return Number(b.price || 0) - Number(a.price || 0);
      }
      return 0;
    });

    // If there is an alert focus, put it first
    if (notificationFocus) {
      result.sort((a, b) => {
        const aMatch = String(a.id) === String(notificationFocus.id) || a.name.toLowerCase() === notificationFocus.name.toLowerCase();
        const bMatch = String(b.id) === String(notificationFocus.id) || b.name.toLowerCase() === notificationFocus.name.toLowerCase();
        if (aMatch && !bMatch) return -1;
        if (!aMatch && bMatch) return 1;
        return 0;
      });
    }

    return result;
  }, [activeProducts, searchQuery, categoryFilter, stockStatusFilter, unitTypeFilter, sortBy, notificationFocus]);

  const paginatedActiveProducts = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredActiveProducts.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredActiveProducts, currentPage]);

  const paginatedInactiveProducts = useMemo(() => {
    const start = (inactivePage - 1) * ITEMS_PER_PAGE;
    return inactiveProducts.slice(start, start + ITEMS_PER_PAGE);
  }, [inactiveProducts, inactivePage]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, categoryFilter, stockStatusFilter, unitTypeFilter, sortBy]);

  // ─────────────────────────────────────────────────────────────────────────
  // History Filter
  // ─────────────────────────────────────────────────────────────────────────
  const filteredHistoryLogs = useMemo(() => {
    let result = [...historyLogs];
    if (historySearch.trim()) {
      const q = historySearch.trim().toLowerCase();
      result = result.filter((log) =>
        String(log.product_name || '').toLowerCase().includes(q) ||
        String(log.reason || '').toLowerCase().includes(q) ||
        String(log.remarks || '').toLowerCase().includes(q) ||
        String(log.user_name || '').toLowerCase().includes(q)
      );
    }
    if (historyTypeFilter !== 'all') {
      result = result.filter((log) => String(log.movement_type || '').toLowerCase() === historyTypeFilter);
    }
    return result;
  }, [historyLogs, historySearch, historyTypeFilter]);

  const paginatedHistoryLogs = useMemo(() => {
    const start = (historyPage - 1) * HISTORY_ITEMS_PER_PAGE;
    return filteredHistoryLogs.slice(start, start + HISTORY_ITEMS_PER_PAGE);
  }, [filteredHistoryLogs, historyPage]);

  useEffect(() => {
    setHistoryPage(1);
  }, [historySearch, historyTypeFilter]);

  // ─────────────────────────────────────────────────────────────────────────
  // Handlers for Add / Edit Product
  // ─────────────────────────────────────────────────────────────────────────
  const handleOpenAdd = () => {
    setProductForm(initialProductForm());
    setProductFormError('');
    setIsAddEditModalOpen(true);
  };

  const handleOpenEdit = (product) => {
    setProductForm({
      id: product.id,
      name: product.name || '',
      category: product.category || 'General',
      price: product.price ?? '',
      stock: product.stock ?? 0,
      min_stock: product.min_stock ?? 5,
      unit_type: getProductUnitType(product),
      base_unit: getProductBaseUnit(product),
      is_favorite: Boolean(product.is_favorite),
    });
    setProductFormError('');
    setIsAddEditModalOpen(true);
  };

  const handleSaveProduct = async (e) => {
    e.preventDefault();
    setProductFormError('');
    setSavingProduct(true);

    try {
      const isBulk = productForm.unit_type === BULK_UNIT_TYPE;
      const baseUnit = isBulk ? (productForm.base_unit || 'kg') : 'pcs';
      const stock = Number(productForm.stock);
      const minStock = Number(productForm.min_stock);
      const price = parseFloat(productForm.price);

      if (!productForm.name.trim()) {
        setProductFormError('Product name is required.');
        setSavingProduct(false);
        return;
      }

      if (!Number.isFinite(price) || price < 0) {
        setProductFormError('Price must be a valid positive number.');
        setSavingProduct(false);
        return;
      }

      if (!Number.isFinite(stock) || stock < 0) {
        setProductFormError('Current stock cannot be negative.');
        setSavingProduct(false);
        return;
      }

      if (!Number.isFinite(minStock) || minStock < 0) {
        setProductFormError('Minimum alert stock cannot be negative.');
        setSavingProduct(false);
        return;
      }

      if (!isBulk && (!Number.isInteger(stock) || !Number.isInteger(minStock))) {
        setProductFormError('PCS items must use whole-number values for stock and reorder alert.');
        setSavingProduct(false);
        return;
      }

      const payload = {
        name: productForm.name.trim(),
        category: productForm.category,
        price,
        stock: isBulk ? parseFloat(stock.toFixed(4)) : Math.round(stock),
        min_stock: isBulk ? parseFloat(minStock.toFixed(4)) : Math.round(minStock),
        unit_type: isBulk ? BULK_UNIT_TYPE : PCS_UNIT_TYPE,
        base_unit: baseUnit,
        is_favorite: Boolean(productForm.is_favorite),
      };

      if (productForm.id) {
        await API.updateProduct(productForm.id, payload);
        window.showToast?.('Product updated successfully!', 'success');
      } else {
        await API.createProduct(payload);
        window.showToast?.('Product added successfully!', 'success');
      }

      setIsAddEditModalOpen(false);
      requestAlertRefresh({ source: 'inventory', reason: 'product-saved' });
      fetchProducts();
      if (activeTab === 'history') fetchHistory();
    } catch (err) {
      setProductFormError(err.message || 'Failed to save product.');
    } finally {
      setSavingProduct(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Handlers for Stock Replenishment
  // ─────────────────────────────────────────────────────────────────────────
  const handleOpenReplenish = (product = null) => {
    setReplenishDraft({
      productId: product ? String(product.id) : (activeProducts[0] ? String(activeProducts[0].id) : ''),
      quantity: '',
      date: getPhilippineDateKey(new Date()),
      remarks: '',
    });
    setReplenishError('');
    setIsReplenishModalOpen(true);
  };

  const handleSaveReplenish = async (e) => {
    e.preventDefault();
    setReplenishError('');
    setSavingReplenish(true);

    try {
      const pId = Number(replenishDraft.productId);
      const qty = Number(replenishDraft.quantity);

      if (!pId) {
        setReplenishError('Please select a product to replenish.');
        setSavingReplenish(false);
        return;
      }

      if (!Number.isFinite(qty) || qty <= 0) {
        setReplenishError('Please enter a valid quantity greater than 0.');
        setSavingReplenish(false);
        return;
      }

      const targetProduct = activeProducts.find((p) => p.id === pId);
      const isBulk = getProductUnitType(targetProduct) === BULK_UNIT_TYPE;
      if (!isBulk && !Number.isInteger(qty)) {
        setReplenishError('PCS items must be replenished in whole numbers.');
        setSavingReplenish(false);
        return;
      }

      await API.replenishInventory({
        product_id: pId,
        quantity: qty,
        date: replenishDraft.date || undefined,
        remarks: replenishDraft.remarks || undefined,
      });

      window.showToast?.(`Stock replenished for ${targetProduct?.name || 'product'}!`, 'success');
      setIsReplenishModalOpen(false);
      requestAlertRefresh({ source: 'inventory', reason: 'replenished' });
      fetchProducts();
      if (activeTab === 'history') fetchHistory();
    } catch (err) {
      setReplenishError(err.message || 'Failed to replenish stock.');
    } finally {
      setSavingReplenish(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Handlers for Stock Adjustment
  // ─────────────────────────────────────────────────────────────────────────
  const handleOpenAdjust = (product = null) => {
    setAdjustDraft({
      productId: product ? String(product.id) : (activeProducts[0] ? String(activeProducts[0].id) : ''),
      adjustmentType: 'deduct',
      quantity: '',
      reason: 'Damaged',
      remarks: '',
    });
    setAdjustError('');
    setIsAdjustModalOpen(true);
  };

  const handleSaveAdjust = async (e) => {
    e.preventDefault();
    setAdjustError('');
    setSavingAdjust(true);

    try {
      const pId = Number(adjustDraft.productId);
      const qty = Number(adjustDraft.quantity);

      if (!pId) {
        setAdjustError('Please select a product to adjust.');
        setSavingAdjust(false);
        return;
      }

      if (!Number.isFinite(qty) || qty < 0) {
        setAdjustError('Please enter a valid non-negative adjustment quantity.');
        setSavingAdjust(false);
        return;
      }

      const targetProduct = activeProducts.find((p) => p.id === pId);
      const isBulk = getProductUnitType(targetProduct) === BULK_UNIT_TYPE;
      if (!isBulk && !Number.isInteger(qty)) {
        setAdjustError('PCS items must use whole-number values.');
        setSavingAdjust(false);
        return;
      }

      await API.adjustInventory({
        product_id: pId,
        adjustment_type: adjustDraft.adjustmentType,
        quantity: qty,
        reason: adjustDraft.reason,
        remarks: adjustDraft.remarks || undefined,
      });

      window.showToast?.(`Stock adjustment recorded for ${targetProduct?.name || 'product'}!`, 'success');
      setIsAdjustModalOpen(false);
      requestAlertRefresh({ source: 'inventory', reason: 'adjusted' });
      fetchProducts();
      if (activeTab === 'history') fetchHistory();
    } catch (err) {
      setAdjustError(err.message || 'Failed to adjust stock.');
    } finally {
      setSavingAdjust(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Deactivate & Restore Handlers (Admin Only)
  // ─────────────────────────────────────────────────────────────────────────
  const handleDeactivate = async (product) => {
    if (!window.confirm(`Are you sure you want to deactivate "${product.name}"? It will be moved to Archived.`)) return;
    try {
      await API.deleteProduct(product.id);
      window.showToast?.(`"${product.name}" moved to Archived.`, 'success');
      requestAlertRefresh({ source: 'inventory', reason: 'product-deactivated' });
      fetchProducts();
    } catch {
      window.showToast?.('Failed to deactivate product.', 'error');
    }
  };

  const handleRestore = async (product) => {
    try {
      await API.updateProduct(product.id, { is_active: true });
      window.showToast?.(`"${product.name}" restored to Active Inventory!`, 'success');
      requestAlertRefresh({ source: 'inventory', reason: 'product-restored' });
      fetchProducts();
    } catch {
      window.showToast?.('Failed to restore product.', 'error');
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Export CSV Report
  // ─────────────────────────────────────────────────────────────────────────
  const handleExportCSV = () => {
    const all = [...activeProducts, ...inactiveProducts];
    const headers = [
      'Product Name',
      'Category',
      'Unit Type',
      'Unit',
      'Current Stock',
      'Reorder Level',
      'Price (PHP)',
      'Total Value (PHP)',
      'Status',
    ];
    const rows = [headers.join(',')];

    all.forEach((p) => {
      const price = Number(p.price || 0);
      const stock = Number(p.stock || 0);
      const value = price * stock;
      const status = !isProductActive(p)
        ? 'Inactive'
        : isOutOfStock(p)
        ? 'Out of Stock'
        : isLowStock(p)
        ? 'Low Stock'
        : 'In Stock';

      rows.push([
        `"${String(p.name || '').replace(/"/g, '""')}"`,
        `"${String(p.category || '').replace(/"/g, '""')}"`,
        getProductUnitType(p).toUpperCase(),
        formatUnit(getProductBaseUnit(p)),
        stock,
        p.min_stock,
        price.toFixed(2),
        value.toFixed(2),
        status,
      ].join(','));
    });

    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SmartCanteen_Inventory_${getPhilippineDateKey(new Date())}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Selected product helper for modals
  const selectedReplenishProduct = useMemo(() => {
    return activeProducts.find((p) => String(p.id) === String(replenishDraft.productId));
  }, [activeProducts, replenishDraft.productId]);

  const selectedAdjustProduct = useMemo(() => {
    return activeProducts.find((p) => String(p.id) === String(adjustDraft.productId));
  }, [activeProducts, adjustDraft.productId]);

  return (
    <div className="view-shell custom-scrollbar gap-6 sm:gap-7">
      {/* ─────────────────────────────────────────────────────────────────────
          PAGE HEADER
      ─────────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <CubeIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            Canteen Supplies & Food
          </div>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900 dark:text-white sm:text-3xl">
            Inventory & Stock
          </h1>
          <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">
            Track available food and drinks, add new deliveries, record damaged items, and check restock history.
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          {canManageInventory && (
            <>
              {isAdmin && (
                <button
                  type="button"
                  onClick={handleOpenAdd}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white shadow-xs transition hover:bg-emerald-700 active:scale-95"
                >
                  <PlusIcon className="h-4 w-4 stroke-[2.5]" />
                  + New Product
                </button>
              )}

              <button
                type="button"
                onClick={() => handleOpenReplenish()}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <PlusCircleIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400 stroke-[2.5]" />
                + Add Stock
              </button>

              <button
                type="button"
                onClick={() => handleOpenAdjust()}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <ScaleIcon className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                Adjust Stock
              </button>
            </>
          )}

          <button
            type="button"
            onClick={handleExportCSV}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            title="Download full inventory Excel/CSV spreadsheet"
          >
            <ArrowDownTrayIcon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
            <span className="hidden md:inline">Download Spreadsheet</span>
          </button>
        </div>
      </div>

      {/* Notification Banner if navigated from an alert */}
      {notificationFocus && (
        <DismissibleAlert
          resetKey={location.key}
          tone="sky"
          title={notificationFocus.type === 'low-stock' ? 'Low-Stock Focus Activated' : 'Product Highlighted'}
          className="rounded-2xl border-sky-300 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/40"
        >
          <span className="font-bold text-sky-950 dark:text-sky-200">{notificationFocus.name || 'Selected product'}</span> is highlighted below. Click "+ Add Stock" to quickly add stock.
        </DismissibleAlert>
      )}

      {/* ─────────────────────────────────────────────────────────────────────
          1. INVENTORY OVERVIEW SUMMARY CARDS (Balanced 60-30-10 Color Theory)
      ─────────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {/* Total Products */}
        <div className="flex items-start justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs transition-all dark:border-slate-800 dark:bg-slate-900">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Total Products
            </div>
            <div className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              {loading ? <Skeleton className="h-7 w-16" /> : formatCount(totalProductsCount)}
            </div>
            <p className="mt-1 text-xs font-medium text-slate-400 dark:text-slate-500">
              Items in catalog
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-400">
            <CubeIcon className="h-5 w-5 stroke-[2]" />
          </div>
        </div>

        {/* Total Stock */}
        <div className="flex items-start justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs transition-all dark:border-slate-800 dark:bg-slate-900">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Total Stock
            </div>
            <div className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              {loading ? <Skeleton className="h-7 w-20" /> : `${formatCount(totalStockCount)}`}
            </div>
            <p className="mt-1 text-xs font-medium text-slate-400 dark:text-slate-500">
              Physical units in canteen
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-sky-100 bg-sky-50 text-sky-600 dark:border-sky-900/60 dark:bg-sky-950/60 dark:text-sky-400">
            <ClipboardDocumentCheckIcon className="h-5 w-5 stroke-[2]" />
          </div>
        </div>

        {/* Low Stock */}
        <div
          onClick={() => setActiveTab('alerts')}
          className="flex cursor-pointer items-start justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs transition-all hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
        >
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Low Stock
            </div>
            <div className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              {loading ? (
                <Skeleton className="h-7 w-12" />
              ) : (
                <span className={lowStockProducts.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}>
                  {formatCount(lowStockProducts.length)}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs font-medium text-slate-400 dark:text-slate-500">
              {lowStockProducts.length > 0 ? `${lowStockProducts.length} items need refill soon` : 'All items well-stocked'}
            </p>
          </div>
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-xl border ${
              lowStockProducts.length > 0
                ? 'border-amber-200/80 bg-amber-50 text-amber-600 dark:border-amber-800/60 dark:bg-amber-950/60 dark:text-amber-400'
                : 'border-slate-200/60 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
            }`}
          >
            <ExclamationTriangleIcon className="h-5 w-5 stroke-[2]" />
          </div>
        </div>

        {/* Out of Stock */}
        <div
          onClick={() => setActiveTab('alerts')}
          className="flex cursor-pointer items-start justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs transition-all hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
        >
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Sold Out
            </div>
            <div className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              {loading ? (
                <Skeleton className="h-7 w-12" />
              ) : (
                <span className={outOfStockProducts.length > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}>
                  {formatCount(outOfStockProducts.length)}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs font-medium text-slate-400 dark:text-slate-500">
              {outOfStockProducts.length > 0 ? `${outOfStockProducts.length} items out of stock` : 'No sold out items'}
            </p>
          </div>
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-xl border ${
              outOfStockProducts.length > 0
                ? 'border-rose-200/80 bg-rose-50 text-rose-600 dark:border-rose-800/60 dark:bg-rose-950/60 dark:text-rose-400'
                : 'border-slate-200/60 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
            }`}
          >
            <XCircleIcon className="h-5 w-5 stroke-[2]" />
          </div>
        </div>

        {/* Stock Value */}
        <div className="flex items-start justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs transition-all dark:border-slate-800 dark:bg-slate-900">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Stock Value
            </div>
            <div className="mt-2 text-2xl font-black tracking-tight text-emerald-600 dark:text-emerald-400">
              {loading ? <Skeleton className="h-7 w-24" /> : `₱${formatCurrency(totalStockValue)}`}
            </div>
            <p className="mt-1 text-xs font-medium text-slate-400 dark:text-slate-500">
              Total inventory value
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-400">
            <BanknotesIcon className="h-5 w-5 stroke-[2]" />
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────
          SEGMENTED NAVIGATION TABS (Clean, Unified Container)
      ─────────────────────────────────────────────────────────────────────── */}
      <div className="inline-flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200/80 bg-slate-100/90 p-1.5 dark:border-slate-800 dark:bg-slate-800/80">
        <button
          type="button"
          onClick={() => setActiveTab('products')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
            activeTab === 'products'
              ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
              : 'text-slate-600 hover:bg-white/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white'
          }`}
        >
          <CubeIcon className="h-4 w-4" />
          All Products
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
            activeTab === 'products'
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
              : 'bg-slate-200/70 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
          }`}>
            {formatCount(activeProducts.length)}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('alerts')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
            activeTab === 'alerts'
              ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
              : 'text-slate-600 hover:bg-white/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white'
          }`}
        >
          <ExclamationTriangleIcon className="h-4 w-4 text-amber-500" />
          Low Stock Items
          {allAlertProducts.length > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              {allAlertProducts.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
            activeTab === 'history'
              ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
              : 'text-slate-600 hover:bg-white/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white'
          }`}
        >
          <ClockIcon className="h-4 w-4 text-sky-500" />
          Stock History & Logs
        </button>

        {isAdmin && inactiveProducts.length > 0 && (
          <button
            type="button"
            onClick={() => setActiveTab('inactive')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
              activeTab === 'inactive'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                : 'text-slate-600 hover:bg-white/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white'
            }`}
          >
            <ArchiveBoxIcon className="h-4 w-4 text-slate-400" />
            Archived Items ({inactiveProducts.length})
          </button>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────────────
          TAB 1: PRODUCT CATALOG & LIST
      ─────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'products' && (
        <div className="space-y-4">
          {/* 2. PRODUCT SEARCH AND FILTERS TOOLBAR */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              {/* Search Product (Prominent & Clean) */}
              <div className="relative flex-1">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search food or drink (e.g. Arroz Caldo, Juice)..."
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pl-10 pr-9 text-sm font-medium text-slate-900 placeholder:text-slate-400 transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Filter Controls Group */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:flex xl:items-center">
                {/* Category Filter */}
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="h-11 w-full min-w-0 xl:w-auto xl:min-w-[140px] rounded-xl border border-slate-200 bg-slate-50/50 px-3 text-xs font-bold text-slate-700 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat === 'All' ? 'All Categories' : cat}
                    </option>
                  ))}
                </select>

                {/* Stock Status Filter */}
                <select
                  value={stockStatusFilter}
                  onChange={(e) => setStockStatusFilter(e.target.value)}
                  className="h-11 w-full min-w-0 xl:w-auto xl:min-w-[130px] rounded-xl border border-slate-200 bg-slate-50/50 px-3 text-xs font-bold text-slate-700 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <option value="All">All Stock Status</option>
                  <option value="in_stock">In Stock</option>
                  <option value="low_stock">Low Stock</option>
                  <option value="out_of_stock">Out of Stock</option>
                </select>

                {/* Unit Type Filter */}
                <select
                  value={unitTypeFilter}
                  onChange={(e) => setUnitTypeFilter(e.target.value)}
                  className="h-11 w-full min-w-0 xl:w-auto xl:min-w-[120px] rounded-xl border border-slate-200 bg-slate-50/50 px-3 text-xs font-bold text-slate-700 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <option value="All">All Units</option>
                  <option value="pcs">Pieces (PCS)</option>
                  <option value="bulk">Bulk (Weight/Vol)</option>
                </select>

                {/* Sort Option */}
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="h-11 w-full min-w-0 xl:w-auto xl:min-w-[135px] rounded-xl border border-slate-200 bg-slate-50/50 px-3 text-xs font-bold text-slate-700 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <option value="name_asc">Name (A to Z)</option>
                  <option value="name_desc">Name (Z to A)</option>
                  <option value="stock_asc">Stock (Low → High)</option>
                  <option value="stock_desc">Stock (High → Low)</option>
                  <option value="price_asc">Price (Low → High)</option>
                  <option value="price_desc">Price (High → Low)</option>
                </select>
              </div>
            </div>
          </div>

          {/* 3. PRODUCT LIST TABLE */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[750px] text-left text-sm">
                <thead className="border-b border-slate-200/80 bg-slate-50/80 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
                  <tr>
                    <th className="px-5 py-3.5">Product Name</th>
                    <th className="px-4 py-3.5">Category</th>
                    <th className="px-4 py-3.5 text-right">Available Stock</th>
                    <th className="px-4 py-3.5">Unit</th>
                    <th className="px-4 py-3.5">Status</th>
                    <th className="px-4 py-3.5 text-right">Selling Price</th>
                    <th className="px-5 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                  {loading ? (
                    Array.from({ length: 5 }, (_, i) => (
                      <tr key={`skeleton-${i}`}>
                        <td className="px-5 py-4"><Skeleton className="h-4 w-40" /></td>
                        <td className="px-4 py-4"><Skeleton className="h-6 w-20 rounded-full" /></td>
                        <td className="px-4 py-4 text-right"><Skeleton className="ml-auto h-5 w-16" /></td>
                        <td className="px-4 py-4"><Skeleton className="h-4 w-12" /></td>
                        <td className="px-4 py-4"><Skeleton className="h-6 w-24 rounded-full" /></td>
                        <td className="px-4 py-4 text-right"><Skeleton className="ml-auto h-4 w-16" /></td>
                        <td className="px-5 py-4 text-right"><Skeleton className="ml-auto h-8 w-28 rounded-lg" /></td>
                      </tr>
                    ))
                  ) : paginatedActiveProducts.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center">
                        <CubeIcon className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
                        <div className="mt-2 text-base font-bold text-slate-700 dark:text-slate-300">
                          No products found
                        </div>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Try adjusting your search query or filters.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    paginatedActiveProducts.map((product) => {
                      const isHighlighted = notificationFocus && (String(product.id) === String(notificationFocus.id) || product.name.toLowerCase() === notificationFocus.name.toLowerCase());
                      const outOfStock = isOutOfStock(product);
                      const lowStock = isLowStock(product);

                      return (
                        <tr
                          key={product.id}
                          className={`transition hover:bg-slate-50/70 dark:hover:bg-slate-800/50 ${
                            isHighlighted
                              ? 'bg-sky-50/80 ring-2 ring-inset ring-sky-300 dark:bg-sky-950/40 dark:ring-sky-700'
                              : outOfStock
                              ? 'bg-rose-50/20 dark:bg-rose-950/10'
                              : lowStock
                              ? 'bg-amber-50/20 dark:bg-amber-950/10'
                              : ''
                          }`}
                        >
                          {/* Product Name */}
                          <td className="px-5 py-4 font-semibold text-slate-900 dark:text-white">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-slate-900 dark:text-white">
                                {product.name}
                              </span>
                              {product.is_favorite && (
                                <span title="Pinned to Quick Sale" className="inline-flex rounded-full bg-amber-50 p-1 text-amber-600 border border-amber-200/60 dark:bg-amber-950 dark:text-amber-400">
                                  <SparklesIcon className="h-3.5 w-3.5" />
                                </span>
                              )}
                            </div>
                            {lowStock && (
                              <div className="mt-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                                Reorder Level: {formatQuantity(product.min_stock, getProductBaseUnit(product), getProductUnitType(product))}
                              </div>
                            )}
                          </td>

                          {/* Category */}
                          <td className="px-4 py-4">
                            <span className="inline-flex rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              {product.category || 'General'}
                            </span>
                          </td>

                          {/* Stock (Large, clear number) */}
                          <td className="px-4 py-4 text-right">
                            <span
                              className={`text-sm font-black ${
                                outOfStock
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : lowStock
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-slate-900 dark:text-white'
                              }`}
                            >
                              {formatCount(product.stock)}
                            </span>
                          </td>

                          {/* Unit */}
                          <td className="px-4 py-4 text-xs font-bold uppercase text-slate-500 dark:text-slate-400">
                            {formatUnit(getProductBaseUnit(product))}
                          </td>

                          {/* Status */}
                          <td className="px-4 py-4">
                            <StockStatusBadge product={product} />
                          </td>

                          {/* Price */}
                          <td className="px-4 py-4 text-right text-sm font-black text-slate-900 dark:text-slate-100">
                            ₱{Number(product.price || 0).toFixed(2)}
                          </td>

                          {/* Actions */}
                          <td className="px-5 py-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {canManageInventory && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenReplenish(product)}
                                    title="Add stock / delivery for this product"
                                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-700 shadow-2xs transition hover:bg-emerald-100 active:scale-95 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                                  >
                                    <PlusCircleIcon className="h-3.5 w-3.5" />
                                    + Add Stock
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => handleOpenAdjust(product)}
                                    title="Record damage, spoilage, or recount"
                                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                                  >
                                    <ScaleIcon className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                                    Adjust
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => handleOpenEdit(product)}
                                    title="Edit product details"
                                    className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-white"
                                  >
                                    <PencilSquareIcon className="h-4 w-4" />
                                  </button>
                                </>
                              )}

                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => handleDeactivate(product)}
                                  title="Hide/Archive product"
                                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                                >
                                  <TrashIcon className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <PaginationControls
              currentPage={currentPage}
              totalItems={filteredActiveProducts.length}
              itemsPerPage={ITEMS_PER_PAGE}
              onPageChange={setCurrentPage}
              label="products"
            />
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────
          TAB 2: LOW STOCK ALERTS VIEW (Clean, Harmonic Design)
      ─────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'alerts' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-200/80 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/60 dark:text-amber-300">
                <ExclamationTriangleIcon className="h-5 w-5 stroke-[2]" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Items That Need Restocking Soon
                </h3>
                <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                  These items are running low or completely empty. Click "+ Add Stock Now" when deliveries arrive.
                </p>
              </div>
            </div>

            <div className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/50 dark:text-amber-300">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              {allAlertProducts.length} items running low
            </div>
          </div>

          {allAlertProducts.length === 0 ? (
            <div className="rounded-2xl border border-slate-200/90 bg-white p-12 text-center shadow-2xs dark:border-slate-800 dark:bg-slate-900">
              <CheckCircleIcon className="mx-auto h-12 w-12 text-emerald-500" />
              <h3 className="mt-3 text-lg font-bold text-slate-900 dark:text-white">All Supplies Well-Stocked!</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                There are currently no food or drink items running low.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {allAlertProducts.map((product) => {
                const outOfStock = isOutOfStock(product);
                const currentStock = Number(product.stock || 0);
                const minStock = Number(product.min_stock || 0);
                const deficit = Math.max(0, minStock - currentStock);

                return (
                  <div
                    key={product.id}
                    className="flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <span className="rounded-md border border-slate-200/80 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {product.category || 'General'}
                        </span>
                        <StockStatusBadge product={product} />
                      </div>

                      <h4 className="mt-3 text-lg font-bold text-slate-900 dark:text-white">
                        {product.name}
                      </h4>

                      <div className="mt-4 space-y-2 rounded-xl border border-slate-100 bg-slate-50/80 p-3.5 text-xs dark:border-slate-800 dark:bg-slate-800/60">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-500 dark:text-slate-400">Available Stock:</span>
                          <span className={`font-black text-sm ${outOfStock ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`}>
                            {formatProductQuantity(product)} remaining
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-500 dark:text-slate-400">Restock Warning At:</span>
                          <span className="font-bold text-slate-700 dark:text-slate-300">
                            {formatQuantity(product.min_stock, getProductBaseUnit(product), getProductUnitType(product))}
                          </span>
                        </div>
                        {deficit > 0 && (
                          <div className="flex items-center justify-between border-t border-slate-200/60 pt-2 dark:border-slate-700">
                            <span className="font-semibold text-slate-500 dark:text-slate-400">Recommended Order:</span>
                            <span className="font-black text-rose-600 dark:text-rose-400">
                              Needs at least +{formatQuantity(deficit, getProductBaseUnit(product), getProductUnitType(product))}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-5 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpenReplenish(product)}
                        className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95"
                      >
                        <PlusCircleIcon className="h-4 w-4 stroke-[2.5]" />
                        + Add Stock Now
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenAdjust(product)}
                        className="flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        title="Adjust Stock"
                      >
                        <ScaleIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────
          TAB 3: INVENTORY MOVEMENT HISTORY
      ─────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          {/* History Filters */}
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 sm:max-w-md">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Search history by product or reason..."
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-10 pr-4 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Filter:</span>
              {[
                { key: 'all', label: 'All Logs' },
                { key: 'replenishment', label: 'Stock Deliveries' },
                { key: 'adjustment', label: 'Damage / Adjustments' },
                { key: 'sale', label: 'Canteen Sales' },
                { key: 'correction', label: 'Manual Corrections' },
              ].map((btn) => (
                <button
                  key={btn.key}
                  type="button"
                  onClick={() => setHistoryTypeFilter(btn.key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    historyTypeFilter === btn.key
                      ? 'bg-emerald-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {btn.label}
                </button>
              ))}

              <button
                type="button"
                onClick={fetchHistory}
                className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                title="Refresh history"
              >
                <ArrowPathIcon className={`h-4 w-4 ${historyLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* History Table */}
          <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[750px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
                  <tr>
                    <th className="px-5 py-3.5">Date & Time</th>
                    <th className="px-4 py-3.5">Product Name</th>
                    <th className="px-4 py-3.5">Action / Event</th>
                    <th className="px-4 py-3.5 text-right">Quantity Changed</th>
                    <th className="px-4 py-3.5 text-center">Stock: Before → After</th>
                    <th className="px-4 py-3.5">Staff Member</th>
                    <th className="px-5 py-3.5">Reason / Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                  {historyLoading ? (
                    Array.from({ length: 5 }, (_, i) => (
                      <tr key={`h-skeleton-${i}`}>
                        <td className="px-5 py-4"><Skeleton className="h-4 w-28" /></td>
                        <td className="px-4 py-4"><Skeleton className="h-4 w-36" /></td>
                        <td className="px-4 py-4"><Skeleton className="h-6 w-24 rounded-full" /></td>
                        <td className="px-4 py-4 text-right"><Skeleton className="ml-auto h-4 w-16" /></td>
                        <td className="px-4 py-4 text-center"><Skeleton className="mx-auto h-4 w-20" /></td>
                        <td className="px-4 py-4"><Skeleton className="h-4 w-20" /></td>
                        <td className="px-5 py-4"><Skeleton className="h-4 w-40" /></td>
                      </tr>
                    ))
                  ) : paginatedHistoryLogs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                        <ClockIcon className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
                        <div className="mt-2 text-base font-bold text-slate-700 dark:text-slate-300">
                          No history records found
                        </div>
                        <p className="mt-1 text-xs">
                          Incoming deliveries, damage adjustments, and canteen sales will appear here automatically.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    paginatedHistoryLogs.map((log) => {
                      const isPositive = Number(log.quantity) > 0;
                      const movementType = String(log.movement_type || '').toLowerCase();

                      const typeColor = {
                        replenishment: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
                        adjustment: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
                        sale: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
                        correction: 'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-300',
                      }[movementType] || 'border-slate-200 bg-slate-100 text-slate-700';

                      const typeLabel = {
                        replenishment: 'Stock Delivery',
                        adjustment: 'Stock Adjustment',
                        sale: 'Canteen Sale',
                        correction: 'Product Edit',
                      }[movementType] || log.movement_type;

                      return (
                        <tr key={log.id} className="transition hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                          {/* Date & Time */}
                          <td className="px-5 py-4 font-mono text-xs text-slate-600 dark:text-slate-400">
                            {formatPhilippineDateTime(log.created_at)}
                          </td>

                          {/* Product */}
                          <td className="px-4 py-4 font-bold text-slate-900 dark:text-white">
                            {log.product_name || `Product #${log.product_id}`}
                          </td>

                          {/* Transaction Type */}
                          <td className="px-4 py-4">
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${typeColor}`}>
                              {typeLabel}
                            </span>
                          </td>

                          {/* Quantity */}
                          <td className="px-4 py-4 text-right font-mono font-bold">
                            <span className={isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                              {isPositive ? `+${log.quantity}` : log.quantity} {formatUnit(log.base_unit || 'pcs')}
                            </span>
                          </td>

                          {/* Previous -> New */}
                          <td className="px-4 py-4 text-center font-mono text-xs text-slate-500 dark:text-slate-400">
                            <span className="font-semibold text-slate-700 dark:text-slate-300">{log.previous_stock}</span>
                            {' → '}
                            <span className="font-bold text-slate-900 dark:text-white">{log.new_stock}</span>
                          </td>

                          {/* User */}
                          <td className="px-4 py-4 text-xs font-semibold text-slate-700 dark:text-slate-300">
                            {log.user_name || 'System'}
                          </td>

                          {/* Remarks */}
                          <td className="px-5 py-4 text-xs text-slate-600 dark:text-slate-400">
                            <span className="font-semibold text-slate-900 dark:text-slate-200">{log.reason}</span>
                            {log.remarks && log.remarks !== log.reason && (
                              <span className="block text-[11px] text-slate-400 dark:text-slate-500">
                                {log.remarks}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <PaginationControls
              currentPage={historyPage}
              totalItems={filteredHistoryLogs.length}
              itemsPerPage={HISTORY_ITEMS_PER_PAGE}
              onPageChange={setHistoryPage}
              label="movements"
            />
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────
          TAB 4: ARCHIVED / INACTIVE PRODUCTS (Admin Only)
      ─────────────────────────────────────────────────────────────────────── */}
      {isAdmin && activeTab === 'inactive' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-3">
              <ArchiveBoxIcon className="h-5 w-5 text-slate-500" />
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Archived / Hidden Products</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  These items are hidden from the canteen menu and POS. Admins can restore them anytime.
                </p>
              </div>
            </div>
            <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {inactiveProducts.length} hidden
            </span>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[650px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
                  <tr>
                    <th className="px-5 py-3.5">Product Name</th>
                    <th className="px-4 py-3.5">Category</th>
                    <th className="px-4 py-3.5 text-right">Archived Stock</th>
                    <th className="px-4 py-3.5">Unit</th>
                    <th className="px-4 py-3.5 text-right">Selling Price</th>
                    <th className="px-5 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                  {paginatedInactiveProducts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-center text-slate-500 dark:text-slate-400">
                        No archived products found.
                      </td>
                    </tr>
                  ) : (
                    paginatedInactiveProducts.map((product) => (
                      <tr key={product.id} className="opacity-80 transition hover:opacity-100">
                        <td className="px-5 py-4 font-bold text-slate-900 dark:text-white">
                          {product.name}
                        </td>
                        <td className="px-4 py-4 text-xs font-semibold text-slate-600 dark:text-slate-400">
                          {product.category || 'General'}
                        </td>
                        <td className="px-4 py-4 text-right font-mono font-bold text-slate-700 dark:text-slate-300">
                          {formatProductQuantity(product)}
                        </td>
                        <td className="px-4 py-4 text-xs font-bold uppercase text-slate-500">
                          {formatUnit(getProductBaseUnit(product))}
                        </td>
                        <td className="px-4 py-4 text-right font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
                          ₱{Number(product.price || 0).toFixed(2)}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <button
                            type="button"
                            onClick={() => handleRestore(product)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 shadow-2xs transition hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                          >
                            <ArrowPathIcon className="h-3.5 w-3.5" />
                            Restore Item
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <PaginationControls
              currentPage={inactivePage}
              totalItems={inactiveProducts.length}
              itemsPerPage={ITEMS_PER_PAGE}
              onPageChange={setInactivePage}
              label="archived products"
            />
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────
          MODAL 1: STOCK REPLENISHMENT
      ─────────────────────────────────────────────────────────────────────── */}
      {isReplenishModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl animate-in fade-in zoom-in-95 dark:border dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-6 py-4 dark:border-slate-800 dark:bg-slate-800/50">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                  <PlusCircleIcon className="h-5 w-5 stroke-[2.5]" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">Add New Stock / Delivery</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Record incoming supplies to increase available stock</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsReplenishModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-white"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveReplenish} className="space-y-4 p-6">
              {replenishError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-400">
                  {replenishError}
                </div>
              )}

              {/* Product Select */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Which product arrived? *
                </label>
                <select
                  value={replenishDraft.productId}
                  onChange={(e) => setReplenishDraft({ ...replenishDraft, productId: e.target.value })}
                  required
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 shadow-2xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="">-- Click here to choose a product --</option>
                  {activeProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.category}) — Current Stock: {formatProductQuantity(p)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Current Stock Preview */}
              {selectedReplenishProduct && (
                <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-xs font-semibold dark:bg-slate-800/80">
                  <span className="text-slate-500 dark:text-slate-400">Current Stock On Hand:</span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {formatProductQuantity(selectedReplenishProduct)}
                  </span>
                </div>
              )}

              {/* Quantity Received */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  How many arrived? ({selectedReplenishProduct ? formatUnit(getProductBaseUnit(selectedReplenishProduct)) : 'units'}) *
                </label>
                <input
                  type="number"
                  step={selectedReplenishProduct && getProductUnitType(selectedReplenishProduct) === BULK_UNIT_TYPE ? '0.01' : '1'}
                  min="0.01"
                  required
                  value={replenishDraft.quantity}
                  onChange={(e) => setReplenishDraft({ ...replenishDraft, quantity: e.target.value })}
                  placeholder={selectedReplenishProduct && getProductUnitType(selectedReplenishProduct) === BULK_UNIT_TYPE ? 'e.g. 25.5' : 'e.g. 50'}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-base font-bold text-slate-900 shadow-2xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                  {selectedReplenishProduct && getProductUnitType(selectedReplenishProduct) === BULK_UNIT_TYPE
                    ? 'Bulk item: decimals allowed (e.g. 25 kg, 5.5 kg)'
                    : 'Individual pieces: enter whole numbers (e.g. 50 pcs)'}
                </p>
              </div>

              {/* Date */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Date Received
                </label>
                <input
                  type="date"
                  value={replenishDraft.date}
                  onChange={(e) => setReplenishDraft({ ...replenishDraft, date: e.target.value })}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-900 shadow-2xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              {/* Optional Remarks */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Supplier Name or Notes (Optional)
                </label>
                <input
                  type="text"
                  value={replenishDraft.remarks}
                  onChange={(e) => setReplenishDraft({ ...replenishDraft, remarks: e.target.value })}
                  placeholder="e.g. Delivered by Supplier ABC, Invoice #1024"
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-900 shadow-2xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsReplenishModalOpen(false)}
                  className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingReplenish}
                  className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {savingReplenish ? 'Saving...' : 'Confirm & Add to Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────
          MODAL 2: STOCK ADJUSTMENT
      ─────────────────────────────────────────────────────────────────────── */}
      {isAdjustModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl animate-in fade-in zoom-in-95 dark:border dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-6 py-4 dark:border-slate-800 dark:bg-slate-800/50">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
                  <ScaleIcon className="h-5 w-5 stroke-[2.5]" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">Adjust Stock Count</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Record damaged food, spoilage, or physical inventory recount</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAdjustModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-white"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveAdjust} className="space-y-4 p-6">
              {adjustError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-400">
                  {adjustError}
                </div>
              )}

              {/* Product Select */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Which product needs adjustment? *
                </label>
                <select
                  value={adjustDraft.productId}
                  onChange={(e) => setAdjustDraft({ ...adjustDraft, productId: e.target.value })}
                  required
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 shadow-2xs outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="">-- Click here to choose a product --</option>
                  {activeProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.category}) — Current Stock: {formatProductQuantity(p)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Current Stock Preview */}
              {selectedAdjustProduct && (
                <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-xs font-semibold dark:bg-slate-800/80">
                  <span className="text-slate-500 dark:text-slate-400">Current Stock Before Adjustment:</span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {formatProductQuantity(selectedAdjustProduct)}
                  </span>
                </div>
              )}

              {/* Adjustment Mode */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  What kind of adjustment? *
                </label>
                <div className="mt-1.5 grid grid-cols-3 gap-2">
                  {[
                    { key: 'deduct', label: 'Deduct / Remove' },
                    { key: 'add', label: 'Add / Increase' },
                    { key: 'set', label: 'Set Exact Count' },
                  ].map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setAdjustDraft({ ...adjustDraft, adjustmentType: opt.key })}
                      className={`rounded-lg py-2 text-xs font-bold transition ${
                        adjustDraft.adjustmentType === opt.key
                          ? 'bg-amber-600 text-white shadow-2xs'
                          : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quantity */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  {adjustDraft.adjustmentType === 'set' ? 'New Total Stock Count *' : 'Quantity to Adjust *'}
                </label>
                <input
                  type="number"
                  step={selectedAdjustProduct && getProductUnitType(selectedAdjustProduct) === BULK_UNIT_TYPE ? '0.01' : '1'}
                  min="0"
                  required
                  value={adjustDraft.quantity}
                  onChange={(e) => setAdjustDraft({ ...adjustDraft, quantity: e.target.value })}
                  placeholder={adjustDraft.adjustmentType === 'set' ? 'e.g. 45' : 'e.g. 5'}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-base font-bold text-slate-900 shadow-2xs outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              {/* Reason */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Reason for Adjustment *
                </label>
                <select
                  value={adjustDraft.reason}
                  onChange={(e) => setAdjustDraft({ ...adjustDraft, reason: e.target.value })}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-900 shadow-2xs outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="Damaged">Damaged (Broken packaging/container)</option>
                  <option value="Spoiled">Spoiled (Expired food or drink)</option>
                  <option value="Missing">Missing / Lost item</option>
                  <option value="Inventory Correction">Physical Inventory Recount Correction</option>
                  <option value="Other">Other Reason</option>
                </select>
              </div>

              {/* Remarks */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Details / Notes (Optional)
                </label>
                <input
                  type="text"
                  value={adjustDraft.remarks}
                  onChange={(e) => setAdjustDraft({ ...adjustDraft, remarks: e.target.value })}
                  placeholder="e.g. 2 bottles broke during morning kitchen prep"
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-900 shadow-2xs outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAdjustModalOpen(false)}
                  className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingAdjust}
                  className="flex-1 rounded-xl bg-amber-600 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-amber-700 disabled:opacity-50"
                >
                  {savingAdjust ? 'Saving...' : 'Confirm & Update Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────
          MODAL 3: ADD / EDIT PRODUCT (Simple & Clear for All Staff)
      ─────────────────────────────────────────────────────────────────────── */}
      {isAddEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl animate-in fade-in zoom-in-95 dark:border dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-6 py-4 dark:border-slate-800 dark:bg-slate-800/50">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  {productForm.id ? 'Edit Product Details' : 'Add New Product'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {productForm.id ? 'Update product information and stock thresholds' : 'Add a new food or drink item to the canteen menu'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsAddEditModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-white"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="space-y-4 p-6">
              {productFormError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-400">
                  {productFormError}
                </div>
              )}

              {/* Product Name */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Product Name *
                </label>
                <input
                  type="text"
                  required
                  value={productForm.name}
                  onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                  placeholder="e.g. Bottled Water 500ml, Arroz Caldo, Chicken Sandwich"
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 shadow-2xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              {/* Category & Price */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Food Category *
                  </label>
                  <select
                    value={productForm.category}
                    onChange={(e) => setProductForm({ ...productForm, category: e.target.value })}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-900 shadow-2xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="General">General</option>
                    <option value="Staple">Staple (Rice / Noodles)</option>
                    <option value="Viand">Viand (Main Dish)</option>
                    <option value="Soup">Soup</option>
                    <option value="Snacks">Snacks</option>
                    <option value="Bread">Bread / Pastries</option>
                    <option value="Drinks">Drinks / Beverages</option>
                    <option value="Dessert">Dessert</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Selling Price (PHP) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={productForm.price}
                    onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
                    placeholder="0.00"
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-bold text-slate-900 shadow-2xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              {/* Unit Type & Base Unit */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    How is this item counted? *
                  </label>
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setProductForm({
                          ...productForm,
                          unit_type: PCS_UNIT_TYPE,
                          base_unit: 'pcs',
                        })
                      }
                      className={`rounded-xl py-2 text-xs font-bold transition ${
                        productForm.unit_type === PCS_UNIT_TYPE
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      Pieces (PCS)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setProductForm({
                          ...productForm,
                          unit_type: BULK_UNIT_TYPE,
                          base_unit: productForm.base_unit === 'pcs' ? 'kg' : productForm.base_unit,
                        })
                      }
                      className={`rounded-xl py-2 text-xs font-bold transition ${
                        productForm.unit_type === BULK_UNIT_TYPE
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      Bulk (Weight/Vol)
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Measurement Unit *
                  </label>
                  {productForm.unit_type === BULK_UNIT_TYPE ? (
                    <select
                      value={productForm.base_unit}
                      onChange={(e) => setProductForm({ ...productForm, base_unit: e.target.value })}
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-900 shadow-2xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    >
                      <option value="kg">Kilogram (kg)</option>
                      <option value="g">Gram (g)</option>
                      <option value="l">Liter (L)</option>
                      <option value="ml">Milliliter (mL)</option>
                    </select>
                  ) : (
                    <div className="mt-1.5 flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      PCS (Individual Piece count)
                    </div>
                  )}
                </div>
              </div>

              {/* Current Stock & Minimum Reorder Stock */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Current Stock on Hand ({formatUnit(productForm.base_unit)}) *
                  </label>
                  <input
                    type="number"
                    step={productForm.unit_type === BULK_UNIT_TYPE ? '0.01' : '1'}
                    min="0"
                    required
                    value={productForm.stock}
                    onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-bold text-slate-900 shadow-2xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Low Stock Warning Level *
                  </label>
                  <input
                    type="number"
                    step={productForm.unit_type === BULK_UNIT_TYPE ? '0.01' : '1'}
                    min="0"
                    required
                    value={productForm.min_stock}
                    onChange={(e) => setProductForm({ ...productForm, min_stock: e.target.value })}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-bold text-slate-900 shadow-2xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                  <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                    Alerts staff when stock drops to or below this number.
                  </p>
                </div>
              </div>

              {/* Pin to Quick Sale */}
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs font-bold text-slate-700 dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={Boolean(productForm.is_favorite)}
                  onChange={(e) => setProductForm({ ...productForm, is_favorite: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>Pin to Quick Sale buttons on POS (for fast checkout)</span>
              </label>

              {/* Actions */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddEditModalOpen(false)}
                  className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingProduct}
                  className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {savingProduct ? 'Saving...' : productForm.id ? 'Save Changes' : 'Add Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
