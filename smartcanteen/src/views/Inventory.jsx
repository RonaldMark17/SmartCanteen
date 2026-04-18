import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { API } from '../services/api';
import DismissibleAlert from '../components/DismissibleAlert';
import { Skeleton, SkeletonText } from '../components/Skeleton';
import { getPhilippineDateKey } from '../utils/dateTime';
import { requestAlertRefresh } from '../services/realtimeAlerts';
import {
  ArrowDownTrayIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';

const INVENTORY_ITEMS_PER_PAGE = 10;
const MAX_PAGE_BUTTONS = 5;

function formatCount(value) {
  return Number(value || 0).toLocaleString('en-PH');
}

function isBelowMinimumStock(product) {
  return Number(product?.stock || 0) < Number(product?.min_stock || 0);
}

function getInventoryPageNumbers(currentPage, totalPages) {
  const visibleCount = Math.min(MAX_PAGE_BUTTONS, totalPages);
  let start = Math.max(1, currentPage - Math.floor(visibleCount / 2));
  const end = Math.min(totalPages, start + visibleCount - 1);
  start = Math.max(1, end - visibleCount + 1);

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export default function Inventory() {
  const location = useLocation();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notificationFocus, setNotificationFocus] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState(initialFormState());
  const [formError, setFormError] = useState("");

  const user = JSON.parse(localStorage.getItem('sc_user') || '{}');
  const isAdmin = user?.role === 'admin';
  const tableColumnCount = isAdmin ? 7 : 6;

  function initialFormState() {
    return { id: null, name: "", category: "Staple", price: "", stock: 0, min_stock: 5, barcode: "" };
  }

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const data = await API.getProducts(false);
      
      // Sorting logic: Low stock items come first, then alphabetical by name
      const sortedData = data.sort((a, b) => {
        const aIsLow = !isProductActive(a) || isBelowMinimumStock(a);
        const bIsLow = !isProductActive(b) || isBelowMinimumStock(b);

        if (aIsLow && !bIsLow) return -1; // a comes first
        if (!aIsLow && bIsLow) return 1;  // b comes first
        
        // If both are in the same status, sort by name
        return a.name.localeCompare(b.name);
      });

      setProducts(sortedData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  useEffect(() => {
    const alertState = location.state;

    if (!alertState?.highlightProductName && !alertState?.highlightProductId) {
      setNotificationFocus(null);
      return;
    }

    setNotificationFocus({
      id: alertState.highlightProductId ?? null,
      name: alertState.highlightProductName || '',
      type: alertState.notificationType || 'notification',
    });
  }, [location.key]);

  const openAddModal = () => {
    setFormData(initialFormState());
    setFormError("");
    setIsModalOpen(true);
  };

  const openEditModal = (product) => {
    setFormData({ ...product });
    setFormError("");
    setIsModalOpen(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to deactivate this product?")) return;
    try {
      await API.deleteProduct(id);
      requestAlertRefresh({ source: 'inventory', reason: 'product-deleted' });
      fetchProducts();
    } catch (err) {
      console.error(err);
      window.showToast("Failed to delete product", "error");
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setFormError("");
    try {
      const parsedStock = parseInt(formData.stock);
      const payload = {
        name: formData.name,
        category: formData.category,
        price: parseFloat(formData.price),
        stock: parsedStock,
        min_stock: parseInt(formData.min_stock),
        barcode: formData.barcode || null
      };

      if (formData.id) {
        if (parsedStock > 0) {
          payload.is_active = true;
        }
        await API.updateProduct(formData.id, payload);
      } else {
        await API.createProduct(payload);
      }
      setIsModalOpen(false);
      requestAlertRefresh({
        source: 'inventory',
        reason: formData.id ? 'product-updated' : 'product-created',
      });
      fetchProducts();
      window.showToast("Product saved successfully!", "success");
    } catch (err) {
      setFormError(err.message || "Failed to save product.");
    }
  };

  // Automated Reporting (Research Objective f)
  const exportCSVReport = () => {
    const headers = ["ID", "Product Name", "Category", "Price (PHP)", "Current Stock", "Min Stock Alert", "Status"];
    const csvRows = [headers.join(",")];
    
    products.forEach(p => {
      const row = [
        p.id,
        `"${p.name}"`, // Quotes handle commas in product names safely
        p.category,
        p.price.toFixed(2),
        p.stock,
        p.min_stock,
        isProductActive(p) ? "Active" : "Inactive"
      ];
      csvRows.push(row.join(","));
    });

    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `SmartCanteen_Inventory_Report_${getPhilippineDateKey(new Date())}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const isNotificationFocusMatch = (product) => {
    if (!notificationFocus) {
      return false;
    }

    if (notificationFocus.id !== null && notificationFocus.id !== undefined) {
      return String(product.id) === String(notificationFocus.id);
    }

    return product.name.toLowerCase() === notificationFocus.name.toLowerCase();
  };

  function isProductActive(product) {
    return product?.is_active !== false;
  }

  const displayedProducts = notificationFocus
    ? [...products].sort((left, right) => {
        const leftMatch = isNotificationFocusMatch(left);
        const rightMatch = isNotificationFocusMatch(right);

        if (leftMatch && !rightMatch) return -1;
        if (!leftMatch && rightMatch) return 1;
        return 0;
      })
    : products;

  const totalPages = Math.max(1, Math.ceil(displayedProducts.length / INVENTORY_ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStartIndex = displayedProducts.length === 0 ? 0 : (safeCurrentPage - 1) * INVENTORY_ITEMS_PER_PAGE;
  const paginatedProducts = displayedProducts.slice(
    pageStartIndex,
    pageStartIndex + INVENTORY_ITEMS_PER_PAGE
  );
  const pageStartCount = displayedProducts.length === 0 ? 0 : pageStartIndex + 1;
  const pageEndCount = Math.min(pageStartIndex + paginatedProducts.length, displayedProducts.length);
  const pageNumbers = getInventoryPageNumbers(safeCurrentPage, totalPages);

  useEffect(() => {
    setCurrentPage(1);
  }, [notificationFocus?.id, notificationFocus?.name]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  return (
    <div className="view-shell-static relative">
      <div className="view-header md:flex-row md:items-center">
        <div>
          <h1 className="view-title">Inventory</h1>
          <p className="view-subtitle">Manage products and stock levels</p>
        </div>
        
        <div className="flex w-full flex-wrap gap-3 md:w-auto">
          <button 
            onClick={exportCSVReport} 
            className="action-button"
          >
            <ArrowDownTrayIcon className="w-5 h-5" /> Export CSV
          </button>
          
          {isAdmin && (
            <button onClick={openAddModal} className="primary-action-button">
              <PlusIcon className="w-5 h-5" /> Add Product
            </button>
          )}
        </div>
      </div>

      {notificationFocus && (
        <DismissibleAlert
          resetKey={location.key}
          tone="sky"
          title={notificationFocus.type === 'low-stock' ? 'Low stock alert opened' : 'Notification opened'}
          className="rounded-2xl"
        >
          {notificationFocus.name || 'Selected product'} is highlighted below so you can review
          its stock faster.
        </DismissibleAlert>
      )}

      <div className="data-card flex min-h-0 flex-1 flex-col">
        <div className="custom-scrollbar hidden min-h-0 flex-1 overflow-y-auto md:block">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-xs uppercase font-bold text-slate-500 border-b border-slate-200 sticky top-0">
              <tr>
                <th className="px-6 py-4">ID</th>
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4">Price</th>
                <th className="px-6 py-4">Stock</th>
                <th className="px-6 py-4">Status</th>
                {isAdmin && <th className="px-6 py-4 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                Array.from({ length: 6 }, (_, index) => (
                  <tr key={`inventory-skeleton-${index}`}>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-10" /></td>
                    <td className="px-6 py-4"><SkeletonText lines={['h-4 w-40']} /></td>
                    <td className="px-6 py-4"><Skeleton className="h-7 w-24 rounded-full" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-20" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-7 w-24 rounded-full" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-7 w-20 rounded-full" /></td>
                    {isAdmin && (
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <Skeleton className="h-8 w-14 rounded-md" />
                          <Skeleton className="h-8 w-16 rounded-md" />
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              ) : displayedProducts.length === 0 ? (
                <tr><td colSpan={tableColumnCount} className="text-center py-10">No products found.</td></tr>
              ) : paginatedProducts.map(p => {
                const isHighlighted = isNotificationFocusMatch(p);
                const isActive = isProductActive(p);

                return (
                <tr key={p.id} className={`transition-colors ${isHighlighted ? 'bg-sky-50 ring-2 ring-inset ring-sky-200' : 'hover:bg-slate-50'} ${!isActive && !isHighlighted ? 'bg-slate-50 opacity-80' : isBelowMinimumStock(p) && !isHighlighted ? 'bg-red-50/50' : ''}`}>
                  <td className="px-6 py-4">{p.id}</td>
                  <td className="px-6 py-4 font-semibold text-slate-900">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{p.name}</span>
                      {isHighlighted && (
                        <span className="rounded-full bg-sky-100 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-sky-700">
                          Alert item
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4"><span className="bg-fuchsia-50 text-fuchsia-700 px-3 py-1 rounded-full text-xs font-bold">{p.category}</span></td>
                  <td className="px-6 py-4">{`PHP ${p.price.toFixed(2)}`}</td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${isBelowMinimumStock(p) ? 'bg-red-100 text-red-700 animate-pulse' : 'bg-emerald-100 text-emerald-700'}`}>
                      {p.stock} {isBelowMinimumStock(p) && ' (LOW)'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      <span className={`h-2 w-2 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-slate-400'}`}></span>
                      {isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="px-6 py-4 text-right space-x-2">
                      <button onClick={() => openEditModal(p)} className="text-sky-600 hover:bg-sky-50 px-3 py-1.5 rounded-md border border-sky-200 font-medium text-xs transition-colors">Edit</button>
                      <button onClick={() => handleDelete(p.id)} className="text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-md border border-red-200 font-medium text-xs transition-colors">Delete</button>
                    </td>
                  )}
                </tr>
              )})}
            </tbody>
          </table>
        </div>

        <div className="custom-scrollbar flex-1 overflow-y-auto p-4 md:hidden">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }, (_, index) => (
                <div key={`inventory-mobile-skeleton-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <SkeletonText lines={['h-4 w-40', 'h-3 w-24']} className="flex-1" />
                    <Skeleton className="h-6 w-16 rounded-full" />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <Skeleton className="h-14 rounded-xl" />
                    <Skeleton className="h-14 rounded-xl" />
                    <Skeleton className="h-14 rounded-xl" />
                    <Skeleton className="h-14 rounded-xl" />
                  </div>
                </div>
              ))}
            </div>
          ) : displayedProducts.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
              No products found.
            </div>
          ) : (
            <div className="space-y-3">
              {paginatedProducts.map((p) => {
                const isHighlighted = isNotificationFocusMatch(p);
                const isActive = isProductActive(p);

                return (
                <div
                  key={p.id}
                  className={`rounded-2xl border p-4 shadow-sm ${
                    isHighlighted
                      ? 'border-sky-300 bg-sky-50/70 ring-2 ring-sky-100'
                      : !isActive
                        ? 'border-slate-200 bg-slate-50/90 opacity-90'
                        : isBelowMinimumStock(p)
                        ? 'border-red-200 bg-red-50/60'
                        : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Product #{p.id}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-base font-black text-slate-900">
                        <span>{p.name}</span>
                        {isHighlighted && (
                          <span className="rounded-full bg-sky-100 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-sky-700">
                            Alert item
                          </span>
                        )}
                      </div>
                      <div className="mt-2 inline-flex rounded-full bg-fuchsia-50 px-3 py-1 text-xs font-bold text-fuchsia-700">
                        {p.category}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Price</div>
                      <div className="mt-1 text-sm font-black text-slate-900">{`PHP ${p.price.toFixed(2)}`}</div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Stock</div>
                      <div className="mt-1 font-black text-slate-900">{p.stock}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Min Alert</div>
                      <div className="mt-1 font-black text-slate-900">{p.min_stock}</div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-widest ${
                        isBelowMinimumStock(p) ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {isBelowMinimumStock(p) ? 'Low stock' : 'Healthy stock'}
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-600">
                      <span className={`h-2 w-2 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-slate-300'}`}></span>
                      {isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  {isAdmin && (
                    <div className="mt-4 flex gap-2">
                      <button
                        onClick={() => openEditModal(p)}
                        className="flex-1 rounded-lg border border-sky-200 px-3 py-2 text-sm font-bold text-sky-600 transition-colors hover:bg-sky-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(p.id)}
                        className="flex-1 rounded-lg border border-red-200 px-3 py-2 text-sm font-bold text-red-600 transition-colors hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              )})}
            </div>
          )}
        </div>

        {!loading && displayedProducts.length > 0 && (
          <div className="flex shrink-0 flex-col gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm font-semibold text-slate-600">
              Showing {formatCount(pageStartCount)}-{formatCount(pageEndCount)} of {formatCount(displayedProducts.length)} products
            </div>

            {totalPages > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={safeCurrentPage === 1}
                  aria-label="Previous inventory page"
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
                        ? 'bg-slate-900 text-white'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {formatCount(pageNumber)}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  disabled={safeCurrentPage === totalPages}
                  aria-label="Next inventory page"
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

      {/* Modal Overlay */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <h3 className="text-xl font-bold text-slate-900 mb-4">{formData.id ? 'Edit Product' : 'Add Product'}</h3>
              
              {formError && (
                <DismissibleAlert
                  resetKey={formError}
                  tone="red"
                  title="Save issue"
                  className="mb-4 rounded-lg border-red-100 p-3"
                >
                  {formError}
                </DismissibleAlert>
              )}
              
              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Product Name *</label>
                  <input type="text" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none" />
                </div>
                
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">Category *</label>
                    <select value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none bg-white">
                      <option>Staple</option><option>Viand</option><option>Soup</option><option>Snacks</option>
                      <option>Bread</option><option>Drinks</option><option>Dessert</option><option>General</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">Price (PHP) *</label>
                    <input type="number" step="0.01" required value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none" />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">Current Stock</label>
                    <input type="number" required value={formData.stock} onChange={e => setFormData({...formData, stock: e.target.value})} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">Min Alert Stock</label>
                    <input type="number" required value={formData.min_stock} onChange={e => setFormData({...formData, min_stock: e.target.value})} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none" />
                  </div>
                </div>

                <div className="flex flex-col gap-3 pt-4 sm:flex-row">
                  <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 px-4 py-3 bg-white border border-slate-200 text-slate-700 rounded-xl font-semibold hover:bg-slate-50 transition-colors">Cancel</button>
                  <button type="submit" className="flex-[2] px-4 py-3 bg-primary text-white rounded-xl font-bold hover:bg-primary-dark transition-colors shadow-sm">Save Product</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
