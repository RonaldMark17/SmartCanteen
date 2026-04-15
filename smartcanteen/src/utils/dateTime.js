export const PH_TIMEZONE = 'Asia/Manila';

const WEEKDAY_INDEX_BY_LABEL = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function parseBackendDateTime(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const rawValue = String(value).trim();
  if (!rawValue) {
    return null;
  }

  let normalizedValue = rawValue;
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
    normalizedValue = `${rawValue}T12:00:00+08:00`;
  } else if (!/(?:[zZ]|[+\-]\d{2}:\d{2})$/.test(rawValue)) {
    normalizedValue = `${rawValue}Z`;
  }

  const date = new Date(normalizedValue);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatPhilippineDateTime(value, options = {}) {
  const date = parseBackendDateTime(value);
  if (!date) {
    return 'Not available';
  }

  return date.toLocaleString('en-PH', {
    timeZone: PH_TIMEZONE,
    ...options,
  });
}

export function formatPhilippineDate(value, options = {}) {
  const date = parseBackendDateTime(value);
  if (!date) {
    return 'N/A';
  }

  return date.toLocaleDateString('en-PH', {
    timeZone: PH_TIMEZONE,
    ...options,
  });
}

export function formatPhilippineTime(value, options = {}) {
  const date = parseBackendDateTime(value);
  if (!date) {
    return '';
  }

  return date.toLocaleTimeString('en-PH', {
    timeZone: PH_TIMEZONE,
    ...options,
  });
}

export function getPhilippineDateParts(value = new Date()) {
  const date = parseBackendDateTime(value) || (value instanceof Date ? value : null);
  if (!date) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: PH_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date).reduce((result, part) => {
    if (part.type !== 'literal') {
      result[part.type] = part.value;
    }
    return result;
  }, {});

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

export function getPhilippineDateKey(value = new Date()) {
  const parts = getPhilippineDateParts(value);
  if (!parts) {
    return '';
  }

  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function getPhilippineWeekday(value) {
  const date = parseBackendDateTime(value);
  if (!date) {
    return null;
  }

  const weekdayLabel = date.toLocaleDateString('en-US', {
    timeZone: PH_TIMEZONE,
    weekday: 'short',
  });

  return WEEKDAY_INDEX_BY_LABEL[weekdayLabel] ?? null;
}

export function isSamePhilippinePeriod(value, period, now = new Date()) {
  const dateParts = getPhilippineDateParts(value);
  const nowParts = getPhilippineDateParts(now);

  if (!dateParts || !nowParts) {
    return false;
  }

  if (period === 'year') {
    return dateParts.year === nowParts.year;
  }

  if (period === 'month') {
    return dateParts.year === nowParts.year && dateParts.month === nowParts.month;
  }

  return (
    dateParts.year === nowParts.year &&
    dateParts.month === nowParts.month &&
    dateParts.day === nowParts.day
  );
}

export function getPhilippineHour(value) {
  return getPhilippineDateParts(value)?.hour ?? null;
}

export function getDaysInPhilippineMonth(value = new Date()) {
  const parts = getPhilippineDateParts(value);
  if (!parts) {
    return 30;
  }

  return new Date(parts.year, parts.month, 0).getDate();
}
