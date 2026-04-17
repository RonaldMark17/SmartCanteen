import { useEffect, useRef, useState } from 'react';
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
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ChartBarIcon,
  CheckCircleIcon,
  CloudIcon,
  ExclamationTriangleIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  SparklesIcon,
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
const OPENWEATHER_API_KEY = import.meta.env.VITE_OPENWEATHERMAP_API_KEY?.trim() || '';
const OPENWEATHER_LAT = import.meta.env.VITE_OPENWEATHERMAP_LAT?.trim() || '';
const OPENWEATHER_LON = import.meta.env.VITE_OPENWEATHERMAP_LON?.trim() || '';
const DEFAULT_OPENWEATHER_LAT = '14.5995';
const DEFAULT_OPENWEATHER_LON = '120.9842';
const DEFAULT_OPENWEATHER_LOCATION_LABEL = 'Manila, PH';
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
  { value: 'none', label: 'Regular Day' },
  { value: 'intramurals', label: 'Intramurals' },
  { value: 'exams', label: 'Exams' },
  { value: 'halfday', label: 'Half Day' },
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
  XGBoost: { accuracy: '91.6%', rmse: '4.21', mape: '8.4%', r2: '0.87' },
  'Random Forest': { accuracy: '90.9%', rmse: '4.88', mape: '9.1%', r2: '0.83' },
  LSTM: { accuracy: '89.8%', rmse: '5.12', mape: '10.2%', r2: '0.79' },
};
const DEFAULT_METRICS = ALGORITHM_REFERENCE_METRICS.XGBoost;
const SCHOOL_WEEK_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const SCHOOL_WEEKDAY_SALES_WEIGHTS = {
  Mon: 0.94,
  Tue: 0.98,
  Wed: 1,
  Thu: 1.03,
  Fri: 1.08,
};
const SCHOOL_WEEKDAY_FULL_NAMES = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
};
const SALES_OUTLOOK_EVENT = 'none';
const SALES_OUTLOOK_EVENT_LABEL = 'regular class';
const RECOMMENDATIONS_PER_PAGE = 6;
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

function normalizeMetrics(metrics) {
  return {
    accuracy: metrics?.accuracy || DEFAULT_METRICS.accuracy,
    rmse: metrics?.rmse || DEFAULT_METRICS.rmse,
    mape: metrics?.mape || DEFAULT_METRICS.mape,
    r2: metrics?.r2 || metrics?.r_squared || DEFAULT_METRICS.r2,
  };
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
    const dayModifier = getScenarioModifier(outlookWeather, SALES_OUTLOOK_EVENT);
    const trendItem = normalizedTrend.find((item) => item.date === label);
    const unadjustedSales = hasBackendTrend
      ? Number(trendItem?.predicted_sales || 0) / selectedScenarioModifier
      : (baseRevenue / selectedScenarioModifier) * (SCHOOL_WEEKDAY_SALES_WEIGHTS[label] || 1);

    return {
      date: label,
      predicted_sales: Number(Math.max(0, unadjustedSales * dayModifier).toFixed(2)),
      weather: outlookWeather,
      weatherLabel: getWeatherProfile(outlookWeather).label,
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

  return [movement, peakSummary, quietSummary, 'This diagram assumes regular class for the whole school week.']
    .filter(Boolean)
    .join(' ');
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

function normalizeForecastResponse(response) {
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
    featureSummary: normalizeFeatureSummary(response?.feature_summary),
    predictions,
    weeklyTrend: normalizeTrend(response?.weekly_sales_trend),
    summary,
    insights: normalizeInsights(response?.insights, predictions, summary, dataSource),
    dataSource,
    generatedAt: response?.generated_at || new Date().toISOString(),
    backendError: response?.error || '',
  };
}

function getWeatherProfile(weather) {
  return WEATHER_OPTIONS.find((option) => option.value === weather) || WEATHER_OPTIONS[0];
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

  return {
    timezone,
    items: Array.from(groupedDays.entries())
      .slice(0, 5)
      .map(([dayKey, entries], index) => {
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
            : null,
          description: representativeEntry?.weather?.[0]?.description || 'Weather details unavailable',
          main: representativeEntry?.weather?.[0]?.main || 'Weather',
          minTemp: Math.min(...minTemperatures, ...mainTemperatures),
          maxTemp: Math.max(...maxTemperatures, ...mainTemperatures),
          rainChance,
        };
      }),
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
  return (
    weatherProfile.modifier *
    (event === 'intramurals' ? 1.18 : event === 'exams' ? 0.92 : event === 'halfday' ? 0.7 : 1)
  );
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

function MetricCard({ title, value, subtitle, accent }) {
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${accent}`}>
      <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{title}</div>
      <div className="mt-2 text-2xl font-black text-slate-900">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{subtitle}</div>
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
    featureSummary: DEFAULT_FEATURE_SUMMARY,
    predictions: [],
    weeklyTrend: normalizeTrend([]),
    summary: deriveSummary([]),
    insights: [],
    dataSource: 'heuristic',
    generatedAt: null,
    backendError: '',
    missingPredictionCount: 0,
  }));
  const recommendationsRef = useRef(null);
  const hasAutoWeatherSyncedRef = useRef(false);
  const weatherProfile = getWeatherProfile(weather);

  function scrollToRecommendations() {
    recommendationsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function loadForecast({
    algorithmOverride = algorithm,
    weatherOverride = weather,
    eventOverride = event,
    leadingNotice = '',
  } = {}) {
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

      const catalogProducts =
        productsResult.status === 'fulfilled'
          ? normalizeCatalogProducts(productsResult.value)
          : [];

      let normalized;
      if (predictionResult.status === 'fulfilled') {
        normalized = ensureForecastCoverage(
          normalizeForecastResponse(predictionResult.value),
          catalogProducts,
          activeWeather,
          activeEvent
        );
      } else if (catalogProducts.length > 0) {
        normalized = buildCatalogOnlyForecast(catalogProducts, activeWeather, activeEvent);
      } else {
        throw predictionResult.reason || new Error('Unable to load prediction data.');
      }

      setForecast(normalized);

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
      setError(err.message || 'Unable to load prediction data.');
      setNotice(
        forecast.predictions.length > 0
          ? 'Showing the last successful forecast while the server reconnects.'
          : ''
      );
    } finally {
      setLoading(false);
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

  const filteredPredictions = [...forecast.predictions]
    .filter((item) => {
      const query = search.toLowerCase();
      const matchesSearch =
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

  const actionablePredictionsCount = forecast.predictions.filter(isActionablePrediction).length;
  const riskAnalysis = deriveRiskAnalysis(
    forecast.predictions,
    forecast.summary,
    weather,
    event,
    forecast.dataSource
  );
  const totalPages = Math.max(1, Math.ceil(filteredPredictions.length / RECOMMENDATIONS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStartIndex = filteredPredictions.length === 0 ? 0 : (safeCurrentPage - 1) * RECOMMENDATIONS_PER_PAGE;
  const paginatedPredictions = filteredPredictions.slice(
    pageStartIndex,
    pageStartIndex + RECOMMENDATIONS_PER_PAGE
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

  const schoolWeekSalesOutlook = buildSchoolWeekSalesOutlook(
    forecast.weeklyTrend,
    forecast.summary.expected_revenue,
    weather,
    event,
    weeklyWeatherForecast
  );
  const chartData = {
    labels: schoolWeekSalesOutlook.map((item) => item.date),
    datasets: [
      {
        label: 'Projected Revenue',
        data: schoolWeekSalesOutlook.map((item) => item.predicted_sales),
        borderColor: '#0f172a',
        backgroundColor: 'rgba(59, 130, 246, 0.15)',
        fill: true,
        tension: 0.35,
        pointRadius: 4,
        pointHoverRadius: 5,
      },
    ],
  };

  const hasTrendData = schoolWeekSalesOutlook.some((item) => item.predicted_sales > 0);
  const salesOutlookExplanation = describeSchoolWeekSalesOutlook(schoolWeekSalesOutlook);
  const salesOutlookUsesForecastWeather = schoolWeekSalesOutlook.some(
    (item) => item.usesForecastWeather
  );
  const eventLabel = EVENT_OPTIONS.find((option) => option.value === event)?.label || 'Regular Day';
  const recommendationCountLabel =
    statusFilter === 'actionable'
      ? `${formatCount(pageStartCount)}-${formatCount(pageEndCount)} of ${formatCount(actionablePredictionsCount)} to check`
      : `${formatCount(pageStartCount)}-${formatCount(pageEndCount)} of ${formatCount(filteredPredictions.length)} products`;

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto pb-8 pr-2 custom-scrollbar">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-emerald-700">
              <SparklesIcon className="h-4 w-4" />
              Tomorrow Prep
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
              Tomorrow Canteen Plan
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
              A simple list of what to prepare, restock, or use first for the next school day.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-slate-600">
              {loading ? (
                <>
                  <Skeleton className="h-7 w-36 rounded-full" />
                  <Skeleton className="h-7 w-28 rounded-full" />
                  <Skeleton className="h-7 w-28 rounded-full" />
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
                </>
              )}
            </div>
          </div>

          <div className="grid w-full max-w-2xl grid-cols-1 gap-3 md:grid-cols-2">
            <label className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                Weather
              </div>
              <select
                value={weather}
                onChange={(eventTarget) => setWeather(eventTarget.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-800 outline-none transition focus:border-primary"
              >
                {WEATHER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <div className="mt-2 text-xs leading-5 text-slate-500">{weatherProfile.note}</div>
              {OPENWEATHER_API_KEY && (
                <button
                  type="button"
                  onClick={syncWeatherFromOpenWeatherMap}
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
            </label>

            <label className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                School Day
              </div>
              <select
                value={event}
                onChange={(eventTarget) => setEvent(eventTarget.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-800 outline-none transition focus:border-primary"
              >
                {EVENT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => loadForecast()}
                disabled={loading}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <Skeleton className="h-4 w-4 rounded-md bg-white/30" />
                    Updating...
                  </>
                ) : (
                  <>
                    <ArrowPathIcon className="h-4 w-4" />
                    Update Plan
                  </>
                )}
              </button>
            </label>
          </div>
        </div>
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

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-sky-700">
              <CloudIcon className="h-4 w-4" />
              Weather
            </div>
            <h2 className="mt-3 text-lg font-black text-slate-900">5-Day Weather Forecast</h2>
            <p className="mt-1 text-sm text-slate-500">
              Use this to adjust drinks, warm meals, and prep volume for the week.
            </p>
          </div>
          <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-black text-slate-600">
            {weeklyWeatherForecast.length > 0
              ? `${weeklyWeatherForecast.length} days loaded`
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
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {weeklyWeatherForecast.map((day) => (
              <article
                key={day.id}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
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
                <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
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
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm font-semibold text-slate-500">
            {OPENWEATHER_API_KEY
              ? 'Click Use Current Weather to load the 5-day forecast.'
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
            <MetricCard
              title="Expected Sales"
              value={formatCurrency(forecast.summary.expected_revenue)}
              subtitle="Projected revenue for the next plan"
              accent="border-slate-200 bg-white"
            />
            <MetricCard
              title="Items to Prepare"
              value={formatCount(forecast.summary.expected_units)}
              subtitle={`${formatCount(forecast.summary.total_products)} products checked`}
              accent="border-slate-200 bg-white"
            />
            <MetricCard
              title="Need Restock"
              value={formatCount(forecast.summary.restock_count)}
              subtitle="Products that may run short"
              accent="border-red-200 bg-red-50/60"
            />
            <MetricCard
              title="Use First"
              value={formatCount(forecast.summary.waste_risk_count)}
              subtitle="Products with extra stock"
              accent="border-amber-200 bg-amber-50/60"
            />
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-lg font-black text-slate-900">Risk Analysis Summary</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Quick checks for stock, waste, and school-day conditions before service starts.
                </p>
              </div>
              <span
                className={`inline-flex items-center gap-2 self-start rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-widest ${getRiskMeta(riskAnalysis.overallLevel).chip}`}
              >
                <ExclamationTriangleIcon className="h-4 w-4" />
                {getRiskMeta(riskAnalysis.overallLevel).label} risk
              </span>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className={`rounded-2xl border p-4 ${getRiskMeta(riskAnalysis.overallLevel).card}`}>
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                  Overall
                </div>
                <div className="mt-2 text-lg font-black text-slate-900">
                  {getRiskMeta(riskAnalysis.overallLevel).label}
                </div>
                <div className="mt-1 text-sm leading-6 text-slate-600">
                  {riskAnalysis.overallMessage}
                </div>
              </div>

              <div className={`rounded-2xl border p-4 ${getRiskMeta(riskAnalysis.supplyLevel).card}`}>
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                  Supply
                </div>
                <div className="mt-2 text-lg font-black text-slate-900">
                  {formatCount(forecast.summary.restock_count)} item
                  {forecast.summary.restock_count === 1 ? '' : 's'}
                </div>
                <div className="mt-1 text-sm leading-6 text-slate-600">
                  {formatCount(riskAnalysis.totalStockGap)} total units may be short.
                </div>
              </div>

              <div className={`rounded-2xl border p-4 ${getRiskMeta(riskAnalysis.wasteLevel).card}`}>
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                  Use First
                </div>
                <div className="mt-2 text-lg font-black text-slate-900">
                  {formatCount(forecast.summary.waste_risk_count)} item
                  {forecast.summary.waste_risk_count === 1 ? '' : 's'}
                </div>
                <div className="mt-1 text-sm leading-6 text-slate-600">
                  {formatCount(riskAnalysis.totalOverstockUnits)} units have extra stock.
                </div>
              </div>

              <div className={`rounded-2xl border p-4 ${getRiskMeta(riskAnalysis.weatherLevel).card}`}>
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                  Weather
                </div>
                <div className="mt-2 text-lg font-black text-slate-900">
                  {weatherProfile.label}
                </div>
                <div className="mt-1 text-sm leading-6 text-slate-600">
                  {getWeatherRiskMessage(weather)}
                </div>
              </div>
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

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm xl:col-span-2">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black text-slate-900">School Week Sales Outlook</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Predicted expected sales from Monday to Friday using {salesOutlookUsesForecastWeather ? 'the 5-day weather forecast' : weatherProfile.label.toLowerCase()} and {SALES_OUTLOOK_EVENT_LABEL}.
                  </p>
                  <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">
                    {salesOutlookExplanation}
                  </p>
                </div>
              </div>

              <div className="min-h-[320px]">
                {hasTrendData ? (
                  <Line
                    data={chartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { display: false } },
                      interaction: { mode: 'index', intersect: false },
                      scales: { y: { ticks: { callback(value) { return `PHP ${value}`; } } } },
                    }}
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

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-black text-slate-900">Things to Check</h2>
                  <p className="mt-1 text-sm text-slate-500">Short notes for tomorrow&apos;s prep.</p>
                </div>
                <CheckCircleIcon className="h-6 w-6 text-primary" />
              </div>

              <div className="mt-5 space-y-3">
                <div className={`rounded-2xl border p-4 ${getRiskMeta(riskAnalysis.overallLevel).card}`}>
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-500">
                    <ExclamationTriangleIcon className="h-4 w-4" />
                    Service Note
                  </div>
                  <div className="mt-2 text-sm font-black text-slate-900">
                    {getRiskMeta(riskAnalysis.overallLevel).label} attention
                  </div>
                  <div className="mt-1 text-sm text-slate-600">{riskAnalysis.overallMessage}</div>
                </div>

                {forecast.insights.map((insight, index) => {
                  const meta = getStatusMeta(insight.type);
                  return (
                    <div key={`${insight.title}-${index}`} className={`rounded-2xl border p-4 ${meta.card}`}>
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

      <div ref={recommendationsRef} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 p-6 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">Tomorrow Prep List</h2>
            <p className="mt-1 text-sm text-slate-500">
              Focus on what needs action before service starts.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-50"
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
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-50"
            >
              <XMarkIcon className="h-4 w-4" />
              Clear
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 border-b border-slate-100 p-6 lg:grid-cols-[1.3fr,0.9fr,0.9fr,0.8fr]">
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

        <div className="p-6">
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
              {paginatedPredictions.map((item) => {
                const meta = getStatusMeta(item.recommendation_type);
                const isHighlighted = isNotificationFocusMatch(item);
                const actionTitle =
                  item.stock_gap > 0
                    ? 'Need More'
                    : item.overstock_units > 0
                      ? 'Use First'
                      : item.recommendation_type === 'low_demand'
                        ? 'Prep Light'
                        : 'Status';
                const actionValue =
                  item.stock_gap > 0
                    ? formatCount(item.stock_gap)
                    : item.overstock_units > 0
                      ? formatCount(item.overstock_units)
                      : item.recommendation_type === 'low_demand'
                        ? 'Low'
                        : 'OK';

                return (
                  <div
                    key={item.product_id}
                    className={`rounded-2xl border p-5 transition hover:border-primary/40 hover:bg-white ${
                      isHighlighted
                        ? 'border-sky-300 bg-sky-50/70 ring-2 ring-sky-100'
                        : 'border-slate-200 bg-slate-50/50'
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
                        <p className="mt-3 max-w-3xl rounded-xl bg-white px-3 py-2 text-sm leading-6 text-slate-700 shadow-sm">
                          {item.recommendation}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 xl:min-w-[360px]">
                        <div className="rounded-xl bg-white px-4 py-3 shadow-sm">
                          <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                            Prepare
                          </div>
                          <div className="mt-1 text-lg font-black text-slate-900">
                            {formatCount(item.predicted_quantity)}
                          </div>
                        </div>
                        <div className="rounded-xl bg-white px-4 py-3 shadow-sm">
                          <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                            On Hand
                          </div>
                          <div className="mt-1 text-lg font-black text-slate-900">
                            {formatCount(item.current_stock)}
                          </div>
                        </div>
                        <div className="rounded-xl bg-white px-4 py-3 shadow-sm">
                          <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                            {actionTitle}
                          </div>
                          <div className="mt-1 text-lg font-black text-slate-900">{actionValue}</div>
                        </div>
                        <div className="rounded-xl bg-white px-4 py-3 shadow-sm">
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
              })}

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

                    {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
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
                    ))}

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
