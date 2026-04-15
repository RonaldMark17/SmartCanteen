from datetime import datetime, timedelta, timezone
import os
import re
import sqlite3
from zoneinfo import ZoneInfo

PH_TIMEZONE = ZoneInfo("Asia/Manila")
FLEXIBLE_DATETIME_PATTERN = re.compile(
    r"^(?P<date>\d{4}-\d{2}-\d{2})[ T]"
    r"(?P<hour>\d{1,2}):(?P<minute>\d{1,3}):(?P<second>\d{1,2})"
    r"(?P<fraction>\.\d+)?(?P<tz>Z|[+-]\d{2}:\d{2})?$"
)
SQLITE_DATETIME_COLUMNS = {
    "users": ("created_at",),
    "products": ("created_at", "updated_at"),
    "transactions": ("created_at",),
    "audit_logs": ("timestamp",),
}


def utc_now_aware():
    return datetime.now(timezone.utc)


def utc_now_naive():
    return utc_now_aware().replace(tzinfo=None)


def parse_datetime_flexible(raw_value):
    if raw_value in (None, ""):
        return None

    if isinstance(raw_value, datetime):
        return raw_value

    normalized_value = str(raw_value).strip()
    if not normalized_value:
        return None

    try:
        return datetime.fromisoformat(normalized_value.replace("Z", "+00:00"))
    except ValueError:
        match = FLEXIBLE_DATETIME_PATTERN.match(normalized_value)
        if not match:
            raise

        parts = match.groupdict()
        hour = int(parts["hour"])
        minute = int(parts["minute"])
        second = int(parts["second"])

        if hour > 23 or minute > 59 or second > 59:
            raise ValueError(f"Invalid time component in datetime string: {raw_value}")

        fraction = parts["fraction"] or ""
        timezone_suffix = parts["tz"] or ""
        canonical = (
            f'{parts["date"]} {hour:02d}:{minute:02d}:{second:02d}'
            f"{fraction}{timezone_suffix}"
        )
        return datetime.fromisoformat(canonical.replace("Z", "+00:00"))


def normalize_datetime_storage_value(raw_value):
    parsed = parse_datetime_flexible(raw_value)
    if not parsed:
        return parsed

    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)

    return parsed


def normalize_client_timestamp(raw_value):
    if not raw_value:
        return utc_now_naive()

    parsed = normalize_datetime_storage_value(raw_value)

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


def repair_sqlite_datetime_storage(database_url):
    if not database_url.startswith("sqlite:///"):
        return 0

    sqlite_path = os.path.abspath(database_url.replace("sqlite:///", "", 1))
    if not os.path.exists(sqlite_path):
        return 0

    repaired_rows = 0
    connection = sqlite3.connect(sqlite_path)
    cursor = connection.cursor()

    try:
        for table_name, columns in SQLITE_DATETIME_COLUMNS.items():
            for column_name in columns:
                try:
                    rows = cursor.execute(
                        f"SELECT id, {column_name} FROM {table_name} WHERE {column_name} IS NOT NULL"
                    ).fetchall()
                except sqlite3.OperationalError:
                    continue

                for row_id, raw_value in rows:
                    if not raw_value:
                        continue

                    try:
                        datetime.fromisoformat(str(raw_value).replace("Z", "+00:00"))
                        continue
                    except ValueError:
                        pass

                    try:
                        repaired_value = normalize_datetime_storage_value(raw_value)
                    except ValueError:
                        continue

                    if not repaired_value:
                        continue

                    cursor.execute(
                        f"UPDATE {table_name} SET {column_name} = ? WHERE id = ?",
                        (repaired_value.isoformat(sep=" "), row_id),
                    )
                    repaired_rows += 1

        if repaired_rows:
            connection.commit()
    finally:
        connection.close()

    return repaired_rows
