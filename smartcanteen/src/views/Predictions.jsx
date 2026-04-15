import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { API } from '../services/api';
import DismissibleAlert from '../components/DismissibleAlert';
import { Skeleton, SkeletonText } from '../components/Skeleton';
import {
  formatPhilippineDate,
  formatPhilippineDateTime,
  getPhilippineDateKey,
  getPhilippineWeekday,
  parseBackendDateTime,
} from '../utils/dateTime';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  BeakerIcon,
  BoltIcon,
  ChartBarIcon,
  CheckBadgeIcon,
  CheckCircleIcon,
  CloudIcon,
  CpuChipIcon,
  ExclamationTriangleIcon,
  FunnelIcon,
  LightBulbIcon,
  MagnifyingGlassIcon,
  SparklesIcon,
  SunIcon,
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

const ALGORITHM_OPTIONS = ['XGBoost', 'Random Forest', 'LSTM'];
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
  { value: 'reduce_waste', label: 'Reduce waste' },
  { value: 'healthy', label: 'Healthy stock' },
  { value: 'low_demand', label: 'Low demand' },
];
const SORT_OPTIONS = [
  { value: 'priority', label: 'Priority' },
  { value: 'demand', label: 'Highest demand' },
  { value: 'revenue', label: 'Highest revenue' },
  { value: 'stock_gap', label: 'Largest stock gap' },
  { value: 'name', label: 'Product name' },
];
const STATUS_META = {
  restock: { label: 'Restock', chip: 'bg-red-100 text-red-700', card: 'border-red-200 bg-red-50/70' },
  reduce_waste: {
    label: 'Reduce Waste',
    chip: 'bg-amber-100 text-amber-700',
    card: 'border-amber-200 bg-amber-50/70',
  },
  healthy: {
    label: 'Healthy',
    chip: 'bg-emerald-100 text-emerald-700',
    card: 'border-emerald-200 bg-emerald-50/70',
  },
  low_demand: {
    label: 'Low Demand',
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
const RECOMMENDATIONS_PER_PAGE = 6;

function formatCurrency(value) {
  return `PHP ${Number(value || 0).toFixed(2)}`;
}

function formatCount(value) {
  return Number(value || 0).toLocaleString('en-PH');
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

function formatShortDate(value) {
  if (!value) return 'No sales history';
  return formatPhilippineDate(value, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
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
    product_id: prediction?.product_id ?? `sample-${index}`,
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
  if (!value) return 'Unknown day';
  const date = parseBackendDateTime(value);
  if (!date) return 'Unknown day';

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

function getWeatherCardTheme(main) {
  const normalized = String(main || '').toLowerCase();

  if (normalized.includes('thunder') || normalized.includes('storm')) {
    return {
      Icon: BoltIcon,
      card:
        'border-violet-400/20 bg-[radial-gradient(circle_at_top,_rgba(168,85,247,0.26),_transparent_36%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(46,16,101,0.95))]',
      iconWrap: 'border-violet-300/20 bg-violet-400/10 text-violet-100',
      chip: 'bg-violet-400/15 text-violet-100 border border-violet-300/20',
    };
  }

  if (normalized.includes('rain') || normalized.includes('drizzle')) {
    return {
      Icon: CloudIcon,
      card:
        'border-sky-400/20 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.22),_transparent_38%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(14,116,144,0.95))]',
      iconWrap: 'border-sky-200/20 bg-sky-400/10 text-sky-100',
      chip: 'bg-sky-400/15 text-sky-100 border border-sky-200/20',
    };
  }

  if (normalized.includes('cloud')) {
    return {
      Icon: CloudIcon,
      card:
        'border-slate-400/20 bg-[radial-gradient(circle_at_top,_rgba(148,163,184,0.2),_transparent_38%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(51,65,85,0.95))]',
      iconWrap: 'border-slate-200/20 bg-slate-400/10 text-slate-100',
      chip: 'bg-slate-400/15 text-slate-100 border border-slate-200/20',
    };
  }

  if (normalized.includes('clear') || normalized.includes('sun')) {
    return {
      Icon: SunIcon,
      card:
        'border-amber-400/20 bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.22),_transparent_40%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(120,53,15,0.95))]',
      iconWrap: 'border-amber-200/20 bg-amber-400/10 text-amber-100',
      chip: 'bg-amber-400/15 text-amber-100 border border-amber-200/20',
    };
  }

  return {
    Icon: SparklesIcon,
    card:
      'border-cyan-400/20 bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.2),_transparent_38%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(30,41,59,0.96))]',
    iconWrap: 'border-cyan-200/20 bg-cyan-400/10 text-cyan-100',
    chip: 'bg-cyan-400/15 text-cyan-100 border border-cyan-200/20',
  };
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
        const representativeEntry = [...entries].sort((left, right) => {
          const leftDistance = Math.abs(getForecastLocalHour(left?.dt, timezone) - 12);
          const rightDistance = Math.abs(getForecastLocalHour(right?.dt, timezone) - 12);
          return leftDistance - rightDistance;
        })[0] || entries[0];
        const mainTemperatures = entries.map((entry) => Number(entry?.main?.temp ?? 0));
        const minTemperatures = entries.map((entry) => Number(entry?.main?.temp_min ?? entry?.main?.temp ?? 0));
        const maxTemperatures = entries.map((entry) => Number(entry?.main?.temp_max ?? entry?.main?.temp ?? 0));
        const humidityValues = entries.map((entry) => Number(entry?.main?.humidity ?? 0));
        const rainChance = Math.max(
          0,
          ...entries.map((entry) => Math.round(Number(entry?.pop ?? 0) * 100))
        );
        const windSpeed = Math.max(0, ...entries.map((entry) => Number(entry?.wind?.speed ?? 0)));
        const averageHumidity =
          humidityValues.length > 0
            ? Math.round(humidityValues.reduce((sum, value) => sum + value, 0) / humidityValues.length)
            : 0;

        return {
          id: `${dayKey}-${index}`,
          date: representativeEntry?.dt
            ? new Date(Number(representativeEntry.dt) * 1000).toISOString()
            : null,
          summary:
            rainChance > 0
              ? `Peak rain chance ${rainChance}% across ${entries.length} forecast intervals.`
              : `${entries.length} forecast intervals from the free 5-day feed.`,
          description: representativeEntry?.weather?.[0]?.description || 'Weather details unavailable',
          main: representativeEntry?.weather?.[0]?.main || 'Weather',
          minTemp: Math.min(...minTemperatures, ...mainTemperatures),
          maxTemp: Math.max(...maxTemperatures, ...mainTemperatures),
          rainChance,
          humidity: Math.max(0, averageHumidity),
          windSpeed,
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

function buildCatalogFallbackPrediction(product, index, weather, event) {
  const modifier = getScenarioModifier(weather, event);
  const baselineDemand =
    product.min_stock > 0
      ? Math.max(1, Math.round(product.min_stock * 0.8))
      : Math.max(1, Math.round(Math.max(product.stock, 1) * 0.35));
  const predictedQuantity = Math.max(0, Math.round(baselineDemand * modifier));

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
      last_sold_on: null,
      recommendation:
        'This product used a stock-based fallback forecast because the live prediction row was unavailable.',
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
    .map((product, index) => buildCatalogFallbackPrediction(product, index, weather, event));

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
        : baseForecast.dataSource === 'sample'
          ? 'sample+catalog'
          : 'catalog-fallback',
    missingPredictionCount: missingPredictions.length,
  };
}

function buildCatalogOnlyForecast(catalogProducts, weather, event) {
  const predictions = catalogProducts.map((product, index) =>
    buildCatalogFallbackPrediction(product, index, weather, event)
  );
  const summary = deriveSummary(predictions);

  return {
    metrics: DEFAULT_METRICS,
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

function buildSampleForecast(weather, event, algorithm) {
  const modifier = getScenarioModifier(weather, event);

  const predictions = [
    {
      product_id: 'sample-1',
      product_name: 'Chicken Tinola',
      category: 'Soup',
      current_stock: 14,
      min_stock: 10,
      predicted_quantity: Math.round(18 * modifier),
      historical_average: 16.5,
      days_observed: 28,
      estimated_revenue: Number((50 * Math.round(18 * modifier)).toFixed(2)),
      confidence: 'high',
      prediction_source: 'sample',
      recommendation_type: 'restock',
      stock_gap: Math.max(0, Math.round(18 * modifier) - 14),
      overstock_units: 0,
      last_sold_on: new Date().toISOString(),
      recommendation: 'Restock before lunch service because demand is projected to outpace stock.',
    },
    {
      product_id: 'sample-2',
      product_name: 'Soft Drinks (small)',
      category: 'Drinks',
      current_stock: 45,
      min_stock: 20,
      predicted_quantity: Math.round(32 * modifier),
      historical_average: 30.2,
      days_observed: 32,
      estimated_revenue: Number((20 * Math.round(32 * modifier)).toFixed(2)),
      confidence: 'high',
      prediction_source: 'sample',
      recommendation_type: 'healthy',
      stock_gap: 0,
      overstock_units: Math.max(0, 45 - Math.round(32 * modifier)),
      last_sold_on: new Date().toISOString(),
      recommendation: 'Current stock can cover expected demand comfortably.',
    },
    {
      product_id: 'sample-3',
      product_name: 'Mango Float (slice)',
      category: 'Dessert',
      current_stock: 18,
      min_stock: 5,
      predicted_quantity: Math.round(8 * modifier),
      historical_average: 7.1,
      days_observed: 18,
      estimated_revenue: Number((30 * Math.round(8 * modifier)).toFixed(2)),
      confidence: 'medium',
      prediction_source: 'sample',
      recommendation_type: 'reduce_waste',
      stock_gap: 0,
      overstock_units: Math.max(0, 18 - Math.round(8 * modifier)),
      last_sold_on: new Date().toISOString(),
      recommendation: 'Use the existing dessert stock first to reduce spoilage risk.',
    },
    {
      product_id: 'sample-4',
      product_name: 'Banana Cue',
      category: 'Snacks',
      current_stock: 10,
      min_stock: 15,
      predicted_quantity: Math.round(12 * modifier),
      historical_average: 11.4,
      days_observed: 14,
      estimated_revenue: Number((15 * Math.round(12 * modifier)).toFixed(2)),
      confidence: 'medium',
      prediction_source: 'sample',
      recommendation_type: 'restock',
      stock_gap: Math.max(0, Math.round(12 * modifier) - 10),
      overstock_units: 0,
      last_sold_on: new Date().toISOString(),
      recommendation: 'Prepare a small top-up batch before the afternoon rush.',
    },
    {
      product_id: 'sample-5',
      product_name: 'Biko (per slice)',
      category: 'Dessert',
      current_stock: 12,
      min_stock: 4,
      predicted_quantity: Math.round(4 * modifier),
      historical_average: 4.2,
      days_observed: 9,
      estimated_revenue: Number((25 * Math.round(4 * modifier)).toFixed(2)),
      confidence: 'low',
      prediction_source: 'sample',
      recommendation_type: 'low_demand',
      stock_gap: 0,
      overstock_units: Math.max(0, 12 - Math.round(4 * modifier)),
      last_sold_on: new Date().toISOString(),
      recommendation: 'Demand looks light. Avoid over-prepping this item tomorrow.',
    },
  ].map(normalizePrediction);

  const weeklyTrend = normalizeTrend([
    { date: 'Mon', predicted_sales: 4100 * modifier },
    { date: 'Tue', predicted_sales: 4350 * modifier },
    { date: 'Wed', predicted_sales: 4200 * modifier },
    { date: 'Thu', predicted_sales: 4520 * modifier },
    { date: 'Fri', predicted_sales: 4980 * modifier },
  ]);
  const summary = deriveSummary(predictions);

  return {
    metrics: {
      accuracy: algorithm === 'LSTM' ? '88.9%' : algorithm === 'Random Forest' ? '90.7%' : '91.4%',
      rmse: algorithm === 'LSTM' ? '5.34' : algorithm === 'Random Forest' ? '4.92' : '4.38',
      mape: algorithm === 'LSTM' ? '11.1%' : algorithm === 'Random Forest' ? '9.3%' : '8.6%',
      r2: algorithm === 'LSTM' ? '0.78' : algorithm === 'Random Forest' ? '0.84' : '0.88',
    },
    predictions,
    weeklyTrend,
    summary,
    insights: deriveInsights(predictions, summary, 'sample'),
    dataSource: 'sample',
    generatedAt: new Date().toISOString(),
    backendError: '',
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

function getConfidenceClasses(confidence) {
  if (confidence === 'high') return 'bg-emerald-100 text-emerald-700';
  if (confidence === 'medium') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-200 text-slate-700';
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

function RiskCard({ title, level, value, subtitle }) {
  const meta = getRiskMeta(level);

  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${meta.card}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{title}</div>
        <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-widest ${meta.chip}`}>
          {meta.label}
        </span>
      </div>
      <div className="mt-3 text-2xl font-black text-slate-900">{value}</div>
      <div className="mt-1 text-sm text-slate-600">{subtitle}</div>
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

function PredictionRiskSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <SkeletonText lines={['h-7 w-36', 'h-4 w-80']} />
        <Skeleton className="h-8 w-32 rounded-full" />
      </div>
      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-36 rounded-2xl" />
        ))}
      </div>
      <div className="mt-5 grid grid-cols-1 gap-3 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-24 rounded-2xl" />
        ))}
      </div>
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
  const [algorithm, setAlgorithm] = useState('XGBoost');
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
  const [showHelp, setShowHelp] = useState(false);
  const [usingSampleData, setUsingSampleData] = useState(false);
  const [weatherSyncing, setWeatherSyncing] = useState(false);
  const [liveWeather, setLiveWeather] = useState(null);
  const [openWeatherIssue, setOpenWeatherIssue] = useState('');
  const [weeklyWeatherForecast, setWeeklyWeatherForecast] = useState([]);
  const [weatherForecastTimezone, setWeatherForecastTimezone] = useState('Asia/Manila');
  const [weatherForecastError, setWeatherForecastError] = useState('');
  const [forecast, setForecast] = useState(() => ({
    metrics: DEFAULT_METRICS,
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
    sample = false,
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

    if (sample) {
      try {
        const catalogProducts = normalizeCatalogProducts(await API.getProducts());
        const sampleForecast = ensureForecastCoverage(
          buildSampleForecast(activeWeather, activeEvent, activeAlgorithm),
          catalogProducts,
          activeWeather,
          activeEvent
        );

        setForecast(sampleForecast);
        setUsingSampleData(true);
        const sampleNotice =
          sampleForecast.missingPredictionCount > 0
            ? `Sample forecast loaded. ${sampleForecast.missingPredictionCount} additional product${sampleForecast.missingPredictionCount > 1 ? 's were' : ' was'} filled from the active catalog.`
            : 'Sample forecast loaded. Use Refresh Forecast to switch back to live server data.';
        setNotice(leadingNotice ? `${leadingNotice} ${sampleNotice}` : sampleNotice);
      } catch {
        setForecast(buildSampleForecast(activeWeather, activeEvent, activeAlgorithm));
        setUsingSampleData(true);
        const sampleNotice = 'Sample forecast loaded. Use Refresh Forecast to switch back to live server data.';
        setNotice(leadingNotice ? `${leadingNotice} ${sampleNotice}` : sampleNotice);
      }

      setLoading(false);
      return;
    }

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
      setUsingSampleData(false);

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

  async function loadSampleForecast() {
    await loadForecast({ sample: true });
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
      const [currentResponse, forecastResponse] = await Promise.allSettled([
        fetch(requestUrl),
        forecastRequestUrl ? fetch(forecastRequestUrl) : Promise.resolve(null),
      ]);

      if (currentResponse.status !== 'fulfilled') {
        throw new Error('Unable to reach OpenWeatherMap right now.');
      }

      if (!currentResponse.value.ok) {
        const statusMessage = await readOpenWeatherError(
          currentResponse.value,
          `OpenWeatherMap returned HTTP ${currentResponse.value.status}.`
        );
        throw new Error(statusMessage);
      }

      const payload = await currentResponse.value.json();
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

      if (forecastResponse.status === 'fulfilled' && forecastResponse.value) {
        if (forecastResponse.value.ok) {
          const forecastPayload = await forecastResponse.value.json();
          const normalizedDaily = normalizeOpenWeatherDailyForecast(forecastPayload);
          setWeeklyWeatherForecast(normalizedDaily.items);
          setWeatherForecastTimezone(normalizedDaily.timezone);
        } else {
          const forecastMessage = await readOpenWeatherError(
            forecastResponse.value,
            `OpenWeatherMap returned HTTP ${forecastResponse.value.status}.`
          );
          setWeeklyWeatherForecast([]);
          setWeatherForecastTimezone('Asia/Manila');
          setWeatherForecastError(forecastMessage);
        }
      } else {
        setWeeklyWeatherForecast([]);
        setWeatherForecastTimezone('Asia/Manila');
        setWeatherForecastError(
          '5-day forecast could not be loaded from OpenWeatherMap free forecast.'
        );
      }

      await loadForecast({
        weatherOverride: mappedWeather,
        leadingNotice: `OpenWeatherMap synced for ${locationLabel} using ${coordinates.source}. Using the ${mappedProfile.label} scenario for this forecast.`,
      });
    } catch (err) {
      setLiveWeather(null);
      setWeeklyWeatherForecast([]);
      setWeatherForecastTimezone('Asia/Manila');
      setOpenWeatherIssue(err.message || 'Unable to sync current weather from OpenWeatherMap.');
      setWeatherForecastError(err.message || '5-day forecast is unavailable until OpenWeatherMap weather sync succeeds.');
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
  }, [location.key]);

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
      'Status',
      'Predicted Quantity',
      'Current Stock',
      'Min Stock',
      'Historical Average',
      'Estimated Revenue',
      'Confidence',
      'Recommendation',
      'Prediction Source',
      'Last Sold On',
    ];

    const rows = filteredPredictions.map((item) => [
      item.product_name,
      item.category,
      getStatusMeta(item.recommendation_type).label,
      item.predicted_quantity,
      item.current_stock,
      item.min_stock,
      item.historical_average,
      item.estimated_revenue,
      item.confidence,
      item.recommendation,
      item.prediction_source,
      item.last_sold_on || '',
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

  const chartData = {
    labels: forecast.weeklyTrend.map((item) => item.date),
    datasets: [
      {
        label: 'Projected Revenue',
        data: forecast.weeklyTrend.map((item) => item.predicted_sales),
        borderColor: '#0f172a',
        backgroundColor: 'rgba(59, 130, 246, 0.15)',
        fill: true,
        tension: 0.35,
        pointRadius: 4,
        pointHoverRadius: 5,
      },
    ],
  };

  const hasTrendData = forecast.weeklyTrend.some((item) => item.predicted_sales > 0);
  const dataSourceLabel =
    forecast.dataSource === 'ml+heuristic'
      ? 'Hybrid ML forecast'
      : forecast.dataSource === 'ml+heuristic+catalog'
        ? 'Hybrid ML forecast with full catalog coverage'
      : forecast.dataSource === 'sample'
        ? 'Sample forecast'
        : forecast.dataSource === 'sample+catalog'
          ? 'Sample forecast with full catalog coverage'
          : forecast.dataSource === 'catalog-fallback'
            ? 'Catalog fallback forecast'
        : 'Heuristic forecast';

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto pb-8 pr-2 custom-scrollbar">
      <div className="rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-blue-900 p-6 text-white shadow-xl">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-blue-100">
              <SparklesIcon className="h-4 w-4" />
              Tomorrow Forecast
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight">AI Prediction Center</h1>
            <p className="mt-3 text-sm text-slate-300">
              Review demand, restock pressure, and waste risk before the next service window. The page keeps the last good forecast on screen if the API has a temporary problem.
            </p>
            <div className="mt-4 flex flex-wrap gap-3 text-xs font-semibold text-slate-200">
              {loading ? (
                <>
                  <Skeleton className="h-7 w-32 rounded-full bg-white/15" />
                  <Skeleton className="h-7 w-40 rounded-full bg-white/15" />
                  <Skeleton className="h-7 w-28 rounded-full bg-white/15" />
                  <Skeleton className="h-7 w-28 rounded-full bg-white/15" />
                </>
              ) : (
                <>
                  <span className="rounded-full bg-white/10 px-3 py-1">Source: {dataSourceLabel}</span>
                  <span className="rounded-full bg-white/10 px-3 py-1">Generated: {formatGeneratedAt(forecast.generatedAt)}</span>
                  <span className="rounded-full bg-white/10 px-3 py-1">Algorithm: {algorithm}</span>
                  <span className="rounded-full bg-white/10 px-3 py-1">Weather: {weatherProfile.label}</span>
                  {liveWeather && (
                    <span className="rounded-full bg-white/10 px-3 py-1">
                      Weather Source: OpenWeatherMap
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="rounded-2xl border border-white/10 bg-white/10 p-3">
              <div className="text-[11px] font-bold uppercase tracking-widest text-slate-300">Algorithm</div>
              <select
                value={algorithm}
                onChange={(eventTarget) => setAlgorithm(eventTarget.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2 text-sm font-semibold text-white outline-none"
              >
                {ALGORITHM_OPTIONS.map((option) => (
                  <option key={option} value={option} className="text-slate-900">
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="rounded-2xl border border-white/10 bg-white/10 p-3">
                <div className="text-[11px] font-bold uppercase tracking-widest text-slate-300">Weather</div>
                <select
                value={weather}
                onChange={(eventTarget) => setWeather(eventTarget.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2 text-sm font-semibold text-white outline-none"
              >
                {WEATHER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value} className="text-slate-900">
                    {option.label}
                  </option>
                ))}
                </select>
                <div className="mt-2 text-xs text-slate-300">{weatherProfile.note}</div>
                <button
                  type="button"
                  onClick={syncWeatherFromOpenWeatherMap}
                  disabled={weatherSyncing}
                  className="mt-3 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-slate-900/40 px-3 py-2 text-xs font-black text-white transition hover:bg-slate-900/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {weatherSyncing ? (
                    <>
                      <Skeleton className="h-4 w-4 rounded-md bg-white/30" />
                      Syncing OpenWeatherMap...
                    </>
                  ) : (
                    <>
                      <CloudIcon className="h-4 w-4" />
                      Use OpenWeatherMap
                    </>
                  )}
                </button>
                <div className="mt-2 text-[11px] text-slate-300/90">
                  {OPENWEATHER_API_KEY
                    ? `OpenWeatherMap uses your device location when permission is granted. If location is unavailable, it falls back to ${OPENWEATHER_LAT && OPENWEATHER_LON ? `${OPENWEATHER_LAT}, ${OPENWEATHER_LON}` : DEFAULT_OPENWEATHER_LOCATION_LABEL}.`
                    : 'Set VITE_OPENWEATHERMAP_API_KEY to enable live OpenWeatherMap weather syncing.'}
                </div>
            </label>

            <label className="rounded-2xl border border-white/10 bg-white/10 p-3 sm:col-span-2">
              <div className="text-[11px] font-bold uppercase tracking-widest text-slate-300">Campus Event</div>
              <select
                value={event}
                onChange={(eventTarget) => setEvent(eventTarget.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2 text-sm font-semibold text-white outline-none"
              >
                {EVENT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value} className="text-slate-900">
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button
                type="button"
                onClick={() => loadForecast()}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-black text-slate-900 transition hover:bg-slate-100"
              >
                {loading ? (
                  <>
                    <Skeleton className="h-4 w-4 rounded-md bg-slate-300" />
                    Refreshing...
                  </>
                ) : (
                  <>
                    <ArrowPathIcon className="h-4 w-4" />
                    Refresh Forecast
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={loadSampleForecast}
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-black text-white transition hover:bg-white/15"
              >
                <BeakerIcon className="h-4 w-4" />
                Load Sample
              </button>
              <button
                type="button"
                onClick={() => setShowHelp(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-black text-white transition hover:bg-white/15"
              >
                <LightBulbIcon className="h-4 w-4" />
                How it works
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <DismissibleAlert
          resetKey={error}
          tone="red"
          title="Prediction service issue"
          icon={ExclamationTriangleIcon}
        >
          {error}
        </DismissibleAlert>
      )}

      {(notice || usingSampleData) && (
        <DismissibleAlert
          resetKey={`${notice}-${usingSampleData}`}
          tone="amber"
          title={usingSampleData ? 'Sample forecast mode' : 'Forecast notice'}
          icon={CloudIcon}
        >
          {notice || 'Sample data is on screen. Refresh the forecast to request live data again.'}
        </DismissibleAlert>
      )}

      {openWeatherIssue && (
        <DismissibleAlert
          resetKey={openWeatherIssue}
          tone="amber"
          title="OpenWeatherMap setup issue"
          icon={CloudIcon}
        >
          <>
            <div>{openWeatherIssue}</div>
            <div className="mt-2 text-xs text-amber-700">
              Predictions are still running with the selected weather profile.
            </div>
          </>
        </DismissibleAlert>
      )}

      {liveWeather && (
        <DismissibleAlert
          resetKey={`${liveWeather.fetchedAt}-${liveWeather.summary}`}
          tone="sky"
          title="OpenWeatherMap weather sync"
          icon={CloudIcon}
        >
          <>
            <div>
              {liveWeather.location} | {liveWeather.summary}
            </div>
            <div className="mt-1 text-xs text-sky-700">
              Synced {formatWeatherFetchedAt(liveWeather.fetchedAt)} | Coordinates:{' '}
              {liveWeather.coordinatesLabel} from {liveWeather.coordinateSource} | Forecast
              scenario: {getWeatherProfile(liveWeather.mappedWeather).label}
            </div>
          </>
        </DismissibleAlert>
      )}

      <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.24em] text-sky-700">
              <CloudIcon className="h-4 w-4" />
              Free Weather Feed
            </div>
            <h2 className="mt-3 text-xl font-black tracking-tight text-slate-900 sm:text-2xl">
              5-Day Weather Forecast
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Use OpenWeatherMap&apos;s free forecast feed to preview the next 5 days of weather and support planning beyond tomorrow&apos;s sales forecast.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <div className="rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.24em] text-white">
              {weeklyWeatherForecast.length > 0
                ? 'OpenWeatherMap loaded'
                : OPENWEATHER_API_KEY
                  ? 'Manual weather sync'
                  : 'Weather sync disabled'}
            </div>
            {liveWeather?.location && (
              <div className="rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-[11px] font-bold text-slate-600">
                {liveWeather.location}
              </div>
            )}
          </div>
        </div>

        {weeklyWeatherForecast.length > 0 ? (
          <div className="mt-5 rounded-[26px] border border-slate-200 bg-slate-50 p-3 sm:p-4">
            <div className="mb-4 flex flex-col gap-2 border-b border-slate-200/80 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs font-semibold text-slate-500">
                Synced {formatWeatherFetchedAt(liveWeather?.fetchedAt)} for {liveWeather?.location || DEFAULT_OPENWEATHER_LOCATION_LABEL}
              </div>
              <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400 sm:hidden">
                Mobile-friendly stacked forecast
              </div>
              <div className="hidden text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400 sm:block">
                Responsive forecast overview
              </div>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              <div className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.2em] text-slate-600">
                {weeklyWeatherForecast.length} forecast days
              </div>
              {liveWeather?.coordinateSource && (
                <div className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-600">
                  Source: {liveWeather.coordinateSource}
                </div>
              )}
              <div className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-600">
                Scenario: {getWeatherProfile(liveWeather?.mappedWeather || weather).label}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {weeklyWeatherForecast.map((day) => {
                  const theme = getWeatherCardTheme(day.main);
                  const WeatherIcon = theme.Icon;

                  return (
                  <article
                    key={day.id}
                    className={`w-full rounded-[26px] border p-4 text-white shadow-lg shadow-slate-900/10 ${theme.card}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">
                          {formatWeatherDayLabel(day.date, weatherForecastTimezone)}
                        </div>
                        <div className="mt-2 text-lg font-black tracking-tight text-white">
                          {day.main}
                        </div>
                        <div className="mt-1 text-sm text-slate-300">{day.description}</div>
                      </div>
                      <div className={`rounded-2xl p-3 ${theme.iconWrap}`}>
                        <WeatherIcon className="h-5 w-5" />
                      </div>
                    </div>

                    {day.summary && (
                      <div className="mt-3 min-h-[3.5rem] rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs leading-5 text-slate-300">
                        {day.summary}
                      </div>
                    )}

                    <div className={`mt-3 inline-flex rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em] ${theme.chip}`}>
                      {day.main}
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-3">
                        <div className="font-bold uppercase tracking-[0.24em] text-slate-400">High</div>
                        <div className="mt-1 text-base font-black text-white">
                          {day.maxTemp.toFixed(1)}C
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-3">
                        <div className="font-bold uppercase tracking-[0.24em] text-slate-400">Low</div>
                        <div className="mt-1 text-base font-black text-white">
                          {day.minTemp.toFixed(1)}C
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-3">
                        <div className="font-bold uppercase tracking-[0.24em] text-slate-400">Rain</div>
                        <div className="mt-1 text-base font-black text-white">{day.rainChance}%</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-3">
                        <div className="font-bold uppercase tracking-[0.24em] text-slate-400">Wind</div>
                        <div className="mt-1 text-base font-black text-white">
                          {day.windSpeed.toFixed(1)} m/s
                        </div>
                      </div>
                    </div>
                  </article>
                )})}
            </div>
          </div>
        ) : weatherForecastError ? (
          <DismissibleAlert
            resetKey={weatherForecastError}
            tone="amber"
            title="5-day forecast unavailable"
            className="mt-5 rounded-[24px] px-4 py-4 sm:px-5"
          >
            <>
              <div className="leading-6">{weatherForecastError}</div>
              <div className="mt-2 text-xs text-amber-700">
                The free tier uses OpenWeatherMap&apos;s 5-day / 3-hour forecast feed instead of
                the paid One Call daily API.
              </div>
            </>
          </DismissibleAlert>
        ) : (
          <div className="mt-5 rounded-[24px] border border-dashed border-slate-200 bg-white/70 px-4 py-8 text-center sm:px-5">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
              <CloudIcon className="h-6 w-6" />
            </div>
            <div className="mt-4 text-sm font-bold text-slate-700">No 5-day weather forecast yet</div>
            <div className="mt-1 text-sm leading-6 text-slate-500">
              {OPENWEATHER_API_KEY
                ? 'Use OpenWeatherMap to load the next 5 days for your current location using the free forecast API.'
                : 'Add a valid OpenWeatherMap API key to enable optional 5-day weather syncing.'}
            </div>
          </div>
        )}
      </div>

      {notificationFocus && (
        <DismissibleAlert
          resetKey={location.key}
          tone="sky"
          title={notificationFocus.type === 'high-demand' ? 'High demand alert opened' : 'Notification opened'}
        >
          {notificationFocus.name || 'Selected product'} is highlighted in Product
          Recommendations below.
        </DismissibleAlert>
      )}

      {loading ? (
        <>
          <PredictionMetricCardsSkeleton />
          <PredictionRiskSkeleton />
          <PredictionOverviewSkeleton />
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard title="Expected Revenue" value={formatCurrency(forecast.summary.expected_revenue)} subtitle={`${formatCount(forecast.summary.total_products)} products in forecast`} accent="border-slate-200 bg-white" />
            <MetricCard title="Expected Units" value={formatCount(forecast.summary.expected_units)} subtitle="Projected items to prepare tomorrow" accent="border-slate-200 bg-white" />
            <MetricCard title="Restock Needed" value={formatCount(forecast.summary.restock_count)} subtitle="Products forecast to run short" accent="border-red-200 bg-red-50/60" />
            <MetricCard title="Waste Risk" value={formatCount(forecast.summary.waste_risk_count)} subtitle="Products carrying extra stock" accent="border-amber-200 bg-amber-50/60" />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-lg font-black text-slate-900">Risk Analysis</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Simple risk checks based on stock gaps, weather, event impact, and forecast quality.
                </p>
              </div>
              <div className={`inline-flex items-center gap-2 self-start rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-widest ${getRiskMeta(riskAnalysis.overallLevel).chip}`}>
                <ExclamationTriangleIcon className="h-4 w-4" />
                {getRiskMeta(riskAnalysis.overallLevel).label} overall risk
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <RiskCard
                title="Overall Risk"
                level={riskAnalysis.overallLevel}
                value={getRiskMeta(riskAnalysis.overallLevel).label}
                subtitle={riskAnalysis.overallMessage}
              />
              <RiskCard
                title="Supply Risk"
                level={riskAnalysis.supplyLevel}
                value={`${formatCount(forecast.summary.restock_count)} item${forecast.summary.restock_count !== 1 ? 's' : ''}`}
                subtitle={`${formatCount(riskAnalysis.totalStockGap)} total units may be short.`}
              />
              <RiskCard
                title="Weather Risk"
                level={riskAnalysis.weatherLevel}
                value={weatherProfile.label}
                subtitle={getWeatherRiskMessage(weather)}
              />
              <RiskCard
                title="Forecast Risk"
                level={riskAnalysis.forecastLevel}
                value={`${formatCount(riskAnalysis.lowConfidenceCount)} low-confidence`}
                subtitle={`${formatCount(forecast.summary.heuristic_predictions)} heuristic forecast rows need extra review.`}
              />
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 xl:grid-cols-3">
              {riskAnalysis.alerts.map((alert, index) => {
                const meta = getRiskMeta(alert.level);

                return (
                  <div key={`${alert.title}-${index}`} className={`rounded-2xl border p-4 ${meta.card}`}>
                    <div className="text-xs font-black uppercase tracking-widest text-slate-500">{alert.title}</div>
                    <div className="mt-2 text-sm text-slate-700">{alert.message}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm xl:col-span-2">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black text-slate-900">Projected 5-Day School Revenue Trend</h2>
                  <p className="mt-1 text-sm text-slate-500">Revenue outlook for the Monday to Friday school week, based on your saved transaction data and adjusted by weather and event assumptions.</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-right text-xs font-semibold text-slate-500 sm:grid-cols-4">
                  <div className="rounded-xl bg-slate-50 px-3 py-2"><div>Accuracy</div><div className="mt-1 text-sm font-black text-slate-900">{forecast.metrics.accuracy}</div></div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2"><div>RMSE</div><div className="mt-1 text-sm font-black text-slate-900">{forecast.metrics.rmse}</div></div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2"><div>MAPE</div><div className="mt-1 text-sm font-black text-slate-900">{forecast.metrics.mape}</div></div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2"><div>R2</div><div className="mt-1 text-sm font-black text-slate-900">{forecast.metrics.r2}</div></div>
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
                    message="The forecast engine has not produced a school-week revenue trend yet. Try refreshing the live data or load the sample forecast to preview the page behavior."
                  />
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-black text-slate-900">Forecast Insights</h2>
                  <p className="mt-1 text-sm text-slate-500">Quick takeaways pulled from the current prediction run.</p>
                </div>
                <CheckBadgeIcon className="h-6 w-6 text-primary" />
              </div>

              <div className="mt-5 space-y-3">
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

              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                <div className="flex items-center gap-2 font-black text-slate-900">
                  <CpuChipIcon className="h-5 w-5 text-slate-400" />
                  Forecast coverage
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-xl bg-white px-3 py-2">
                    <div className="text-slate-500">Model-backed</div>
                    <div className="mt-1 text-sm font-black text-slate-900">{formatCount(forecast.summary.model_backed_predictions)}</div>
                  </div>
                  <div className="rounded-xl bg-white px-3 py-2">
                    <div className="text-slate-500">Heuristic</div>
                    <div className="mt-1 text-sm font-black text-slate-900">{formatCount(forecast.summary.heuristic_predictions)}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <div ref={recommendationsRef} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 p-6 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">Product Recommendations</h2>
            <p className="mt-1 text-sm text-slate-500">Filter, sort, and export the recommendations that matter most to the team.</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-50"
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
              Export CSV
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
              Reset Filters
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 border-b border-slate-100 p-6 lg:grid-cols-[1.3fr,0.9fr,0.9fr,0.9fr]">
          <label className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(eventTarget) => setSearch(eventTarget.target.value)}
              placeholder="Search product, category, or recommendation"
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
            {statusFilter === 'actionable'
              ? `Showing ${formatCount(pageStartCount)}-${formatCount(pageEndCount)} of ${formatCount(actionablePredictionsCount)} actionable recommendations`
              : `Showing ${formatCount(pageStartCount)}-${formatCount(pageEndCount)} of ${formatCount(forecast.predictions.length)} products`}
          </div>
        </div>

        <div className="p-6">
          {loading ? (
            <PredictionRecommendationsSkeleton />
          ) : filteredPredictions.length === 0 ? (
            <EmptyState
              title="No recommendation rows match"
              message={
                statusFilter === 'actionable'
                  ? 'No products need action right now. Switch the filter to All products if you want to review the full forecast.'
                  : 'Try a different status filter, clear the search field, or refresh the forecast with different assumptions.'
              }
              action={
                <button
                  type="button"
                  onClick={loadSampleForecast}
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-black text-white transition hover:bg-slate-800"
                >
                  <BeakerIcon className="h-4 w-4" />
                  Preview Sample Forecast
                </button>
              }
            />
          ) : (
            <div className="space-y-4">
              {paginatedPredictions.map((item) => {
                const meta = getStatusMeta(item.recommendation_type);
                const isHighlighted = isNotificationFocusMatch(item);

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
                          <span
                            className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-widest ${getConfidenceClasses(item.confidence)}`}
                          >
                            {item.confidence} confidence
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-500">
                          <span>Category: {item.category}</span>
                          <span>Last sold: {formatShortDate(item.last_sold_on)}</span>
                          <span>Observed days: {formatCount(item.days_observed)}</span>
                          <span>Source: {item.prediction_source}</span>
                        </div>
                        <p className="mt-3 max-w-3xl text-sm text-slate-700">{item.recommendation}</p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 xl:min-w-[340px] xl:grid-cols-3">
                        <div className="rounded-xl bg-white px-4 py-3 shadow-sm">
                          <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Forecast</div>
                          <div className="mt-1 text-lg font-black text-slate-900">{formatCount(item.predicted_quantity)}</div>
                        </div>
                        <div className="rounded-xl bg-white px-4 py-3 shadow-sm">
                          <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Stock</div>
                          <div className="mt-1 text-lg font-black text-slate-900">{formatCount(item.current_stock)}</div>
                        </div>
                        <div className="rounded-xl bg-white px-4 py-3 shadow-sm">
                          <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Revenue</div>
                          <div className="mt-1 text-lg font-black text-slate-900">{formatCurrency(item.estimated_revenue)}</div>
                        </div>
                        <div className="rounded-xl bg-white px-4 py-3 shadow-sm">
                          <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Avg sales</div>
                          <div className="mt-1 text-lg font-black text-slate-900">{Number(item.historical_average || 0).toFixed(1)}</div>
                        </div>
                        <div className="rounded-xl bg-white px-4 py-3 shadow-sm">
                          <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Stock gap</div>
                          <div className="mt-1 text-lg font-black text-slate-900">{formatCount(item.stock_gap)}</div>
                        </div>
                        <div className="rounded-xl bg-white px-4 py-3 shadow-sm">
                          <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Min stock</div>
                          <div className="mt-1 text-lg font-black text-slate-900">{formatCount(item.min_stock)}</div>
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

      {showHelp && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-black text-slate-900">How this forecast works</h2>
                <p className="mt-2 text-sm text-slate-500">
                  The page combines prediction metrics, product-level recommendations, and a revenue trend. If live data is unavailable, you can load a sample dataset to keep reviewing the interface.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-sm font-black text-slate-900">
                  <CpuChipIcon className="h-5 w-5 text-slate-400" />
                  Algorithm and assumptions
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  Choose an algorithm, weather condition, and event profile, then refresh the forecast to request a new Monday to Friday school-week prediction run from the backend.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-sm font-black text-slate-900">
                  <CheckCircleIcon className="h-5 w-5 text-slate-400" />
                  Reliability behavior
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  The page keeps the last successful forecast on screen if a later request fails, and it shows a clear warning instead of wiping out the whole view.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-sm font-black text-slate-900">
                  <FunnelIcon className="h-5 w-5 text-slate-400" />
                  Filters and export
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  Search by product, filter by recommendation type, sort by urgency or demand, and export the filtered rows to CSV for operations review.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-sm font-black text-slate-900">
                  <BeakerIcon className="h-5 w-5 text-slate-400" />
                  Sample mode
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  Load sample data any time to preview the screen or keep discussions moving while the backend is still being prepared.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
