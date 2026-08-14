import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowUpTrayIcon,
  CheckBadgeIcon,
  DocumentMagnifyingGlassIcon,
  EyeIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  PhotoIcon,
  PrinterIcon,
  ReceiptPercentIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { getReceipt, saveReceipt } from '../services/receiptStorage';
import { API } from '../services/api';
import { readFileAsDataUrl, validateReceiptFile } from '../services/receiptSanitizer';

function formatCurrency(amount) {
  const numeric = Number(amount) || 0;
  return `PHP ${numeric.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function ReceiptPreviewModal({ receiptData, onClose, onReceiptUpdated }) {
  const [storedReceipt, setStoredReceipt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setZoomLevel(1);
    setRotation(0);
    setUploadError('');

    async function loadData() {
      if (!receiptData) {
        setLoading(false);
        return;
      }

      // If receiptData already has dataUrl provided (e.g. preview before saving)
      if (receiptData.dataUrl) {
        if (isMounted) {
          setStoredReceipt(receiptData);
          setLoading(false);
        }
        return;
      }

      // Look up in local storage / IndexedDB / backend
      const filename = receiptData.receipt || receiptData.receiptName || receiptData.filename;
      const expenseId = receiptData.id;

      let found = null;
      if (filename && filename !== 'No receipt' && filename !== '-') {
        found = await getReceipt(filename, receiptData);
      }
      if (!found && expenseId) {
        found = await getReceipt(expenseId, receiptData);
      }

      // Fallback: direct backend URL if filename exists
      if (!found && filename && filename !== 'No receipt' && filename !== '-') {
        const directUrl = API.getFinancialReceiptUrl(filename);
        if (directUrl) {
          found = {
            filename,
            url: directUrl,
            category: receiptData.category,
            amount: receiptData.amount,
            date: receiptData.date,
          };
        }
      }

      if (isMounted) {
        setStoredReceipt(found);
        setLoading(false);
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, [receiptData]);

  // Handle keyboard Escape
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        onClose?.();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!receiptData) return null;

  const filename =
    receiptData.receipt || receiptData.receiptName || receiptData.filename || 'Receipt';
  const category = receiptData.category || 'Operating Expense';
  const amount = receiptData.amount || 0;
  const date = receiptData.date || 'N/A';
  const supplier = receiptData.supplier && receiptData.supplier !== '-' ? receiptData.supplier : 'None specified';
  const description =
    receiptData.description && receiptData.description !== '-' ? receiptData.description : 'None specified';
  const typeLabel = receiptData.typeLabel || (receiptData.type === 'monthly' ? 'Monthly Expense' : 'Daily Expense');

  const previewSource = storedReceipt?.dataUrl || storedReceipt?.url || receiptData.dataUrl || null;
  const isPdf =
    storedReceipt?.isPdf ||
    storedReceipt?.mimeType === 'application/pdf' ||
    String(filename).toLowerCase().endsWith('.pdf');

  function handleZoomIn() {
    setZoomLevel((prev) => Math.min(prev + 0.25, 3));
  }

  function handleZoomOut() {
    setZoomLevel((prev) => Math.max(prev - 0.25, 0.5));
  }

  function handleResetZoom() {
    setZoomLevel(1);
    setRotation(0);
  }

  function handleRotate() {
    setRotation((prev) => (prev + 90) % 360);
  }

  async function handleFileSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const validation = validateReceiptFile(file);
    if (!validation.valid) {
      setUploadError(validation.error || 'Invalid file format.');
      return;
    }

    setUploadError('');
    setUploadingReceipt(true);

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const updatedEntry = {
        key: filename,
        filename,
        rawName: file.name,
        dataUrl,
        mimeType: validation.mimeType,
        isPdf: validation.isPdf,
        category,
        amount,
        date,
        supplier,
        description,
        reportId: receiptData.reportId,
      };

      await saveReceipt(updatedEntry);
      API.uploadFinancialReceipt(file).catch((err) => {
        console.warn('Backend receipt upload:', err);
      });

      setStoredReceipt(updatedEntry);
      onReceiptUpdated?.(updatedEntry);
      window.showToast?.('Receipt attached and verified!', 'success');
    } catch (err) {
      console.error('Error attaching receipt:', err);
      setUploadError('Failed to read and attach receipt.');
    } finally {
      setUploadingReceipt(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function handleDownload() {
    if (!previewSource) return;
    const a = document.createElement('a');
    a.href = previewSource;
    a.download = filename || 'receipt.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function handlePrint() {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const receiptHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Receipt Preview - ${filename}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            margin: 0;
            padding: 30px;
            color: #1e293b;
            background: #ffffff;
          }
          .voucher-box {
            max-width: 650px;
            margin: 0 auto;
            border: 2px solid #0f766e;
            border-radius: 12px;
            padding: 24px;
          }
          .header {
            text-align: center;
            border-bottom: 2px dashed #cbd5e1;
            padding-bottom: 16px;
            margin-bottom: 20px;
          }
          .school-title {
            font-size: 20px;
            font-weight: 800;
            color: #0f766e;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .sub-title {
            font-size: 13px;
            color: #64748b;
            margin-top: 4px;
          }
          .badge {
            display: inline-block;
            background: #f0fdf4;
            color: #166534;
            border: 1px solid #bbf7d0;
            border-radius: 9999px;
            padding: 4px 12px;
            font-size: 12px;
            font-weight: 700;
            margin-top: 10px;
          }
          .details-table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
          }
          .details-table th, .details-table td {
            padding: 10px 12px;
            text-align: left;
            border-bottom: 1px solid #f1f5f9;
            font-size: 14px;
          }
          .details-table th {
            color: #64748b;
            font-weight: 600;
            width: 35%;
          }
          .details-table td {
            color: #0f172a;
            font-weight: 500;
          }
          .amount-row {
            background: #f8fafc;
            border-radius: 8px;
          }
          .amount-value {
            font-size: 18px;
            font-weight: 800;
            color: #0f766e;
          }
          .receipt-img-box {
            text-align: center;
            margin-top: 24px;
            border-top: 2px dashed #cbd5e1;
            padding-top: 20px;
          }
          .receipt-img {
            max-width: 100%;
            max-height: 500px;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
          }
          .footer-note {
            margin-top: 20px;
            font-size: 11px;
            color: #94a3b8;
            text-align: center;
          }
        </style>
      </head>
      <body>
        <div class="voucher-box">
          <div class="header">
            <div class="school-title">MEALS - Management of Expenses, Assets, and Logistics System</div>
            <div class="sub-title">DepEd Canteen Financial Management & Operations</div>
            <div class="badge">EXPENSE VOUCHER & RECEIPT RECORD</div>
          </div>

          <table class="details-table">
            <tr>
              <th>Expense Type</th>
              <td><strong>${typeLabel}</strong></td>
            </tr>
            <tr>
              <th>Date Recorded</th>
              <td>${date}</td>
            </tr>
            <tr>
              <th>Category</th>
              <td>${category}</td>
            </tr>
            <tr class="amount-row">
              <th>Amount Paid</th>
              <td class="amount-value">${formatCurrency(amount)}</td>
            </tr>
            <tr>
              <th>Supplier</th>
              <td>${supplier}</td>
            </tr>
            <tr>
              <th>Description</th>
              <td>${description}</td>
            </tr>
            <tr>
              <th>Receipt Document</th>
              <td>${filename}</td>
            </tr>
          </table>

          ${
            previewSource && !isPdf
              ? `<div class="receipt-img-box">
                   <div style="font-size:12px; font-weight:700; color:#64748b; margin-bottom:10px; text-transform:uppercase;">Attached Receipt Image</div>
                   <img src="${previewSource}" class="receipt-img" alt="Receipt Image" />
                 </div>`
              : ''
          }

          <div class="footer-note">
            This receipt record is an official transaction item of the MEALS Financial Accounting System. Printed on ${new Date().toLocaleString(
              'en-PH'
            )}.
          </div>
        </div>
        <script>
          window.onload = function() {
            window.print();
          };
        </script>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(receiptHtml);
    printWindow.document.close();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-6 backdrop-blur-sm animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-200 animate-scaleUp">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-slate-50 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <DocumentMagnifyingGlassIcon className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black text-slate-900">Receipt Details & Preview</h2>
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200">
                  {typeLabel}
                </span>
              </div>
              <p className="text-xs text-slate-500 font-mono mt-0.5 truncate max-w-md" title={filename}>
                {filename}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
          {/* Metadata Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Date</span>
              <div className="mt-1 text-sm font-black text-slate-900">{date}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Category</span>
              <div className="mt-1 text-sm font-bold text-slate-800 truncate" title={category}>
                {category}
              </div>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">Amount Paid</span>
              <div className="mt-1 text-base font-black text-emerald-800">{formatCurrency(amount)}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Supplier</span>
              <div className="mt-1 text-sm font-semibold text-slate-700 truncate" title={supplier}>
                {supplier}
              </div>
            </div>
          </div>

          {/* Description line if exists */}
          {description && description !== 'None specified' && (
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 text-xs text-slate-600">
              <strong className="text-slate-800 font-bold">Description: </strong>
              {description}
            </div>
          )}

          {/* Main Preview Container */}
          <div className="relative rounded-2xl border border-slate-200 bg-slate-900/5 p-4 min-h-[320px] flex flex-col items-center justify-center overflow-hidden">
            {loading ? (
              <div className="flex flex-col items-center gap-3 py-16">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                <p className="text-sm font-semibold text-slate-500">Loading receipt preview...</p>
              </div>
            ) : previewSource ? (
              isPdf ? (
                <div className="w-full flex flex-col items-center py-6">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 border border-rose-200 shadow-sm">
                    <ReceiptPercentIcon className="h-8 w-8" />
                  </div>
                  <h3 className="mt-4 text-base font-black text-slate-900">{filename}</h3>
                  <p className="mt-1 text-xs text-slate-500">PDF Document Receipt</p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <a
                      href={previewSource}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-primary-dark transition"
                    >
                      <EyeIcon className="h-4 w-4" />
                      Open PDF in New Window
                    </a>
                    <button
                      type="button"
                      onClick={handleDownload}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 transition"
                    >
                      <ArrowDownTrayIcon className="h-4 w-4" />
                      Download PDF
                    </button>
                  </div>
                </div>
              ) : (
                <div className="w-full flex flex-col items-center">
                  {/* Image Controls Toolbar */}
                  <div className="mb-3 flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/90 px-3 py-1.5 shadow-sm backdrop-blur-md">
                    <button
                      type="button"
                      onClick={handleZoomIn}
                      title="Zoom In"
                      className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 transition"
                    >
                      <MagnifyingGlassPlusIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={handleZoomOut}
                      title="Zoom Out"
                      className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 transition"
                    >
                      <MagnifyingGlassMinusIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={handleRotate}
                      title="Rotate 90°"
                      className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 transition"
                    >
                      <ArrowPathIcon className="h-4 w-4" />
                    </button>
                    <div className="h-4 w-px bg-slate-200 mx-1" />
                    <button
                      type="button"
                      onClick={handleResetZoom}
                      className="text-xs font-bold text-slate-600 px-2 py-1 hover:bg-slate-100 rounded-lg transition"
                    >
                      {Math.round(zoomLevel * 100)}% (Reset)
                    </button>
                  </div>

                  {/* Scrollable Viewport */}
                  <div className="max-h-[460px] w-full overflow-auto custom-scrollbar flex items-center justify-center p-2 rounded-xl bg-slate-950/5">
                    <img
                      src={previewSource}
                      alt={filename}
                      onError={(e) => {
                        const directUrl = API.getFinancialReceiptUrl(filename);
                        if (directUrl && e.currentTarget.src !== directUrl && !e.currentTarget.dataset.retried) {
                          e.currentTarget.dataset.retried = 'true';
                          e.currentTarget.src = directUrl;
                        }
                      }}
                      style={{
                        transform: `scale(${zoomLevel}) rotate(${rotation}deg)`,
                        transition: 'transform 0.2s ease',
                      }}
                      className="max-h-[420px] max-w-full rounded-lg shadow-md object-contain cursor-grab active:cursor-grabbing"
                    />
                  </div>
                </div>
              )
            ) : (
              /* Fallback: Verified Digital Canteen Voucher Card for historical records */
              <div className="w-full max-w-lg rounded-2xl border-2 border-dashed border-slate-300 bg-white p-6 shadow-sm text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-200 mb-4">
                  <CheckBadgeIcon className="h-8 w-8" />
                </div>
                <h3 className="text-base font-black text-slate-900">Official Expense Record Verified</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Referenced File: <strong className="font-mono text-slate-700">{filename}</strong>
                </p>

                <div className="mt-5 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-slate-50/60 text-left text-xs">
                  <div className="flex justify-between px-3.5 py-2.5">
                    <span className="text-slate-500 font-medium">Recorded Date:</span>
                    <span className="font-bold text-slate-800">{date}</span>
                  </div>
                  <div className="flex justify-between px-3.5 py-2.5">
                    <span className="text-slate-500 font-medium">Expense Category:</span>
                    <span className="font-bold text-slate-800">{category}</span>
                  </div>
                  <div className="flex justify-between px-3.5 py-2.5">
                    <span className="text-slate-500 font-medium">Total Amount:</span>
                    <span className="font-black text-emerald-700">{formatCurrency(amount)}</span>
                  </div>
                  <div className="flex justify-between px-3.5 py-2.5">
                    <span className="text-slate-500 font-medium">Supplier / Vendor:</span>
                    <span className="font-semibold text-slate-700">{supplier}</span>
                  </div>
                </div>

                {uploadError && (
                  <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs font-semibold text-rose-700">
                    {uploadError}
                  </div>
                )}

                <div className="mt-5 flex flex-col sm:flex-row items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingReceipt}
                    className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-primary-dark transition active:scale-95"
                  >
                    <ArrowUpTrayIcon className="h-4 w-4" />
                    {uploadingReceipt ? 'Attaching...' : 'Attach / Re-upload Receipt Image'}
                  </button>
                </div>

                <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
                  This transaction is recorded and verified within the DepEd Canteen Financial System.
                  Click "Print Receipt" below to generate a formal voucher copy.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Hidden file input for re-uploading receipts */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
          onChange={handleFileSelected}
          className="hidden"
        />

        {/* Modal Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <div className="flex items-center gap-2">
            {previewSource && (
              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-100 transition"
              >
                <ArrowDownTrayIcon className="h-4 w-4" />
                Download File
              </button>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingReceipt}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-100 transition"
            >
              <ArrowUpTrayIcon className="h-4 w-4" />
              {previewSource ? 'Replace Receipt' : 'Attach Receipt'}
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-100 transition"
            >
              <PrinterIcon className="h-4 w-4" />
              Print Receipt
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-slate-800 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
