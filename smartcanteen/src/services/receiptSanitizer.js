/**
 * Receipt Sanitization and Validation Utilities
 * Ensures secure file handling, protects against malicious file uploads,
 * path traversal attacks, delimiter corruption (e.g. pipe characters in notes),
 * and validates MIME types and file extensions.
 */

export const ALLOWED_RECEIPT_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.pdf', '.gif'];

export const ALLOWED_RECEIPT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/pjpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
];

export const DANGEROUS_EXTENSIONS = [
  '.exe',
  '.bat',
  '.cmd',
  '.sh',
  '.php',
  '.phtml',
  '.js',
  '.mjs',
  '.vbs',
  '.msi',
  '.jar',
  '.html',
  '.htm',
  '.svg',
  '.py',
  '.pl',
  '.cgi',
  '.dll',
  '.scr',
  '.ps1',
  '.com',
  '.reg',
];

export const MAX_RECEIPT_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Format raw byte size into human readable string (KB / MB)
 */
export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Sanitize a filename to make it safe for storage, URL usage, and delimited note storage.
 * Strips path traversals, control characters, null bytes, HTML/script tags, and pipe `|` symbols.
 */
export function sanitizeReceiptFilename(rawName) {
  if (!rawName || typeof rawName !== 'string') {
    return 'receipt_' + Date.now() + '.png';
  }

  // 1. Strip directories / path traversal characters
  let clean = rawName.replace(/^.*[\\/]/, '');

  // 2. Remove null bytes and control chars
  clean = clean.replace(/[\x00-\x1f\x7f]/g, '');

  // 3. Extract base and extension
  const lastDotIndex = clean.lastIndexOf('.');
  let baseName = lastDotIndex > 0 ? clean.slice(0, lastDotIndex) : clean;
  let ext = lastDotIndex > 0 ? clean.slice(lastDotIndex).toLowerCase() : '';

  // 4. Sanitize base name - remove dangerous characters, quotes, pipes, brackets, tags
  baseName = baseName
    .replace(/[|<>:"/\\?*;%${}()[\]&'`!~#^=+,]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!baseName) {
    baseName = 'receipt_' + Date.now();
  }

  // Limit base name length
  if (baseName.length > 50) {
    baseName = baseName.slice(0, 50);
  }

  // 5. Check and sanitize extension
  if (!ext || !ALLOWED_RECEIPT_EXTENSIONS.includes(ext)) {
    // If extension is missing or disallowed, default to .png if it was an image or keep safe fallback
    ext = '.png';
  }

  return `${baseName}${ext}`;
}

/**
 * Validates an uploaded receipt file.
 * Returns an object with validation outcome and metadata.
 */
export function validateReceiptFile(file) {
  if (!file) {
    return {
      valid: false,
      error: 'No file selected.',
    };
  }

  // 1. File size check
  if (file.size > MAX_RECEIPT_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File exceeds maximum allowed size of ${formatFileSize(MAX_RECEIPT_FILE_SIZE_BYTES)} (Selected: ${formatFileSize(file.size)}).`,
    };
  }

  if (file.size === 0) {
    return {
      valid: false,
      error: 'The selected file is empty (0 bytes).',
    };
  }

  // 2. Extension check
  const rawName = file.name || '';
  const lastDotIndex = rawName.lastIndexOf('.');
  const ext = lastDotIndex >= 0 ? rawName.slice(lastDotIndex).toLowerCase() : '';

  if (DANGEROUS_EXTENSIONS.includes(ext)) {
    return {
      valid: false,
      error: `Security Alert: Files with extension "${ext}" are blocked for security.`,
    };
  }

  if (!ALLOWED_RECEIPT_EXTENSIONS.includes(ext)) {
    return {
      valid: false,
      error: `Unsupported file type "${ext || 'unknown'}". Allowed formats: JPG, PNG, WEBP, GIF, PDF.`,
    };
  }

  // 3. MIME type check
  const mimeType = (file.type || '').toLowerCase();
  const isImage = mimeType.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext);
  const isPdf = mimeType === 'application/pdf' || ext === '.pdf';

  if (!isImage && !isPdf) {
    return {
      valid: false,
      error: 'Invalid file format. Please upload an image (PNG, JPG, WEBP, GIF) or PDF document.',
    };
  }

  const sanitizedName = sanitizeReceiptFilename(file.name);

  return {
    valid: true,
    sanitizedName,
    rawName: file.name,
    size: file.size,
    sizeFormatted: formatFileSize(file.size),
    mimeType: mimeType || (isPdf ? 'application/pdf' : 'image/png'),
    isImage,
    isPdf,
  };
}

/**
 * Reads a File object as a base64 Data URL
 */
export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No file provided'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (err) => reject(err || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
