from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

PH_TIMEZONE = ZoneInfo("Asia/Manila")


def utc_now_aware():
    return datetime.now(timezone.utc)


def utc_now_naive():
    return utc_now_aware().replace(tzinfo=None)


def normalize_client_timestamp(raw_value):
    if not raw_value:
        return utc_now_naive()

    normalized_value = str(raw_value).replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized_value)

    if parsed.tzinfo is None:
        return parsed

    return parsed.astimezone(timezone.utc).replace(tzinfo=None)


def utc_naive_to_aware(value):
    if not value:
        return value

    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)

    return value.astimezone(timezone.utc)


def to_ph_time(value):
    aware_value = utc_naive_to_aware(value)
    if not aware_value:
        return aware_value

    return aware_value.astimezone(PH_TIMEZONE)


def get_ph_today():
    return utc_now_aware().astimezone(PH_TIMEZONE).date()


def get_ph_tomorrow():
    return get_ph_today() + timedelta(days=1)


def get_ph_day_bounds_utc_naive(day_value):
    start_local = datetime.combine(day_value, datetime.min.time(), tzinfo=PH_TIMEZONE)
    end_local = datetime.combine(day_value, datetime.max.time(), tzinfo=PH_TIMEZONE)

    start_utc = start_local.astimezone(timezone.utc).replace(tzinfo=None)
    end_utc = end_local.astimezone(timezone.utc).replace(tzinfo=None)
    return start_utc, end_utc


def get_ph_recent_cutoff_utc_naive(days):
    target_day = get_ph_today() - timedelta(days=max(days - 1, 0))
    start_utc, _ = get_ph_day_bounds_utc_naive(target_day)
    return start_utc


def build_ph_date_range_bounds(start_date, end_date):
    start_local = datetime.strptime(start_date, "%Y-%m-%d").replace(
        hour=0, minute=0, second=0, microsecond=0, tzinfo=PH_TIMEZONE
    )
    end_local = datetime.strptime(end_date, "%Y-%m-%d").replace(
        hour=23, minute=59, second=59, microsecond=999999, tzinfo=PH_TIMEZONE
    )

    start_utc = start_local.astimezone(timezone.utc).replace(tzinfo=None)
    end_utc = end_local.astimezone(timezone.utc).replace(tzinfo=None)
    return start_utc, end_utc


def build_recent_ph_day_keys(days):
    today = get_ph_today()
    return [
        (today - timedelta(days=offset)).isoformat()
        for offset in range(days - 1, -1, -1)
    ]
