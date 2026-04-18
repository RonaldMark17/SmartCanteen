import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { API } from '../services/api';
import DismissibleAlert from '../components/DismissibleAlert';
import { Skeleton, SkeletonText } from '../components/Skeleton';
import {
  formatPhilippineDateTime,
  getPhilippineDateKey,
  getPhilippineWeekday,
  parseBackendDateTime,
} from '../utils/dateTime';
import {
  ArchiveBoxIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  BanknotesIcon,
  ChartBarIcon,
  CheckCircleIcon,
  ClipboardDocumentListIcon,
  CloudIcon,
  ExclamationTriangleIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ShoppingBagIcon,
  SparklesIcon,
  Squares2X2Icon,
  TableCellsIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

const DEFAULT_ALGORITHM = 'XGBoost';
const MODEL_ALGORITHMS = [DEFAULT_ALGORITHM];
const OPENWEATHER_API_KEY = import.meta.env.VITE_OPENWEATHERMAP_API_KEY?.trim() || '';
const OPENWEATHER_LAT = import.meta.env.VITE_OPENWEATHERMAP_LAT?.trim() || '';
const OPENWEATHER_LON = import.meta.env.VITE_OPENWEATHERMAP_LON?.trim() || '';
const DEFAULT_OPENWEATHER_LAT = '14.5995';
const DEFAULT_OPENWEATHER_LON = '120.9842';
const DEFAULT_OPENWEATHER_LOCATION_LABEL = 'Manila, PH';
const METRIC_REFRESH_IDLE_TIMEOUT_MS = 1500;
const WEATHER_OPTIONS = [
  {
    value: 'hot_dry',
    label: 'Hot Day',
    backendWeather: 'clear',
    modifier: 1.08,
    note: 'Hot weather can increase sales of cold drinks, snacks, and desserts.',
  },
  {
    value: 'cool_breezy',
    label: 'Cool Day',
    backendWeather: 'cloudy',
    modifier: 0.98,
    note: 'Cool weather can slightly lower sales of cold drinks.',
  },
  {
    value: 'rainy_monsoon',
    label: 'Rainy Day',
    backendWeather: 'rainy',
    modifier: 0.88,
    note: 'Rain can reduce customers and increase demand for warm meals.',
  },
  {
    value: 'thunderstorm',
    label: 'Stormy Day',
    backendWeather: 'rainy',
    modifier: 0.8,
    note: 'Strong rain can reduce walk-in orders, especially in the afternoon.',
  },
  {
    value: 'typhoon',
    label: 'Typhoon',
    backendWeather: 'rainy',
    modifier: 0.58,
    note: 'Typhoon weather can greatly reduce customer traffic and sales.',
  },
];
const EVENT_OPTIONS = [
  {
    value: 'none',
    label: 'Regular Day',
    modifier: 1,
    note: 'Full-day classes usually keep lunch and snack demand steady.',
  },
  {
    value: 'intramurals',
    label: 'Intramurals',
    modifier: 1.18,
    note: 'Sports and campus events can lift drinks, snacks, and quick meals.',
  },
  {
    value: 'exams',
    label: 'Exams',
    modifier: 0.92,
    note: 'Exam schedules can reduce browsing time but keep quick snacks moving.',
  },
  {
    value: 'halfday',
    label: 'Half Day',
    modifier: 0.7,
    note: 'Shorter class days usually lower lunch and afternoon sales.',
  },
];
const STATUS_OPTIONS = [
  { value: 'actionable', label: 'Recommended only' },
  { value: 'all', label: 'All products' },
  { value: 'restock', label: 'Restock' },
  { value: 'reduce_waste', label: 'Use first' },
  { value: 'healthy', label: 'Enough stock' },
  { value: 'low_demand', label: 'Prep light' },
];
const SORT_OPTIONS = [
  { value: 'priority', label: 'Priority' },
  { value: 'demand', label: 'Highest demand' },
  { value: 'revenue', label: 'Highest sales value' },
  { value: 'stock_gap', label: 'Most items short' },
  { value: 'name', label: 'Product name' },
];
const PREP_VIEW_MODES = [
  { value: 'cards', label: 'Card View', icon: Squares2X2Icon },
  { value: 'table', label: 'Table View', icon: TableCellsIcon },
];
const STATUS_META = {
  restock: { label: 'Restock', chip: 'bg-red-100 text-red-700', card: 'border-red-200 bg-red-50/70' },
  reduce_waste: {
    label: 'Use First',
    chip: 'bg-amber-100 text-amber-700',
    card: 'border-amber-200 bg-amber-50/70',
  },
  healthy: {
    label: 'Enough Stock',
    chip: 'bg-emerald-100 text-emerald-700',
    card: 'border-emerald-200 bg-emerald-50/70',
  },
  low_demand: {
    label: 'Prep Light',
    chip: 'bg-slate-200 text-slate-700',
    card: 'border-slate-200 bg-slate-50/70',
  },
};
const RISK_META = {
  low: { label: 'Low', chip: 'bg-emerald-100 text-emerald-700', card: 'border-emerald-200 bg-emerald-50/70' },
  medium: { label: 'Medium', chip: 'bg-amber-100 text-amber-700', card: 'border-amber-200 bg-amber-50/70' },
  high: { label: 'High', chip: 'bg-red-100 text-red-700', card: 'border-red-200 bg-red-50/70' },
};
const ALGORITHM_REFERENCE_METRICS = {
  XGBoost: { accuracy: '91.6%', rmse: '4.21', mape: '8.4%', error_rate: '8.4%', r2: '0.87' },
};
const DEFAULT_METRICS = ALGORITHM_REFERENCE_METRICS.XGBoost;
const EMPTY_MODEL_METRICS = {
  accuracy: '0.00',
  rmse: '0.00',
  mape: '0.00',
  wape: '0.00',
  error_rate: '0.00',
  r2: '0.00',
  accuracy_basis: 'No live metric data',
};
const MODEL_METRIC_TONES = {
  XGBoost: 'bg-blue-50 ring-blue-100 text-blue-700',
};
const SCHOOL_WEEK_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const SCHOOL_WEEKDAY_SALES_WEIGHTS = {
  Mon: 1.08,
  Tue: 1.02,
  Wed: 1,
  Thu: 0.97,
  Fri: 0.9,
};
const SCHOOL_WEEKDAY_FULL_NAMES = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
};
const RECOMMENDATIONS_PER_PAGE = 6;

function scheduleIdleTask(callback) {
  if (typeof window === 'undefined') {
    callback();
    return () => {};
  }

  if ('requestIdleCallback' in window) {
    const idleId = window.requestIdleCallback(callback, {
      timeout: METRIC_REFRESH_IDLE_TIMEOUT_MS,
    });
    return () => window.cancelIdleCallback?.(idleId);
  }

  const timeoutId = window.setTimeout(callback, 0);
  return () => window.clearTimeout(timeoutId);
}

function buildPaginationItems(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set([
    1,
    totalPages,
    currentPage - 1,
    currentPage,
    currentPage + 1,
  ]);
  const normalizedPages = [...pages]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((left, right) => left - right);

  return normalizedPages.flatMap((page, index) => {
    const previousPage = normalizedPages[index - 1];
    if (index > 0 && page - previousPage > 1) {
      return [`ellipsis-${previousPage}-${page}`, page];
    }
    return [page];
  });
}
const TOMORROW_DAY_OPTIONS = [
  { value: 'Monday', label: 'Monday' },
  { value: 'Tuesday', label: 'Tuesday' },
  { value: 'Wednesday', label: 'Wednesday' },
  { value: 'Thursday', label: 'Thursday' },
  { value: 'Friday', label: 'Friday' },
];
const TOMORROW_TREND_OPTIONS = [
  { value: 'rising', label: 'Rising' },
  { value: 'stable', label: 'Stable' },
  { value: 'declining', label: 'Declining' },
];
const TOMORROW_STOCK_OPTIONS = [
  { value: 'high', label: 'High' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'low', label: 'Low' },
  { value: 'critical', label: 'Critical' },
];
const TOMORROW_ALLOWANCE_OPTIONS = [
  { value: 'start_week', label: 'Start of week' },
  { value: 'allowance_day', label: 'Allowance day' },
  { value: 'normal', label: 'Normal' },
  { value: 'end_week', label: 'End of week' },
];
const SALES_OUTLOOK_FACTORS = [
  { key: 'tomorrowDay', title: 'Tomorrow Day' },
  { key: 'weatherContext', title: 'Weather' },
  { key: 'eventContext', title: 'School Day / Event' },
  { key: 'todaySales', title: 'Today Sales' },
  { key: 'recentTrend', title: 'Recent 3-7 Day Trend' },
  { key: 'attendanceTomorrow', title: 'Attendance Tomorrow' },
  { key: 'plannedMenu', title: 'Planned Menu' },
  { key: 'stockLevel', title: 'Inventory Availability' },
  { key: 'allowanceTiming', title: 'Allowance Timing' },
  { key: 'sameDayLastWeek', title: 'Same Day Last Week' },
];
const SALES_OUTLOOK_LOCKED_APP_DATA_KEYS = new Set([
  'tomorrowDay',
  'todaySales',
  'recentTrend',
  'stockLevel',
  'sameDayLastWeek',
]);
const SALES_OUTLOOK_SOURCE_LABELS = {
  app_forecast_summary: 'Forecast summary',
  bootstrap: 'School calendar estimate',
  calendar: 'Calendar',
  calendar_allowance_pattern: 'Calendar allowance pattern',
  forecast: 'Forecasted demand',
  forecasted_top_demand: 'Forecasted top sellers',
  inventory_forecast: 'Inventory and forecast',
  last_3_days_vs_previous_4_days: 'Recent sales trend',
  open_meteo: 'Weather history',
  school_day_event_proxy: 'School day estimate',
  selected: 'Selected plan context',
  transactions_last_7_days: 'Last 7 days sales',
  transactions_same_calendar_weekday: 'Same weekday sales',
  transactions_today: 'Today transactions',
};
const SALES_WEEK_CLASS_META = {
  high: {
    label: 'High Tomorrow Sales',
    chip: 'bg-emerald-100 text-emerald-700',
    card: 'bg-emerald-50/70 ring-emerald-100',
    description: 'Tomorrow demand is above the same-day benchmark.',
  },
  normal: {
    label: 'Normal Tomorrow Sales',
    chip: 'bg-sky-100 text-sky-700',
    card: 'bg-sky-50/70 ring-sky-100',
    description: 'Tomorrow demand is close to the same-day benchmark.',
  },
  low: {
    label: 'Low Tomorrow Sales',
    chip: 'bg-amber-100 text-amber-700',
    card: 'bg-amber-50/70 ring-amber-100',
    description: 'Tomorrow demand is below the same-day benchmark.',
  },
  unavailable: {
    label: 'Waiting for Sales Data',
    chip: 'bg-slate-200 text-slate-700',
    card: 'bg-slate-50/70 ring-slate-100',
    description: 'Add more sales records to generate a tomorrow outlook.',
  },
};
const DEFAULT_FEATURE_SUMMARY = {
  modelFeatureGroups: [
    'recent sales lags',
    'weekday pattern',
    'price signals',
    'time-of-day mix',
    'weather history',
    'school event history',
    'category demand',
    'canteen demand',
  ],
  heuristicFeatureGroups: [
    'historical averages',
    'weekday baseline',
    'weather adjustment',
    'event adjustment',
  ],
  historicalDrivers: {
    weatherDays: 0,
    eventDays: 0,
    startDate: '',
    endDate: '',
    weatherSources: [],
    eventSources: [],
  },
};

function formatCurrency(value) {
  return `PHP ${Number(value || 0).toFixed(2)}`;
}

function formatCompactCurrency(value) {
  return `PHP ${Number(value || 0).toLocaleString('en-PH', {
    maximumFractionDigits: 0,
  })}`;
}

function formatCount(value) {
  return Number(value || 0).toLocaleString('en-PH');
}

function InlineAlert({
  resetKey,
  tone,
  title,
  icon,
  className,
  body,
  helperText,
  helperToneClassName = '',
}) {
  return (
    <DismissibleAlert
      resetKey={resetKey}
      tone={tone}
      title={title}
      icon={icon}
      className={className}
    >
      <>
        {body && <div>{body}</div>}
        {helperText && (
          <div className={`mt-2 text-xs ${helperToneClassName}`.trim()}>{helperText}</div>
        )}
      </>
    </DismissibleAlert>
  );
}

function formatGeneratedAt(value) {
  if (!value) return 'Not available';

  return formatPhilippineDateTime(value, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function normalizeConfidence(value) {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'low';
}

function inferRecommendationType(prediction) {
  if (prediction?.recommendation_type) return prediction.recommendation_type;
  const text = String(prediction?.recommendation || '').toLowerCase();
  if (text.includes('restock')) return 'restock';
  if (text.includes('waste')) return 'reduce_waste';
  if (text.includes('quiet') || text.includes('low demand')) return 'low_demand';
  return 'healthy';
}

function buildRecommendation(type, prediction) {
  if (type === 'restock') return `Restock ${prediction.stock_gap} units to cover expected demand.`;
  if (type === 'reduce_waste') return `Use ${prediction.overstock_units} extra units first to avoid waste.`;
  if (type === 'low_demand') return 'Demand is light. Avoid preparing extra stock for this item.';
  return 'Stock level looks healthy for the projected demand.';
}

function normalizePrediction(prediction, index) {
  const predictedQuantity = Math.max(0, Number(prediction?.predicted_quantity || 0));
  const currentStock = Math.max(0, Number(prediction?.current_stock || 0));
  const type = inferRecommendationType(prediction);
  const stockGap = prediction?.stock_gap !== undefined
    ? Math.max(0, Number(prediction.stock_gap || 0))
    : Math.max(0, predictedQuantity - currentStock);
  const overstockUnits = prediction?.overstock_units !== undefined
    ? Math.max(0, Number(prediction.overstock_units || 0))
    : Math.max(0, currentStock - predictedQuantity);

  const normalized = {
    product_id: prediction?.product_id ?? `prediction-${index}`,
    product_name: prediction?.product_name || `Product ${index + 1}`,
    category: prediction?.category || 'Uncategorized',
    current_stock: currentStock,
    min_stock: Math.max(0, Number(prediction?.min_stock || 0)),
    predicted_quantity: predictedQuantity,
    historical_average: Number(prediction?.historical_average || 0),
    days_observed: Math.max(0, Number(prediction?.days_observed || 0)),
    estimated_revenue: Math.max(0, Number(prediction?.estimated_revenue || 0)),
    confidence: normalizeConfidence(prediction?.confidence),
    prediction_source: prediction?.prediction_source || 'heuristic',
    last_sold_on: prediction?.last_sold_on || null,
    active_feature_groups: Array.isArray(prediction?.active_feature_groups)
      ? prediction.active_feature_groups.map((entry) => String(entry))
      : [],
    fallback_reason: prediction?.fallback_reason || '',
    recommendation_type: type,
    stock_gap: stockGap,
    overstock_units: overstockUnits,
    recommendation: prediction?.recommendation || '',
  };

  normalized.recommendation = normalized.recommendation || buildRecommendation(type, normalized);
  return normalized;
}

function normalizeMetrics(metrics, fallback = DEFAULT_METRICS) {
  return {
    accuracy: metrics?.accuracy || fallback.accuracy,
    rmse: metrics?.rmse || fallback.rmse,
    mape: metrics?.mape || fallback.mape,
    wape: metrics?.wape || metrics?.canteen_wape || metrics?.mape || fallback.wape || fallback.mape,
    error_rate:
      metrics?.error_rate ||
      metrics?.wape ||
      metrics?.canteen_wape ||
      metrics?.mape ||
      fallback.error_rate ||
      fallback.mape,
    r2: metrics?.r2 || metrics?.r_squared || fallback.r2,
    accuracy_basis: metrics?.accuracy_basis || fallback.accuracy_basis || 'school-day canteen WAPE',
  };
}

function normalizeAlgorithmMetrics(rawMetrics, selectedAlgorithm = DEFAULT_ALGORITHM, selectedMetrics = null) {
  const normalized = MODEL_ALGORITHMS.reduce((acc, algorithmName) => {
    acc[algorithmName] = normalizeMetrics(
      rawMetrics?.[algorithmName],
      EMPTY_MODEL_METRICS
    );
    return acc;
  }, {});

  if (selectedMetrics && MODEL_ALGORITHMS.includes(selectedAlgorithm)) {
    normalized[selectedAlgorithm] = normalizeMetrics(
      selectedMetrics,
      EMPTY_MODEL_METRICS
    );
  }

  return normalized;
}

function buildLiveAlgorithmMetrics(primaryAlgorithm, primaryResponse, comparisonAlgorithms, comparisonResults) {
  const liveMetrics = normalizeAlgorithmMetrics(primaryResponse?.algorithm_metrics);

  if (primaryResponse?.metrics && MODEL_ALGORITHMS.includes(primaryAlgorithm)) {
    liveMetrics[primaryAlgorithm] = normalizeMetrics(
      primaryResponse.metrics,
      EMPTY_MODEL_METRICS
    );
  }

  comparisonAlgorithms.forEach((algorithmName, index) => {
    const result = comparisonResults[index];
    if (result?.status !== 'fulfilled') return;
    liveMetrics[algorithmName] = normalizeMetrics(
      result.value?.metrics,
      EMPTY_MODEL_METRICS
    );
  });

  return liveMetrics;
}

function normalizeFeatureSummary(summary) {
  return {
    modelFeatureGroups: Array.isArray(summary?.model_feature_groups)
      ? summary.model_feature_groups.map((entry) => String(entry))
      : DEFAULT_FEATURE_SUMMARY.modelFeatureGroups,
    heuristicFeatureGroups: Array.isArray(summary?.heuristic_feature_groups)
      ? summary.heuristic_feature_groups.map((entry) => String(entry))
      : DEFAULT_FEATURE_SUMMARY.heuristicFeatureGroups,
    historicalDrivers: {
      weatherDays: Number(
        summary?.historical_drivers?.weather_days ??
          DEFAULT_FEATURE_SUMMARY.historicalDrivers.weatherDays
      ),
      eventDays: Number(
        summary?.historical_drivers?.event_days ??
          DEFAULT_FEATURE_SUMMARY.historicalDrivers.eventDays
      ),
      startDate:
        summary?.historical_drivers?.start_date ||
        DEFAULT_FEATURE_SUMMARY.historicalDrivers.startDate,
      endDate:
        summary?.historical_drivers?.end_date ||
        DEFAULT_FEATURE_SUMMARY.historicalDrivers.endDate,
      weatherSources: Array.isArray(summary?.historical_drivers?.weather_sources)
        ? summary.historical_drivers.weather_sources.map((entry) => String(entry))
        : DEFAULT_FEATURE_SUMMARY.historicalDrivers.weatherSources,
      eventSources: Array.isArray(summary?.historical_drivers?.event_sources)
        ? summary.historical_drivers.event_sources.map((entry) => String(entry))
        : DEFAULT_FEATURE_SUMMARY.historicalDrivers.eventSources,
    },
  };
}

function formatWeatherFetchedAt(value) {
  if (!value) return 'Not synced yet';
  return formatPhilippineDateTime(value, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatWeatherDayLabel(value, timezone = 'Asia/Manila') {
  if (!value) return 'Forecast day';
  const date = parseBackendDateTime(value);
  if (!date) return 'Forecast day';

  if (typeof timezone === 'number' && Number.isFinite(timezone)) {
    const shiftedDate = new Date(date.getTime() + timezone * 1000);
    return shiftedDate.toLocaleDateString('en-PH', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  }

  return date.toLocaleDateString('en-PH', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: timezone,
  });
}

function getSchoolDayLabel(value) {
  if (!value) return null;

  const text = String(value).trim();
  const shortLabel = text.slice(0, 3).toLowerCase();
  const labelMap = {
    mon: 'Mon',
    tue: 'Tue',
    wed: 'Wed',
    thu: 'Thu',
    fri: 'Fri',
  };

  if (labelMap[shortLabel]) {
    return labelMap[shortLabel];
  }

  const date = parseBackendDateTime(text);
  if (!date) {
    return null;
  }

  const weekday = getPhilippineWeekday(date);
  return SCHOOL_WEEK_LABELS[weekday - 1] || null;
}

function normalizeTrend(trend) {
  if (!Array.isArray(trend) || trend.length === 0) {
    return SCHOOL_WEEK_LABELS.map((label) => ({ date: label, predicted_sales: 0 }));
  }

  const trendByLabel = new Map();

  trend
    .map((entry) => {
      const label = getSchoolDayLabel(entry?.date);
      if (!label) {
        return null;
      }

      return [label, {
        date: label,
        predicted_sales: Math.max(0, Number(entry?.predicted_sales || 0)),
      }];
    })
    .filter(Boolean)
    .forEach(([label, value]) => {
      trendByLabel.set(label, value);
    });

  return SCHOOL_WEEK_LABELS.map((label) => trendByLabel.get(label) || { date: label, predicted_sales: 0 });
}

function inferForecastDayWeather(day) {
  const description = `${day?.main || ''} ${day?.description || ''}`.toLowerCase();
  const rainChance = Number(day?.rainChance || 0);
  const maxTemp = Number(day?.maxTemp ?? Number.NaN);

  if (description.includes('thunder') || description.includes('storm')) {
    return 'thunderstorm';
  }
  if (description.includes('rain') || description.includes('drizzle') || rainChance >= 45) {
    return 'rainy_monsoon';
  }
  if (description.includes('cloud') || (Number.isFinite(maxTemp) && maxTemp <= 27)) {
    return 'cool_breezy';
  }
  return 'hot_dry';
}

function getForecastWeatherByWeekday(weatherForecast) {
  const weatherByWeekday = new Map();

  if (!Array.isArray(weatherForecast)) {
    return weatherByWeekday;
  }

  weatherForecast.forEach((day) => {
    const label = getSchoolDayLabel(day?.date);
    if (label && SCHOOL_WEEK_LABELS.includes(label) && !weatherByWeekday.has(label)) {
      weatherByWeekday.set(label, inferForecastDayWeather(day));
    }
  });

  return weatherByWeekday;
}

function buildSchoolWeekSalesOutlook(
  weeklyTrend,
  expectedRevenue,
  selectedWeather,
  selectedEvent,
  weatherForecast = []
) {
  const normalizedTrend = normalizeTrend(weeklyTrend);
  const hasBackendTrend = normalizedTrend.some((item) => item.predicted_sales > 0);
  const selectedScenarioModifier = Math.max(0.01, getScenarioModifier(selectedWeather, selectedEvent));
  const weatherByWeekday = getForecastWeatherByWeekday(weatherForecast);
  const baseRevenue = Math.max(0, Number(expectedRevenue || 0));

  return SCHOOL_WEEK_LABELS.map((label) => {
    const forecastWeather = weatherByWeekday.get(label);
    const outlookWeather = forecastWeather || selectedWeather;
    const dayModifier = getScenarioModifier(outlookWeather, selectedEvent);
    const trendItem = normalizedTrend.find((item) => item.date === label);
    const unadjustedSales = hasBackendTrend
      ? Number(trendItem?.predicted_sales || 0) / selectedScenarioModifier
      : (baseRevenue / selectedScenarioModifier) * (SCHOOL_WEEKDAY_SALES_WEIGHTS[label] || 1);

    return {
      date: label,
      predicted_sales: Number(Math.max(0, unadjustedSales * dayModifier).toFixed(2)),
      baseline_sales: Number(Math.max(0, unadjustedSales).toFixed(2)),
      weather: outlookWeather,
      weatherLabel: getWeatherProfile(outlookWeather).label,
      event: selectedEvent,
      eventLabel: getEventProfile(selectedEvent).label,
      usesForecastWeather: Boolean(forecastWeather),
    };
  });
}

function getWeekdayFullName(label) {
  return SCHOOL_WEEKDAY_FULL_NAMES[label] || label;
}

function describeSchoolWeekSalesOutlook(outlook) {
  const salesDays = outlook.filter((item) => item.predicted_sales > 0);
  if (salesDays.length === 0) {
    return 'The diagram will explain which school days are expected to be busier once sales data is available.';
  }

  const firstDay = salesDays[0];
  const lastDay = salesDays[salesDays.length - 1];
  const peakDay = salesDays.reduce(
    (peak, item) => (item.predicted_sales > peak.predicted_sales ? item : peak),
    salesDays[0]
  );
  const quietDay = salesDays.reduce(
    (quietest, item) => (item.predicted_sales < quietest.predicted_sales ? item : quietest),
    salesDays[0]
  );

  const firstName = getWeekdayFullName(firstDay.date);
  const lastName = getWeekdayFullName(lastDay.date);
  const peakName = getWeekdayFullName(peakDay.date);
  const quietName = getWeekdayFullName(quietDay.date);

  const movement =
    lastDay.predicted_sales > firstDay.predicted_sales
      ? `Sales are expected to go higher from ${firstName} (${formatCurrency(firstDay.predicted_sales)}) to ${lastName} (${formatCurrency(lastDay.predicted_sales)}).`
      : lastDay.predicted_sales < firstDay.predicted_sales
        ? `Sales are expected to go lower from ${firstName} (${formatCurrency(firstDay.predicted_sales)}) to ${lastName} (${formatCurrency(lastDay.predicted_sales)}).`
        : `Sales are expected to stay steady from ${firstName} to ${lastName}.`;

  const peakSummary = `${peakName} is the busiest day in the diagram at ${formatCurrency(peakDay.predicted_sales)} with ${peakDay.weatherLabel.toLowerCase()} weather.`;
  const quietSummary =
    quietDay.date !== peakDay.date
      ? `${quietName} is the quietest day at ${formatCurrency(quietDay.predicted_sales)} with ${quietDay.weatherLabel.toLowerCase()} weather.`
      : '';

  return [movement, peakSummary, quietSummary, 'This diagram uses the selected school-day scenario for the whole school week.']
    .filter(Boolean)
    .join(' ');
}

function buildWeeklySummaryItems(outlook) {
  const salesDays = outlook.filter((item) => item.predicted_sales > 0);
  if (salesDays.length === 0) {
    return [describeSchoolWeekSalesOutlook(outlook)];
  }

  const peakDay = salesDays.reduce(
    (peak, item) => (item.predicted_sales > peak.predicted_sales ? item : peak),
    salesDays[0]
  );
  const quietDay = salesDays.reduce(
    (quietest, item) => (item.predicted_sales < quietest.predicted_sales ? item : quietest),
    salesDays[0]
  );
  const weatherInsight = getWeatherBusinessInsight(peakDay.weather);

  return [
    `Highest sales: ${getWeekdayFullName(peakDay.date)} ${formatCurrency(peakDay.predicted_sales)}`,
    `Lowest sales: ${getWeekdayFullName(quietDay.date)} ${formatCurrency(quietDay.predicted_sales)}`,
    `Best weather day: ${peakDay.weatherLabel} ${getWeekdayFullName(peakDay.date)}`,
    `Suggested prep: ${weatherInsight.detail}`,
  ];
}

function getSalesWeekClassMeta(level) {
  return SALES_WEEK_CLASS_META[level] || SALES_WEEK_CLASS_META.unavailable;
}

function getNextSchoolDate(date) {
  const nextDate = new Date(date);
  while (nextDate.getDay() === 0 || nextDate.getDay() === 6) {
    nextDate.setDate(nextDate.getDate() + 1);
  }
  return nextDate;
}

function getTomorrowDate() {
  return getNextSchoolDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
}

function getTomorrowDayName() {
  return formatPhilippineDateTime(getTomorrowDate(), { weekday: 'long' });
}

function normalizeTomorrowDayName(day) {
  const dayName = String(day || '');
  return TOMORROW_DAY_OPTIONS.some((option) => option.value === dayName)
    ? dayName
    : getTomorrowDayName();
}

function getTomorrowSalesBenchmark(outlook) {
  const salesDays = outlook.filter((item) => item.predicted_sales > 0);
  if (salesDays.length === 0) {
    return {
      label: 'Same day last week',
      value: 0,
    };
  }

  const tomorrowSchoolLabel = getSchoolDayLabel(getTomorrowDate());
  const matchedDay = tomorrowSchoolLabel
    ? salesDays.find((item) => item.date === tomorrowSchoolLabel)
    : null;
  const matchedBaseline = Number(matchedDay?.baseline_sales || 0);
  if (matchedBaseline > 0) {
    return {
      label: `Same ${getWeekdayFullName(tomorrowSchoolLabel)} benchmark`,
      value: matchedBaseline,
    };
  }

  const averageBaseline =
    salesDays.reduce((sum, item) => sum + Number(item.baseline_sales || item.predicted_sales || 0), 0) /
    salesDays.length;

  return {
    label: 'Recent weekday benchmark',
    value: Number(averageBaseline.toFixed(2)),
  };
}

function buildTomorrowSalesPredictionSummary(forecastSummary, outlook) {
  const estimatedSales = Math.max(0, Number(forecastSummary?.expected_revenue || 0));
  const benchmark = getTomorrowSalesBenchmark(outlook);
  if (estimatedSales <= 0) {
    return {
      level: 'unavailable',
      estimatedSales: 0,
      benchmarkSales: benchmark.value,
      baselineIndex: 0,
      benchmarkLabel: benchmark.label,
    };
  }

  const baselineIndex = benchmark.value > 0 ? estimatedSales / benchmark.value : 1;
  const level = baselineIndex >= 1.08 ? 'high' : baselineIndex <= 0.92 ? 'low' : 'normal';

  return {
    level,
    estimatedSales: Number(estimatedSales.toFixed(2)),
    benchmarkSales: benchmark.value,
    baselineIndex,
    benchmarkLabel: benchmark.label,
  };
}

function getSalesOutlookStockSignal(summary, riskAnalysis) {
  if (riskAnalysis.totalStockGap > 0) {
    return 'Low on key items';
  }
  if (summary.waste_risk_count > 0 || riskAnalysis.totalOverstockUnits > 0) {
    return 'High stock';
  }
  return 'Balanced stock';
}

function normalizeNumberInput(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getSalesOutlookTrendSignal(outlook) {
  const salesDays = outlook.filter((item) => item.predicted_sales > 0);
  if (salesDays.length < 2) {
    return 'stable';
  }

  const firstSales = Number(salesDays[0].predicted_sales || 0);
  const lastSales = Number(salesDays.at(-1).predicted_sales || 0);
  if (lastSales > firstSales * 1.05) {
    return 'rising';
  }
  if (lastSales < firstSales * 0.95) {
    return 'declining';
  }
  return 'stable';
}

function getTomorrowWeatherValue(weather) {
  if (weather === 'clear') return 'hot';
  if (weather === 'cloudy') return 'cool';
  if (weather === 'rainy') return 'rainy';
  if (weather === 'rainy_monsoon') return 'rainy';
  if (weather === 'thunderstorm') return 'stormy';
  if (weather === 'typhoon') return 'typhoon';
  if (weather === 'cool_breezy') return 'cool';
  return 'hot';
}

function getTomorrowEventValue(event) {
  if (event === 'intramurals') return 'sports';
  if (event === 'exams') return 'exams';
  if (event === 'halfday') return 'halfday';
  return 'regular';
}

function getDayModifier(day) {
  const label = String(day || '').slice(0, 3);
  if (SCHOOL_WEEKDAY_SALES_WEIGHTS[label]) {
    return SCHOOL_WEEKDAY_SALES_WEIGHTS[label];
  }
  return day === 'Saturday' || day === 'Sunday' ? 0.45 : 1;
}

function getWeatherDemandModifier(weather) {
  const modifiers = {
    hot: 1.06,
    cool: 0.98,
    rainy: 0.96,
    stormy: 0.76,
    typhoon: 0.52,
  };
  return modifiers[weather] || 1;
}

function getEventDemandModifier(event) {
  const modifiers = {
    regular: 1,
    exams: 0.92,
    sports: 1.18,
    recognition: 1.08,
    halfday: 0.7,
    suspended: 0.22,
  };
  return modifiers[event] || 1;
}

function getMenuDemandModifier(menu) {
  const text = (Array.isArray(menu) ? menu.join(' ') : String(menu || '')).toLowerCase();
  if (!text.trim() || text.includes('no menu signal')) return 0.94;
  if (text.includes('limited') || text.includes('few') || text.includes('sold out')) return 0.88;
  if (
    text.includes('chicken') ||
    text.includes('burger') ||
    text.includes('juice') ||
    text.includes('pizza') ||
    text.includes('popular')
  ) {
    return 1.1;
  }
  return 1;
}

function getStockDemandModifier(stockLevel) {
  const modifiers = {
    high: 1.03,
    balanced: 1,
    low: 0.82,
    critical: 0.58,
  };
  return modifiers[stockLevel] || 1;
}

function getAllowanceDemandModifier(allowanceTiming) {
  const modifiers = {
    start_week: 1.08,
    allowance_day: 1.12,
    normal: 1,
    end_week: 0.92,
  };
  return modifiers[allowanceTiming] || 1;
}

function getTrendDemandModifier(trend) {
  if (trend === 'rising') return 1.08;
  if (trend === 'declining') return 0.92;
  return 1;
}

function buildFunctionalTomorrowSalesPrediction(inputs) {
  const todaySales = normalizeNumberInput(inputs.todaySales);
  const last7DayAvg = normalizeNumberInput(inputs.last7DayAvg);
  const sameDayLastWeek = normalizeNumberInput(inputs.sameDayLastWeek);
  const attendanceTomorrow = normalizeNumberInput(inputs.attendanceTomorrow, 1180);
  const weightedInputs = [
    { value: todaySales, weight: 0.35 },
    { value: last7DayAvg, weight: 0.3 },
    { value: sameDayLastWeek, weight: 0.25 },
  ].filter((item) => item.value > 0);
  const weightedBase =
    weightedInputs.length > 0
      ? weightedInputs.reduce((sum, item) => sum + item.value * item.weight, 0) /
        weightedInputs.reduce((sum, item) => sum + item.weight, 0)
      : 0;
  const attendanceModifier = clamp(attendanceTomorrow / 1180, 0.45, 1.25);
  const demandModifier =
    getDayModifier(inputs.tomorrowDay) *
    getTrendDemandModifier(inputs.recentTrend) *
    attendanceModifier *
    getWeatherDemandModifier(inputs.weatherTomorrow) *
    getEventDemandModifier(inputs.eventTomorrow) *
    getMenuDemandModifier(inputs.plannedMenuItems?.length > 0 ? inputs.plannedMenuItems : inputs.plannedMenu) *
    getStockDemandModifier(inputs.stockLevel) *
    getAllowanceDemandModifier(inputs.allowanceTiming);
  const estimatedSales = Number(Math.max(0, weightedBase * demandModifier).toFixed(2));
  const benchmarkSales = sameDayLastWeek || last7DayAvg || todaySales || 0;
  const baselineIndex = benchmarkSales > 0 ? estimatedSales / benchmarkSales : 1;
  const level = estimatedSales <= 0
    ? 'unavailable'
    : baselineIndex >= 1.08
      ? 'high'
      : baselineIndex <= 0.92
        ? 'low'
        : 'normal';

  return {
    level,
    estimatedSales,
    benchmarkSales: Number(benchmarkSales.toFixed(2)),
    benchmarkLabel: sameDayLastWeek > 0 ? 'Same day last week' : 'Best available benchmark',
    baselineIndex,
  };
}

function getTomorrowOutlookHeadline(level) {
  if (level === 'high') return 'Tomorrow Outlook: Strong Demand Expected';
  if (level === 'low') return 'Tomorrow Outlook: Lighter Demand Expected';
  if (level === 'unavailable') return 'Tomorrow Outlook: Waiting for Sales Data';
  return 'Tomorrow Outlook: Stable Demand Expected';
}

function getWeatherBusinessInsight(weather) {
  const insights = {
    hot_dry: {
      metric: '+18% cold drinks',
      title: 'Hot weather may lift cold drinks',
      detail: 'Keep chilled drinks, ice cream, and quick snacks visible.',
      tone: 'bg-sky-50 text-sky-700 ring-sky-100',
    },
    cool_breezy: {
      metric: '+12% warm meals',
      title: 'Cool weather can favor soups and noodles',
      detail: 'Prepare more warm meals while keeping drinks moderate.',
      tone: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
    },
    rainy_monsoon: {
      metric: '-25% foot traffic',
      title: 'Rain can reduce walk-in volume',
      detail: 'Shift prep toward hot meals and avoid excess cold drinks.',
      tone: 'bg-amber-50 text-amber-700 ring-amber-100',
    },
    thunderstorm: {
      metric: '-35% afternoon traffic',
      title: 'Stormy weather can shorten buying windows',
      detail: 'Prepare earlier, keep restocks conservative, and watch waste.',
      tone: 'bg-orange-50 text-orange-700 ring-orange-100',
    },
    typhoon: {
      metric: 'High disruption risk',
      title: 'Typhoon conditions may suppress sales',
      detail: 'Keep stock lean until classes and foot traffic are confirmed.',
      tone: 'bg-red-50 text-red-700 ring-red-100',
    },
  };

  return insights[weather] || insights.hot_dry;
}

function getTopForecastItem(predictions, plannedMenuItems = []) {
  const topPrediction = [...predictions]
    .filter((item) => Number(item.predicted_quantity || 0) > 0)
    .sort((left, right) => Number(right.predicted_quantity || 0) - Number(left.predicted_quantity || 0))[0];

  return topPrediction?.product_name || plannedMenuItems[0] || 'No top seller yet';
}

function getWatchItem(predictions) {
  const restockItem = [...predictions]
    .filter((item) => Number(item.stock_gap || 0) > 0)
    .sort((left, right) => Number(right.stock_gap || 0) - Number(left.stock_gap || 0))[0];

  if (restockItem) {
    return `${restockItem.product_name} low stock`;
  }

  const wasteItem = [...predictions]
    .filter((item) => Number(item.overstock_units || 0) > 0)
    .sort((left, right) => Number(right.overstock_units || 0) - Number(left.overstock_units || 0))[0];

  return wasteItem ? `${wasteItem.product_name} use first` : 'No urgent watch item';
}

function getSalesOutlookSourceLabel(source, fallback = 'App data') {
  const key = String(source || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return SALES_OUTLOOK_SOURCE_LABELS[key] || fallback;
}

function getBackendInputSource(backendInputs, key, fallback) {
  return getSalesOutlookSourceLabel(backendInputs[key]?.source, fallback);
}

function buildForecastedMenuLabel(predictions) {
  const topItems = [...predictions]
    .filter((item) => Number(item.predicted_quantity || 0) > 0)
    .sort((left, right) => Number(right.predicted_quantity || 0) - Number(left.predicted_quantity || 0))
    .slice(0, 2)
    .map((item) => item.product_name)
    .filter(Boolean);

  return topItems.length > 0 ? topItems.join(' + ') : 'No menu signal yet';
}

function splitPlannedMenuItems(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value || '')
    .split(/\s*\+\s*|[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildPlannedMenuLabel(items) {
  return splitPlannedMenuItems(items).join(' + ');
}

function estimateAttendanceTomorrow(tomorrowDay, eventTomorrow) {
  const dayIndex = TOMORROW_DAY_OPTIONS.findIndex((option) => option.value === tomorrowDay);
  const weekdayFactor = {
    0: 1.04,
    1: 1,
    2: 1,
    3: 0.98,
    4: 0.92,
    5: 0.2,
    6: 0.12,
  }[dayIndex] ?? 1;
  const eventFactor = {
    regular: 1,
    exams: 0.9,
    sports: 1.05,
    recognition: 1.02,
    halfday: 0.72,
    suspended: 0,
  }[eventTomorrow] ?? 1;

  return String(Math.round(1180 * weekdayFactor * eventFactor));
}

function getAllowanceTimingValue(date = getTomorrowDate()) {
  const day = date.getDay();
  if (day === 1) return 'start_week';
  if (day === 5) return 'end_week';
  return 'normal';
}

function buildTomorrowSalesOutlookDefaults({
  backendOutlook,
  event,
  forecastSummary,
  predictions = [],
  riskAnalysis,
  schoolWeekSalesOutlook,
  tomorrowSalesPrediction,
  weather,
}) {
  const backendInputs = backendOutlook?.inputs || {};
  const benchmarkSales = Number(tomorrowSalesPrediction?.benchmarkSales || 0);
  const stockSignal = getSalesOutlookStockSignal(forecastSummary, riskAnalysis);
  const tomorrowDay = normalizeTomorrowDayName(backendInputs.tomorrow_day?.value || getTomorrowDayName());
  const eventTomorrow = getTomorrowEventValue(event || backendInputs.event?.event_type);
  const plannedMenu = backendInputs.planned_menu?.value || buildForecastedMenuLabel(predictions);
  const plannedMenuItems = plannedMenu === 'No menu signal yet' ? [] : splitPlannedMenuItems(plannedMenu);

  return {
    tomorrowDay,
    todaySales: Number(
      backendInputs.today_sales?.value ??
        tomorrowSalesPrediction?.estimatedSales ??
        forecastSummary.expected_revenue ??
        0
    ).toFixed(2),
    last7DayAvg: Number(
      backendInputs.last_7_day_avg?.value ?? benchmarkSales ?? forecastSummary.expected_revenue ?? 0
    ).toFixed(2),
    recentTrend: backendInputs.recent_sales_trend?.value || getSalesOutlookTrendSignal(schoolWeekSalesOutlook),
    attendanceTomorrow: String(
      backendInputs.attendance_forecast?.value ?? estimateAttendanceTomorrow(tomorrowDay, eventTomorrow)
    ),
    weatherTomorrow: getTomorrowWeatherValue(weather || backendInputs.weather_forecast?.weather),
    eventTomorrow,
    plannedMenu: buildPlannedMenuLabel(plannedMenuItems) || plannedMenu,
    plannedMenuItems,
    stockLevel: backendInputs.stock_level?.value || (stockSignal.startsWith('Low')
      ? 'low'
      : stockSignal.startsWith('High')
        ? 'high'
        : 'balanced'),
    allowanceTiming: backendInputs.allowance_timing?.value || getAllowanceTimingValue(),
    sameDayLastWeek: Number(backendInputs.same_day_last_week?.value ?? benchmarkSales ?? 0).toFixed(2),
    sources: {
      tomorrowDay: getBackendInputSource(backendInputs, 'tomorrow_day', 'Calendar'),
      todaySales: getBackendInputSource(backendInputs, 'today_sales', 'Today transactions'),
      recentTrend: getBackendInputSource(backendInputs, 'recent_sales_trend', 'Recent sales trend'),
      attendanceTomorrow: getBackendInputSource(backendInputs, 'attendance_forecast', 'School day estimate'),
      weatherTomorrow: getBackendInputSource(backendInputs, 'weather_forecast', 'Selected plan context'),
      eventTomorrow: getBackendInputSource(backendInputs, 'event', 'Selected plan context'),
      weatherContext: 'Selected plan context',
      eventContext: 'Selected plan context',
      plannedMenu: getBackendInputSource(backendInputs, 'planned_menu', 'Forecasted top sellers'),
      stockLevel: getBackendInputSource(backendInputs, 'stock_level', 'Inventory and forecast'),
      allowanceTiming: getBackendInputSource(backendInputs, 'allowance_timing', 'Calendar allowance pattern'),
      sameDayLastWeek: getBackendInputSource(backendInputs, 'same_day_last_week', 'Same weekday sales'),
    },
  };
}

function deriveSummary(predictions) {
  const totalProducts = predictions.length;
  const restockCount = predictions.filter((item) => item.recommendation_type === 'restock').length;
  const wasteRiskCount = predictions.filter((item) => item.recommendation_type === 'reduce_waste').length;
  const expectedRevenue = predictions.reduce((sum, item) => sum + Number(item.estimated_revenue || 0), 0);
  const expectedUnits = predictions.reduce((sum, item) => sum + Number(item.predicted_quantity || 0), 0);
  const modelBackedPredictions = predictions.filter((item) => item.prediction_source === 'ml+heuristic').length;

  return {
    total_products: totalProducts,
    restock_count: restockCount,
    waste_risk_count: wasteRiskCount,
    expected_revenue: Number(expectedRevenue.toFixed(2)),
    expected_units: expectedUnits,
    model_backed_predictions: modelBackedPredictions,
    heuristic_predictions: totalProducts - modelBackedPredictions,
  };
}

function deriveInsights(predictions, summary, dataSource) {
  const insights = [];
  const restockItems = predictions.filter((item) => item.recommendation_type === 'restock');
  const wasteItems = predictions.filter((item) => item.recommendation_type === 'reduce_waste');

  if (restockItems.length > 0) {
    const topRestock = [...restockItems].sort((left, right) => right.stock_gap - left.stock_gap)[0];
    insights.push({
      type: 'restock',
      title: 'Highest restock priority',
      message: `${topRestock.product_name} needs ${topRestock.stock_gap} more units.`,
    });
  }

  if (wasteItems.length > 0) {
    const topWaste = [...wasteItems].sort((left, right) => right.overstock_units - left.overstock_units)[0];
    insights.push({
      type: 'reduce_waste',
      title: 'Largest waste risk',
      message: `${topWaste.product_name} has ${topWaste.overstock_units} extra units above forecast.`,
    });
  }

  if (predictions.length > 0) {
    const topDemand = [...predictions].sort((left, right) => right.predicted_quantity - left.predicted_quantity)[0];
    insights.push({
      type: 'healthy',
      title: 'Highest projected demand',
      message: `${topDemand.product_name} is forecast to sell ${topDemand.predicted_quantity} units.`,
    });
  }

  if (summary.heuristic_predictions > 0 && dataSource !== 'ml+heuristic') {
    insights.push({
      type: 'low_demand',
      title: 'Heuristic mode active',
      message: 'The forecast is using historical averages because model-ready data is still limited.',
    });
  }

  if (insights.length === 0) {
    insights.push({
      type: 'healthy',
      title: 'Forecast is ready',
      message: 'Generate more transactions over time to unlock deeper demand patterns and tighter recommendations.',
    });
  }

  return insights.slice(0, 4);
}

function normalizeInsights(insights, predictions, summary, dataSource) {
  if (Array.isArray(insights) && insights.length > 0) {
    return insights.map((entry, index) => ({
      type: entry?.type || 'healthy',
      title: entry?.title || `Insight ${index + 1}`,
      message: entry?.message || 'No detail provided.',
    }));
  }

  return deriveInsights(predictions, summary, dataSource);
}

function normalizeForecastResponse(response, selectedAlgorithm = DEFAULT_ALGORITHM) {
  const predictions = Array.isArray(response?.predictions) ? response.predictions.map(normalizePrediction) : [];
  const derivedSummary = deriveSummary(predictions);
  const summary = {
    total_products: Number(response?.summary?.total_products ?? derivedSummary.total_products),
    restock_count: Number(response?.summary?.restock_count ?? derivedSummary.restock_count),
    waste_risk_count: Number(response?.summary?.waste_risk_count ?? derivedSummary.waste_risk_count),
    expected_revenue: Number(response?.summary?.expected_revenue ?? derivedSummary.expected_revenue),
    expected_units: Number(response?.summary?.expected_units ?? derivedSummary.expected_units),
    model_backed_predictions: Number(
      response?.summary?.model_backed_predictions ?? derivedSummary.model_backed_predictions
    ),
    heuristic_predictions: Number(
      response?.summary?.heuristic_predictions ?? derivedSummary.heuristic_predictions
    ),
  };
  const dataSource =
    response?.data_source ||
    (summary.model_backed_predictions > 0 ? 'ml+heuristic' : 'heuristic');

  return {
    metrics: normalizeMetrics(response?.metrics),
    algorithmMetrics: normalizeAlgorithmMetrics(
      response?.algorithm_metrics,
      selectedAlgorithm,
      response?.metrics
    ),
    featureSummary: normalizeFeatureSummary(response?.feature_summary),
    predictions,
    weeklyTrend: normalizeTrend(response?.weekly_sales_trend),
    summary,
    tomorrowSalesOutlook: response?.tomorrow_sales_outlook || null,
    insights: normalizeInsights(response?.insights, predictions, summary, dataSource),
    dataSource,
    generatedAt: response?.generated_at || new Date().toISOString(),
    backendError: response?.error || '',
  };
}

function getWeatherProfile(weather) {
  return WEATHER_OPTIONS.find((option) => option.value === weather) || WEATHER_OPTIONS[0];
}

function getEventProfile(event) {
  return EVENT_OPTIONS.find((option) => option.value === event) || EVENT_OPTIONS[0];
}

function getFallbackOpenWeatherCoordinates() {
  return {
    lat: OPENWEATHER_LAT || DEFAULT_OPENWEATHER_LAT,
    lon: OPENWEATHER_LON || DEFAULT_OPENWEATHER_LON,
    source: OPENWEATHER_LAT && OPENWEATHER_LON ? 'configured coordinates' : 'default Manila coordinates',
  };
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Device location is not available in this browser.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 300000,
    });
  });
}

async function resolveOpenWeatherCoordinates() {
  const fallback = getFallbackOpenWeatherCoordinates();

  try {
    const position = await getCurrentPosition();
    const latitude = Number(position?.coords?.latitude);
    const longitude = Number(position?.coords?.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return fallback;
    }

    return {
      lat: latitude.toFixed(6),
      lon: longitude.toFixed(6),
      source: 'Device Location',
    };
  } catch {
    return fallback;
  }
}

function buildOpenWeatherRequestUrl(coordinates = getFallbackOpenWeatherCoordinates()) {
  if (!OPENWEATHER_API_KEY) {
    return '';
  }

  const url = new URL('https://api.openweathermap.org/data/2.5/weather');
  url.searchParams.set('lat', coordinates.lat);
  url.searchParams.set('lon', coordinates.lon);
  url.searchParams.set('appid', OPENWEATHER_API_KEY);
  url.searchParams.set('units', 'metric');
  return url.toString();
}

function buildOpenWeatherForecastUrl(coordinates = getFallbackOpenWeatherCoordinates()) {
  if (!OPENWEATHER_API_KEY) {
    return '';
  }

  const url = new URL('https://api.openweathermap.org/data/2.5/forecast');
  url.searchParams.set('lat', coordinates.lat);
  url.searchParams.set('lon', coordinates.lon);
  url.searchParams.set('appid', OPENWEATHER_API_KEY);
  url.searchParams.set('units', 'metric');
  return url.toString();
}

function mapOpenWeatherToScenario(payload) {
  const weatherId = Number(payload?.weather?.[0]?.id || 0);
  const condition = String(payload?.weather?.[0]?.main || '').toLowerCase();
  const temperature = Number(payload?.main?.temp ?? Number.NaN);
  const windSpeed = Number(payload?.wind?.speed ?? 0);

  if (windSpeed >= 33) {
    return 'typhoon';
  }
  if (weatherId >= 200 && weatherId < 300) {
    return 'thunderstorm';
  }
  if (weatherId >= 300 && weatherId < 600 || condition.includes('rain') || condition.includes('drizzle')) {
    return windSpeed >= 17 ? 'thunderstorm' : 'rainy_monsoon';
  }
  if (condition.includes('storm') || condition.includes('squall') || condition.includes('tornado')) {
    return 'thunderstorm';
  }
  if (condition.includes('cloud') || weatherId >= 801) {
    return 'cool_breezy';
  }
  if (Number.isFinite(temperature) && temperature <= 24) {
    return 'cool_breezy';
  }
  return 'hot_dry';
}

function buildForecastDayKey(unixSeconds, timezoneOffsetSeconds = 0) {
  const shiftedDate = new Date((Number(unixSeconds || 0) + Number(timezoneOffsetSeconds || 0)) * 1000);
  const year = shiftedDate.getUTCFullYear();
  const month = String(shiftedDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shiftedDate.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getForecastLocalHour(unixSeconds, timezoneOffsetSeconds = 0) {
  const shiftedDate = new Date((Number(unixSeconds || 0) + Number(timezoneOffsetSeconds || 0)) * 1000);
  return shiftedDate.getUTCHours();
}

function isForecastWeekday(dayKey) {
  const date = new Date(`${dayKey}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const dayOfWeek = date.getUTCDay();
  return dayOfWeek >= 1 && dayOfWeek <= 5;
}

function addDaysToForecastDayKey(dayKey, daysToAdd = 1) {
  const date = new Date(`${dayKey}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  date.setUTCDate(date.getUTCDate() + daysToAdd);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getNextForecastWeekdayKey(dayKey) {
  let nextDayKey = addDaysToForecastDayKey(dayKey, 1);

  while (nextDayKey && !isForecastWeekday(nextDayKey)) {
    nextDayKey = addDaysToForecastDayKey(nextDayKey, 1);
  }

  return nextDayKey;
}

function buildForecastDateFromDayKey(dayKey, timezoneOffsetSeconds = 0) {
  const [year, month, day] = String(dayKey || '').split('-').map(Number);
  if (!year || !month || !day) {
    return null;
  }

  const localNoonUtcMs = Date.UTC(year, month - 1, day, 12, 0, 0) - Number(timezoneOffsetSeconds || 0) * 1000;
  return new Date(localNoonUtcMs).toISOString();
}

function buildOpenWeatherDayItem(dayKey, entries, timezone, index) {
  const representativeEntry =
    [...entries].sort((left, right) => {
      const leftDistance = Math.abs(getForecastLocalHour(left?.dt, timezone) - 12);
      const rightDistance = Math.abs(getForecastLocalHour(right?.dt, timezone) - 12);
      return leftDistance - rightDistance;
    })[0] || entries[0];
  const mainTemperatures = entries.map((entry) => Number(entry?.main?.temp ?? 0));
  const minTemperatures = entries.map((entry) =>
    Number(entry?.main?.temp_min ?? entry?.main?.temp ?? 0)
  );
  const maxTemperatures = entries.map((entry) =>
    Number(entry?.main?.temp_max ?? entry?.main?.temp ?? 0)
  );
  const rainChance = Math.max(
    0,
    ...entries.map((entry) => Math.round(Number(entry?.pop ?? 0) * 100))
  );

  return {
    id: `${dayKey}-${index}`,
    date: representativeEntry?.dt
      ? new Date(Number(representativeEntry.dt) * 1000).toISOString()
      : buildForecastDateFromDayKey(dayKey, timezone),
    description: representativeEntry?.weather?.[0]?.description || 'Weather details unavailable',
    main: representativeEntry?.weather?.[0]?.main || 'Weather',
    minTemp: Math.min(...minTemperatures, ...mainTemperatures),
    maxTemp: Math.max(...maxTemperatures, ...mainTemperatures),
    rainChance,
  };
}

function buildEstimatedForecastDayItem(dayKey, sourceItem, timezone, index) {
  return {
    id: `${dayKey}-${index}`,
    date: buildForecastDateFromDayKey(dayKey, timezone),
    description: sourceItem?.description || 'Weather details unavailable',
    main: sourceItem?.main || 'Weather',
    minTemp: Number(sourceItem?.minTemp ?? 0),
    maxTemp: Number(sourceItem?.maxTemp ?? 0),
    rainChance: Number(sourceItem?.rainChance ?? 0),
  };
}

function normalizeOpenWeatherDailyForecast(payload) {
  const timezone = Number(payload?.city?.timezone ?? 28800);
  if (!Array.isArray(payload?.list)) {
    return { timezone, items: [] };
  }

  const groupedDays = new Map();
  payload.list.forEach((entry) => {
    const dayKey = buildForecastDayKey(entry?.dt, timezone);
    if (!groupedDays.has(dayKey)) {
      groupedDays.set(dayKey, []);
    }
    groupedDays.get(dayKey).push(entry);
  });

  const groupedDayEntries = Array.from(groupedDays.entries()).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey)
  );
  const weekdayItems = groupedDayEntries
    .filter(([dayKey]) => isForecastWeekday(dayKey))
    .map(([dayKey, entries], index) => buildOpenWeatherDayItem(dayKey, entries, timezone, index));
  const items = weekdayItems.slice(0, 5);

  if (items.length === 0 && groupedDayEntries.length === 0) {
    return { timezone, items };
  }

  const fallbackSource =
    items.at(-1) ||
    (groupedDayEntries[0]
      ? buildOpenWeatherDayItem(groupedDayEntries[0][0], groupedDayEntries[0][1], timezone, 0)
      : null);
  let nextDayKey = items.at(-1)?.id?.split('-').slice(0, 3).join('-') || groupedDayEntries[0]?.[0] || '';

  while (items.length < 5 && nextDayKey) {
    nextDayKey = getNextForecastWeekdayKey(nextDayKey);
    if (!nextDayKey) {
      break;
    }

    const existingEntries = groupedDays.get(nextDayKey);
    const nextItem = existingEntries
      ? buildOpenWeatherDayItem(nextDayKey, existingEntries, timezone, items.length)
      : buildEstimatedForecastDayItem(nextDayKey, fallbackSource, timezone, items.length);

    items.push(nextItem);
  }

  return {
    timezone,
    items,
  };
}

async function readOpenWeatherError(response, fallbackMessage) {
  try {
    const payload = await response.json();
    if (payload?.message) {
      return String(payload.message);
    }
  } catch {
    // Ignore JSON parsing errors and fall back to a generic message.
  }

  return fallbackMessage;
}

function getScenarioModifier(weather, event) {
  const weatherProfile = getWeatherProfile(weather);
  const eventProfile = getEventProfile(event);
  return weatherProfile.modifier * Number(eventProfile.modifier || 1);
}

function normalizeCatalogProducts(products) {
  if (!Array.isArray(products)) {
    return [];
  }

  return products.map((product, index) => ({
    id: product?.id ?? `catalog-${index}`,
    name: product?.name || `Product ${index + 1}`,
    category: product?.category || 'Uncategorized',
    stock: Math.max(0, Number(product?.stock || 0)),
    min_stock: Math.max(0, Number(product?.min_stock || 0)),
    price: Math.max(0, Number(product?.price || 0)),
  }));
}

function getCatalogFallbackMessaging(dataSource) {
  const source = String(dataSource || '').toLowerCase();

  if (!source || source === 'catalog-fallback' || source === 'error') {
    return {
      fallbackReason:
        'Live forecasting was unavailable, so this product is using a catalog-based fallback estimate.',
      recommendation:
        'This product used a stock-based catalog estimate because live forecasting was unavailable.',
    };
  }

  return {
    fallbackReason:
      'This product is using a catalog-based fallback estimate because the detailed live forecast row was missing.',
    recommendation:
      'This product used a stock-based catalog estimate because a detailed live forecast row was missing.',
  };
}

function buildCatalogFallbackPrediction(product, index, weather, event, { dataSource = 'catalog-fallback' } = {}) {
  const modifier = getScenarioModifier(weather, event);
  const baselineDemand =
    product.min_stock > 0
      ? Math.max(1, Math.round(product.min_stock * 0.8))
      : Math.max(1, Math.round(Math.max(product.stock, 1) * 0.35));
  const predictedQuantity = Math.max(0, Math.round(baselineDemand * modifier));
  const messaging = getCatalogFallbackMessaging(dataSource);

  return normalizePrediction(
    {
      product_id: product.id ?? `catalog-${index}`,
      product_name: product.name,
      category: product.category,
      current_stock: product.stock,
      min_stock: product.min_stock,
      predicted_quantity: predictedQuantity,
      historical_average: 0,
      days_observed: 0,
      estimated_revenue: Number((predictedQuantity * product.price).toFixed(2)),
      confidence: 'low',
      prediction_source: 'catalog-fallback',
      active_feature_groups: DEFAULT_FEATURE_SUMMARY.heuristicFeatureGroups,
      fallback_reason: messaging.fallbackReason,
      last_sold_on: null,
      recommendation: messaging.recommendation,
    },
    index
  );
}

function ensureForecastCoverage(baseForecast, catalogProducts, weather, event) {
  if (!catalogProducts.length) {
    return { ...baseForecast, missingPredictionCount: 0 };
  }

  const existingIds = new Set(baseForecast.predictions.map((item) => String(item.product_id)));
  const missingPredictions = catalogProducts
    .filter((product) => !existingIds.has(String(product.id)))
    .map((product, index) =>
      buildCatalogFallbackPrediction(product, index, weather, event, {
        dataSource: baseForecast.dataSource,
      })
    );

  if (missingPredictions.length === 0) {
    return { ...baseForecast, missingPredictionCount: 0 };
  }

  const predictions = [...baseForecast.predictions, ...missingPredictions];
  const summary = deriveSummary(predictions);
  const fallbackInsight = {
    type: 'low_demand',
    title: 'Coverage completed with fallback rows',
    message: `${missingPredictions.length} product${missingPredictions.length > 1 ? 's were' : ' was'} added from the catalog so every active item has a forecast.`,
  };
  const insights = [fallbackInsight, ...deriveInsights(predictions, summary, 'catalog-fallback')].slice(0, 4);

  return {
    ...baseForecast,
    predictions,
    summary,
    insights,
    dataSource:
      baseForecast.dataSource === 'ml+heuristic'
        ? 'ml+heuristic+catalog'
        : 'catalog-fallback',
    missingPredictionCount: missingPredictions.length,
  };
}

function buildCatalogOnlyForecast(catalogProducts, weather, event) {
  const predictions = catalogProducts.map((product, index) =>
    buildCatalogFallbackPrediction(product, index, weather, event, {
      dataSource: 'catalog-fallback',
    })
  );
  const summary = deriveSummary(predictions);

  return {
    metrics: DEFAULT_METRICS,
    algorithmMetrics: normalizeAlgorithmMetrics(),
    featureSummary: DEFAULT_FEATURE_SUMMARY,
    predictions,
    weeklyTrend: normalizeTrend([]),
    summary,
    insights: [
      {
        type: 'low_demand',
        title: 'Catalog fallback mode',
        message: 'Live prediction rows were unavailable, so the page built low-confidence forecasts for all active products from the product catalog.',
      },
      ...deriveInsights(predictions, summary, 'catalog-fallback'),
    ].slice(0, 4),
    dataSource: 'catalog-fallback',
    generatedAt: new Date().toISOString(),
    backendError: 'Using catalog fallback coverage.',
    missingPredictionCount: predictions.length,
  };
}

function getRiskLevel(points) {
  if (points >= 7) return 'high';
  if (points >= 4) return 'medium';
  return 'low';
}

function getRiskMeta(level) {
  return RISK_META[level] || RISK_META.low;
}

function getWeatherRiskMessage(weather) {
  if (weather === 'typhoon') return 'Bad weather may greatly reduce customer traffic.';
  if (weather === 'thunderstorm') return 'Strong rain may reduce walk-in sales in the afternoon.';
  if (weather === 'rainy_monsoon') return 'Rain may lower customer traffic and change meal choices.';
  if (weather === 'cool_breezy') return 'Cool weather may slightly lower cold drink sales.';
  return 'Hot weather may increase sales of cold drinks and desserts.';
}

function getEventRiskMessage(event) {
  if (event === 'intramurals') return 'Intramurals can quickly change demand during break time.';
  if (event === 'exams') return 'Exams may lower demand for some items and shift peak hours.';
  if (event === 'halfday') return 'Half day schedules can shorten selling hours.';
  return 'No special event risk was added.';
}

function deriveRiskAnalysis(predictions, summary, weather, event, dataSource) {
  const restockItems = predictions.filter((item) => item.recommendation_type === 'restock');
  const wasteItems = predictions.filter((item) => item.recommendation_type === 'reduce_waste');
  const lowConfidenceItems = predictions.filter((item) => item.confidence === 'low');
  const totalStockGap = restockItems.reduce((sum, item) => sum + Number(item.stock_gap || 0), 0);
  const totalOverstockUnits = wasteItems.reduce((sum, item) => sum + Number(item.overstock_units || 0), 0);
  const source = String(dataSource || '');

  const supplyRiskPoints =
    totalStockGap >= 25 || summary.restock_count >= 5
      ? 3
      : totalStockGap >= 10 || summary.restock_count >= 3
        ? 2
        : summary.restock_count > 0
          ? 1
          : 0;

  const wasteRiskPoints =
    totalOverstockUnits >= 20 || summary.waste_risk_count >= 4
      ? 2
      : totalOverstockUnits >= 8 || summary.waste_risk_count >= 2
        ? 1
        : 0;

  const weatherRiskPoints =
    weather === 'typhoon'
      ? 3
      : weather === 'thunderstorm'
        ? 2
        : weather === 'rainy_monsoon'
          ? 1
          : 0;

  const eventRiskPoints = event === 'none' ? 0 : 1;

  const forecastRiskPoints =
    source === 'catalog-fallback'
      ? 3
      : source.includes('catalog')
        ? 2
        : lowConfidenceItems.length >= Math.ceil(Math.max(predictions.length, 1) * 0.5)
          ? 2
          : lowConfidenceItems.length > 0 || summary.heuristic_predictions > 0
            ? 1
            : 0;

  const overallLevel = getRiskLevel(
    supplyRiskPoints + wasteRiskPoints + weatherRiskPoints + eventRiskPoints + forecastRiskPoints
  );
  const supplyLevel = getRiskLevel(supplyRiskPoints * 2);
  const wasteLevel = getRiskLevel(wasteRiskPoints * 2);
  const weatherLevel = getRiskLevel(weatherRiskPoints + eventRiskPoints + 1);
  const forecastLevel = getRiskLevel(forecastRiskPoints * 2);

  const alerts = [];

  if (summary.restock_count > 0) {
    alerts.push({
      level: supplyLevel,
      title: 'Supply risk',
      message: `${summary.restock_count} product${summary.restock_count > 1 ? 's may' : ' may'} run short. Total stock gap is ${formatCount(totalStockGap)} units.`,
    });
  }

  if (summary.waste_risk_count > 0) {
    alerts.push({
      level: wasteLevel,
      title: 'Waste risk',
      message: `${summary.waste_risk_count} product${summary.waste_risk_count > 1 ? 's have' : ' has'} extra stock. Total overstock is ${formatCount(totalOverstockUnits)} units.`,
    });
  }

  alerts.push({
    level: weatherLevel,
    title: 'Weather and event risk',
    message: `${getWeatherRiskMessage(weather)} ${getEventRiskMessage(event)}`,
  });

  if (forecastLevel !== 'low' || alerts.length < 3) {
    alerts.push({
      level: forecastLevel,
      title: 'Forecast quality risk',
      message:
        lowConfidenceItems.length > 0 || summary.heuristic_predictions > 0
          ? `${formatCount(lowConfidenceItems.length)} low-confidence product${lowConfidenceItems.length !== 1 ? 's' : ''} and ${formatCount(summary.heuristic_predictions)} heuristic forecast${summary.heuristic_predictions !== 1 ? 's' : ''} need closer review.`
          : 'Forecast quality looks stable for the current run.',
    });
  }

  if (alerts.length === 0) {
    alerts.push({
      level: 'low',
      title: 'Risk status',
      message: 'The current forecast looks stable. No major risk was found.',
    });
  }

  const overallMessage =
    overallLevel === 'high'
      ? 'High risk. Review stock and weather before service starts.'
      : overallLevel === 'medium'
        ? 'Medium risk. Check the flagged products before service.'
        : 'Low risk. The current forecast looks stable.';

  return {
    overallLevel,
    overallMessage,
    supplyLevel,
    wasteLevel,
    weatherLevel,
    forecastLevel,
    totalStockGap,
    totalOverstockUnits,
    lowConfidenceCount: lowConfidenceItems.length,
    alerts: alerts.slice(0, 4),
  };
}

function getStatusMeta(type) {
  return STATUS_META[type] || STATUS_META.healthy;
}

function isActionablePrediction(prediction) {
  return (
    prediction.recommendation_type === 'restock' ||
    prediction.recommendation_type === 'reduce_waste' ||
    prediction.recommendation_type === 'low_demand' ||
    prediction.stock_gap > 0 ||
    prediction.overstock_units > 0
  );
}

function comparePredictions(left, right, sortBy) {
  if (sortBy === 'name') return left.product_name.localeCompare(right.product_name);
  if (sortBy === 'demand') return right.predicted_quantity - left.predicted_quantity;
  if (sortBy === 'revenue') return right.estimated_revenue - left.estimated_revenue;
  if (sortBy === 'stock_gap') return right.stock_gap - left.stock_gap;

  const priorityRank = { restock: 0, reduce_waste: 1, healthy: 2, low_demand: 3 };
  return (
    (priorityRank[left.recommendation_type] ?? 99) -
      (priorityRank[right.recommendation_type] ?? 99) ||
    right.predicted_quantity - left.predicted_quantity
  );
}

function getPredictionActionDisplay(item) {
  if (item.stock_gap > 0) {
    return {
      title: 'Need More',
      value: formatCount(item.stock_gap),
      tone: 'text-red-700',
    };
  }

  if (item.overstock_units > 0) {
    return {
      title: 'Use First',
      value: formatCount(item.overstock_units),
      tone: 'text-amber-700',
    };
  }

  if (item.recommendation_type === 'low_demand') {
    return {
      title: 'Prep Light',
      value: 'Low',
      tone: 'text-slate-700',
    };
  }

  return {
    title: 'Status',
    value: 'OK',
    tone: 'text-emerald-700',
  };
}

function EmptyState({ title, message, action }) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 text-center">
      <ChartBarIcon className="h-10 w-10 text-slate-300" />
      <h3 className="mt-4 text-lg font-black text-slate-800">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-slate-500">{message}</p>
      {action}
    </div>
  );
}

function TomorrowSalesOutlookInputs({
  event,
  eventProfile,
  initialInputs,
  loading,
  onEventChange,
  onSyncWeather,
  onUpdatePlan,
  onWeatherChange,
  predictions = [],
  selectedAlgorithm,
  weather,
  weatherProfile,
  weatherSyncing,
}) {
  const [inputs, setInputs] = useState(() => initialInputs);
  const [manualMode, setManualMode] = useState(false);
  const [menuDraft, setMenuDraft] = useState('');
  const prediction = buildFunctionalTomorrowSalesPrediction(inputs);
  const predictionMeta = getSalesWeekClassMeta(prediction.level);
  const plannedMenuItems = splitPlannedMenuItems(
    inputs.plannedMenuItems?.length > 0 ? inputs.plannedMenuItems : inputs.plannedMenu
  );
  const weatherInsight = getWeatherBusinessInsight(weather);
  const topForecastItem = getTopForecastItem(predictions, plannedMenuItems);
  const watchItem = getWatchItem(predictions);
  const baseFieldClassName =
    'mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500';

  function updateInput(key, value) {
    setInputs((current) => ({ ...current, [key]: value }));
  }

  function updatePlannedMenuItems(nextItems) {
    const normalizedItems = splitPlannedMenuItems(nextItems);
    setInputs((current) => ({
      ...current,
      plannedMenu: buildPlannedMenuLabel(normalizedItems),
      plannedMenuItems: normalizedItems,
    }));
  }

  function getFieldClassName(disabled) {
    return `${baseFieldClassName} ${disabled ? 'bg-slate-100 text-slate-500' : 'bg-white text-slate-800'}`;
  }

  function isAutoLocked(key) {
    return SALES_OUTLOOK_LOCKED_APP_DATA_KEYS.has(key) && !manualMode;
  }

  function resetToAppData() {
    setInputs(initialInputs);
    setManualMode(false);
    setMenuDraft('');
  }

  function toggleManualMode() {
    if (manualMode) {
      resetToAppData();
      return;
    }
    setManualMode(true);
  }

  function addPlannedMenuItem() {
    const item = menuDraft.trim();
    if (!item) {
      return;
    }

    const hasDuplicate = plannedMenuItems.some(
      (existingItem) => existingItem.toLowerCase() === item.toLowerCase()
    );
    updatePlannedMenuItems(hasDuplicate ? plannedMenuItems : [...plannedMenuItems, item]);
    setMenuDraft('');
  }

  function removePlannedMenuItem(indexToRemove) {
    updatePlannedMenuItems(plannedMenuItems.filter((_, index) => index !== indexToRemove));
  }

  function renderSelect(key, options, disabled) {
    return (
      <select
        value={inputs[key]}
        disabled={disabled}
        onChange={(eventTarget) => updateInput(key, eventTarget.target.value)}
        className={getFieldClassName(disabled)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  function renderCurrencyInput(key, disabled) {
    return (
      <div
        className={`mt-2 flex rounded-xl border border-slate-200 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10 ${
          disabled ? 'bg-slate-100' : 'bg-white'
        }`}
      >
        <span className="flex items-center border-r border-slate-200 px-3 text-xs font-black text-slate-400">
          PHP
        </span>
        <input
          type="number"
          min="0"
          step="100"
          value={inputs[key]}
          disabled={disabled}
          onChange={(eventTarget) => updateInput(key, eventTarget.target.value)}
          className="min-w-0 flex-1 rounded-r-xl bg-transparent px-3 py-2.5 text-sm font-bold text-slate-800 outline-none disabled:cursor-not-allowed disabled:text-slate-500"
        />
      </div>
    );
  }

  function renderFactorControl(factor) {
    const disabled = isAutoLocked(factor.key);
    if (factor.key === 'tomorrowDay') return renderSelect('tomorrowDay', TOMORROW_DAY_OPTIONS, disabled);
    if (factor.key === 'weatherContext') {
      return (
        <div className="mt-2">
          <select
            value={weather}
            onChange={(eventTarget) => onWeatherChange(eventTarget.target.value)}
            className={getFieldClassName(false)}
          >
            {WEATHER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="mt-2 text-xs leading-5 text-slate-500">{weatherProfile.note}</div>
          <div className={`mt-2 rounded-xl px-3 py-2 text-xs font-bold ring-1 ${weatherInsight.tone}`}>
            {weatherInsight.metric} - {weatherInsight.title}
          </div>
          {OPENWEATHER_API_KEY && (
            <button
              type="button"
              onClick={onSyncWeather}
              disabled={weatherSyncing}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {weatherSyncing ? (
                <>
                  <Skeleton className="h-4 w-4 rounded-md" />
                  Checking weather...
                </>
              ) : (
                <>
                  <CloudIcon className="h-4 w-4" />
                  Use Current Weather
                </>
              )}
            </button>
          )}
        </div>
      );
    }
    if (factor.key === 'eventContext') {
      return (
        <div className="mt-2">
          <select
            value={event}
            onChange={(eventTarget) => onEventChange(eventTarget.target.value)}
            className={getFieldClassName(false)}
          >
            {EVENT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="mt-2 text-xs leading-5 text-slate-500">{eventProfile.note}</div>
        </div>
      );
    }
    if (factor.key === 'todaySales') return renderCurrencyInput('todaySales', disabled);
    if (factor.key === 'recentTrend') {
      return (
        <div className="mt-2 grid grid-cols-1 gap-2">
          {renderCurrencyInput('last7DayAvg', disabled)}
          {renderSelect('recentTrend', TOMORROW_TREND_OPTIONS, disabled)}
        </div>
      );
    }
    if (factor.key === 'attendanceTomorrow') {
      return (
        <input
          type="number"
          min="0"
          step="10"
          value={inputs.attendanceTomorrow}
          disabled={disabled}
          onChange={(eventTarget) => updateInput('attendanceTomorrow', eventTarget.target.value)}
          className={getFieldClassName(disabled)}
        />
      );
    }
    if (factor.key === 'plannedMenu') {
      return (
        <div className="mt-2 space-y-2">
          <div className="flex min-h-10 flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2">
            {plannedMenuItems.length > 0 ? (
              plannedMenuItems.map((item, index) => (
                <span
                  key={`${item}-${index}`}
                  className="inline-flex min-w-0 items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700"
                >
                  <span className="max-w-[9rem] truncate">{item}</span>
                  {!disabled && (
                    <button
                      type="button"
                      onClick={() => removePlannedMenuItem(index)}
                      className="rounded-full p-0.5 text-slate-400 transition hover:bg-white hover:text-slate-700"
                      aria-label={`Remove ${item}`}
                    >
                      <XMarkIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              ))
            ) : (
              <span className="px-1 py-1 text-xs font-semibold text-slate-400">
                No menu items yet
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={menuDraft}
              disabled={disabled}
              onChange={(eventTarget) => setMenuDraft(eventTarget.target.value)}
              onKeyDown={(eventTarget) => {
                if (eventTarget.key === 'Enter') {
                  eventTarget.preventDefault();
                  addPlannedMenuItem();
                }
              }}
              placeholder="Add menu item"
              className={`${getFieldClassName(disabled)} mt-0 min-w-0 flex-1`}
            />
            <button
              type="button"
              onClick={addPlannedMenuItem}
              disabled={disabled || !menuDraft.trim()}
              className="mt-0 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Add menu item"
            >
              <PlusIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      );
    }
    if (factor.key === 'stockLevel') return renderSelect('stockLevel', TOMORROW_STOCK_OPTIONS, disabled);
    if (factor.key === 'allowanceTiming') return renderSelect('allowanceTiming', TOMORROW_ALLOWANCE_OPTIONS, disabled);
    if (factor.key === 'sameDayLastWeek') return renderCurrencyInput('sameDayLastWeek', disabled);
    return null;
  }

  const outputStats = [
    {
      icon: ChartBarIcon,
      label: 'Estimated Revenue',
      value: formatCompactCurrency(prediction.estimatedSales),
      tone: 'bg-blue-50 text-blue-700 ring-blue-100',
    },
    {
      icon: SparklesIcon,
      label: 'Best Seller',
      value: topForecastItem,
      tone: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    },
    {
      icon: ExclamationTriangleIcon,
      label: 'Watch Item',
      value: watchItem,
      tone: watchItem === 'No urgent watch item'
        ? 'bg-slate-50 text-slate-700 ring-slate-100'
        : 'bg-amber-50 text-amber-700 ring-amber-100',
    },
    {
      icon: CloudIcon,
      label: 'Weather Signal',
      value: weatherInsight.metric,
      detail: weatherInsight.title,
      tone: weatherInsight.tone,
    },
  ];

  return (
    <div className="mt-4">
      <div className="mb-3 flex flex-col gap-3 rounded-[20px] bg-slate-50 px-4 py-3 ring-1 ring-slate-100 lg:flex-row lg:items-center lg:justify-between">
        <p className="max-w-3xl text-sm leading-6 text-slate-600">
          Auto-filled from transactions, inventory, weather, school-day context, and forecasted product demand.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-[14px] border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm">
            <span className="whitespace-nowrap text-slate-500">AI Model</span>
            <span className="rounded-xl border border-blue-100 bg-blue-50 px-2 py-1 text-xs font-black text-blue-700">
              {selectedAlgorithm || DEFAULT_ALGORITHM}
            </span>
          </div>
          <button
            type="button"
            onClick={onUpdatePlan}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-[14px] bg-slate-900 px-3 py-2 text-xs font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Updating...' : 'Update Plan'}
          </button>
          <button
            type="button"
            onClick={toggleManualMode}
            className={`inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-black transition ${
              manualMode
                ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:-translate-y-0.5 hover:bg-emerald-100'
                : 'border border-slate-200 bg-white text-slate-700 hover:-translate-y-0.5 hover:bg-slate-100'
            }`}
          >
            {manualMode ? 'Use App Data' : 'Edit Inputs'}
          </button>
          <button
            type="button"
            onClick={resetToAppData}
            className="inline-flex items-center justify-center rounded-[14px] border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:-translate-y-0.5 hover:bg-slate-100"
          >
            Reset
          </button>
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-widest ${
              manualMode ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
            }`}
          >
            {manualMode ? 'Manual Override' : 'App Data + Staff Inputs'}
          </span>
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-widest ${predictionMeta.chip}`}
          >
            <ChartBarIcon className="h-4 w-4" />
            {predictionMeta.label}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1.35fr,0.65fr]">
        <div className="rounded-[20px] bg-slate-50 p-3 ring-1 ring-slate-100">
          <div className="grid auto-rows-fr grid-cols-1 items-stretch gap-3 md:grid-cols-2 xl:grid-cols-3">
            {SALES_OUTLOOK_FACTORS.map((factor) => {
              const locked = isAutoLocked(factor.key);
              return (
                <div
                  key={factor.key}
                  className={`flex h-full min-w-0 flex-col rounded-2xl p-3 shadow-sm ring-1 ring-slate-100 transition hover:-translate-y-0.5 hover:shadow-md ${
                    locked ? 'bg-white/80' : 'bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                      {factor.title}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${
                        locked ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {locked ? 'Auto' : 'Edit'}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-[11px] font-semibold text-slate-400">
                    {inputs.sources?.[factor.key] || 'App data'}
                  </div>
                  {renderFactorControl(factor)}
                </div>
              );
            })}
          </div>
        </div>

        <div className={`self-start rounded-[20px] p-4 shadow-md ring-1 backdrop-blur ${predictionMeta.card}`}>
          <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-slate-600 shadow-sm">
            <SparklesIcon className="h-4 w-4 text-primary" />
            AI Output
          </div>
          <div className="mt-3 text-2xl font-black leading-tight text-slate-900">
            {getTomorrowOutlookHeadline(prediction.level)}
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">{predictionMeta.description}</p>

          <div className="mt-4 grid grid-cols-1 gap-2.5">
            {outputStats.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className={`rounded-2xl bg-white/90 px-3 py-2.5 shadow-sm ring-1 ${item.tone}`}>
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-white/80 p-2 shadow-sm">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold uppercase tracking-widest opacity-70">
                        {item.label}
                      </div>
                      <div className="mt-1 text-base font-black leading-snug text-slate-900">{item.value}</div>
                      {item.detail && <div className="mt-1 text-xs font-semibold opacity-80">{item.detail}</div>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-3 text-xs leading-5 text-slate-500">
            {manualMode
              ? 'Updates instantly from the edited values above.'
              : `Compared with ${prediction.benchmarkLabel.toLowerCase()} at ${formatCurrency(prediction.benchmarkSales)}. Edit staff inputs only when tomorrow will be different.`}
          </p>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, subtitle, accent, icon: Icon, iconTone = 'bg-slate-100 text-slate-600' }) {
  return (
    <div className={`rounded-[20px] p-4 shadow-sm ring-1 ring-slate-100 transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${accent}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{title}</div>
          <div className="mt-2 text-2xl font-black leading-tight text-slate-900">{value}</div>
        </div>
        {Icon && (
          <div className={`shrink-0 rounded-2xl p-2.5 shadow-sm ring-1 ring-white/70 ${iconTone}`}>
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
      <div className="mt-2 text-sm text-slate-500">{subtitle}</div>
    </div>
  );
}

function PredictionMetricCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <SkeletonText lines={['h-3 w-24', 'h-8 w-28', 'h-4 w-36']} />
        </div>
      ))}
    </div>
  );
}

function PredictionOverviewSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm xl:col-span-2">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <SkeletonText lines={['h-7 w-64', 'h-4 w-full max-w-[32rem]']} className="flex-1" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-16 w-24 rounded-xl" />
            ))}
          </div>
        </div>
        <Skeleton className="h-[320px] rounded-2xl" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <SkeletonText lines={['h-7 w-40', 'h-4 w-44']} />
          <Skeleton className="h-6 w-6 rounded-lg" />
        </div>
        <div className="mt-5 space-y-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="mt-5 h-28 rounded-2xl" />
      </div>
    </div>
  );
}

function PredictionRecommendationsSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-7 w-48" />
                <Skeleton className="h-6 w-28 rounded-full" />
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }, (_, metricIndex) => (
                  <Skeleton key={metricIndex} className="h-20 rounded-2xl" />
                ))}
              </div>
            </div>
            <div className="w-full max-w-sm space-y-3 xl:w-80">
              <Skeleton className="h-24 rounded-2xl" />
              <Skeleton className="h-20 rounded-2xl" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Predictions() {
  const location = useLocation();
  const algorithm = DEFAULT_ALGORITHM;
  const [weather, setWeather] = useState('hot_dry');
  const [event, setEvent] = useState('none');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('actionable');
  const [sortBy, setSortBy] = useState('priority');
  const [prepViewMode, setPrepViewMode] = useState('cards');
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [notificationFocus, setNotificationFocus] = useState(null);
  const [weatherSyncing, setWeatherSyncing] = useState(false);
  const [liveWeather, setLiveWeather] = useState(null);
  const [openWeatherIssue, setOpenWeatherIssue] = useState('');
  const [weeklyWeatherForecast, setWeeklyWeatherForecast] = useState([]);
  const [weatherForecastTimezone, setWeatherForecastTimezone] = useState('Asia/Manila');
  const [weatherForecastError, setWeatherForecastError] = useState('');
  const [forecast, setForecast] = useState(() => ({
    metrics: DEFAULT_METRICS,
    algorithmMetrics: normalizeAlgorithmMetrics(),
    featureSummary: DEFAULT_FEATURE_SUMMARY,
    predictions: [],
    weeklyTrend: normalizeTrend([]),
    summary: deriveSummary([]),
    tomorrowSalesOutlook: null,
    insights: [],
    dataSource: 'heuristic',
    generatedAt: null,
    backendError: '',
    missingPredictionCount: 0,
  }));
  const recommendationsRef = useRef(null);
  const hasAutoWeatherSyncedRef = useRef(false);
  const isMountedRef = useRef(true);
  const forecastRequestIdRef = useRef(0);
  const comparisonMetricsRequestIdRef = useRef(0);
  const weatherProfile = getWeatherProfile(weather);
  const eventProfile = getEventProfile(event);
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      forecastRequestIdRef.current += 1;
      comparisonMetricsRequestIdRef.current += 1;
    };
  }, []);

  function scrollToRecommendations() {
    recommendationsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function refreshComparisonMetrics({
    activeAlgorithm,
    activeWeather,
    activeEvent,
    primaryResponse,
    requestId,
  }) {
    const comparisonAlgorithms = MODEL_ALGORITHMS.filter((modelName) => modelName !== activeAlgorithm);
    const hasAllAlgorithmMetrics = MODEL_ALGORITHMS.every(
      (modelName) => primaryResponse?.algorithm_metrics?.[modelName]
    );

    if (comparisonAlgorithms.length === 0 || hasAllAlgorithmMetrics) {
      return;
    }

    const comparisonRequestId = ++comparisonMetricsRequestIdRef.current;
    const activeWeatherProfile = getWeatherProfile(activeWeather);

    scheduleIdleTask(async () => {
      const comparisonResults = await Promise.allSettled(
        comparisonAlgorithms.map((modelName) =>
          API.getPredictions({
            algorithm: modelName,
            weather: activeWeatherProfile.backendWeather,
            event: activeEvent,
          })
        )
      );

      if (
        !isMountedRef.current ||
        requestId !== forecastRequestIdRef.current ||
        comparisonRequestId !== comparisonMetricsRequestIdRef.current
      ) {
        return;
      }

      setForecast((currentForecast) => ({
        ...currentForecast,
        algorithmMetrics: buildLiveAlgorithmMetrics(
          activeAlgorithm,
          primaryResponse,
          comparisonAlgorithms,
          comparisonResults
        ),
      }));
    });
  }

  async function loadForecast({
    algorithmOverride = algorithm,
    weatherOverride = weather,
    eventOverride = event,
    leadingNotice = '',
  } = {}) {
    const requestId = ++forecastRequestIdRef.current;
    comparisonMetricsRequestIdRef.current += 1;
    const activeWeather = weatherOverride;
    const activeEvent = eventOverride;
    const activeAlgorithm = algorithmOverride;
    const activeWeatherProfile = getWeatherProfile(activeWeather);

    setLoading(true);
    setError('');
    setNotice('');

    try {
      const [predictionResult, productsResult] = await Promise.allSettled([
        API.getPredictions({
          algorithm: activeAlgorithm,
          weather: activeWeatherProfile.backendWeather,
          event: activeEvent,
        }),
        API.getProducts(),
      ]);

      if (!isMountedRef.current || requestId !== forecastRequestIdRef.current) {
        return;
      }

      const catalogProducts =
        productsResult.status === 'fulfilled'
          ? normalizeCatalogProducts(productsResult.value)
          : [];
      const primaryResponse = predictionResult.status === 'fulfilled' ? predictionResult.value : null;

      let normalized;
      if (predictionResult.status === 'fulfilled') {
        normalized = ensureForecastCoverage(
          normalizeForecastResponse(primaryResponse, activeAlgorithm),
          catalogProducts,
          activeWeather,
          activeEvent
        );
      } else if (catalogProducts.length > 0) {
        normalized = buildCatalogOnlyForecast(catalogProducts, activeWeather, activeEvent);
      } else {
        throw predictionResult.reason || new Error('Unable to load prediction data.');
      }

      normalized = {
        ...normalized,
        algorithmMetrics: buildLiveAlgorithmMetrics(
          activeAlgorithm,
          primaryResponse,
          [],
          []
        ),
      };

      setForecast(normalized);
      if (primaryResponse) {
        refreshComparisonMetrics({
          activeAlgorithm,
          activeWeather,
          activeEvent,
          primaryResponse,
          requestId,
        });
      }

      const notices = leadingNotice ? [leadingNotice] : [];
      if (normalized.backendError) {
        notices.push(`Live forecast returned a warning: ${normalized.backendError}`);
      }
      if (normalized.missingPredictionCount > 0) {
        notices.push(
          `${normalized.missingPredictionCount} product${normalized.missingPredictionCount > 1 ? 's were' : ' was'} filled with fallback forecast rows so every active product is covered.`
        );
      }
      if (normalized.predictions.length === 0) {
        notices.push('No prediction rows are available yet. Record more transactions to improve forecasting.');
      }

      setNotice(notices.join(' '));
    } catch (err) {
      if (!isMountedRef.current || requestId !== forecastRequestIdRef.current) {
        return;
      }

      setError(err.message || 'Unable to load prediction data.');
      setNotice(
        forecast.predictions.length > 0
          ? 'Showing the last successful forecast while the server reconnects.'
          : ''
      );
    } finally {
      if (isMountedRef.current && requestId === forecastRequestIdRef.current) {
        setLoading(false);
      }
    }
  }

  async function syncWeatherFromOpenWeatherMap() {
    if (!OPENWEATHER_API_KEY) {
      setOpenWeatherIssue(
        'Add VITE_OPENWEATHERMAP_API_KEY to your frontend environment to enable OpenWeatherMap weather syncing.'
      );
      return;
    }

    setWeatherSyncing(true);
    setOpenWeatherIssue('');
    setWeatherForecastError('');

    const coordinates = await resolveOpenWeatherCoordinates();
    const requestUrl = buildOpenWeatherRequestUrl(coordinates);
    if (!requestUrl) {
      setOpenWeatherIssue('OpenWeatherMap configuration is incomplete. Check your API key and location settings.');
      setWeatherSyncing(false);
      return;
    }

    try {
      const forecastRequestUrl = buildOpenWeatherForecastUrl(coordinates);
      const [currentResult, forecastResult] = await Promise.allSettled([
        fetch(requestUrl),
        forecastRequestUrl ? fetch(forecastRequestUrl) : Promise.resolve(null),
      ]);

      if (currentResult.status !== 'fulfilled') {
        throw new Error('Unable to reach OpenWeatherMap right now.');
      }

      if (!currentResult.value.ok) {
        const statusMessage = await readOpenWeatherError(
          currentResult.value,
          `OpenWeatherMap returned HTTP ${currentResult.value.status}.`
        );
        throw new Error(statusMessage);
      }

      const payload = await currentResult.value.json();
      const mappedWeather = mapOpenWeatherToScenario(payload);
      const mappedProfile = getWeatherProfile(mappedWeather);
      const locationLabel =
        [payload?.name, payload?.sys?.country].filter(Boolean).join(', ') ||
        DEFAULT_OPENWEATHER_LOCATION_LABEL;
      const summaryParts = [];
      const temp = Number(payload?.main?.temp ?? Number.NaN);
      if (Number.isFinite(temp)) {
        summaryParts.push(`${temp.toFixed(1)}C`);
      }
      if (payload?.weather?.[0]?.description) {
        summaryParts.push(payload.weather[0].description);
      }
      if (Number.isFinite(Number(payload?.wind?.speed))) {
        summaryParts.push(`wind ${Number(payload.wind.speed).toFixed(1)} m/s`);
      }
      const fetchedAt = payload?.dt ? new Date(Number(payload.dt) * 1000).toISOString() : new Date().toISOString();

      setLiveWeather({
        location: locationLabel,
        summary:
          summaryParts.join(' | ') || 'Current weather synced from OpenWeatherMap.',
        fetchedAt,
        mappedWeather,
        coordinatesLabel: `${coordinates.lat}, ${coordinates.lon}`,
        coordinateSource: coordinates.source,
      });
      setWeather(mappedWeather);

      if (forecastResult.status === 'fulfilled' && forecastResult.value) {
        if (forecastResult.value.ok) {
          const forecastPayload = await forecastResult.value.json();
          const normalizedForecast = normalizeOpenWeatherDailyForecast(forecastPayload);
          setWeeklyWeatherForecast(normalizedForecast.items);
          setWeatherForecastTimezone(normalizedForecast.timezone);
        } else {
          const forecastMessage = await readOpenWeatherError(
            forecastResult.value,
            `OpenWeatherMap returned HTTP ${forecastResult.value.status}.`
          );
          setWeeklyWeatherForecast([]);
          setWeatherForecastTimezone('Asia/Manila');
          setWeatherForecastError(forecastMessage);
        }
      } else {
        setWeeklyWeatherForecast([]);
        setWeatherForecastTimezone('Asia/Manila');
        setWeatherForecastError('5-day weather forecast is unavailable right now.');
      }

      await loadForecast({
        weatherOverride: mappedWeather,
        leadingNotice: `Weather updated from ${locationLabel}. Forecast is using ${mappedProfile.label}.`,
      });
    } catch (err) {
      setLiveWeather(null);
      setWeeklyWeatherForecast([]);
      setWeatherForecastTimezone('Asia/Manila');
      setOpenWeatherIssue(err.message || 'Unable to sync current weather from OpenWeatherMap.');
      setWeatherForecastError(err.message || '5-day weather forecast is unavailable right now.');
      await loadForecast();
    } finally {
      setWeatherSyncing(false);
    }
  }

  useEffect(() => {
    if (hasAutoWeatherSyncedRef.current) {
      return;
    }

    hasAutoWeatherSyncedRef.current = true;

    if (OPENWEATHER_API_KEY) {
      syncWeatherFromOpenWeatherMap();
      return;
    }

    loadForecast();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const alertState = location.state;

    if (!alertState?.highlightProductName && !alertState?.highlightProductId) {
      setNotificationFocus(null);
      return;
    }

    setSearch(alertState.highlightProductName || '');
    setStatusFilter('all');
    setSortBy('priority');
    setCurrentPage(1);
    setNotificationFocus({
      id: alertState.highlightProductId ?? null,
      name: alertState.highlightProductName || '',
      type: alertState.notificationType || 'notification',
    });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToRecommendations();
      });
    });
  }, [location.key, location.state]);

  function isNotificationFocusMatch(prediction) {
    if (!notificationFocus) {
      return false;
    }

    if (notificationFocus.id !== null && notificationFocus.id !== undefined) {
      return String(prediction.product_id) === String(notificationFocus.id);
    }

    return prediction.product_name.toLowerCase() === notificationFocus.name.toLowerCase();
  }

  const filteredPredictions = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();

    return [...forecast.predictions]
      .filter((item) => {
        const matchesSearch =
          !query ||
          item.product_name.toLowerCase().includes(query) ||
          item.category.toLowerCase().includes(query) ||
          item.recommendation.toLowerCase().includes(query);
        const matchesStatus =
          statusFilter === 'all'
            ? true
            : statusFilter === 'actionable'
              ? isActionablePrediction(item)
              : item.recommendation_type === statusFilter;
        return matchesSearch && matchesStatus;
      })
      .sort((left, right) => comparePredictions(left, right, sortBy));
  }, [deferredSearch, forecast.predictions, sortBy, statusFilter]);

  const actionablePredictionsCount = useMemo(
    () => forecast.predictions.filter(isActionablePrediction).length,
    [forecast.predictions]
  );
  const riskAnalysis = useMemo(
    () =>
      deriveRiskAnalysis(
        forecast.predictions,
        forecast.summary,
        weather,
        event,
        forecast.dataSource
      ),
    [event, forecast.dataSource, forecast.predictions, forecast.summary, weather]
  );
  const totalPages = Math.max(1, Math.ceil(filteredPredictions.length / RECOMMENDATIONS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStartIndex = filteredPredictions.length === 0 ? 0 : (safeCurrentPage - 1) * RECOMMENDATIONS_PER_PAGE;
  const paginatedPredictions = useMemo(
    () =>
      filteredPredictions.slice(
        pageStartIndex,
        pageStartIndex + RECOMMENDATIONS_PER_PAGE
      ),
    [filteredPredictions, pageStartIndex]
  );
  const paginationItems = useMemo(
    () => buildPaginationItems(safeCurrentPage, totalPages),
    [safeCurrentPage, totalPages]
  );
  const pageStartCount = filteredPredictions.length === 0 ? 0 : pageStartIndex + 1;
  const pageEndCount = Math.min(pageStartIndex + paginatedPredictions.length, filteredPredictions.length);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter, sortBy]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  function exportCsv() {
    if (filteredPredictions.length === 0) {
      setNotice('There is no filtered prediction data to export.');
      return;
    }

    const headers = [
      'Product',
      'Category',
      'Recommended Action',
      'Prepare',
      'Current Stock',
      'Need More',
      'Use First',
      'Expected Sales',
      'Note',
    ];

    const rows = filteredPredictions.map((item) => [
      item.product_name,
      item.category,
      getStatusMeta(item.recommendation_type).label,
      item.predicted_quantity,
      item.current_stock,
      item.stock_gap,
      item.overstock_units,
      item.estimated_revenue,
      item.recommendation,
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `predictions-${getPhilippineDateKey(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    setNotice('Prediction export downloaded.');
  }

  const schoolWeekSalesOutlook = useMemo(
    () =>
      buildSchoolWeekSalesOutlook(
        forecast.weeklyTrend,
        forecast.summary.expected_revenue,
        weather,
        event,
        weeklyWeatherForecast
      ),
    [event, forecast.summary.expected_revenue, forecast.weeklyTrend, weather, weeklyWeatherForecast]
  );
  const chartData = useMemo(
    () => ({
      labels: schoolWeekSalesOutlook.map((item) => item.date),
      datasets: [
        {
          label: 'Projected Revenue',
          data: schoolWeekSalesOutlook.map((item) => item.predicted_sales),
          borderColor: '#2563eb',
          backgroundColor(context) {
            const { chart } = context;
            const { ctx, chartArea } = chart;
            if (!chartArea) {
              return 'rgba(37, 99, 235, 0.14)';
            }
            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, 'rgba(37, 99, 235, 0.34)');
            gradient.addColorStop(0.55, 'rgba(124, 58, 237, 0.12)');
            gradient.addColorStop(1, 'rgba(37, 99, 235, 0.015)');
            return gradient;
          },
          fill: true,
          tension: 0.42,
          borderWidth: 3,
          pointRadius: 4.5,
          pointHoverRadius: 8,
          pointBackgroundColor: '#ffffff',
          pointBorderColor: '#2563eb',
          pointBorderWidth: 2.5,
        },
        {
          label: 'Previous Week Benchmark',
          data: schoolWeekSalesOutlook.map((item) => item.baseline_sales),
          borderColor: '#94a3b8',
          borderDash: [6, 6],
          fill: false,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 5,
        },
      ],
    }),
    [schoolWeekSalesOutlook]
  );
  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 450,
        easing: 'easeOutQuart',
      },
      plugins: {
        legend: {
          display: true,
          labels: {
            boxWidth: 10,
            boxHeight: 10,
            color: '#475569',
            font: { weight: '700' },
            usePointStyle: true,
          },
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.9)',
          borderColor: 'rgba(255, 255, 255, 0.14)',
          borderWidth: 1,
          cornerRadius: 16,
          caretPadding: 8,
          padding: 12,
          displayColors: false,
          titleColor: '#f8fafc',
          bodyColor: '#e2e8f0',
          titleFont: { weight: '800' },
          bodyFont: { weight: '700' },
          callbacks: {
            label(context) {
              return `${context.dataset.label}: ${formatCurrency(context.parsed.y)}`;
            },
          },
        },
      },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#64748b', font: { weight: '700' } },
        },
        y: {
          border: { display: false },
          grid: { color: 'rgba(148, 163, 184, 0.18)' },
          ticks: {
            color: '#64748b',
            callback(value) {
              return formatCompactCurrency(value);
            },
          },
        },
      },
    }),
    []
  );

  const hasTrendData = useMemo(
    () => schoolWeekSalesOutlook.some((item) => item.predicted_sales > 0),
    [schoolWeekSalesOutlook]
  );
  const weeklySummaryItems = useMemo(
    () => buildWeeklySummaryItems(schoolWeekSalesOutlook),
    [schoolWeekSalesOutlook]
  );
  const liveModelMetricRows = useMemo(
    () =>
      MODEL_ALGORITHMS.map((modelName) => ({
        name: modelName,
        metrics: normalizeMetrics(
          forecast.algorithmMetrics?.[modelName],
          EMPTY_MODEL_METRICS
        ),
        tone: MODEL_METRIC_TONES[modelName] || 'bg-slate-50 ring-slate-100 text-slate-700',
      })),
    [forecast.algorithmMetrics]
  );
  const selectedModelMetric = useMemo(
    () => liveModelMetricRows.find((model) => model.name === algorithm) || liveModelMetricRows[0],
    [algorithm, liveModelMetricRows]
  );
  const salesOutlookUsesForecastWeather = useMemo(
    () => schoolWeekSalesOutlook.some((item) => item.usesForecastWeather),
    [schoolWeekSalesOutlook]
  );
  const eventLabel = eventProfile.label;
  const tomorrowSalesPrediction = useMemo(
    () => buildTomorrowSalesPredictionSummary(forecast.summary, schoolWeekSalesOutlook),
    [forecast.summary, schoolWeekSalesOutlook]
  );
  const outlookWeatherLabel = salesOutlookUsesForecastWeather ? '5-day weather forecast' : weatherProfile.label;
  const tomorrowSalesInputs = useMemo(
    () =>
      buildTomorrowSalesOutlookDefaults({
        backendOutlook: forecast.tomorrowSalesOutlook,
        event,
        forecastSummary: forecast.summary,
        predictions: forecast.predictions,
        riskAnalysis,
        schoolWeekSalesOutlook,
        tomorrowSalesPrediction,
        weather,
      }),
    [
      event,
      forecast.predictions,
      forecast.summary,
      forecast.tomorrowSalesOutlook,
      riskAnalysis,
      schoolWeekSalesOutlook,
      tomorrowSalesPrediction,
      weather,
    ]
  );
  const recommendationCountLabel =
    statusFilter === 'actionable'
      ? `${formatCount(pageStartCount)}-${formatCount(pageEndCount)} of ${formatCount(actionablePredictionsCount)} to check`
      : `${formatCount(pageStartCount)}-${formatCount(pageEndCount)} of ${formatCount(filteredPredictions.length)} products`;
  const predictionMetricCards = useMemo(
    () => [
      {
        title: 'Expected Sales',
        value: formatCurrency(forecast.summary.expected_revenue),
        subtitle: 'Projected revenue for the next plan',
        accent: 'bg-white shadow-md',
        icon: BanknotesIcon,
        iconTone: 'bg-blue-50 text-blue-700 ring-blue-100',
      },
      {
        title: 'Items to Prepare',
        value: formatCount(forecast.summary.expected_units),
        subtitle: `${formatCount(forecast.summary.total_products)} products checked`,
        accent: 'bg-white',
        icon: ShoppingBagIcon,
        iconTone: 'bg-violet-50 text-violet-700 ring-violet-100',
      },
      {
        title: 'Need Restock',
        value: formatCount(forecast.summary.restock_count),
        subtitle: 'Products that may run short',
        accent: 'bg-red-50/70 shadow-md ring-red-100',
        icon: ArchiveBoxIcon,
        iconTone: 'bg-red-100 text-red-700 ring-red-200',
      },
      {
        title: 'Use First',
        value: formatCount(forecast.summary.waste_risk_count),
        subtitle: 'Products with extra stock',
        accent: 'bg-amber-50/70',
        icon: ExclamationTriangleIcon,
        iconTone: 'bg-amber-100 text-amber-700 ring-amber-200',
      },
    ],
    [
      forecast.summary.expected_revenue,
      forecast.summary.expected_units,
      forecast.summary.restock_count,
      forecast.summary.total_products,
      forecast.summary.waste_risk_count,
    ]
  );
  const overallRiskMeta = getRiskMeta(riskAnalysis.overallLevel);
  const riskSummaryCards = useMemo(
    () => [
      {
        title: 'Overall',
        value: overallRiskMeta.label,
        description: riskAnalysis.overallMessage,
        card: overallRiskMeta.card,
      },
      {
        title: 'Supply',
        value: `${formatCount(forecast.summary.restock_count)} item${forecast.summary.restock_count === 1 ? '' : 's'}`,
        description: `${formatCount(riskAnalysis.totalStockGap)} total units may be short.`,
        card: getRiskMeta(riskAnalysis.supplyLevel).card,
      },
      {
        title: 'Use First',
        value: `${formatCount(forecast.summary.waste_risk_count)} item${forecast.summary.waste_risk_count === 1 ? '' : 's'}`,
        description: `${formatCount(riskAnalysis.totalOverstockUnits)} units have extra stock.`,
        card: getRiskMeta(riskAnalysis.wasteLevel).card,
      },
      {
        title: 'Weather',
        value: weatherProfile.label,
        description: getWeatherRiskMessage(weather),
        card: getRiskMeta(riskAnalysis.weatherLevel).card,
      },
    ],
    [
      forecast.summary.restock_count,
      forecast.summary.waste_risk_count,
      overallRiskMeta.card,
      overallRiskMeta.label,
      riskAnalysis,
      weather,
      weatherProfile.label,
    ]
  );
  const tomorrowOutlookMeta = getSalesWeekClassMeta(tomorrowSalesPrediction.level);
  const heroMetricCards = useMemo(
    () => [
      {
        title: 'Expected Sales',
        value: formatCompactCurrency(forecast.summary.expected_revenue),
        detail: `${formatCount(forecast.summary.expected_units)} units forecast`,
        tone: 'bg-blue-50 text-blue-700 ring-blue-100',
      },
      {
        title: 'Tomorrow Outlook',
        value: tomorrowOutlookMeta.label.replace('Tomorrow Sales', '').trim() || tomorrowOutlookMeta.label,
        detail: formatCurrency(tomorrowSalesPrediction.estimatedSales),
        tone: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
      },
      {
        title: `${selectedModelMetric?.name || algorithm} Accuracy`,
        value: selectedModelMetric?.metrics.accuracy || '0.00',
        detail: `${selectedModelMetric?.metrics.error_rate || '0.00'} error rate`,
        tone: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-100',
      },
    ],
    [
      algorithm,
      forecast.summary.expected_revenue,
      forecast.summary.expected_units,
      selectedModelMetric?.metrics.accuracy,
      selectedModelMetric?.metrics.error_rate,
      selectedModelMetric?.name,
      tomorrowOutlookMeta.label,
      tomorrowSalesPrediction.estimatedSales,
    ]
  );

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto bg-slate-50/40 pb-6 pr-2 custom-scrollbar">
      <div className="rounded-[20px] bg-white/95 p-4 shadow-md ring-1 ring-slate-100 sm:p-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr),minmax(340px,0.72fr)] xl:items-start">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-100 bg-violet-50 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-violet-700 shadow-sm">
              <SparklesIcon className="h-4 w-4" />
              Tomorrow Plan
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
              Tomorrow Canteen Plan & Sales Outlook
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
              Prepare stock, plan the menu, and predict next-school-day sales from one workspace.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-slate-600">
              {loading ? (
                <>
                  <Skeleton className="h-7 w-36 rounded-full" />
                  <Skeleton className="h-7 w-28 rounded-full" />
                  <Skeleton className="h-7 w-28 rounded-full" />
                  <Skeleton className="h-7 w-32 rounded-full" />
                </>
              ) : (
                <>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                    Updated {formatGeneratedAt(forecast.generatedAt)}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                    {weatherProfile.label}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                    {eventLabel}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                    Model: {algorithm}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 xl:grid-cols-1">
            {loading
              ? Array.from({ length: 3 }, (_, index) => (
                  <Skeleton key={index} className="h-20 rounded-[20px]" />
                ))
              : heroMetricCards.map((card) => (
                  <div
                    key={card.title}
                    className={`rounded-[20px] bg-white/90 px-4 py-3 shadow-sm ring-1 transition hover:-translate-y-0.5 hover:shadow-md ${card.tone}`}
                  >
                    <div className="text-[10px] font-black uppercase tracking-widest opacity-70">
                      {card.title}
                    </div>
                    <div className="mt-2 truncate text-2xl font-black leading-tight text-slate-950">
                      {card.value}
                    </div>
                    <div className="mt-1 truncate text-xs font-bold opacity-80">{card.detail}</div>
                  </div>
                ))}
          </div>
        </div>

        {loading ? (
          <div className="mt-5">
            <div className="mb-3 rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
              <SkeletonText lines={['h-4 w-full max-w-[34rem]']} />
            </div>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr,0.65fr]">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: SALES_OUTLOOK_FACTORS.length }, (_, index) => (
                  <Skeleton key={index} className="h-24 rounded-xl" />
                ))}
              </div>
              <Skeleton className="h-full min-h-[280px] rounded-2xl" />
            </div>
          </div>
        ) : (
          <TomorrowSalesOutlookInputs
            key={`${forecast.generatedAt || 'initial'}-${weather}-${event}`}
            event={event}
            eventProfile={eventProfile}
            initialInputs={tomorrowSalesInputs}
            loading={loading}
            onEventChange={setEvent}
            onSyncWeather={syncWeatherFromOpenWeatherMap}
            onUpdatePlan={() => loadForecast()}
            onWeatherChange={setWeather}
            predictions={forecast.predictions}
            selectedAlgorithm={algorithm}
            weather={weather}
            weatherProfile={weatherProfile}
            weatherSyncing={weatherSyncing}
          />
        )}
      </div>

      {error && (
        <InlineAlert
          resetKey={error}
          tone="red"
          title="Prediction service issue"
          icon={ExclamationTriangleIcon}
          body={error}
        />
      )}

      {notice && (
        <InlineAlert
          resetKey={notice}
          tone="amber"
          title="Forecast notice"
          icon={CloudIcon}
          body={notice}
        />
      )}

      {openWeatherIssue && (
        <InlineAlert
          resetKey={openWeatherIssue}
          tone="amber"
          title="Weather update unavailable"
          icon={CloudIcon}
          body={openWeatherIssue}
          helperText="The plan is still using the weather selected above."
          helperToneClassName="text-amber-700"
        />
      )}

      {liveWeather && (
        <InlineAlert
          resetKey={`${liveWeather.fetchedAt}-${liveWeather.summary}`}
          tone="sky"
          title="Current weather applied"
          icon={CloudIcon}
          body={`${liveWeather.location} | ${liveWeather.summary}`}
          helperText={`Checked ${formatWeatherFetchedAt(liveWeather.fetchedAt)}. Plan is using ${getWeatherProfile(liveWeather.mappedWeather).label}.`}
          helperToneClassName="text-sky-700"
        />
      )}

      <section className="rounded-[20px] bg-white p-4 shadow-sm ring-1 ring-slate-100 sm:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-sky-700">
              <CloudIcon className="h-4 w-4" />
              Weather
            </div>
            <h2 className="mt-2 text-[22px] font-extrabold text-slate-900">5-Day Weather Forecast</h2>
            <p className="mt-1 text-sm text-slate-500">
              Weekday outlook for adjusting drinks, warm meals, and prep volume for school days.
            </p>
          </div>
          <div className="rounded-full bg-slate-50 px-3 py-1.5 text-xs font-black text-slate-600 ring-1 ring-slate-100">
            {weeklyWeatherForecast.length > 0
              ? `${weeklyWeatherForecast.length} weekdays loaded`
              : OPENWEATHER_API_KEY
                ? 'Use Current Weather'
                : 'Weather sync unavailable'}
          </div>
        </div>

        {weatherForecastError && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
            {weatherForecastError}
          </div>
        )}

        {weeklyWeatherForecast.length > 0 ? (
          <div className="mt-4 grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {weeklyWeatherForecast.map((day) => {
              const dayWeather = inferForecastDayWeather(day);
              const insight = getWeatherBusinessInsight(dayWeather);

              return (
                <article
                  key={day.id}
                  className="self-start rounded-[20px] bg-slate-50 p-3.5 shadow-sm ring-1 ring-slate-100 transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                        {formatWeatherDayLabel(day.date, weatherForecastTimezone)}
                      </div>
                      <div className="mt-2 text-base font-black text-slate-900">{day.main}</div>
                      <div className="mt-1 text-sm capitalize text-slate-500">{day.description}</div>
                    </div>
                    <div className="rounded-xl bg-white p-2 text-sky-600 shadow-sm">
                      <CloudIcon className="h-5 w-5" />
                    </div>
                  </div>
                  <div className={`mt-4 rounded-xl px-3 py-2 text-xs font-bold ring-1 ${insight.tone}`}>
                    <div>{insight.metric}</div>
                    <div className="mt-1 font-semibold opacity-80">{insight.title}</div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-xl bg-white px-2 py-2">
                      <div className="font-bold uppercase tracking-widest text-slate-400">High</div>
                      <div className="mt-1 font-black text-slate-900">{day.maxTemp.toFixed(1)}C</div>
                    </div>
                    <div className="rounded-xl bg-white px-2 py-2">
                      <div className="font-bold uppercase tracking-widest text-slate-400">Low</div>
                      <div className="mt-1 font-black text-slate-900">{day.minTemp.toFixed(1)}C</div>
                    </div>
                    <div className="rounded-xl bg-white px-2 py-2">
                      <div className="font-bold uppercase tracking-widest text-slate-400">Rain</div>
                      <div className="mt-1 font-black text-slate-900">{day.rainChance}%</div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm font-semibold text-slate-500">
            {OPENWEATHER_API_KEY
              ? 'Click Use Current Weather to load the weekday forecast.'
              : 'Add an OpenWeatherMap API key to show the 5-day forecast.'}
          </div>
        )}
      </section>

      {notificationFocus && (
        <InlineAlert
          resetKey={location.key}
          tone="sky"
          title={notificationFocus.type === 'high-demand' ? 'High demand alert opened' : 'Notification opened'}
          body={`${notificationFocus.name || 'Selected product'} is highlighted in Product Recommendations below.`}
        />
      )}

      {loading ? (
        <>
          <PredictionMetricCardsSkeleton />
          <PredictionOverviewSkeleton />
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {predictionMetricCards.map((card) => (
              <MetricCard key={card.title} {...card} />
            ))}
          </div>

      <section className="rounded-[20px] bg-white p-4 shadow-sm ring-1 ring-slate-100 sm:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-[22px] font-extrabold text-slate-900">Risk Analysis Summary</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Quick checks for stock, waste, and school-day conditions before service starts.
                </p>
              </div>
              <span
                className={`inline-flex items-center gap-2 self-start rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-widest ${overallRiskMeta.chip}`}
              >
                <ExclamationTriangleIcon className="h-4 w-4" />
                {overallRiskMeta.label} risk
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {riskSummaryCards.map((card) => (
                <div key={card.title} className={`rounded-[20px] border p-3.5 ${card.card}`}>
                  <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                    {card.title}
                  </div>
                  <div className="mt-2 text-lg font-black text-slate-900">{card.value}</div>
                  <div className="mt-1 text-sm leading-6 text-slate-600">{card.description}</div>
                </div>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
              {riskAnalysis.alerts.slice(0, 3).map((alert, index) => (
                <div
                  key={`${alert.title}-${index}`}
                  className={`rounded-2xl border px-4 py-3 ${getRiskMeta(alert.level).card}`}
                >
                  <div className="text-xs font-black uppercase tracking-widest text-slate-500">
                    {alert.title}
                  </div>
                  <div className="mt-1 text-sm leading-6 text-slate-700">{alert.message}</div>
                </div>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <div className="rounded-[20px] bg-white p-4 shadow-sm ring-1 ring-slate-100 sm:p-5 xl:col-span-2">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-[22px] font-extrabold text-slate-900">School Week Sales Outlook</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Predicted expected sales from Monday to Friday using {algorithm}, {outlookWeatherLabel.toLowerCase()}, {eventLabel.toLowerCase()}, past sales history, and product availability.
                  </p>
                </div>
                <span className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-black text-white shadow-sm">
                  Selected model: {algorithm}
                </span>
              </div>

              <div className="mb-4">
                <div className="rounded-[20px] bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
                  <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                    Weekly Summary
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-slate-700">
                    {weeklySummaryItems.map((item) => (
                      <div key={item} className="flex items-start gap-2">
                        <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="min-h-[300px]">
                {hasTrendData ? (
                  <Line
                    data={chartData}
                    options={chartOptions}
                  />
                ) : (
                  <EmptyState
                    title="No trend data yet"
                    message="The weekly sales chart will appear after the forecast has sales values to show."
                  />
                )}
              </div>

              {hasTrendData && (
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {schoolWeekSalesOutlook.map((item) => (
                    <div key={`sales-outlook-${item.date}`} className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                        {item.date}
                      </div>
                      <div className="mt-1 text-sm font-black text-slate-900">
                        {formatCurrency(item.predicted_sales)}
                      </div>
                      <div className="mt-1 truncate text-[11px] font-bold text-slate-500">
                        {item.weatherLabel}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-[20px] bg-white p-4 shadow-sm ring-1 ring-slate-100 sm:p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[22px] font-extrabold text-slate-900">Things to Check</h2>
                  <p className="mt-1 text-sm text-slate-500">Short notes for tomorrow&apos;s prep.</p>
                </div>
                <CheckCircleIcon className="h-6 w-6 text-primary" />
              </div>

              <div className="mt-4 space-y-2.5">
                <div className={`rounded-2xl border p-3 ${getRiskMeta(riskAnalysis.overallLevel).card}`}>
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-500">
                    <ExclamationTriangleIcon className="h-4 w-4" />
                    Service Note
                  </div>
                  <div className="mt-2 text-sm font-black text-slate-900">
                    {overallRiskMeta.label} attention
                  </div>
                  <div className="mt-1 text-sm text-slate-600">{riskAnalysis.overallMessage}</div>
                </div>

                {forecast.insights.map((insight, index) => {
                  const meta = getStatusMeta(insight.type);
                  return (
                    <div key={`${insight.title}-${index}`} className={`rounded-2xl border p-3 ${meta.card}`}>
                      <div className="text-xs font-black uppercase tracking-widest text-slate-500">{meta.label}</div>
                      <div className="mt-2 text-sm font-black text-slate-900">{insight.title}</div>
                      <div className="mt-1 text-sm text-slate-600">{insight.message}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

      <div ref={recommendationsRef} className="rounded-[20px] bg-white shadow-sm ring-1 ring-slate-100">
        <div className="flex flex-col gap-4 border-b border-slate-100 p-4 sm:p-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-[22px] font-extrabold text-slate-900">Tomorrow Prep List</h2>
            <p className="mt-1 text-sm text-slate-500">
              Focus on what needs action before service starts.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-[14px] bg-slate-100 p-1 ring-1 ring-slate-200">
              {PREP_VIEW_MODES.map((mode) => {
                const Icon = mode.icon;
                const selected = prepViewMode === mode.value;
                return (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() => setPrepViewMode(mode.value)}
                    className={`inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-black transition ${
                      selected
                        ? 'bg-white text-violet-700 shadow-sm'
                        : 'text-slate-500 hover:bg-white/70 hover:text-slate-800'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {mode.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-2 rounded-[14px] border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 transition hover:-translate-y-0.5 hover:bg-slate-50"
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
              Download List
            </button>
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setStatusFilter('actionable');
                setSortBy('priority');
                setCurrentPage(1);
              }}
              className="inline-flex items-center gap-2 rounded-[14px] border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 transition hover:-translate-y-0.5 hover:bg-slate-50"
            >
              <XMarkIcon className="h-4 w-4" />
              Clear
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 border-b border-slate-100 bg-slate-50/60 p-4 sm:p-5 lg:grid-cols-[1.3fr,0.9fr,0.9fr,0.8fr]">
          <label className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(eventTarget) => setSearch(eventTarget.target.value)}
              placeholder="Search product or category"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm font-medium text-slate-700 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
          </label>

          <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3">
            <FunnelIcon className="h-5 w-5 text-slate-400" />
            <select
              value={statusFilter}
              onChange={(eventTarget) => setStatusFilter(eventTarget.target.value)}
              className="w-full bg-transparent py-2.5 text-sm font-semibold text-slate-700 outline-none"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3">
            <ChartBarIcon className="h-5 w-5 text-slate-400" />
            <select
              value={sortBy}
              onChange={(eventTarget) => setSortBy(eventTarget.target.value)}
              className="w-full bg-transparent py-2.5 text-sm font-semibold text-slate-700 outline-none"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-600">
            {recommendationCountLabel}
          </div>
        </div>

        <div className="p-4 sm:p-5">
          {loading ? (
            <PredictionRecommendationsSkeleton />
          ) : filteredPredictions.length === 0 ? (
            <EmptyState
              title="No products match"
              message={
                statusFilter === 'actionable'
                  ? 'No products need action right now. Switch Show to All products to review everything.'
                  : 'Try another filter, clear the search field, or update the plan.'
              }
            />
          ) : (
            <div className="space-y-4">
              {prepViewMode === 'table' ? (
                <div className="overflow-x-auto rounded-[20px] bg-white shadow-sm ring-1 ring-slate-100">
                  <table className="min-w-[900px] w-full border-collapse text-left">
                    <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-widest text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Product</th>
                        <th className="px-4 py-3">Action</th>
                        <th className="px-4 py-3 text-right">Prepare</th>
                        <th className="px-4 py-3 text-right">On Hand</th>
                        <th className="px-4 py-3 text-right">Need / Use</th>
                        <th className="px-4 py-3 text-right">Sales</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {paginatedPredictions.map((item) => {
                        const meta = getStatusMeta(item.recommendation_type);
                        const isHighlighted = isNotificationFocusMatch(item);
                        const action = getPredictionActionDisplay(item);

                        return (
                          <tr
                            key={item.product_id}
                            className={`transition hover:bg-violet-50/50 ${
                              isHighlighted ? 'bg-sky-50/70' : 'bg-white'
                            }`}
                          >
                            <td className="px-4 py-3">
                              <div className="font-black text-slate-900">{item.product_name}</div>
                              <div className="mt-0.5 text-xs font-semibold text-slate-500">{item.category}</div>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-widest ${meta.chip}`}>
                                {meta.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-black text-slate-900">
                              {formatCount(item.predicted_quantity)}
                            </td>
                            <td className="px-4 py-3 text-right font-black text-slate-900">
                              {formatCount(item.current_stock)}
                            </td>
                            <td className={`px-4 py-3 text-right font-black ${action.tone}`}>
                              {action.value}
                            </td>
                            <td className="px-4 py-3 text-right font-black text-slate-900">
                              {formatCurrency(item.estimated_revenue)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                paginatedPredictions.map((item) => {
                  const meta = getStatusMeta(item.recommendation_type);
                  const isHighlighted = isNotificationFocusMatch(item);
                  const action = getPredictionActionDisplay(item);

                  return (
                    <div
                      key={item.product_id}
                      className={`rounded-[20px] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                        isHighlighted
                          ? 'bg-sky-50/70 ring-2 ring-sky-200'
                          : 'bg-slate-50/50 ring-1 ring-slate-100'
                      }`}
                    >
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-black text-slate-900">{item.product_name}</h3>
                            {isHighlighted && (
                              <span className="rounded-full bg-sky-100 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-sky-700">
                                Alert item
                              </span>
                            )}
                            <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-widest ${meta.chip}`}>
                              {meta.label}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-500">
                            <span>Category: {item.category}</span>
                          </div>
                          <p className="mt-3 max-w-3xl rounded-2xl bg-white px-3 py-2 text-sm leading-6 text-slate-700 shadow-sm">
                            {item.recommendation}
                          </p>
                        </div>

                        <div className="grid grid-cols-2 gap-2.5 xl:min-w-[360px]">
                          <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-100">
                            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                              Prepare
                            </div>
                            <div className="mt-1 text-lg font-black text-slate-900">
                              {formatCount(item.predicted_quantity)}
                            </div>
                          </div>
                          <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-100">
                            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                              On Hand
                            </div>
                            <div className="mt-1 text-lg font-black text-slate-900">
                              {formatCount(item.current_stock)}
                            </div>
                          </div>
                          <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-100">
                            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                              {action.title}
                            </div>
                            <div className={`mt-1 text-lg font-black ${action.tone}`}>{action.value}</div>
                          </div>
                          <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-100">
                            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                              Sales
                            </div>
                            <div className="mt-1 text-lg font-black text-slate-900">
                              {formatCurrency(item.estimated_revenue)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}

              {totalPages > 1 && (
                <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm font-semibold text-slate-600">
                    Page {formatCount(safeCurrentPage)} of {formatCount(totalPages)}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                      disabled={safeCurrentPage === 1}
                      className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Previous
                    </button>

                    {paginationItems.map((pageNumber) =>
                      typeof pageNumber === 'number' ? (
                        <button
                          key={pageNumber}
                          type="button"
                          onClick={() => setCurrentPage(pageNumber)}
                          className={`inline-flex h-10 min-w-10 items-center justify-center rounded-xl px-3 text-sm font-black transition ${
                            pageNumber === safeCurrentPage
                              ? 'bg-slate-900 text-white'
                              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {pageNumber}
                        </button>
                      ) : (
                        <span
                          key={pageNumber}
                          className="inline-flex h-10 min-w-10 items-center justify-center px-2 text-sm font-black text-slate-400"
                        >
                          ...
                        </span>
                      )
                    )}

                    <button
                      type="button"
                      onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                      disabled={safeCurrentPage === totalPages}
                      className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
