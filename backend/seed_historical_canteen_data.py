"""Add realistic historical school canteen data to the local SQLite database.

This script is intentionally independent from the FastAPI app startup path so it
can be run safely as a one-off local database maintenance task.
"""

from __future__ import annotations

import argparse
import random
import sqlite3
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo


PH_TIMEZONE = ZoneInfo("Asia/Manila")
DEFAULT_START_DATE = date(2023, 1, 1)
DEFAULT_END_DATE = date(2026, 4, 18)
SOURCE = "historical_demo"


SLOT_WINDOWS = {
    "breakfast": ((7, 0), (8, 35)),
    "recess": ((9, 10), (10, 40)),
    "lunch": ((11, 5), (13, 10)),
    "afternoon": ((14, 10), (15, 55)),
}


SLOT_WEIGHTS = {
    "regular": {
        "breakfast": 0.21,
        "recess": 0.27,
        "lunch": 0.39,
        "afternoon": 0.13,
    },
    "halfday": {
        "breakfast": 0.28,
        "recess": 0.45,
        "lunch": 0.24,
        "afternoon": 0.03,
    },
    "exams": {
        "breakfast": 0.31,
        "recess": 0.39,
        "lunch": 0.25,
        "afternoon": 0.05,
    },
    "intramurals": {
        "breakfast": 0.12,
        "recess": 0.33,
        "lunch": 0.28,
        "afternoon": 0.27,
    },
}


WEEKDAY_BASE_REVENUE = {
    0: 5200.0,
    1: 4850.0,
    2: 5600.0,
    3: 5150.0,
    4: 4350.0,
}


YEAR_FACTOR = {
    2023: 0.84,
    2024: 0.93,
    2025: 1.0,
    2026: 1.08,
}


MONTH_FACTOR = {
    1: 0.93,
    2: 1.03,
    3: 1.07,
    4: 0.92,
    5: 0.2,
    6: 0.86,
    7: 1.08,
    8: 1.03,
    9: 1.0,
    10: 0.98,
    11: 1.02,
    12: 0.74,
}


HOLIDAY_LABELS = {
    "01-01": "New Year's Day",
    "04-09": "Araw ng Kagitingan",
    "05-01": "Labor Day",
    "06-12": "Independence Day",
    "08-21": "Ninoy Aquino Day",
    "11-01": "All Saints' Day",
    "11-02": "All Souls' Day Break",
    "11-30": "Bonifacio Day",
    "12-08": "Feast of the Immaculate Conception",
    "12-24": "Christmas Break",
    "12-25": "Christmas Day",
    "12-30": "Rizal Day",
    "12-31": "New Year's Eve",
}


HOLY_WEEK_RANGES = {
    2023: (date(2023, 4, 6), date(2023, 4, 10)),
    2024: (date(2024, 3, 28), date(2024, 4, 1)),
    2025: (date(2025, 4, 17), date(2025, 4, 21)),
    2026: (date(2026, 4, 2), date(2026, 4, 6)),
}


SUMMER_BREAK_RANGES = {
    2023: (date(2023, 4, 17), date(2023, 6, 4)),
    2024: (date(2024, 4, 15), date(2024, 6, 2)),
    2025: (date(2025, 4, 14), date(2025, 6, 8)),
    2026: (date(2026, 4, 20), date(2026, 5, 31)),
}


CHRISTMAS_BREAK_RANGES = {
    2023: (date(2023, 12, 20), date(2024, 1, 3)),
    2024: (date(2024, 12, 20), date(2025, 1, 5)),
    2025: (date(2025, 12, 19), date(2026, 1, 4)),
}


SPECIAL_EVENTS = {
    date(2023, 2, 17): ("intramurals", "Foundation Day Food Booths", True),
    date(2023, 3, 20): ("exams", "Quarterly Exams", True),
    date(2023, 3, 21): ("exams", "Quarterly Exams", True),
    date(2023, 8, 29): ("none", "Opening of Classes", True),
    date(2023, 9, 22): ("intramurals", "Sports Clinic Day", True),
    date(2023, 10, 5): ("halfday", "Teachers' Day Program", True),
    date(2023, 12, 15): ("halfday", "Class Christmas Parties", True),
    date(2024, 2, 16): ("intramurals", "Foundation Day Food Booths", True),
    date(2024, 3, 20): ("exams", "Quarterly Exams", True),
    date(2024, 3, 21): ("exams", "Quarterly Exams", True),
    date(2024, 7, 29): ("none", "Opening of Classes", True),
    date(2024, 9, 18): ("intramurals", "Intramurals Day 1", True),
    date(2024, 9, 19): ("intramurals", "Intramurals Day 2", True),
    date(2024, 10, 4): ("halfday", "Teachers' Day Program", True),
    date(2024, 12, 13): ("halfday", "Class Christmas Parties", True),
    date(2025, 2, 14): ("intramurals", "Foundation Day Food Booths", True),
    date(2025, 3, 24): ("exams", "Quarterly Exams", True),
    date(2025, 3, 25): ("exams", "Quarterly Exams", True),
    date(2025, 6, 16): ("none", "Opening of Classes", True),
    date(2025, 9, 17): ("intramurals", "Intramurals Day 1", True),
    date(2025, 9, 18): ("intramurals", "Intramurals Day 2", True),
    date(2025, 10, 3): ("halfday", "Teachers' Day Program", True),
    date(2025, 12, 12): ("halfday", "Class Christmas Parties", True),
    date(2026, 2, 13): ("intramurals", "Foundation Day Food Booths", True),
    date(2026, 3, 6): ("intramurals", "Foundation Day Booth Sales", True),
    date(2026, 3, 25): ("intramurals", "Sports Fest Day 1", True),
    date(2026, 3, 26): ("intramurals", "Sports Fest Day 2", True),
    date(2026, 4, 7): ("exams", "Quarterly Exams", True),
    date(2026, 4, 8): ("exams", "Quarterly Exams", True),
    date(2026, 4, 9): ("holiday", "Araw ng Kagitingan", False),
    date(2026, 4, 10): ("halfday", "Exam Checking Half-Day", True),
    date(2026, 4, 16): ("halfday", "Recognition Practice", True),
}


@dataclass(frozen=True)
class Product:
    id: int
    name: str
    category: str
    price: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", default="canteen.db", help="Path to the SQLite database.")
    parser.add_argument("--start-date", default=DEFAULT_START_DATE.isoformat())
    parser.add_argument("--end-date", default=DEFAULT_END_DATE.isoformat())
    return parser.parse_args()


def parse_day(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def day_range(start_day: date, end_day: date):
    current = start_day
    while current <= end_day:
        yield current
        current += timedelta(days=1)


def ph_to_utc_naive(day_value: date, hour: int, minute: int, second: int = 0) -> datetime:
    local_value = datetime.combine(day_value, time(hour, minute, second), tzinfo=PH_TIMEZONE)
    return local_value.astimezone(timezone.utc).replace(tzinfo=None)


def db_datetime(value: datetime) -> str:
    return value.strftime("%Y-%m-%d %H:%M:%S.%f")


def parse_db_datetime(raw_value: str) -> datetime | None:
    if not raw_value:
        return None

    try:
        return datetime.fromisoformat(str(raw_value).replace("Z", "+00:00"))
    except ValueError:
        return None


def ph_day_from_db_datetime(raw_value: str) -> date | None:
    parsed = parse_db_datetime(raw_value)
    if not parsed:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    else:
        parsed = parsed.astimezone(timezone.utc)

    return parsed.astimezone(PH_TIMEZONE).date()


def dated_random(day_value: date, salt: int = 0) -> random.Random:
    return random.Random((day_value.toordinal() * 104729) + 20230101 + salt)


def date_in_ranges(day_value: date, ranges: dict[int, tuple[date, date]]) -> bool:
    current_range = ranges.get(day_value.year)
    if current_range and current_range[0] <= day_value <= current_range[1]:
        return True

    for start_day, end_day in ranges.values():
        if start_day <= day_value <= end_day:
            return True

    return False


def weather_for_day(day_value: date) -> dict:
    rng = dated_random(day_value, 11)
    month = day_value.month

    if month in {3, 4, 5}:
        roll = rng.random()
        if roll < 0.09:
            weather = "rainy"
            temperature = rng.uniform(27.6, 30.3)
            humidity = rng.uniform(78, 91)
            rainfall = rng.uniform(5, 22)
        elif roll < 0.24:
            weather = "cloudy"
            temperature = rng.uniform(30.0, 32.4)
            humidity = rng.uniform(68, 82)
            rainfall = rng.uniform(0, 2.5)
        else:
            weather = "clear"
            temperature = rng.uniform(32.2, 36.4)
            humidity = rng.uniform(54, 72)
            rainfall = 0.0
    elif month in {6, 7, 8, 9, 10}:
        roll = rng.random()
        if roll < 0.36:
            weather = "rainy"
            temperature = rng.uniform(26.4, 29.4)
            humidity = rng.uniform(80, 93)
            rainfall = rng.uniform(6, 35)
        elif roll < 0.68:
            weather = "cloudy"
            temperature = rng.uniform(28.0, 31.4)
            humidity = rng.uniform(72, 87)
            rainfall = rng.uniform(0, 4)
        else:
            weather = "clear"
            temperature = rng.uniform(30.0, 33.4)
            humidity = rng.uniform(62, 78)
            rainfall = 0.0
    else:
        roll = rng.random()
        if roll < 0.14:
            weather = "rainy"
            temperature = rng.uniform(25.8, 28.7)
            humidity = rng.uniform(78, 90)
            rainfall = rng.uniform(4, 20)
        elif roll < 0.44:
            weather = "cloudy"
            temperature = rng.uniform(27.0, 30.5)
            humidity = rng.uniform(66, 82)
            rainfall = rng.uniform(0, 2.5)
        else:
            weather = "clear"
            temperature = rng.uniform(29.0, 32.8)
            humidity = rng.uniform(58, 76)
            rainfall = 0.0

    return {
        "weather": weather,
        "temperature_c": round(temperature, 1),
        "humidity_pct": round(humidity, 1),
        "rainfall_mm": round(rainfall, 1),
    }


def event_for_day(day_value: date, weather_row: dict) -> dict:
    if day_value in SPECIAL_EVENTS:
        event_type, label, is_school_day = SPECIAL_EVENTS[day_value]
        return {
            "event_type": event_type,
            "label": label,
            "is_school_day": is_school_day,
        }

    if day_value.weekday() >= 5:
        return {
            "event_type": "holiday",
            "label": "Weekend - No Classes",
            "is_school_day": False,
        }

    month_day = day_value.strftime("%m-%d")
    if month_day in HOLIDAY_LABELS:
        return {
            "event_type": "holiday",
            "label": HOLIDAY_LABELS[month_day],
            "is_school_day": False,
        }

    if date_in_ranges(day_value, HOLY_WEEK_RANGES):
        return {
            "event_type": "holiday",
            "label": "Holy Week Break",
            "is_school_day": False,
        }

    if date_in_ranges(day_value, CHRISTMAS_BREAK_RANGES):
        return {
            "event_type": "holiday",
            "label": "Christmas Break",
            "is_school_day": False,
        }

    if date_in_ranges(day_value, SUMMER_BREAK_RANGES):
        return {
            "event_type": "holiday",
            "label": "Summer Break",
            "is_school_day": False,
        }

    rng = dated_random(day_value, 29)
    if (
        day_value.month in {7, 8, 9, 10}
        and weather_row["weather"] == "rainy"
        and weather_row["rainfall_mm"] >= 24
        and rng.random() < 0.45
    ):
        return {
            "event_type": "holiday",
            "label": "Class Suspension - Heavy Rain",
            "is_school_day": False,
        }

    if day_value.weekday() == 4 and day_value.day in {6, 13, 20}:
        return {
            "event_type": "halfday",
            "label": "Club Activities Half-Day",
            "is_school_day": True,
        }

    if day_value.month in {3, 10} and day_value.weekday() in {1, 2} and 19 <= day_value.day <= 26:
        return {
            "event_type": "exams",
            "label": "Quarterly Exams",
            "is_school_day": True,
        }

    return {
        "event_type": "none",
        "label": "Regular Classes",
        "is_school_day": True,
    }


def event_factor(event_type: str) -> float:
    return {
        "intramurals": 1.34,
        "exams": 0.82,
        "halfday": 0.58,
        "holiday": 0.0,
    }.get(event_type, 1.0)


def weather_factor(weather_row: dict) -> float:
    if weather_row["weather"] == "rainy":
        return 0.9 if weather_row["rainfall_mm"] < 20 else 0.78
    if weather_row["temperature_c"] >= 34 and weather_row["weather"] == "clear":
        return 1.08
    return 1.0


def daily_target(day_value: date, weather_row: dict, event_row: dict) -> float:
    if not event_row["is_school_day"]:
        return 0.0

    rng = dated_random(day_value, 43)
    target = WEEKDAY_BASE_REVENUE.get(day_value.weekday(), 0.0)
    target *= YEAR_FACTOR.get(day_value.year, 1.0)
    target *= MONTH_FACTOR.get(day_value.month, 1.0)
    target *= event_factor(event_row["event_type"])
    target *= weather_factor(weather_row)
    target *= rng.uniform(0.9, 1.14)

    if day_value.day <= 3 or event_row["label"] == "Opening of Classes":
        target *= 1.08
    if day_value.weekday() == 0:
        target *= 1.04
    if day_value.weekday() == 4:
        target *= 0.92
    if "Foundation" in event_row["label"]:
        target *= 1.1

    return round(target, 2)


def weighted_choice(rng: random.Random, weighted_items):
    total = sum(weight for _, weight in weighted_items)
    marker = rng.uniform(0, total)
    upto = 0.0
    for item, weight in weighted_items:
        upto += weight
        if upto >= marker:
            return item
    return weighted_items[-1][0]


def load_products(cur: sqlite3.Cursor) -> list[Product]:
    rows = cur.execute(
        """
        SELECT id, name, category, price
        FROM products
        WHERE is_active = 1
        ORDER BY id
        """
    ).fetchall()
    return [Product(id=row[0], name=row[1], category=row[2], price=float(row[3])) for row in rows]


def group_products(products: list[Product]) -> dict[str, list[Product]]:
    grouped: dict[str, list[Product]] = {}
    for product in products:
        grouped.setdefault(product.category, []).append(product)
    return grouped


def product_pools(grouped: dict[str, list[Product]]) -> dict[str, list[Product]]:
    return {
        "breakfast": (
            grouped.get("Bread", [])
            + grouped.get("Soup", [])
            + grouped.get("Drinks", [])
        ),
        "recess": (
            grouped.get("Snacks", [])
            + grouped.get("Bread", [])
            + grouped.get("Drinks", [])
            + grouped.get("Dessert", [])
        ),
        "lunch": (
            grouped.get("Staple", [])
            + grouped.get("Viand", [])
            + grouped.get("Soup", [])
            + grouped.get("Drinks", [])
            + grouped.get("Dessert", [])
        ),
        "afternoon": (
            grouped.get("Snacks", [])
            + grouped.get("Drinks", [])
            + grouped.get("Dessert", [])
            + grouped.get("Bread", [])
        ),
    }


def product_weight(product: Product, slot: str, weather_row: dict, event_row: dict) -> float:
    weight = {
        "Staple": 1.85,
        "Viand": 2.0,
        "Soup": 1.0,
        "Snacks": 2.05,
        "Bread": 1.48,
        "Drinks": 2.3,
        "Dessert": 0.95,
    }.get(product.category, 1.0)

    if slot == "lunch" and product.category in {"Staple", "Viand", "Soup"}:
        weight *= 1.85
    if slot in {"recess", "afternoon"} and product.category in {"Snacks", "Drinks"}:
        weight *= 1.5
    if slot == "breakfast" and product.category in {"Bread", "Soup", "Drinks"}:
        weight *= 1.35

    if weather_row["weather"] == "rainy" and product.category == "Soup":
        weight *= 1.75
    if weather_row["weather"] == "rainy" and product.category == "Drinks":
        weight *= 0.78
    if weather_row["temperature_c"] >= 34 and product.category == "Drinks":
        weight *= 1.65
    if event_row["event_type"] == "intramurals" and product.category in {"Drinks", "Snacks"}:
        weight *= 1.6
    if event_row["event_type"] == "exams" and product.category in {"Bread", "Drinks"}:
        weight *= 1.2

    lower_name = product.name.lower()
    if any(term in lower_name for term in ("water", "iced tea", "rice", "siomai", "lumpia")):
        weight *= 1.22
    if any(term in lower_name for term in ("ampalaya", "halaya", "macaroni")):
        weight *= 0.72

    return max(weight, 0.1)


def choose_product(
    rng: random.Random,
    pool: list[Product],
    slot: str,
    weather_row: dict,
    event_row: dict,
) -> Product:
    return weighted_choice(
        rng,
        [(product, product_weight(product, slot, weather_row, event_row)) for product in pool],
    )


def find_product(products: list[Product], name: str) -> Product | None:
    for product in products:
        if product.name == name:
            return product
    return None


def add_item(items: dict[int, tuple[Product, int]], product: Product | None, quantity: int = 1) -> None:
    if not product:
        return

    _, current_quantity = items.get(product.id, (product, 0))
    items[product.id] = (product, current_quantity + quantity)


def build_transaction_items(
    rng: random.Random,
    products: list[Product],
    pools: dict[str, list[Product]],
    slot: str,
    weather_row: dict,
    event_row: dict,
) -> list[tuple[Product, int]]:
    items: dict[int, tuple[Product, int]] = {}

    if slot == "lunch":
        if rng.random() < 0.68:
            add_item(items, find_product(products, "Rice (per order)"))
        if rng.random() < 0.62:
            viands = [product for product in products if product.category == "Viand"]
            add_item(items, choose_product(rng, viands, slot, weather_row, event_row))
        if rng.random() < 0.42:
            drinks = [product for product in products if product.category == "Drinks"]
            add_item(items, choose_product(rng, drinks, slot, weather_row, event_row))

    line_count = 1
    if rng.random() < 0.43:
        line_count += 1
    if rng.random() < 0.12:
        line_count += 1

    for _ in range(line_count):
        pool = pools[slot]
        product = choose_product(rng, pool, slot, weather_row, event_row)
        quantity = 1
        if product.category in {"Drinks", "Snacks"} and rng.random() < 0.17:
            quantity = 2
        if product.name in {"Pandesal", "Pork BBQ Skewer"} and rng.random() < 0.22:
            quantity = 2
        add_item(items, product, quantity)

    return list(items.values())


def choose_slot(rng: random.Random, event_type: str) -> str:
    weights = SLOT_WEIGHTS.get(event_type, SLOT_WEIGHTS["regular"])
    return weighted_choice(rng, list(weights.items()))


def minute_in_slot(rng: random.Random, slot: str) -> tuple[int, int]:
    (start_hour, start_minute), (end_hour, end_minute) = SLOT_WINDOWS[slot]
    start = start_hour * 60 + start_minute
    end = end_hour * 60 + end_minute
    minute_value = rng.randint(start, end)
    return divmod(minute_value, 60)


def payment_type_for_transaction(rng: random.Random, day_value: date, subtotal: float) -> str:
    gcash_probability = {
        2023: 0.11,
        2024: 0.17,
        2025: 0.24,
        2026: 0.31,
    }.get(day_value.year, 0.2)
    if subtotal >= 160:
        gcash_probability += 0.08
    return "gcash" if rng.random() < gcash_probability else "cash"


def existing_transaction_days(cur: sqlite3.Cursor, start_day: date, end_day: date) -> set[date]:
    start_utc = ph_to_utc_naive(start_day, 0, 0)
    end_utc = ph_to_utc_naive(end_day, 23, 59, 59)
    rows = cur.execute(
        """
        SELECT created_at
        FROM transactions
        WHERE created_at BETWEEN ? AND ?
        """,
        (db_datetime(start_utc), db_datetime(end_utc)),
    ).fetchall()

    days = set()
    for (raw_created_at,) in rows:
        day_value = ph_day_from_db_datetime(raw_created_at)
        if day_value:
            days.add(day_value)
    return days


def upsert_weather(cur: sqlite3.Cursor, day_value: date, weather_row: dict, now_value: str) -> None:
    cur.execute(
        """
        INSERT INTO weather_history (
            date, weather, temperature_c, humidity_pct, rainfall_mm,
            source, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
            weather = excluded.weather,
            temperature_c = excluded.temperature_c,
            humidity_pct = excluded.humidity_pct,
            rainfall_mm = excluded.rainfall_mm,
            source = excluded.source,
            updated_at = excluded.updated_at
        """,
        (
            day_value.isoformat(),
            weather_row["weather"],
            weather_row["temperature_c"],
            weather_row["humidity_pct"],
            weather_row["rainfall_mm"],
            SOURCE,
            now_value,
            now_value,
        ),
    )


def upsert_school_event(cur: sqlite3.Cursor, day_value: date, event_row: dict, now_value: str) -> None:
    cur.execute(
        """
        INSERT INTO school_event_history (
            date, event_type, label, is_school_day, source, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
            event_type = excluded.event_type,
            label = excluded.label,
            is_school_day = excluded.is_school_day,
            source = excluded.source,
            updated_at = excluded.updated_at
        """,
        (
            day_value.isoformat(),
            event_row["event_type"],
            event_row["label"],
            1 if event_row["is_school_day"] else 0,
            SOURCE,
            now_value,
            now_value,
        ),
    )


def insert_transaction(
    cur: sqlite3.Cursor,
    user_id: int,
    created_at: str,
    total: float,
    discount: float,
    payment_type: str,
    notes: str,
    items: list[tuple[Product, int]],
) -> int:
    cur.execute(
        """
        INSERT INTO transactions (
            user_id, total, discount, payment_type, notes, created_at, synced
        )
        VALUES (?, ?, ?, ?, ?, ?, 1)
        """,
        (user_id, round(total, 2), round(discount, 2), payment_type, notes, created_at),
    )
    transaction_id = cur.lastrowid

    cur.executemany(
        """
        INSERT INTO transaction_items (
            transaction_id, product_id, quantity, unit_price
        )
        VALUES (?, ?, ?, ?)
        """,
        [
            (transaction_id, product.id, quantity, product.price)
            for product, quantity in items
        ],
    )
    return transaction_id


def user_ids(cur: sqlite3.Cursor) -> dict[str, int]:
    rows = cur.execute("SELECT id, username, role FROM users ORDER BY id").fetchall()
    by_role: dict[str, int] = {}
    by_username: dict[str, int] = {}
    for user_id, username, role in rows:
        by_username[username] = user_id
        by_role.setdefault(role, user_id)

    if not rows:
        raise RuntimeError("No users found. Seed users/products first before adding historical data.")

    first_user_id = rows[0][0]
    return {
        "admin": by_role.get("admin") or by_username.get("admin") or first_user_id,
        "cashier": by_role.get("cashier") or by_username.get("cashier") or first_user_id,
        "staff": by_role.get("staff") or by_username.get("staff") or first_user_id,
    }


def seed_historical_data(database_path: Path, start_day: date, end_day: date) -> dict:
    if end_day < start_day:
        raise ValueError("end date must be on or after start date")

    if not database_path.exists():
        raise FileNotFoundError(f"Database not found: {database_path}")

    connection = sqlite3.connect(database_path)
    connection.execute("PRAGMA foreign_keys = ON")
    cur = connection.cursor()

    try:
        products = load_products(cur)
        if not products:
            raise RuntimeError("No active products found. Seed products before adding historical data.")

        grouped = group_products(products)
        pools = product_pools(grouped)
        if any(not pool for pool in pools.values()):
            raise RuntimeError("Product categories are incomplete for realistic historical seeding.")

        users = user_ids(cur)
        existing_days = existing_transaction_days(cur, start_day, end_day)
        now_value = db_datetime(datetime.now(timezone.utc).replace(tzinfo=None))

        cur.execute("DELETE FROM weather_history WHERE date > ?", (end_day.isoformat(),))
        cur.execute("DELETE FROM school_event_history WHERE date > ?", (end_day.isoformat(),))
        cur.execute("DELETE FROM prediction_cache")

        weather_days = 0
        event_days = 0
        school_days = 0
        skipped_transaction_days = 0
        transaction_days_added = 0
        transactions_added = 0
        items_added = 0
        revenue_added = 0.0

        for day_index, day_value in enumerate(day_range(start_day, end_day), start=1):
            weather_row = weather_for_day(day_value)
            event_row = event_for_day(day_value, weather_row)
            upsert_weather(cur, day_value, weather_row, now_value)
            upsert_school_event(cur, day_value, event_row, now_value)
            weather_days += 1
            event_days += 1

            if not event_row["is_school_day"]:
                if day_index % 45 == 0:
                    connection.commit()
                continue

            school_days += 1
            if day_value in existing_days:
                skipped_transaction_days += 1
                if day_index % 45 == 0:
                    connection.commit()
                continue

            rng = dated_random(day_value, 71)
            target = daily_target(day_value, weather_row, event_row)
            if target <= 0:
                continue

            min_count = max(15, int(target / 105))
            max_count = max(min_count + 10, min(135, int(target / 42)))
            if event_row["event_type"] == "intramurals":
                max_count = min(165, int(max_count * 1.18))

            index = 0
            day_revenue = 0.0
            while (day_revenue < target * 0.96 or index < min_count) and index < max_count:
                slot = choose_slot(rng, event_row["event_type"])
                hour, minute = minute_in_slot(rng, slot)
                second = rng.randint(0, 59)
                items = build_transaction_items(rng, products, pools, slot, weather_row, event_row)
                if not items:
                    continue

                subtotal = sum(product.price * quantity for product, quantity in items)
                discount = 0.0
                if subtotal >= 180 and rng.random() < 0.055:
                    discount = 5.0
                if subtotal >= 280 and rng.random() < 0.025:
                    discount = 10.0

                total = max(0.0, subtotal - discount)
                payment_type = payment_type_for_transaction(rng, day_value, subtotal)
                created_at = db_datetime(ph_to_utc_naive(day_value, hour, minute, second))
                user_id = users["cashier"] if index % 13 else users["staff"]
                notes = f"Historical demo {event_row['label']} - {slot}"

                insert_transaction(
                    cur,
                    user_id,
                    created_at,
                    total,
                    discount,
                    payment_type,
                    notes,
                    items,
                )
                day_revenue += total
                revenue_added += total
                transactions_added += 1
                items_added += len(items)
                index += 1

            transaction_days_added += 1

            if day_index % 45 == 0:
                connection.commit()

        cur.execute(
            """
            INSERT INTO audit_logs (user_id, action, details, ip_address, timestamp)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                users["admin"],
                "HISTORICAL_DEMO_DATA_ADDED",
                (
                    f"Added realistic school canteen history from {start_day.isoformat()} "
                    f"to {end_day.isoformat()}: {transactions_added} transactions, "
                    f"{items_added} line items, PHP {revenue_added:.2f} revenue."
                ),
                "127.0.0.1",
                now_value,
            ),
        )
        connection.commit()

        return {
            "database": str(database_path),
            "start_date": start_day.isoformat(),
            "end_date": end_day.isoformat(),
            "weather_days_upserted": weather_days,
            "school_event_days_upserted": event_days,
            "school_days": school_days,
            "transaction_days_added": transaction_days_added,
            "transaction_days_skipped_existing": skipped_transaction_days,
            "transactions_added": transactions_added,
            "transaction_items_added": items_added,
            "revenue_added": round(revenue_added, 2),
        }
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def main() -> None:
    args = parse_args()
    database_path = Path(args.database).resolve()
    start_day = parse_day(args.start_date)
    end_day = parse_day(args.end_date)
    result = seed_historical_data(database_path, start_day, end_day)

    for key, value in result.items():
        print(f"{key}: {value}")


if __name__ == "__main__":
    main()
