"""Prediction helpers for SmartCanteen."""

import copy
import json
import os
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import urlopen

import numpy as np
import pandas as pd
from sklearn.metrics import mean_squared_error, r2_score
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

try:
    import xgboost as xgb
except ImportError:  # pragma: no cover - optional dependency
    xgb = None

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PROJECT_DATABASE_PATH = PROJECT_ROOT / "canteen.db"

if (
    not os.getenv("DATABASE_URL")
    and not os.getenv("POSTGRES_URL")
    and PROJECT_DATABASE_PATH.exists()
):
    os.environ["DATABASE_URL"] = f"sqlite:///{PROJECT_DATABASE_PATH.as_posix()}"

try:
    from . import models
    from .time_utils import get_ph_recent_cutoff_utc_naive, get_ph_today, get_ph_tomorrow, to_ph_time
except ImportError:  # Allows `python ml_predictor.py` from the backend folder.
    import sys

    project_root_path = str(PROJECT_ROOT)
    if project_root_path not in sys.path:
        sys.path.insert(0, project_root_path)

    import backend.models as models
    from backend.time_utils import get_ph_recent_cutoff_utc_naive, get_ph_today, get_ph_tomorrow, to_ph_time


DEFAULT_METRICS = {
    "XGBoost": {"rmse": "4.21", "mape": "8.4%", "accuracy": "91.6%", "r2": "0.87", "error_rate": "8.4%"},
}
BEST_ALGORITHM = "XGBoost"
SUPPORTED_ALGORITHMS = (BEST_ALGORITHM,)

WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
SCHOOL_WEEKDAYS = [0, 1, 2, 3, 4]
WEATHER_FACTORS = {"clear": 1.0, "cloudy": 0.96, "rainy": 0.84}
EVENT_FACTORS = {"none": 1.0, "intramurals": 1.28, "exams": 0.9, "halfday": 0.62, "holiday": 0.0}

CATEGORY_FACTORS = {
    "drinks": {
        "weather": {"rainy": 0.72, "cloudy": 0.95, "clear": 1.05},
        "event": {"intramurals": 1.55, "exams": 0.92, "halfday": 0.74, "holiday": 0.0, "none": 1.0},
    },
    "soup": {
        "weather": {"rainy": 1.45, "cloudy": 1.12, "clear": 0.96},
        "event": {"intramurals": 0.85, "exams": 1.05, "halfday": 0.72, "holiday": 0.0, "none": 1.0},
    },
    "dessert": {
        "weather": {"rainy": 0.88, "cloudy": 0.98, "clear": 1.08},
        "event": {"intramurals": 1.1, "exams": 0.94, "halfday": 0.78, "holiday": 0.0, "none": 1.0},
    },
    "snacks": {
        "weather": {"rainy": 0.95, "cloudy": 0.98, "clear": 1.06},
        "event": {"intramurals": 1.18, "exams": 0.96, "halfday": 0.82, "holiday": 0.0, "none": 1.0},
    },
}

WEATHER_TYPES = ["clear", "cloudy", "rainy"]
EVENT_TYPES = ["none", "intramurals", "exams", "halfday", "holiday"]
OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
DEFAULT_WEATHER_LAT = float(os.getenv("FORECAST_WEATHER_LAT", "14.5995"))
DEFAULT_WEATHER_LON = float(os.getenv("FORECAST_WEATHER_LON", "120.9842"))
MODEL_FEATURE_GROUPS = [
    "recent sales lags",
    "weekday pattern",
    "price signals",
    "time-of-day mix",
    "weather history",
    "school event history",
    "category demand",
    "canteen demand",
]
HEURISTIC_FEATURE_GROUPS = [
    "historical averages",
    "weekday baseline",
    "weather adjustment",
    "event adjustment",
]
TOMORROW_OUTLOOK_FEATURE_GROUPS = [
    "tomorrow weekday",
    "today sales",
    "recent 3-7 day trend",
    "attendance forecast",
    "weather forecast",
    "school event",
    "planned menu proxy",
    "inventory availability",
    "allowance timing",
    "same weekday benchmark",
]
PREDICTION_CACHE_TTL_SECONDS = 180
PREDICTION_CACHE_VERSION = "xgb-shared-v2"
REFRESH_ARCHIVE_WEATHER_ON_PREDICTION = os.getenv("FORECAST_REFRESH_ARCHIVE_WEATHER", "0").lower() in {
    "1",
    "true",
    "yes",
    "on",
}
OPEN_METEO_TIMEOUT_SECONDS = float(os.getenv("FORECAST_OPEN_METEO_TIMEOUT_SECONDS", "4"))
_PREDICTION_RESULT_CACHE: Dict[tuple, Dict] = {}
_PREDICTION_CACHE_LOCK = threading.Lock()
_PREDICTION_INFLIGHT: Dict[tuple, threading.Event] = {}
_PERSISTENT_REFRESH_LOCK = threading.Lock()
_PERSISTENT_REFRESH_INFLIGHT = set()

FORECAST_FEATURE_COLUMNS = [
    "days_idx",
    "day_of_week",
    "is_weekend",
    "day_of_week_sin",
    "day_of_week_cos",
    "avg_price",
    "price_vs_median",
    "price_delta_1",
    "lag_1",
    "lag_2",
    "lag_3",
    "lag_7",
    "breakfast_lag_1",
    "lunch_lag_1",
    "afternoon_lag_1",
    "breakfast_share_7",
    "lunch_share_7",
    "afternoon_share_7",
    "rolling_mean_3",
    "rolling_mean_7",
    "rolling_max_7",
    "weekday_history_mean",
    "weekday_recent_mean_4",
    "weekday_nonzero_mean",
    "days_since_last_sale",
    "recent_sales_streak",
    "recent_nonzero_ratio_14",
    "category_lag_1",
    "category_rolling_mean_7",
    "category_weekday_mean",
    "global_lag_1",
    "global_rolling_mean_7",
    "global_weekday_mean",
    "category_share_7",
    "weather_clear",
    "weather_cloudy",
    "weather_rainy",
    "temperature_c",
    "humidity_pct",
    "rainfall_mm",
    "is_school_day",
    "event_none",
    "event_intramurals",
    "event_exams",
    "event_halfday",
    "event_holiday",
]


def _prune_prediction_cache(now_utc: datetime) -> None:
    expired_keys = [
        cache_key
        for cache_key, entry in _PREDICTION_RESULT_CACHE.items()
        if entry.get("expires_at") and entry["expires_at"] <= now_utc
    ]
    for cache_key in expired_keys:
        _PREDICTION_RESULT_CACHE.pop(cache_key, None)


def _get_cached_prediction_result(cache_key: tuple, now_utc: datetime) -> Dict | None:
    cached_entry = _PREDICTION_RESULT_CACHE.get(cache_key)
    if cached_entry and cached_entry.get("expires_at", now_utc) > now_utc:
        return copy.deepcopy(cached_entry["result"])
    return None


def _store_prediction_result(cache_keys, result: Dict) -> None:
    expires_at = datetime.utcnow() + timedelta(seconds=PREDICTION_CACHE_TTL_SECONDS)
    cached_result = copy.deepcopy(result)
    with _PREDICTION_CACHE_LOCK:
        for cache_key in cache_keys:
            _PREDICTION_RESULT_CACHE[cache_key] = {
                "expires_at": expires_at,
                "result": cached_result,
            }


def _build_prediction_request_key(algorithm: str, weather: str, event: str) -> str:
    return json.dumps(
        [_normalize_algorithm(algorithm), weather or "clear", event or "none"],
        separators=(",", ":"),
    )


def _serialize_prediction_signature(cache_key: tuple) -> str:
    return json.dumps(list(cache_key), separators=(",", ":"), default=str)


def _with_cache_metadata(result: Dict, status: str, cache_row=None, refresh_needed: bool = False) -> Dict:
    response = copy.deepcopy(result)
    response["cache_status"] = status
    response["cache_refresh_needed"] = bool(refresh_needed)
    if cache_row is not None:
        response["cache_updated_at"] = (
            cache_row.updated_at.isoformat()
            if getattr(cache_row, "updated_at", None)
            else None
        )
    return response


def _load_persistent_prediction_cache(db: Session, request_key: str):
    return (
        db.query(models.PredictionCache)
        .filter(models.PredictionCache.request_key == request_key)
        .first()
    )


def _decode_persistent_prediction_payload(cache_row) -> Dict | None:
    if not cache_row or not cache_row.payload:
        return None

    try:
        payload = json.loads(cache_row.payload)
    except (TypeError, ValueError):
        return None

    return payload if isinstance(payload, dict) else None


def _store_persistent_prediction_cache(
    db: Session,
    request_key: str,
    data_signature: str,
    result: Dict,
) -> None:
    cache_row = _load_persistent_prediction_cache(db, request_key)
    if cache_row is None:
        cache_row = models.PredictionCache(request_key=request_key)
        db.add(cache_row)

    cache_row.data_signature = data_signature
    cache_row.payload = json.dumps(result, separators=(",", ":"), default=str)
    cache_row.updated_at = datetime.utcnow()
    db.commit()


def begin_prediction_cache_refresh(algorithm: str, weather: str, event: str) -> bool:
    request_key = _build_prediction_request_key(algorithm, weather, event)
    with _PERSISTENT_REFRESH_LOCK:
        if request_key in _PERSISTENT_REFRESH_INFLIGHT:
            return False
        _PERSISTENT_REFRESH_INFLIGHT.add(request_key)
        return True


def _finish_prediction_cache_refresh(algorithm: str, weather: str, event: str) -> None:
    request_key = _build_prediction_request_key(algorithm, weather, event)
    with _PERSISTENT_REFRESH_LOCK:
        _PERSISTENT_REFRESH_INFLIGHT.discard(request_key)


def _build_prediction_cache_key(db: Session, algorithm: str, weather: str, event: str) -> tuple:
    tx_count, tx_max = db.query(
        func.count(models.Transaction.id),
        func.max(models.Transaction.created_at),
    ).one()
    product_count, product_updated_max = db.query(
        func.count(models.Product.id),
        func.max(models.Product.updated_at),
    ).filter(models.Product.is_active == True).one()
    return (
        get_ph_today().isoformat(),
        PREDICTION_CACHE_VERSION,
        algorithm,
        weather,
        event,
        int(tx_count or 0),
        tx_max.isoformat() if tx_max else "",
        int(product_count or 0),
        product_updated_max.isoformat() if product_updated_max else "",
    )


def _empty_weekly_trend() -> List[Dict]:
    return [{"date": WEEKDAY_LABELS[day], "predicted_sales": 0} for day in SCHOOL_WEEKDAYS]


def _next_school_day(day_value):
    while day_value.weekday() >= 5:
        day_value += timedelta(days=1)
    return day_value


def _fallback_metrics(algorithm: str) -> Dict:
    return DEFAULT_METRICS[BEST_ALGORITHM]


def _build_algorithm_metrics(selected_algorithm: str, selected_metrics: Dict) -> Dict:
    selected_algorithm = _normalize_algorithm(selected_algorithm)
    comparison = {BEST_ALGORITHM: DEFAULT_METRICS[BEST_ALGORITHM].copy()}
    comparison[selected_algorithm] = selected_metrics.copy()
    return comparison


def _normalize_algorithm(algorithm: str) -> str:
    return algorithm if algorithm in SUPPORTED_ALGORITHMS else BEST_ALGORITHM


def _resolve_time_slot(hour: int) -> str:
    if hour < 10:
        return "breakfast"
    if hour < 14:
        return "lunch"
    return "afternoon"


def _date_ordinal_seed(day_value) -> int:
    return (day_value.toordinal() * 37 + 17) % 100


def _build_bootstrap_weather(day_value) -> Dict:
    seed = _date_ordinal_seed(day_value)
    rainy_season = day_value.month in {6, 7, 8, 9, 10, 11}

    if rainy_season:
        if seed < 42:
            weather = "rainy"
        elif seed < 72:
            weather = "cloudy"
        else:
            weather = "clear"
    else:
        if seed < 18:
            weather = "rainy"
        elif seed < 48:
            weather = "cloudy"
        else:
            weather = "clear"

    temperature_c = 31.5 if weather == "clear" else 29.5 if weather == "cloudy" else 27.4
    humidity_pct = 67.0 if weather == "clear" else 78.0 if weather == "cloudy" else 88.0
    rainfall_mm = 0.0 if weather == "clear" else round(0.8 + (seed % 5) * 0.4, 2) if weather == "cloudy" else round(8.0 + (seed % 9) * 1.8, 2)

    month_adjustment = 1.2 if day_value.month in {4, 5} else -0.8 if day_value.month in {12, 1} else 0.0
    temperature_c = round(temperature_c + month_adjustment, 1)
    humidity_pct = round(min(96.0, max(55.0, humidity_pct + (2 if rainy_season else -2))), 1)

    return {
        "weather": weather,
        "temperature_c": temperature_c,
        "humidity_pct": humidity_pct,
        "rainfall_mm": rainfall_mm,
        "source": "bootstrap",
    }


def _build_bootstrap_school_event(day_value) -> Dict:
    if day_value.weekday() >= 5:
        return {
            "event_type": "holiday",
            "label": "Weekend",
            "is_school_day": False,
            "source": "bootstrap",
        }

    week_of_month = ((day_value.day - 1) // 7) + 1

    if (day_value.month, week_of_month) in {(10, 2), (3, 3)}:
        return {
            "event_type": "exams",
            "label": "Exam Week",
            "is_school_day": True,
            "source": "bootstrap",
        }

    if day_value.month == 11 and week_of_month == 3:
        return {
            "event_type": "intramurals",
            "label": "Intramurals",
            "is_school_day": True,
            "source": "bootstrap",
        }

    if (day_value.month, day_value.day) in {(12, 19), (3, 27)}:
        return {
            "event_type": "halfday",
            "label": "Half Day",
            "is_school_day": True,
            "source": "bootstrap",
        }

    if (day_value.month == 12 and day_value.day >= 22) or (day_value.month == 1 and day_value.day <= 3):
        return {
            "event_type": "holiday",
            "label": "School Break",
            "is_school_day": False,
            "source": "bootstrap",
        }

    return {
        "event_type": "none",
        "label": "Regular School Day",
        "is_school_day": True,
        "source": "bootstrap",
    }


def _map_weather_code_to_type(weather_code: float | int | None, precipitation_sum: float) -> str:
    if weather_code is None:
        return "rainy" if precipitation_sum >= 2.0 else "clear"

    code = int(weather_code)
    if code in {0, 1}:
        return "clear"
    if code in {2, 3, 45, 48}:
        return "cloudy"
    if precipitation_sum > 0:
        return "rainy"
    return "cloudy"


def _default_humidity_for_weather(weather: str) -> float:
    if weather == "rainy":
        return 88.0
    if weather == "cloudy":
        return 78.0
    return 67.0


def _fetch_open_meteo_archive(start_date, end_date) -> Dict:
    if start_date > end_date:
        return {}

    query = urlencode(
        {
            "latitude": DEFAULT_WEATHER_LAT,
            "longitude": DEFAULT_WEATHER_LON,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "daily": "weather_code,temperature_2m_mean,precipitation_sum",
            "timezone": "Asia/Manila",
        }
    )
    request_url = f"{OPEN_METEO_ARCHIVE_URL}?{query}"

    try:
        with urlopen(request_url, timeout=OPEN_METEO_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (URLError, TimeoutError, json.JSONDecodeError, ValueError):
        return {}

    daily = payload.get("daily") or {}
    dates = daily.get("time") or []
    weather_codes = daily.get("weather_code") or []
    temperatures = daily.get("temperature_2m_mean") or []
    precipitation_values = daily.get("precipitation_sum") or []

    weather_by_date = {}
    for index, date_value in enumerate(dates):
        try:
            parsed_date = pd.to_datetime(date_value).date()
        except Exception:
            continue

        precipitation_sum = float(precipitation_values[index] or 0.0) if index < len(precipitation_values) else 0.0
        weather_code = weather_codes[index] if index < len(weather_codes) else None
        weather = _map_weather_code_to_type(weather_code, precipitation_sum)
        temperature_c = float(temperatures[index] or 0.0) if index < len(temperatures) else 0.0

        weather_by_date[parsed_date] = {
            "weather": weather,
            "temperature_c": round(temperature_c or (31.5 if weather == "clear" else 29.5 if weather == "cloudy" else 27.4), 1),
            "humidity_pct": _default_humidity_for_weather(weather),
            "rainfall_mm": round(max(0.0, precipitation_sum), 2),
            "source": "open-meteo",
        }

    return weather_by_date


def _fetch_open_meteo_archive_range(start_date, end_date) -> Dict:
    weather_by_date = {}
    cursor = start_date

    while cursor <= end_date:
        chunk_end = min(cursor + timedelta(days=30), end_date)
        weather_by_date.update(_fetch_open_meteo_archive(cursor, chunk_end))
        cursor = chunk_end + timedelta(days=1)

    return weather_by_date


def _refresh_weather_history_from_archive(
    db: Session,
    weather_rows: List[models.WeatherHistory],
    start_date,
    end_date,
) -> None:
    if not REFRESH_ARCHIVE_WEATHER_ON_PREDICTION:
        return

    historical_end_date = min(end_date, get_ph_today())
    if start_date > historical_end_date:
        return

    weather_by_date = {row.date: row for row in weather_rows}
    dates_to_refresh = [
        day_value
        for day_value in pd.date_range(start=start_date, end=historical_end_date, freq="D").date
        if day_value not in weather_by_date or (weather_by_date[day_value].source or "bootstrap") == "bootstrap"
    ]
    if not dates_to_refresh:
        return

    refresh_start = min(dates_to_refresh)
    refresh_end = max(dates_to_refresh)
    archive_weather = _fetch_open_meteo_archive_range(refresh_start, refresh_end)
    if not archive_weather:
        return

    updated = False
    for day_value in dates_to_refresh:
        archive_row = archive_weather.get(day_value)
        if not archive_row:
            continue

        existing = weather_by_date.get(day_value)
        if existing is None:
            existing = models.WeatherHistory(date=day_value)
            db.add(existing)
            weather_by_date[day_value] = existing

        existing.weather = archive_row["weather"]
        existing.temperature_c = archive_row["temperature_c"]
        existing.humidity_pct = archive_row["humidity_pct"]
        existing.rainfall_mm = archive_row["rainfall_mm"]
        existing.source = archive_row["source"]
        updated = True

    if updated:
        db.commit()


def _ensure_driver_history(db: Session, sales_df: pd.DataFrame) -> Dict:
    prediction_day = _next_school_day(get_ph_tomorrow())
    if sales_df.empty:
        start_date = get_ph_today() - timedelta(days=180)
        end_date = prediction_day
    else:
        start_date = min(sales_df["date"]).to_pydatetime().date() if isinstance(min(sales_df["date"]), pd.Timestamp) else min(sales_df["date"])
        end_date = max(max(sales_df["date"]), prediction_day)

    weather_rows = (
        db.query(models.WeatherHistory)
        .filter(models.WeatherHistory.date >= start_date, models.WeatherHistory.date <= end_date)
        .all()
    )
    event_rows = (
        db.query(models.SchoolEventHistory)
        .filter(models.SchoolEventHistory.date >= start_date, models.SchoolEventHistory.date <= end_date)
        .all()
    )

    weather_by_date = {row.date: row for row in weather_rows}
    event_by_date = {row.date: row for row in event_rows}

    inserted = False
    total_days = (end_date - start_date).days + 1
    for offset in range(total_days):
        day_value = start_date + timedelta(days=offset)
        if day_value not in weather_by_date:
            db.add(models.WeatherHistory(date=day_value, **_build_bootstrap_weather(day_value)))
            inserted = True
        if day_value not in event_by_date:
            db.add(models.SchoolEventHistory(date=day_value, **_build_bootstrap_school_event(day_value)))
            inserted = True

    if inserted:
        db.commit()

    weather_rows = (
        db.query(models.WeatherHistory)
        .filter(models.WeatherHistory.date >= start_date, models.WeatherHistory.date <= end_date)
        .all()
    )
    _refresh_weather_history_from_archive(db, weather_rows, start_date, end_date)

    return {"start_date": start_date, "end_date": end_date}


def _fetch_driver_daily_frame(db: Session, start_date, end_date) -> pd.DataFrame:
    weather_rows = (
        db.query(models.WeatherHistory)
        .filter(models.WeatherHistory.date >= start_date, models.WeatherHistory.date <= end_date)
        .all()
    )
    event_rows = (
        db.query(models.SchoolEventHistory)
        .filter(models.SchoolEventHistory.date >= start_date, models.SchoolEventHistory.date <= end_date)
        .all()
    )

    date_range = pd.date_range(start=start_date, end=end_date, freq="D")
    driver_df = pd.DataFrame({"date": date_range})
    driver_df["date_key"] = driver_df["date"].dt.date

    weather_df = pd.DataFrame(
        [
            {
                "date_key": row.date,
                "weather": row.weather,
                "temperature_c": float(row.temperature_c or 0),
                "humidity_pct": float(row.humidity_pct or 0),
                "rainfall_mm": float(row.rainfall_mm or 0),
                "weather_source": row.source or "unknown",
            }
            for row in weather_rows
        ]
    )
    if weather_df.empty:
        weather_df = pd.DataFrame(columns=["date_key", "weather", "temperature_c", "humidity_pct", "rainfall_mm", "weather_source"])

    event_df = pd.DataFrame(
        [
            {
                "date_key": row.date,
                "event_type": row.event_type,
                "event_label": row.label or row.event_type,
                "is_school_day": bool(row.is_school_day),
                "event_source": row.source or "unknown",
            }
            for row in event_rows
        ]
    )
    if event_df.empty:
        event_df = pd.DataFrame(columns=["date_key", "event_type", "event_label", "is_school_day", "event_source"])

    driver_df = driver_df.merge(weather_df, on="date_key", how="left").merge(event_df, on="date_key", how="left")
    driver_df["weather"] = driver_df["weather"].fillna("clear")
    driver_df["temperature_c"] = driver_df["temperature_c"].fillna(30.0)
    driver_df["humidity_pct"] = driver_df["humidity_pct"].fillna(70.0)
    driver_df["rainfall_mm"] = driver_df["rainfall_mm"].fillna(0.0)
    driver_df["event_type"] = driver_df["event_type"].fillna("none")
    driver_df["event_label"] = driver_df["event_label"].fillna("Regular School Day")
    driver_df["is_school_day"] = driver_df["is_school_day"].fillna(True).astype(int)
    driver_df["weather_source"] = driver_df["weather_source"].fillna("bootstrap")
    driver_df["event_source"] = driver_df["event_source"].fillna("bootstrap")

    for weather_type in WEATHER_TYPES:
        driver_df[f"weather_{weather_type}"] = (driver_df["weather"] == weather_type).astype(int)

    for event_type in EVENT_TYPES:
        driver_df[f"event_{event_type}"] = (driver_df["event_type"] == event_type).astype(int)

    return driver_df.drop(columns=["date_key"])


def _build_tomorrow_driver_row(driver_daily: pd.DataFrame, tomorrow_value, weather: str, event: str) -> Dict:
    tomorrow_match = driver_daily.loc[pd.to_datetime(driver_daily["date"]).dt.date == tomorrow_value]
    base = tomorrow_match.iloc[-1].to_dict() if not tomorrow_match.empty else {
        "date": pd.Timestamp(tomorrow_value),
        "temperature_c": 30.0,
        "humidity_pct": 70.0,
        "rainfall_mm": 0.0,
        "is_school_day": int(tomorrow_value.weekday() < 5),
        "event_label": "Regular School Day",
        "weather_source": "bootstrap",
        "event_source": "bootstrap",
    }

    base["weather"] = weather if weather in WEATHER_TYPES else "clear"
    base["event_type"] = event if event in EVENT_TYPES else "none"

    if base["weather"] == "rainy" and float(base.get("rainfall_mm", 0) or 0) <= 0:
        base["rainfall_mm"] = 9.0
    if base["weather"] == "clear" and float(base.get("rainfall_mm", 0) or 0) > 1.5:
        base["rainfall_mm"] = 0.0

    base["is_school_day"] = 0 if base["event_type"] == "holiday" else int(base.get("is_school_day", 1))
    base["event_label"] = {
        "intramurals": "Intramurals",
        "exams": "Exam Week",
        "halfday": "Half Day",
        "holiday": "Holiday",
        "none": "Regular School Day",
    }.get(base["event_type"], "Regular School Day")

    for weather_type in WEATHER_TYPES:
        base[f"weather_{weather_type}"] = int(base["weather"] == weather_type)
    for event_type in EVENT_TYPES:
        base[f"event_{event_type}"] = int(base["event_type"] == event_type)

    return base


def _build_feature_summary(driver_daily: pd.DataFrame, driver_range: Dict) -> Dict:
    historical_driver_daily = driver_daily.loc[pd.to_datetime(driver_daily["date"]).dt.date <= get_ph_today()].copy()
    weather_sources = sorted(
        set(str(value) for value in historical_driver_daily.get("weather_source", pd.Series(dtype=str)).dropna().tolist())
    )
    event_sources = sorted(
        set(str(value) for value in historical_driver_daily.get("event_source", pd.Series(dtype=str)).dropna().tolist())
    )
    return {
        "model_feature_groups": MODEL_FEATURE_GROUPS,
        "heuristic_feature_groups": HEURISTIC_FEATURE_GROUPS,
        "tomorrow_outlook_feature_groups": TOMORROW_OUTLOOK_FEATURE_GROUPS,
        "historical_drivers": {
            "weather_days": int(len(historical_driver_daily)),
            "event_days": int(len(historical_driver_daily)),
            "start_date": driver_range["start_date"].isoformat(),
            "end_date": min(driver_range["end_date"], get_ph_today()).isoformat(),
            "weather_sources": weather_sources or ["bootstrap"],
            "event_sources": event_sources or ["bootstrap"],
        },
    }


def _fetch_sales_df(db: Session, days_back: int = 90) -> pd.DataFrame:
    cutoff = get_ph_recent_cutoff_utc_naive(days_back)
    transactions = (
        db.query(models.Transaction)
        .options(
            selectinload(models.Transaction.items).selectinload(models.TransactionItem.product)
        )
        .filter(models.Transaction.created_at >= cutoff)
        .all()
    )

    rows = []
    for transaction in transactions:
        created_at = to_ph_time(transaction.created_at)
        time_slot = _resolve_time_slot(created_at.hour)
        for item in transaction.items or []:
            product = item.product
            quantity = int(item.quantity or 0)
            price = float(item.unit_price or 0)
            if quantity <= 0 or price < 0:
                continue
            rows.append(
                {
                    "date": created_at.date(),
                    "product_id": item.product_id,
                    "product_name": product.name if product else "Unknown",
                    "category": (product.category if product and product.category else "General").lower(),
                    "quantity": quantity,
                    "price": price,
                    "day_of_week": created_at.weekday(),
                    "breakfast_qty": quantity if time_slot == "breakfast" else 0,
                    "lunch_qty": quantity if time_slot == "lunch" else 0,
                    "afternoon_qty": quantity if time_slot == "afternoon" else 0,
                }
            )

    if rows:
        return pd.DataFrame(rows)

    return pd.DataFrame(
        columns=[
            "date",
            "product_id",
            "product_name",
            "category",
            "quantity",
            "price",
            "day_of_week",
            "breakfast_qty",
            "lunch_qty",
            "afternoon_qty",
        ]
    )


def _build_model(algorithm: str):
    if _normalize_algorithm(algorithm) != BEST_ALGORITHM or xgb is None:
        raise RuntimeError("XGBoost is the only enabled prediction model.")

    return xgb.XGBRegressor(
        objective="reg:squarederror",
        n_estimators=45,
        max_depth=3,
        learning_rate=0.07,
        subsample=0.9,
        colsample_bytree=0.9,
        random_state=42,
    )


def _get_category_factor(category: str, weather: str, event: str) -> float:
    config = CATEGORY_FACTORS.get(category.lower(), {})
    weather_factor = config.get("weather", {}).get(weather, 1.0)
    event_factor = config.get("event", {}).get(event, 1.0)
    return weather_factor * event_factor


def _get_overall_factor(weather: str, event: str) -> float:
    return WEATHER_FACTORS.get(weather, 1.0) * EVENT_FACTORS.get(event, 1.0)


def _safe_mape(y_true, y_pred) -> float | None:
    actual = np.array(y_true, dtype=float)
    predicted = np.array(y_pred, dtype=float)
    if actual.size == 0 or predicted.size == 0:
        return None

    denominator = np.maximum(np.abs(actual), 1.0)
    return float(np.mean(np.abs(actual - predicted) / denominator) * 100)


def _safe_wape(y_true, y_pred) -> float | None:
    actual = np.array(y_true, dtype=float)
    predicted = np.array(y_pred, dtype=float)
    if actual.size == 0 or predicted.size == 0:
        return None

    actual_total = float(np.sum(np.abs(actual)))
    if actual_total <= 0:
        return 0.0 if float(np.sum(np.abs(predicted))) <= 0 else 100.0

    return float(np.sum(np.abs(actual - predicted)) / actual_total * 100)


def _format_percent_metric(value: float | None, cap: float = 99.9) -> str:
    if value is None or not np.isfinite(value):
        value = cap
    return f"{min(max(float(value), 0.0), cap):.1f}%"


def _format_accuracy_metric(error_rate: float | None) -> str:
    if error_rate is None or not np.isfinite(error_rate):
        error_rate = 100.0
    return f"{min(99.9, max(0.0, 100.0 - float(error_rate))):.1f}%"


def _validation_context_from_row(row) -> tuple[str, str, bool]:
    weather_scores = {
        "clear": float(row.get("weather_clear", 0) or 0),
        "cloudy": float(row.get("weather_cloudy", 0) or 0),
        "rainy": float(row.get("weather_rainy", 0) or 0),
    }
    weather = max(weather_scores, key=weather_scores.get)
    if weather_scores[weather] <= 0:
        weather = "clear"

    event_scores = {
        "holiday": float(row.get("event_holiday", 0) or 0),
        "halfday": float(row.get("event_halfday", 0) or 0),
        "intramurals": float(row.get("event_intramurals", 0) or 0),
        "exams": float(row.get("event_exams", 0) or 0),
        "none": float(row.get("event_none", 0) or 0),
    }
    is_school_day = float(row.get("is_school_day", 1) or 0) >= 0.5
    event = max(event_scores, key=event_scores.get)
    if not is_school_day:
        event = "holiday"
    elif event_scores[event] <= 0:
        event = "none"

    return weather, event, is_school_day


def _build_validation_metrics(validation_records: List[Dict], algorithm: str) -> Dict:
    if not validation_records:
        return _fallback_metrics(algorithm)

    school_records = [
        record
        for record in validation_records
        if record.get("is_school_day", True)
    ]
    metric_records = school_records or validation_records

    item_actual = np.array([record["actual"] for record in metric_records], dtype=float)
    item_predicted = np.array([record["predicted"] for record in metric_records], dtype=float)
    if item_actual.size == 0 or item_predicted.size == 0:
        return _fallback_metrics(algorithm)

    item_rmse = float(np.sqrt(mean_squared_error(item_actual, item_predicted)))
    item_wape = _safe_wape(item_actual, item_predicted)
    item_mape = _safe_mape(item_actual[item_actual > 0], item_predicted[item_actual > 0])

    daily_totals = {}
    for record in metric_records:
        date_key = record.get("date") or "unknown"
        entry = daily_totals.setdefault(date_key, {"actual": 0.0, "predicted": 0.0})
        entry["actual"] += float(record["actual"])
        entry["predicted"] += float(record["predicted"])

    daily_actual = np.array([entry["actual"] for entry in daily_totals.values()], dtype=float)
    daily_predicted = np.array([entry["predicted"] for entry in daily_totals.values()], dtype=float)
    canteen_wape = _safe_wape(daily_actual, daily_predicted)
    try:
        canteen_r2 = r2_score(daily_actual, daily_predicted) if len(daily_actual) > 1 else 0.0
    except Exception:
        canteen_r2 = 0.0

    if not np.isfinite(canteen_r2):
        canteen_r2 = 0.0

    display_error_rate = canteen_wape if canteen_wape is not None else item_wape
    if display_error_rate is None:
        display_error_rate = 100.0

    return {
        "rmse": f"{item_rmse:.2f}",
        "mape": _format_percent_metric(display_error_rate),
        "wape": _format_percent_metric(display_error_rate),
        "item_wape": _format_percent_metric(item_wape),
        "item_mape": _format_percent_metric(item_mape),
        "canteen_wape": _format_percent_metric(canteen_wape),
        "accuracy": _format_accuracy_metric(display_error_rate),
        "r2": f"{canteen_r2:.2f}",
        "error_rate": _format_percent_metric(display_error_rate),
        "accuracy_basis": "school-day canteen WAPE",
        "validation_days": len(daily_totals),
        "validation_rows": len(metric_records),
    }


def _build_daily_sales(product_df: pd.DataFrame, series_end_date=None) -> pd.DataFrame:
    if product_df.empty:
        return pd.DataFrame(
            columns=[
                "date",
                "quantity",
                "day_of_week",
                "avg_price",
                "breakfast_qty",
                "lunch_qty",
                "afternoon_qty",
            ]
        )

    daily = (
        product_df.groupby("date")
        .agg(
            quantity=("quantity", "sum"),
            day_of_week=("day_of_week", "first"),
            avg_price=("price", "mean"),
            breakfast_qty=("breakfast_qty", "sum"),
            lunch_qty=("lunch_qty", "sum"),
            afternoon_qty=("afternoon_qty", "sum"),
        )
        .reset_index()
        .sort_values("date")
    )
    daily["date"] = pd.to_datetime(daily["date"])
    start_date = daily["date"].min()
    end_date = pd.to_datetime(series_end_date) if series_end_date is not None else daily["date"].max()
    full_range = pd.date_range(start=start_date, end=end_date, freq="D")
    default_price = float(product_df["price"].median()) if not product_df["price"].empty else 0.0

    daily = (
        daily.set_index("date")
        .reindex(full_range)
        .rename_axis("date")
        .reset_index()
    )
    daily["day_of_week"] = daily["date"].dt.weekday
    daily["quantity"] = daily["quantity"].fillna(0).clip(lower=0).astype(float)
    daily["breakfast_qty"] = daily["breakfast_qty"].fillna(0).clip(lower=0).astype(float)
    daily["lunch_qty"] = daily["lunch_qty"].fillna(0).clip(lower=0).astype(float)
    daily["afternoon_qty"] = daily["afternoon_qty"].fillna(0).clip(lower=0).astype(float)
    daily["avg_price"] = daily["avg_price"].fillna(default_price).clip(lower=0).astype(float)

    nonzero_quantities = daily.loc[daily["quantity"] > 0, "quantity"]
    if len(nonzero_quantities) >= 12:
        upper_bound = float(nonzero_quantities.quantile(0.99))
        if upper_bound > 0:
            daily["quantity"] = daily["quantity"].clip(upper=upper_bound)
            slot_total = daily["breakfast_qty"] + daily["lunch_qty"] + daily["afternoon_qty"]
            slot_scale = np.where(slot_total > 0, daily["quantity"] / np.maximum(slot_total, 1.0), 0.0)
            daily["breakfast_qty"] = daily["breakfast_qty"] * np.where(slot_total > 0, slot_scale, 1.0)
            daily["lunch_qty"] = daily["lunch_qty"] * np.where(slot_total > 0, slot_scale, 1.0)
            daily["afternoon_qty"] = daily["afternoon_qty"] * np.where(slot_total > 0, slot_scale, 1.0)
    daily["date"] = daily["date"].dt.date
    return daily


def _build_context_daily_lookup(df: pd.DataFrame, series_end_date=None) -> Dict:
    if df.empty:
        return {"global": pd.DataFrame(columns=["date", "quantity", "day_of_week"]), "by_category": {}}

    categories = {
        str(category).lower(): _build_daily_sales(
            df[df["category"] == category].copy(),
            series_end_date=series_end_date,
        )
        for category in df["category"].dropna().unique().tolist()
    }

    return {
        "global": _build_daily_sales(df.copy(), series_end_date=series_end_date),
        "by_category": categories,
    }


def _attach_context_features(frame: pd.DataFrame, prefix: str, context_daily: pd.DataFrame | None) -> pd.DataFrame:
    if context_daily is None or context_daily.empty:
        frame[f"{prefix}_lag_1"] = 0.0
        frame[f"{prefix}_rolling_mean_7"] = 0.0
        frame[f"{prefix}_weekday_mean"] = 0.0
        return frame

    context = context_daily[["date", "quantity", "day_of_week"]].copy()
    context["date"] = pd.to_datetime(context["date"])
    context = context.rename(columns={"quantity": f"{prefix}_quantity"})

    frame = frame.merge(
        context[["date", f"{prefix}_quantity"]],
        on="date",
        how="left",
    )
    shifted = frame[f"{prefix}_quantity"].shift(1)
    frame[f"{prefix}_lag_1"] = shifted
    frame[f"{prefix}_rolling_mean_7"] = shifted.rolling(7, min_periods=1).mean()
    frame[f"{prefix}_weekday_sum"] = frame.groupby("day_of_week")[f"{prefix}_quantity"].cumsum() - frame[f"{prefix}_quantity"]
    frame[f"{prefix}_weekday_count"] = frame.groupby("day_of_week").cumcount()
    frame[f"{prefix}_weekday_mean"] = np.where(
        frame[f"{prefix}_weekday_count"] > 0,
        frame[f"{prefix}_weekday_sum"] / frame[f"{prefix}_weekday_count"],
        np.nan,
    )
    return frame


def _build_feature_frame(
    daily: pd.DataFrame,
    category_daily: pd.DataFrame | None = None,
    global_daily: pd.DataFrame | None = None,
    driver_daily: pd.DataFrame | None = None,
) -> pd.DataFrame:
    if len(daily) < 2:
        return pd.DataFrame(columns=["series_index", "quantity", *FORECAST_FEATURE_COLUMNS])

    frame = daily.copy().reset_index(drop=True)
    frame["date"] = pd.to_datetime(frame["date"])
    frame["series_index"] = frame.index
    frame["days_idx"] = np.arange(len(frame))
    frame["is_weekend"] = (frame["day_of_week"] >= 5).astype(int)
    frame["day_of_week_sin"] = np.sin((2 * np.pi * frame["day_of_week"]) / 7)
    frame["day_of_week_cos"] = np.cos((2 * np.pi * frame["day_of_week"]) / 7)
    median_price = float(frame["avg_price"].replace(0, np.nan).median()) if not frame["avg_price"].empty else 0.0
    if not np.isfinite(median_price):
        median_price = 0.0
    frame["price_vs_median"] = frame["avg_price"] / max(median_price, 1.0)
    frame["price_delta_1"] = frame["avg_price"] - frame["avg_price"].shift(1).fillna(frame["avg_price"])

    shifted_quantity = frame["quantity"].shift(1)
    shifted_breakfast = frame["breakfast_qty"].shift(1)
    shifted_lunch = frame["lunch_qty"].shift(1)
    shifted_afternoon = frame["afternoon_qty"].shift(1)
    frame["lag_1"] = shifted_quantity
    frame["lag_2"] = frame["quantity"].shift(2)
    frame["lag_3"] = frame["quantity"].shift(3)
    frame["lag_7"] = frame["quantity"].shift(7)
    frame["breakfast_lag_1"] = shifted_breakfast
    frame["lunch_lag_1"] = shifted_lunch
    frame["afternoon_lag_1"] = shifted_afternoon
    frame["rolling_mean_3"] = shifted_quantity.rolling(3, min_periods=1).mean()
    frame["rolling_mean_7"] = shifted_quantity.rolling(7, min_periods=1).mean()
    frame["rolling_max_7"] = shifted_quantity.rolling(7, min_periods=1).max()
    frame["recent_nonzero_ratio_14"] = shifted_quantity.rolling(14, min_periods=1).apply(
        lambda values: float(np.count_nonzero(values)) / max(len(values), 1),
        raw=True,
    )
    breakfast_sum_7 = shifted_breakfast.rolling(7, min_periods=1).sum()
    lunch_sum_7 = shifted_lunch.rolling(7, min_periods=1).sum()
    afternoon_sum_7 = shifted_afternoon.rolling(7, min_periods=1).sum()
    slot_sum_7 = breakfast_sum_7 + lunch_sum_7 + afternoon_sum_7
    frame["breakfast_share_7"] = breakfast_sum_7 / np.maximum(slot_sum_7, 1.0)
    frame["lunch_share_7"] = lunch_sum_7 / np.maximum(slot_sum_7, 1.0)
    frame["afternoon_share_7"] = afternoon_sum_7 / np.maximum(slot_sum_7, 1.0)

    frame["weekday_history_sum"] = frame.groupby("day_of_week")["quantity"].cumsum() - frame["quantity"]
    frame["weekday_history_count"] = frame.groupby("day_of_week").cumcount()
    frame["weekday_history_mean"] = np.where(
        frame["weekday_history_count"] > 0,
        frame["weekday_history_sum"] / frame["weekday_history_count"],
        np.nan,
    )
    frame["weekday_recent_mean_4"] = shifted_quantity.groupby(frame["day_of_week"]).transform(
        lambda series: series.rolling(4, min_periods=1).mean()
    )
    frame["weekday_nonzero_mean"] = shifted_quantity.mask(shifted_quantity <= 0).groupby(frame["day_of_week"]).transform(
        lambda series: series.expanding(min_periods=1).mean()
    )

    last_sale_index = None
    gaps = []
    streaks = []
    running_streak = 0
    for idx, quantity in enumerate(frame["quantity"].tolist()):
        if last_sale_index is None:
            gaps.append(float(idx + 1))
        else:
            gaps.append(float(idx - last_sale_index))

        streaks.append(float(running_streak))
        if quantity > 0:
            last_sale_index = idx
            running_streak += 1
        else:
            running_streak = 0
    frame["days_since_last_sale"] = pd.Series(gaps).shift(1)
    frame["recent_sales_streak"] = pd.Series(streaks).shift(1)

    frame = _attach_context_features(frame, "category", category_daily)
    frame = _attach_context_features(frame, "global", global_daily)
    frame["category_share_7"] = frame["rolling_mean_7"] / np.maximum(frame["category_rolling_mean_7"], 1.0)

    if driver_daily is not None and not driver_daily.empty:
        drivers = driver_daily.copy()
        drivers["date"] = pd.to_datetime(drivers["date"])
        driver_columns = ["date"] + [
            "weather_clear",
            "weather_cloudy",
            "weather_rainy",
            "temperature_c",
            "humidity_pct",
            "rainfall_mm",
            "is_school_day",
            "event_none",
            "event_intramurals",
            "event_exams",
            "event_halfday",
            "event_holiday",
        ]
        frame = frame.merge(drivers[driver_columns], on="date", how="left")
    else:
        for column in [
            "weather_clear",
            "weather_cloudy",
            "weather_rainy",
            "temperature_c",
            "humidity_pct",
            "rainfall_mm",
            "is_school_day",
            "event_none",
            "event_intramurals",
            "event_exams",
            "event_halfday",
            "event_holiday",
        ]:
            frame[column] = 0.0

    frame[FORECAST_FEATURE_COLUMNS] = frame[FORECAST_FEATURE_COLUMNS].fillna(0.0)
    return frame.iloc[1:].copy()


def _build_future_features(
    daily: pd.DataFrame,
    tomorrow_weekday: int,
    category_daily: pd.DataFrame | None = None,
    global_daily: pd.DataFrame | None = None,
    tomorrow_driver: Dict | None = None,
) -> np.ndarray:
    history = daily.copy().reset_index(drop=True)
    quantities = history["quantity"].astype(float).to_numpy()
    breakfast_quantities = history["breakfast_qty"].astype(float).to_numpy()
    lunch_quantities = history["lunch_qty"].astype(float).to_numpy()
    afternoon_quantities = history["afternoon_qty"].astype(float).to_numpy()
    recent_3 = quantities[-3:]
    recent_7 = quantities[-7:]
    weekday_history = history.loc[history["day_of_week"] == tomorrow_weekday, "quantity"].astype(float)

    if len(quantities):
        nonzero_indices = np.flatnonzero(quantities > 0)
        days_since_last_sale = float(len(quantities) - nonzero_indices[-1]) if len(nonzero_indices) else float(len(quantities))
        recent_nonzero_ratio_14 = float(np.count_nonzero(quantities[-14:])) / min(len(quantities), 14)
        overall_weekday_mean = float(weekday_history.mean()) if not weekday_history.empty else float(np.mean(quantities))
    else:
        days_since_last_sale = 0.0
        recent_nonzero_ratio_14 = 0.0
        overall_weekday_mean = 0.0
        weekday_recent_mean_4 = 0.0
        weekday_nonzero_mean = 0.0

    same_weekday_history = weekday_history.tail(4)
    weekday_recent_mean_4 = float(same_weekday_history.mean()) if not same_weekday_history.empty else overall_weekday_mean
    weekday_nonzero_history = weekday_history[weekday_history > 0]
    weekday_nonzero_mean = float(weekday_nonzero_history.mean()) if not weekday_nonzero_history.empty else overall_weekday_mean

    recent_sales_streak = 0.0
    for quantity in quantities[::-1]:
        if quantity > 0:
            recent_sales_streak += 1.0
        else:
            break

    def _context_summary(context_daily: pd.DataFrame | None) -> tuple[float, float, float]:
        if context_daily is None or context_daily.empty:
            return 0.0, 0.0, 0.0

        context = context_daily.copy().reset_index(drop=True)
        context_quantities = context["quantity"].astype(float).to_numpy()
        context_weekday_history = context.loc[
            context["day_of_week"] == tomorrow_weekday,
            "quantity",
        ].astype(float)
        return (
            float(context_quantities[-1]) if len(context_quantities) >= 1 else 0.0,
            float(np.mean(context_quantities[-7:])) if len(context_quantities) else 0.0,
            float(context_weekday_history.mean()) if not context_weekday_history.empty else 0.0,
        )

    category_lag_1, category_rolling_mean_7, category_weekday_mean = _context_summary(category_daily)
    global_lag_1, global_rolling_mean_7, global_weekday_mean = _context_summary(global_daily)
    breakfast_sum_7 = float(np.sum(breakfast_quantities[-7:])) if len(breakfast_quantities) else 0.0
    lunch_sum_7 = float(np.sum(lunch_quantities[-7:])) if len(lunch_quantities) else 0.0
    afternoon_sum_7 = float(np.sum(afternoon_quantities[-7:])) if len(afternoon_quantities) else 0.0
    slot_sum_7 = breakfast_sum_7 + lunch_sum_7 + afternoon_sum_7
    median_price = float(history["avg_price"].replace(0, np.nan).median()) if not history["avg_price"].empty else 0.0
    if not np.isfinite(median_price):
        median_price = 0.0
    current_price = float(history["avg_price"].iloc[-1]) if not history["avg_price"].empty else 0.0
    previous_price = float(history["avg_price"].iloc[-2]) if len(history["avg_price"]) >= 2 else current_price
    tomorrow_driver = tomorrow_driver or {}

    feature_row = {
        "days_idx": float(len(history)),
        "day_of_week": float(tomorrow_weekday),
        "is_weekend": float(int(tomorrow_weekday >= 5)),
        "day_of_week_sin": float(np.sin((2 * np.pi * tomorrow_weekday) / 7)),
        "day_of_week_cos": float(np.cos((2 * np.pi * tomorrow_weekday) / 7)),
        "avg_price": current_price,
        "price_vs_median": current_price / max(median_price, 1.0),
        "price_delta_1": current_price - previous_price,
        "lag_1": float(quantities[-1]) if len(quantities) >= 1 else 0.0,
        "lag_2": float(quantities[-2]) if len(quantities) >= 2 else 0.0,
        "lag_3": float(quantities[-3]) if len(quantities) >= 3 else 0.0,
        "lag_7": float(quantities[-7]) if len(quantities) >= 7 else 0.0,
        "breakfast_lag_1": float(breakfast_quantities[-1]) if len(breakfast_quantities) >= 1 else 0.0,
        "lunch_lag_1": float(lunch_quantities[-1]) if len(lunch_quantities) >= 1 else 0.0,
        "afternoon_lag_1": float(afternoon_quantities[-1]) if len(afternoon_quantities) >= 1 else 0.0,
        "breakfast_share_7": breakfast_sum_7 / max(slot_sum_7, 1.0),
        "lunch_share_7": lunch_sum_7 / max(slot_sum_7, 1.0),
        "afternoon_share_7": afternoon_sum_7 / max(slot_sum_7, 1.0),
        "rolling_mean_3": float(np.mean(recent_3)) if len(recent_3) else 0.0,
        "rolling_mean_7": float(np.mean(recent_7)) if len(recent_7) else 0.0,
        "rolling_max_7": float(np.max(recent_7)) if len(recent_7) else 0.0,
        "weekday_history_mean": overall_weekday_mean,
        "weekday_recent_mean_4": weekday_recent_mean_4,
        "weekday_nonzero_mean": weekday_nonzero_mean,
        "days_since_last_sale": days_since_last_sale,
        "recent_sales_streak": recent_sales_streak,
        "recent_nonzero_ratio_14": recent_nonzero_ratio_14,
        "category_lag_1": category_lag_1,
        "category_rolling_mean_7": category_rolling_mean_7,
        "category_weekday_mean": category_weekday_mean,
        "global_lag_1": global_lag_1,
        "global_rolling_mean_7": global_rolling_mean_7,
        "global_weekday_mean": global_weekday_mean,
        "category_share_7": float(np.mean(recent_7)) / max(category_rolling_mean_7, 1.0) if len(recent_7) else 0.0,
        "weather_clear": float(tomorrow_driver.get("weather_clear", 0)),
        "weather_cloudy": float(tomorrow_driver.get("weather_cloudy", 0)),
        "weather_rainy": float(tomorrow_driver.get("weather_rainy", 0)),
        "temperature_c": float(tomorrow_driver.get("temperature_c", 30.0)),
        "humidity_pct": float(tomorrow_driver.get("humidity_pct", 70.0)),
        "rainfall_mm": float(tomorrow_driver.get("rainfall_mm", 0.0)),
        "is_school_day": float(tomorrow_driver.get("is_school_day", 1)),
        "event_none": float(tomorrow_driver.get("event_none", 1)),
        "event_intramurals": float(tomorrow_driver.get("event_intramurals", 0)),
        "event_exams": float(tomorrow_driver.get("event_exams", 0)),
        "event_halfday": float(tomorrow_driver.get("event_halfday", 0)),
        "event_holiday": float(tomorrow_driver.get("event_holiday", 0)),
    }
    return np.array([[feature_row[column] for column in FORECAST_FEATURE_COLUMNS]], dtype=float)


def _choose_blend_weight(history_points: int, model_mape: float | None, heuristic_mape: float | None) -> float:
    base_weight = min(0.8, max(0.35, 0.35 + (history_points / 120)))

    if model_mape is not None and heuristic_mape is not None:
        if model_mape >= heuristic_mape * 1.15:
            base_weight -= 0.2
        elif model_mape <= heuristic_mape * 0.85:
            base_weight += 0.1

    return float(min(0.8, max(0.2, base_weight)))


def _filter_validation_values(values, evaluation_mask):
    if not evaluation_mask:
        return list(values)

    filtered = [
        value
        for value, include in zip(values, evaluation_mask)
        if include
    ]
    return filtered or list(values)


def _select_blend_weight(
    y_true,
    y_pred_model,
    y_pred_heuristic,
    history_points: int,
    model_mape: float | None,
    heuristic_mape: float | None,
    evaluation_mask=None,
) -> float:
    candidate_weights = [0.0, 0.2, 0.35, 0.5, 0.65, 0.8, 1.0]
    preferred_weight = _choose_blend_weight(history_points, model_mape, heuristic_mape)
    best_weight = preferred_weight
    best_score = None
    eval_true = _filter_validation_values(y_true, evaluation_mask)
    eval_model = _filter_validation_values(y_pred_model, evaluation_mask)
    eval_heuristic = _filter_validation_values(y_pred_heuristic, evaluation_mask)

    for weight in candidate_weights:
        blended = [
            (model_value * weight) + (heuristic_value * (1 - weight))
            for model_value, heuristic_value in zip(eval_model, eval_heuristic)
        ]
        blended_error = _safe_wape(eval_true, blended)
        if blended_error is None:
            continue

        score = blended_error + (abs(weight - preferred_weight) * 0.25)
        if best_score is None or score < best_score:
            best_score = score
            best_weight = weight

    return float(best_weight)


def _get_history_health(daily: pd.DataFrame) -> Dict:
    if daily.empty:
        return {
            "days_observed": 0,
            "nonzero_days": 0,
            "total_units": 0.0,
            "recent_nonzero_days": 0,
        }

    return {
        "days_observed": int(len(daily)),
        "nonzero_days": int((daily["quantity"] > 0).sum()),
        "total_units": float(daily["quantity"].sum()),
        "recent_nonzero_days": int((daily["quantity"].tail(60) > 0).sum()),
    }


def _is_model_ready(daily: pd.DataFrame) -> bool:
    health = _get_history_health(daily)
    if health["days_observed"] < 14:
        return False

    return (
        health["nonzero_days"] >= 4
        and health["total_units"] >= 6
        and health["recent_nonzero_days"] >= 2
    )


def _build_history_gap_reason(daily: pd.DataFrame) -> str:
    health = _get_history_health(daily)
    gaps = []

    if health["days_observed"] < 14:
        gaps.append(f"only {health['days_observed']} days of history")
    if health["nonzero_days"] < 4:
        gaps.append(f"{health['nonzero_days']} non-zero selling days")
    if health["total_units"] < 6:
        gaps.append(f"{int(health['total_units'])} total units sold")
    if health["recent_nonzero_days"] < 2:
        gaps.append(f"{health['recent_nonzero_days']} recent selling days in the last 60 days")

    if not gaps:
        return "Used fallback because this product's sales pattern is still too sparse for reliable ML training."

    return f"Used fallback because this product only has {'; '.join(gaps)}."


def _is_sparse_category_ready(daily: pd.DataFrame, category_daily: pd.DataFrame | None, global_daily: pd.DataFrame | None) -> bool:
    health = _get_history_health(daily)
    if health["days_observed"] < 7:
        return False

    category_has_signal = category_daily is not None and not category_daily.empty and float(category_daily["quantity"].sum()) > 0
    global_has_signal = global_daily is not None and not global_daily.empty and float(global_daily["quantity"].sum()) > 0
    has_product_signal = health["nonzero_days"] >= 2 or health["total_units"] >= 4
    return has_product_signal and (category_has_signal or global_has_signal)


def _context_scaled_signal(
    daily: pd.DataFrame,
    context_daily: pd.DataFrame | None,
    tomorrow_weekday: int,
) -> float:
    if context_daily is None or context_daily.empty:
        return 0.0

    product_recent_mean = float(daily["quantity"].tail(min(28, len(daily))).mean()) if not daily.empty else 0.0
    product_total_units = float(daily["quantity"].sum()) if not daily.empty else 0.0
    context_recent_mean = float(context_daily["quantity"].tail(min(28, len(context_daily))).mean())
    context_weekday = context_daily.loc[context_daily["day_of_week"] == tomorrow_weekday, "quantity"].astype(float)
    context_weekday_mean = float(context_weekday.mean()) if not context_weekday.empty else context_recent_mean
    context_signal = (context_weekday_mean * 0.6) + (context_recent_mean * 0.4)

    if context_signal <= 0:
        return 0.0

    recent_share = product_recent_mean / max(context_recent_mean, 1.0)
    lifetime_share = product_total_units / max(float(context_daily["quantity"].sum()), 1.0)
    share = min(1.0, max(0.02 if product_total_units > 0 else 0.0, (recent_share * 0.7) + (lifetime_share * 0.3)))
    return context_signal * share


def _sparse_history_prediction(
    daily: pd.DataFrame,
    category: str,
    tomorrow_weekday: int,
    weather: str,
    event: str,
    category_daily: pd.DataFrame | None = None,
    global_daily: pd.DataFrame | None = None,
) -> Dict:
    baseline = _heuristic_prediction(
        daily,
        category,
        tomorrow_weekday,
        weather,
        event,
    )
    health = _get_history_health(daily)
    category_signal = _context_scaled_signal(daily, category_daily, tomorrow_weekday)
    global_signal = _context_scaled_signal(daily, global_daily, tomorrow_weekday)

    product_weight = 0.7 if health["nonzero_days"] >= 4 else 0.5 if health["nonzero_days"] >= 2 else 0.25
    if health["recent_nonzero_days"] == 0:
        product_weight -= 0.25
    elif health["recent_nonzero_days"] == 1:
        product_weight -= 0.1
    product_weight = max(0.15, product_weight)

    category_weight = 0.0
    global_weight = 0.0
    if category_signal > 0:
        category_weight = 0.25
    if global_signal > 0:
        global_weight = 0.15

    if health["recent_nonzero_days"] == 0:
        category_weight += 0.1 if category_signal > 0 else 0.0
        global_weight += 0.05 if global_signal > 0 else 0.0

    weight_total = product_weight + category_weight + global_weight
    if weight_total <= 0:
        return baseline

    assisted_prediction = (
        (baseline["prediction"] * product_weight)
        + (category_signal * category_weight)
        + (global_signal * global_weight)
    ) / weight_total

    if assisted_prediction > 0 and assisted_prediction < 0.5:
        assisted_prediction = 0.5

    return {
        **baseline,
        "prediction": max(0, round(assisted_prediction)),
        "source": "category-assisted",
    }


def _heuristic_prediction(
    daily: pd.DataFrame,
    category: str,
    tomorrow_weekday: int,
    weather: str,
    event: str,
) -> Dict:
    if daily.empty:
        return {"prediction": 0, "avg_daily": 0.0, "days_observed": 0, "source": "heuristic"}

    avg_daily = float(daily["quantity"].mean())
    recent_avg = float(daily["quantity"].tail(min(3, len(daily))).mean())

    weekday_rows = daily[daily["day_of_week"] == tomorrow_weekday]
    weekday_avg = float(weekday_rows["quantity"].mean()) if not weekday_rows.empty else avg_daily

    blended_base = (weekday_avg * 0.5) + (recent_avg * 0.3) + (avg_daily * 0.2)
    adjusted = blended_base * _get_overall_factor(weather, event) * _get_category_factor(
        category,
        weather,
        event,
    )

    if adjusted > 0 and adjusted < 0.5:
        adjusted = 0.5

    return {
        "prediction": max(0, round(adjusted)),
        "avg_daily": round(avg_daily, 2),
        "days_observed": len(daily),
        "source": "heuristic",
    }


def _shared_ml_predictions(
    product_contexts: List[Dict],
    algorithm: str,
    tomorrow_weekday: int,
    driver_daily: pd.DataFrame | None,
    tomorrow_driver: Dict | None,
    global_daily: pd.DataFrame | None,
) -> Dict[int, Dict]:
    results = {
        int(context["product"].id): {
            "prediction": None,
            "y_test": [],
            "y_pred": [],
            "validation_context": [],
            "reason": _build_history_gap_reason(context["daily"]),
        }
        for context in product_contexts
    }

    if xgb is None:
        for result in results.values():
            result["reason"] = "XGBoost is not installed, so heuristic forecasting was used."
        return results

    train_parts = []
    test_parts = []
    validation_rows = []
    future_rows = []
    eligible_contexts = []

    for context in product_contexts:
        product = context["product"]
        product_id = int(product.id)
        daily = context["daily"]
        category = context["category_key"]
        category_daily = context.get("category_daily")

        if not _is_model_ready(daily):
            continue

        model_df = _build_feature_frame(
            daily,
            category_daily=category_daily,
            global_daily=global_daily,
            driver_daily=driver_daily,
        )
        if len(model_df) < 8:
            results[product_id]["reason"] = "Not enough clean training rows after feature engineering."
            continue

        validation_window = max(3, int(np.ceil(len(model_df) * 0.2)))
        if len(model_df) - validation_window < 6:
            results[product_id]["reason"] = "Time-based split left too little history for training."
            continue

        train_df = model_df.iloc[:-validation_window]
        test_df = model_df.iloc[-validation_window:]
        train_parts.append(train_df[[*FORECAST_FEATURE_COLUMNS, "quantity"]])
        test_parts.append(test_df[FORECAST_FEATURE_COLUMNS])

        for _, test_row in test_df.iterrows():
            history_cutoff = int(test_row["series_index"])
            past_daily = daily.iloc[:history_cutoff].copy()
            validation_weather, validation_event, is_school_day = _validation_context_from_row(test_row)
            heuristic_prediction = _heuristic_prediction(
                past_daily,
                category,
                int(test_row["day_of_week"]),
                validation_weather,
                validation_event,
            )["prediction"]
            validation_rows.append(
                {
                    "product_id": product_id,
                    "actual": float(test_row["quantity"]),
                    "heuristic": float(heuristic_prediction),
                    "context": {
                        "date": pd.to_datetime(test_row["date"]).date().isoformat(),
                        "is_school_day": is_school_day,
                    },
                }
            )

        future_rows.append(
            _build_future_features(
                daily,
                tomorrow_weekday,
                category_daily=category_daily,
                global_daily=global_daily,
                tomorrow_driver=tomorrow_driver,
            )[0]
        )
        eligible_contexts.append({**context, "model_df": model_df})

    if not train_parts or not test_parts or not validation_rows:
        return results

    try:
        validation_model = _build_model(algorithm)
        train_frame = pd.concat(train_parts, ignore_index=True)
        test_frame = pd.concat(test_parts, ignore_index=True)
        validation_model.fit(
            train_frame[FORECAST_FEATURE_COLUMNS].values,
            train_frame["quantity"].values,
        )
        raw_validation_predictions = validation_model.predict(test_frame[FORECAST_FEATURE_COLUMNS].values)
    except Exception:
        for context in eligible_contexts:
            results[int(context["product"].id)]["reason"] = "Shared model training failed on the available history."
        return results

    y_test = [row["actual"] for row in validation_rows]
    y_pred_model = [max(0.0, float(value)) for value in raw_validation_predictions]
    y_pred_heuristic = [row["heuristic"] for row in validation_rows]
    evaluation_mask = [row["context"]["is_school_day"] for row in validation_rows]
    evaluation_y_test = _filter_validation_values(y_test, evaluation_mask)
    evaluation_y_pred_model = _filter_validation_values(y_pred_model, evaluation_mask)
    evaluation_y_pred_heuristic = _filter_validation_values(y_pred_heuristic, evaluation_mask)
    model_mape = _safe_wape(evaluation_y_test, evaluation_y_pred_model)
    heuristic_mape = _safe_wape(evaluation_y_test, evaluation_y_pred_heuristic)
    average_history_points = int(np.mean([len(context["model_df"]) for context in eligible_contexts]))

    blend_weight = _select_blend_weight(
        y_test,
        y_pred_model,
        y_pred_heuristic,
        average_history_points,
        model_mape,
        heuristic_mape,
        evaluation_mask=evaluation_mask,
    )
    blended_validation_predictions = [
        (model_value * blend_weight) + (heuristic_value * (1 - blend_weight))
        for model_value, heuristic_value in zip(y_pred_model, y_pred_heuristic)
    ]

    for row, blended_prediction in zip(validation_rows, blended_validation_predictions):
        result = results[row["product_id"]]
        result["y_test"].append(float(row["actual"]))
        result["y_pred"].append(float(blended_prediction))
        result["validation_context"].append(row["context"])

    try:
        future_predictions = validation_model.predict(np.vstack(future_rows))
    except Exception:
        for context in eligible_contexts:
            results[int(context["product"].id)]["reason"] = "Shared future forecast failed for tomorrow's features."
        return results

    for context, future_prediction in zip(eligible_contexts, future_predictions):
        product_id = int(context["product"].id)
        future_heuristic_prediction = float(context["heuristic"]["prediction"])
        prediction = max(
            0,
            round((max(0.0, float(future_prediction)) * blend_weight) + (future_heuristic_prediction * (1 - blend_weight))),
        )
        results[product_id]["prediction"] = prediction
        results[product_id]["reason"] = ""

    return results


def _build_recommendation(predicted_quantity: int, stock: int, min_stock: int) -> Dict:
    stock_gap = max(0, predicted_quantity - stock)
    overstock_units = max(0, stock - predicted_quantity)

    if stock_gap > 0:
        return {
            "recommendation_type": "restock",
            "stock_gap": stock_gap,
            "overstock_units": overstock_units,
            "recommendation": f"Restock {stock_gap} units to meet the projected demand.",
        }

    if predicted_quantity == 0:
        return {
            "recommendation_type": "low_demand",
            "stock_gap": stock_gap,
            "overstock_units": overstock_units,
            "recommendation": "Demand looks quiet. Avoid preparing extra units for this item.",
        }

    if stock > max(predicted_quantity * 1.5, min_stock * 2):
        return {
            "recommendation_type": "reduce_waste",
            "stock_gap": stock_gap,
            "overstock_units": overstock_units,
            "recommendation": "Use existing stock first to reduce waste risk.",
        }

    return {
        "recommendation_type": "healthy",
        "stock_gap": stock_gap,
        "overstock_units": overstock_units,
        "recommendation": "Stock level looks healthy for the projected demand.",
    }


def _build_weekly_sales_trend(
    df: pd.DataFrame,
    weather: str,
    event: str,
) -> List[Dict]:
    if df.empty:
        return _empty_weekly_trend()

    revenue_df = df.copy()
    revenue_df["revenue"] = revenue_df["quantity"] * revenue_df["price"]
    daily_revenue = (
        revenue_df.groupby("date")
        .agg(revenue=("revenue", "sum"), day_of_week=("day_of_week", "first"))
        .reset_index()
        .sort_values("date")
    )

    if daily_revenue.empty:
        return _empty_weekly_trend()

    daily_revenue = daily_revenue[daily_revenue["day_of_week"].isin(SCHOOL_WEEKDAYS)].copy()
    if daily_revenue.empty:
        return _empty_weekly_trend()

    weekday_baselines = {
        int(day): float(group["revenue"].mean())
        for day, group in daily_revenue.groupby("day_of_week")
    }
    overall_baseline = float(daily_revenue["revenue"].mean())
    recent_baseline = float(daily_revenue.tail(min(10, len(daily_revenue)))["revenue"].mean())
    recent_weekday_baselines = {
        int(day): float(group.tail(min(3, len(group)))["revenue"].mean())
        for day, group in daily_revenue.groupby("day_of_week")
    }
    multiplier = _get_overall_factor(weather, event)

    trend = []
    for offset, future_day in enumerate(SCHOOL_WEEKDAYS, start=1):
        weekday_baseline = weekday_baselines.get(future_day, overall_baseline)
        recent_weekday_baseline = recent_weekday_baselines.get(future_day, weekday_baseline)
        predicted_value = (
            (weekday_baseline * 0.6)
            + (recent_weekday_baseline * 0.25)
            + (recent_baseline * 0.15)
        ) * multiplier

        trend.append(
            {
                "date": WEEKDAY_LABELS[future_day],
                "predicted_sales": round(max(0, predicted_value), 2),
            }
        )

    return trend


def _build_daily_revenue(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame(columns=["date", "revenue", "quantity", "day_of_week"])

    revenue_df = df.copy()
    revenue_df["revenue"] = revenue_df["quantity"] * revenue_df["price"]
    daily_revenue = (
        revenue_df.groupby("date")
        .agg(
            revenue=("revenue", "sum"),
            quantity=("quantity", "sum"),
            day_of_week=("day_of_week", "first"),
        )
        .reset_index()
        .sort_values("date")
    )
    return daily_revenue


def _sum_revenue_between(daily_revenue: pd.DataFrame, start_date, end_date) -> float:
    if daily_revenue.empty:
        return 0.0

    mask = (daily_revenue["date"] >= start_date) & (daily_revenue["date"] <= end_date)
    return float(daily_revenue.loc[mask, "revenue"].sum())


def _average_revenue_between(daily_revenue: pd.DataFrame, start_date, end_date) -> float:
    total_days = max(1, (end_date - start_date).days + 1)
    return _sum_revenue_between(daily_revenue, start_date, end_date) / total_days


def _revenue_on_date(daily_revenue: pd.DataFrame, day_value) -> float:
    if daily_revenue.empty:
        return 0.0

    rows = daily_revenue.loc[daily_revenue["date"] == day_value]
    if rows.empty:
        return 0.0
    return float(rows["revenue"].sum())


def _same_weekday_average(daily_revenue: pd.DataFrame, weekday: int, tomorrow_value) -> float:
    if daily_revenue.empty:
        return 0.0

    weekday_rows = daily_revenue.loc[
        (daily_revenue["day_of_week"] == weekday) & (daily_revenue["date"] < tomorrow_value)
    ].tail(4)
    if weekday_rows.empty:
        return 0.0
    return float(weekday_rows["revenue"].mean())


def _recent_revenue_trend(daily_revenue: pd.DataFrame, today_value) -> str:
    recent_avg = _average_revenue_between(daily_revenue, today_value - timedelta(days=2), today_value)
    previous_avg = _average_revenue_between(
        daily_revenue,
        today_value - timedelta(days=6),
        today_value - timedelta(days=3),
    )

    if recent_avg <= 0 and previous_avg <= 0:
        return "stable"
    if previous_avg <= 0:
        return "rising"
    if recent_avg > previous_avg * 1.08:
        return "rising"
    if recent_avg < previous_avg * 0.92:
        return "declining"
    return "stable"


def _estimate_attendance_forecast(tomorrow_value, event: str) -> int:
    weekday_factor = {
        0: 1.04,
        1: 1.0,
        2: 1.0,
        3: 0.98,
        4: 0.92,
        5: 0.2,
        6: 0.12,
    }.get(tomorrow_value.weekday(), 1.0)
    event_factor = {
        "none": 1.0,
        "intramurals": 1.05,
        "exams": 0.9,
        "halfday": 0.72,
        "holiday": 0.0,
    }.get(event, 1.0)
    return int(round(1180 * weekday_factor * event_factor))


def _infer_allowance_timing(tomorrow_value) -> Dict:
    if tomorrow_value.weekday() == 0:
        return {
            "value": "start_week",
            "label": "Start of week",
            "modifier": 1.08,
            "source": "calendar_allowance_pattern",
        }
    if tomorrow_value.weekday() == 4:
        return {
            "value": "end_week",
            "label": "End of week",
            "modifier": 0.92,
            "source": "calendar_allowance_pattern",
        }
    return {
        "value": "normal",
        "label": "Normal",
        "modifier": 1.0,
        "source": "calendar_allowance_pattern",
    }


def _infer_stock_level(predictions: List[Dict], summary: Dict) -> Dict:
    total_stock_gap = sum(float(prediction.get("stock_gap") or 0) for prediction in predictions)
    restock_count = int(summary.get("restock_count") or 0)
    waste_count = int(summary.get("waste_risk_count") or 0)

    if total_stock_gap >= 40 or restock_count >= 6:
        return {
            "value": "critical",
            "label": "Critical",
            "modifier": 0.58,
            "source": "inventory_forecast",
            "total_stock_gap": total_stock_gap,
        }
    if total_stock_gap > 0 or restock_count > 0:
        return {
            "value": "low",
            "label": "Low",
            "modifier": 0.82,
            "source": "inventory_forecast",
            "total_stock_gap": total_stock_gap,
        }
    if waste_count > 0:
        return {
            "value": "high",
            "label": "High",
            "modifier": 1.03,
            "source": "inventory_forecast",
            "total_stock_gap": total_stock_gap,
        }
    return {
        "value": "balanced",
        "label": "Balanced",
        "modifier": 1.0,
        "source": "inventory_forecast",
        "total_stock_gap": total_stock_gap,
    }


def _infer_planned_menu_proxy(predictions: List[Dict]) -> Dict:
    if not predictions:
        return {
            "value": "No menu signal yet",
            "source": "forecast",
            "modifier": 0.94,
        }

    top_items = sorted(
        predictions,
        key=lambda prediction: prediction.get("predicted_quantity", 0),
        reverse=True,
    )[:2]
    item_names = [item.get("product_name") for item in top_items if item.get("product_name")]
    top_quantity = sum(float(item.get("predicted_quantity") or 0) for item in top_items)
    menu_label = " + ".join(item_names) if item_names else "Forecasted top sellers"

    return {
        "value": menu_label,
        "source": "forecasted top demand",
        "modifier": 1.08 if top_quantity > 0 else 0.94,
    }


def _weather_label(weather: str) -> str:
    return {
        "clear": "Hot / Clear",
        "cloudy": "Cool / Cloudy",
        "rainy": "Rainy",
    }.get(weather, "Hot / Clear")


def _outlook_level(estimated_sales: float, benchmark_sales: float) -> str:
    if estimated_sales <= 0:
        return "unavailable"
    if benchmark_sales <= 0:
        return "normal"
    ratio = estimated_sales / benchmark_sales
    if ratio >= 1.08:
        return "high"
    if ratio <= 0.92:
        return "low"
    return "normal"


def _outlook_label(level: str) -> str:
    return {
        "high": "High Tomorrow Sales",
        "normal": "Normal Tomorrow Sales",
        "low": "Low Tomorrow Sales",
        "unavailable": "Waiting for Sales Data",
    }.get(level, "Waiting for Sales Data")


def _build_tomorrow_sales_outlook(
    df: pd.DataFrame,
    predictions: List[Dict],
    summary: Dict,
    tomorrow_driver: Dict,
    weather: str,
    event: str,
) -> Dict:
    today = get_ph_today()
    tomorrow = _next_school_day(get_ph_tomorrow())
    daily_revenue = _build_daily_revenue(df)
    today_sales = _revenue_on_date(daily_revenue, today)
    last_7_day_avg = _average_revenue_between(daily_revenue, today - timedelta(days=6), today)
    last_3_day_avg = _average_revenue_between(daily_revenue, today - timedelta(days=2), today)
    same_day_last_week = _revenue_on_date(daily_revenue, tomorrow - timedelta(days=7))
    same_weekday_avg = _same_weekday_average(daily_revenue, tomorrow.weekday(), tomorrow)
    benchmark_sales = same_day_last_week or same_weekday_avg or last_7_day_avg or today_sales
    benchmark_source = (
        "same_day_last_week"
        if same_day_last_week > 0
        else "same_weekday_average"
        if same_weekday_avg > 0
        else "last_7_day_average"
        if last_7_day_avg > 0
        else "today_sales"
        if today_sales > 0
        else "none"
    )
    stock_level = _infer_stock_level(predictions, summary)
    menu_proxy = _infer_planned_menu_proxy(predictions)
    allowance_timing = _infer_allowance_timing(tomorrow)
    attendance_forecast = _estimate_attendance_forecast(tomorrow, event)
    estimated_sales = float(summary.get("expected_revenue") or 0)
    level = _outlook_level(estimated_sales, benchmark_sales)
    model_backed = int(summary.get("model_backed_predictions") or 0)
    total_products = max(1, int(summary.get("total_products") or 0))

    inputs = {
        "tomorrow_day": {
            "value": tomorrow.strftime("%A"),
            "weekday_index": tomorrow.weekday(),
            "date": tomorrow.isoformat(),
            "source": "calendar",
        },
        "today_sales": {
            "value": round(today_sales, 2),
            "source": "transactions_today",
        },
        "last_7_day_avg": {
            "value": round(last_7_day_avg, 2),
            "source": "transactions_last_7_days",
        },
        "last_3_day_avg": {
            "value": round(last_3_day_avg, 2),
            "source": "transactions_last_3_days",
        },
        "recent_sales_trend": {
            "value": _recent_revenue_trend(daily_revenue, today),
            "source": "last_3_days_vs_previous_4_days",
        },
        "attendance_forecast": {
            "value": attendance_forecast,
            "source": "school_day_event_proxy",
        },
        "weather_forecast": {
            "value": _weather_label(weather),
            "weather": weather,
            "temperature_c": round(float(tomorrow_driver.get("temperature_c") or 30.0), 1),
            "rainfall_mm": round(float(tomorrow_driver.get("rainfall_mm") or 0.0), 2),
            "source": tomorrow_driver.get("weather_source") or "selected",
        },
        "event": {
            "value": tomorrow_driver.get("event_label") or "Regular School Day",
            "event_type": event,
            "source": tomorrow_driver.get("event_source") or "selected",
        },
        "planned_menu": menu_proxy,
        "stock_level": stock_level,
        "allowance_timing": allowance_timing,
        "same_day_last_week": {
            "value": round(same_day_last_week, 2),
            "source": "transactions_same_calendar_weekday",
        },
    }

    return {
        "level": level,
        "label": _outlook_label(level),
        "estimated_sales": round(estimated_sales, 2),
        "benchmark_sales": round(float(benchmark_sales or 0), 2),
        "benchmark_source": benchmark_source,
        "demand_index": round(estimated_sales / benchmark_sales, 3) if benchmark_sales > 0 else 1.0,
        "confidence": "high" if model_backed / total_products >= 0.6 else "medium" if model_backed > 0 else "low",
        "inputs": inputs,
        "feature_groups": TOMORROW_OUTLOOK_FEATURE_GROUPS,
    }


def _build_insights(predictions: List[Dict], summary: Dict, data_source: str) -> List[Dict]:
    insights = []

    restocks = [prediction for prediction in predictions if prediction["recommendation_type"] == "restock"]
    waste_risks = [
        prediction for prediction in predictions if prediction["recommendation_type"] == "reduce_waste"
    ]

    if restocks:
        top_restock = max(restocks, key=lambda prediction: prediction["stock_gap"])
        insights.append(
            {
                "type": "restock",
                "title": "Highest restock priority",
                "message": f"{top_restock['product_name']} needs {top_restock['stock_gap']} more units.",
            }
        )

    if waste_risks:
        top_waste = max(waste_risks, key=lambda prediction: prediction["overstock_units"])
        insights.append(
            {
                "type": "waste",
                "title": "Biggest waste risk",
                "message": f"{top_waste['product_name']} has {top_waste['overstock_units']} units above projected demand.",
            }
        )

    if predictions:
        top_demand = max(predictions, key=lambda prediction: prediction["predicted_quantity"])
        insights.append(
            {
                "type": "demand",
                "title": "Top expected demand",
                "message": f"{top_demand['product_name']} is forecast to sell {top_demand['predicted_quantity']} units.",
            }
        )

    if data_source == "heuristic":
        insights.append(
            {
                "type": "coverage",
                "title": "Forecast fallback active",
                "message": "The system used heuristic forecasting where sales history was too limited for full model training.",
            }
        )

    if not insights:
        insights.append(
            {
                "type": "info",
                "title": "No forecast insights yet",
                "message": "Record more transactions to improve the forecast coverage and recommendations.",
            }
        )

    return insights[:4]


def predict_tomorrow_sales(
    db: Session,
    algorithm: str = BEST_ALGORITHM,
    weather: str = "clear",
    event: str = "none",
    allow_stale: bool = True,
) -> Dict:
    algorithm = _normalize_algorithm(algorithm)
    cache_key = _build_prediction_cache_key(db, algorithm, weather, event)
    request_key = _build_prediction_request_key(algorithm, weather, event)
    data_signature = _serialize_prediction_signature(cache_key)

    now_utc = datetime.utcnow()
    with _PREDICTION_CACHE_LOCK:
        _prune_prediction_cache(now_utc)
        cached_result = _get_cached_prediction_result(cache_key, now_utc)
    if cached_result is not None:
        return _with_cache_metadata(cached_result, "fresh")

    persistent_cache = _load_persistent_prediction_cache(db, request_key)
    persistent_payload = _decode_persistent_prediction_payload(persistent_cache)
    if persistent_payload is not None:
        if persistent_cache.data_signature == data_signature:
            _store_prediction_result({cache_key}, persistent_payload)
            return _with_cache_metadata(persistent_payload, "fresh", persistent_cache)
        if allow_stale:
            return _with_cache_metadata(
                persistent_payload,
                "stale",
                persistent_cache,
                refresh_needed=True,
            )

    while True:
        now_utc = datetime.utcnow()
        with _PREDICTION_CACHE_LOCK:
            _prune_prediction_cache(now_utc)
            cached_result = _get_cached_prediction_result(cache_key, now_utc)
            if cached_result is not None:
                return _with_cache_metadata(cached_result, "fresh")

            wait_event = _PREDICTION_INFLIGHT.get(cache_key)
            if wait_event is None:
                wait_event = threading.Event()
                _PREDICTION_INFLIGHT[cache_key] = wait_event
                break

        wait_event.wait(timeout=60)

    cache_keys = {cache_key}
    inflight_keys = {cache_key}
    try:
        df = _fetch_sales_df(db, days_back=180)
        driver_range = _ensure_driver_history(db, df)
        final_cache_key = _build_prediction_cache_key(db, algorithm, weather, event)
        final_data_signature = _serialize_prediction_signature(final_cache_key)
        cache_keys.add(final_cache_key)
        if final_cache_key != cache_key:
            with _PREDICTION_CACHE_LOCK:
                if final_cache_key not in _PREDICTION_INFLIGHT:
                    _PREDICTION_INFLIGHT[final_cache_key] = wait_event
                    inflight_keys.add(final_cache_key)
        driver_daily = _fetch_driver_daily_frame(db, driver_range["start_date"], driver_range["end_date"])
        feature_summary = _build_feature_summary(driver_daily, driver_range)
        products = db.query(models.Product).filter(models.Product.is_active == True).all()
        tomorrow = _next_school_day(get_ph_tomorrow())

        if not products:
            tomorrow_driver = _build_tomorrow_driver_row(driver_daily, tomorrow, weather, event)
            empty_summary = {
                "total_products": 0,
                "restock_count": 0,
                "waste_risk_count": 0,
                "expected_revenue": 0.0,
                "expected_units": 0,
                "model_backed_predictions": 0,
                "heuristic_predictions": 0,
            }
            result = {
                "metrics": _fallback_metrics(algorithm),
                "algorithm_metrics": _build_algorithm_metrics(algorithm, _fallback_metrics(algorithm)),
                "feature_summary": feature_summary,
                "predictions": [],
                "weekly_sales_trend": _empty_weekly_trend(),
                "summary": empty_summary,
                "tomorrow_sales_outlook": _build_tomorrow_sales_outlook(
                    df,
                    [],
                    empty_summary,
                    tomorrow_driver,
                    weather,
                    event,
                ),
                "insights": _build_insights([], {"total_products": 0}, "heuristic"),
                "data_source": "heuristic",
            }
            _store_prediction_result(cache_keys, result)
            _store_persistent_prediction_cache(db, request_key, final_data_signature, result)
            return _with_cache_metadata(result, "fresh")

        tomorrow_weekday = tomorrow.weekday()
        series_end_date = df["date"].max() if not df.empty else None
        context_lookup = _build_context_daily_lookup(df, series_end_date=series_end_date)
        global_daily = context_lookup["global"]
        category_daily_lookup = context_lookup["by_category"]
        tomorrow_driver = _build_tomorrow_driver_row(driver_daily, tomorrow, weather, event)

        product_contexts = []
        for product in products:
            product_df = df[df["product_id"] == product.id].copy()
            daily = _build_daily_sales(product_df, series_end_date=series_end_date)
            category_key = (product.category or "General").lower()
            category_daily = category_daily_lookup.get(category_key)

            if _is_sparse_category_ready(daily, category_daily, global_daily) and not _is_model_ready(daily):
                heuristic = _sparse_history_prediction(
                    daily,
                    category_key,
                    tomorrow_weekday,
                    weather,
                    event,
                    category_daily=category_daily,
                    global_daily=global_daily,
                )
            else:
                heuristic = _heuristic_prediction(
                    daily,
                    category_key,
                    tomorrow_weekday,
                    weather,
                    event,
                )

            product_contexts.append(
                {
                    "product": product,
                    "daily": daily,
                    "category_key": category_key,
                    "category_daily": category_daily,
                    "heuristic": heuristic,
                }
            )

        ml_results = _shared_ml_predictions(
            product_contexts,
            algorithm,
            tomorrow_weekday,
            driver_daily,
            tomorrow_driver,
            global_daily,
        )

        predictions = []
        validation_records = []
        model_backed_predictions = 0

        for context in product_contexts:
            product = context["product"]
            daily = context["daily"]
            heuristic = context["heuristic"]
            ml_result = ml_results.get(
                int(product.id),
                {
                    "prediction": None,
                    "y_test": [],
                    "y_pred": [],
                    "validation_context": [],
                    "reason": "Model-ready history is not available for this product.",
                },
            )

            if ml_result["prediction"] is not None:
                predicted_quantity = ml_result["prediction"]
                prediction_source = "ml+heuristic"
                model_backed_predictions += 1
                for actual, predicted, context in zip(
                    ml_result.get("y_test", []),
                    ml_result.get("y_pred", []),
                    ml_result.get("validation_context", []),
                ):
                    validation_records.append(
                        {
                            "actual": float(actual),
                            "predicted": float(predicted),
                            "date": context.get("date"),
                            "is_school_day": bool(context.get("is_school_day", True)),
                        }
                    )
                active_feature_groups = MODEL_FEATURE_GROUPS
                fallback_reason = ""
            else:
                predicted_quantity = heuristic["prediction"]
                prediction_source = heuristic.get("source", "heuristic")
                active_feature_groups = HEURISTIC_FEATURE_GROUPS
                fallback_reason = ml_result.get(
                    "reason",
                    "Model-ready history is not available for this product.",
                )

            recommendation = _build_recommendation(
                int(predicted_quantity),
                int(product.stock or 0),
                int(product.min_stock or 0),
            )

            if heuristic["days_observed"] >= 14 and prediction_source == "ml+heuristic":
                confidence = "high"
            elif heuristic["days_observed"] >= 5:
                confidence = "medium"
            else:
                confidence = "low"

            last_sold_on = daily["date"].max().isoformat() if not daily.empty else None
            estimated_revenue = round(float(predicted_quantity) * float(product.price or 0), 2)

            predictions.append(
                {
                    "product_id": product.id,
                    "product_name": product.name,
                    "category": product.category,
                    "current_stock": int(product.stock or 0),
                    "min_stock": int(product.min_stock or 0),
                    "predicted_quantity": int(predicted_quantity),
                    "historical_average": heuristic["avg_daily"],
                    "days_observed": heuristic["days_observed"],
                    "estimated_revenue": estimated_revenue,
                    "confidence": confidence,
                    "prediction_source": prediction_source,
                    "last_sold_on": last_sold_on,
                    "active_feature_groups": active_feature_groups,
                    "fallback_reason": fallback_reason,
                    **recommendation,
                }
            )

        predictions = sorted(
            predictions,
            key=lambda item: (item["recommendation_type"] != "restock", -item["predicted_quantity"]),
        )

        weekly_sales_trend = _build_weekly_sales_trend(df, weather, event)

        metrics = _build_validation_metrics(validation_records, algorithm)

        summary = {
            "total_products": len(predictions),
            "restock_count": sum(
                1 for prediction in predictions if prediction["recommendation_type"] == "restock"
            ),
            "waste_risk_count": sum(
                1 for prediction in predictions if prediction["recommendation_type"] == "reduce_waste"
            ),
            "expected_revenue": round(
                sum(prediction["estimated_revenue"] for prediction in predictions),
                2,
            ),
            "expected_units": sum(prediction["predicted_quantity"] for prediction in predictions),
            "model_backed_predictions": model_backed_predictions,
            "heuristic_predictions": len(predictions) - model_backed_predictions,
        }

        data_source = "ml+heuristic" if model_backed_predictions > 0 else "heuristic"
        tomorrow_sales_outlook = _build_tomorrow_sales_outlook(
            df,
            predictions,
            summary,
            tomorrow_driver,
            weather,
            event,
        )

        result = {
            "metrics": metrics,
            "algorithm_metrics": _build_algorithm_metrics(algorithm, metrics),
            "feature_summary": feature_summary,
            "predictions": predictions,
            "weekly_sales_trend": weekly_sales_trend,
            "summary": summary,
            "tomorrow_sales_outlook": tomorrow_sales_outlook,
            "insights": _build_insights(predictions, summary, data_source),
            "data_source": data_source,
        }
        _store_prediction_result(cache_keys, result)
        _store_persistent_prediction_cache(db, request_key, final_data_signature, result)
        return _with_cache_metadata(result, "fresh")
    finally:
        with _PREDICTION_CACHE_LOCK:
            signaled_events = []
            for inflight_key in inflight_keys:
                inflight_event = _PREDICTION_INFLIGHT.pop(inflight_key, None)
                if inflight_event and inflight_event not in signaled_events:
                    signaled_events.append(inflight_event)
                    inflight_event.set()


def refresh_prediction_cache(algorithm: str = BEST_ALGORITHM, weather: str = "clear", event: str = "none") -> None:
    try:
        try:
            from backend.database import SessionLocal
        except ImportError:
            from .database import SessionLocal

        db = SessionLocal()
        try:
            predict_tomorrow_sales(
                db,
                algorithm=algorithm,
                weather=weather,
                event=event,
                allow_stale=False,
            )
        finally:
            db.close()
    finally:
        _finish_prediction_cache_refresh(algorithm, weather, event)


CLI_ALGORITHMS = SUPPORTED_ALGORITHMS
ZERO_CLI_METRICS = {
    "accuracy": "0.00%",
    "error_rate": "0.00%",
    "mape": "0.00%",
    "rmse": "0.00",
    "r2": "0.00",
}


def _coerce_metric_number(value):
    if value is None:
        return None
    if isinstance(value, (int, float, np.integer, np.floating)):
        return float(value)

    cleaned = str(value).strip().replace("%", "")
    if not cleaned:
        return None

    try:
        return float(cleaned)
    except ValueError:
        return None


def _format_cli_percent(value) -> str:
    number = _coerce_metric_number(value)
    if number is None or not np.isfinite(number):
        return ZERO_CLI_METRICS["error_rate"]
    return f"{number:.1f}%"


def _format_cli_decimal(value) -> str:
    number = _coerce_metric_number(value)
    if number is None or not np.isfinite(number):
        return ZERO_CLI_METRICS["rmse"]
    return f"{number:.2f}"


def _normalize_cli_metrics(metrics: Dict | None) -> Dict:
    metrics = metrics or {}
    error_rate = metrics.get("error_rate") or metrics.get("wape") or metrics.get("mape")
    mape = metrics.get("mape") or error_rate

    return {
        "accuracy": _format_cli_percent(metrics.get("accuracy")),
        "error_rate": _format_cli_percent(error_rate),
        "mape": _format_cli_percent(mape),
        "rmse": _format_cli_decimal(metrics.get("rmse")),
        "r2": _format_cli_decimal(metrics.get("r2") or metrics.get("r_squared")),
    }


def _load_cli_session():
    try:
        from backend.database import SessionLocal, SQLALCHEMY_DATABASE_URL
    except ImportError:
        from .database import SessionLocal, SQLALCHEMY_DATABASE_URL

    return SessionLocal, SQLALCHEMY_DATABASE_URL


def get_cli_model_metrics() -> Dict[str, Dict]:
    SessionLocal, _ = _load_cli_session()
    db = SessionLocal()

    try:
        model_metrics = {}
        for algorithm in CLI_ALGORITHMS:
            try:
                result = predict_tomorrow_sales(db, algorithm=algorithm)
                model_metrics[algorithm] = _normalize_cli_metrics(result.get("metrics"))
            except Exception as exc:
                model_metrics[algorithm] = {**ZERO_CLI_METRICS, "error": str(exc)}
        return model_metrics
    finally:
        db.close()


def print_cli_model_metrics() -> None:
    _, database_url = _load_cli_session()
    model_metrics = get_cli_model_metrics()

    print("SmartCanteen AI Model Metrics")
    print(f"Database: {database_url}")
    print("")

    for algorithm in CLI_ALGORITHMS:
        metrics = model_metrics.get(algorithm, ZERO_CLI_METRICS)
        print(algorithm)
        print(f"accuracy: {metrics['accuracy']}")
        print(f"error_rate: {metrics['error_rate']}")
        print(f"mape: {metrics['mape']}")
        print(f"rmse: {metrics['rmse']}")
        print(f"r2: {metrics['r2']}")
        if metrics.get("error"):
            print(f"note: {metrics['error']}")
        print("")


if __name__ == "__main__":
    print_cli_model_metrics()
