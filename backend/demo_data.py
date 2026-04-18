"""Realistic demo database content for SmartCanteen."""

from datetime import datetime, time, timedelta, timezone
import random

from sqlalchemy.orm import Session

from . import auth, models
from .time_utils import PH_TIMEZONE, get_ph_today


DEMO_USERS = [
    {
        "username": "admin",
        "full_name": "SmartCanteen Admin",
        "password": "admin123",
        "role": "admin",
    },
    {
        "username": "cashier",
        "full_name": "Main Canteen Cashier",
        "password": "cashier123",
        "role": "cashier",
    },
    {
        "username": "staff",
        "full_name": "Kitchen Inventory Staff",
        "password": "staff123",
        "role": "staff",
    },
]


DEMO_PRODUCTS = [
    ("Rice (per order)", "Staple", 15.0, 165, 60),
    ("Fried Rice", "Staple", 22.0, 95, 35),
    ("Pancit Bihon", "Staple", 35.0, 52, 18),
    ("Spaghetti Solo", "Staple", 42.0, 49, 18),
    ("Palabok Cup", "Staple", 38.0, 38, 15),
    ("Pork Adobo", "Viand", 48.0, 28, 12),
    ("Fried Chicken", "Viand", 58.0, 42, 16),
    ("Chicken Curry", "Viand", 58.0, 33, 14),
    ("Fish Fillet", "Viand", 50.0, 34, 12),
    ("Menudo", "Viand", 52.0, 31, 14),
    ("Beef Tapa", "Viand", 65.0, 26, 10),
    ("Pork BBQ Skewer", "Viand", 28.0, 66, 24),
    ("Ginisang Ampalaya", "Viand", 35.0, 22, 10),
    ("Chicken Tinola", "Soup", 50.0, 8, 14),
    ("Sinigang na Baboy", "Soup", 55.0, 19, 10),
    ("Arroz Caldo", "Soup", 40.0, 36, 14),
    ("Beef Mami", "Soup", 44.0, 41, 14),
    ("Lugaw with Egg", "Soup", 35.0, 55, 18),
    ("Champorado Cup", "Soup", 25.0, 44, 16),
    ("Lumpia (2 pcs)", "Snacks", 20.0, 92, 35),
    ("Siomai (4 pcs)", "Snacks", 30.0, 88, 30),
    ("Turon", "Snacks", 18.0, 84, 30),
    ("Banana Cue", "Snacks", 15.0, 76, 30),
    ("Kwek-Kwek (6 pcs)", "Snacks", 22.0, 80, 30),
    ("Cheese Sticks (5 pcs)", "Snacks", 25.0, 72, 24),
    ("Fresh Lumpia", "Snacks", 28.0, 45, 18),
    ("Pandesal", "Bread", 6.0, 135, 45),
    ("Egg Sandwich", "Bread", 28.0, 58, 20),
    ("Hotdog Sandwich", "Bread", 30.0, 61, 22),
    ("Chicken Burger", "Bread", 38.0, 55, 20),
    ("Tuna Sandwich", "Bread", 32.0, 52, 18),
    ("Chicken Empanada", "Bread", 32.0, 69, 24),
    ("Banana Bread", "Bread", 25.0, 48, 18),
    ("Chocolate Muffin", "Bread", 24.0, 57, 22),
    ("Hopia", "Bread", 18.0, 83, 28),
    ("Water (500ml)", "Drinks", 15.0, 126, 45),
    ("Mineral Water (1L)", "Drinks", 22.0, 82, 30),
    ("Soft Drinks (small)", "Drinks", 20.0, 58, 35),
    ("Iced Tea", "Drinks", 20.0, 47, 35),
    ("Calamansi Juice", "Drinks", 18.0, 17, 25),
    ("Gulaman Drink", "Drinks", 16.0, 68, 28),
    ("Orange Juice", "Drinks", 20.0, 54, 28),
    ("Coffee Jelly Drink", "Drinks", 24.0, 39, 18),
    ("Choco Milk", "Drinks", 23.0, 46, 20),
    ("Mango Float (slice)", "Dessert", 30.0, 6, 10),
    ("Biko (per slice)", "Dessert", 25.0, 36, 14),
    ("Leche Flan Cup", "Dessert", 28.0, 24, 10),
    ("Cassava Cake", "Dessert", 30.0, 31, 12),
    ("Puto Cheese", "Dessert", 18.0, 13, 18),
    ("Ube Halaya Cup", "Dessert", 26.0, 29, 12),
    ("Macaroni Salad Cup", "Dessert", 25.0, 27, 12),
    ("Ginataang Bilo-Bilo", "Dessert", 32.0, 22, 10),
]


WEATHER_LABELS = {
    "clear": "Hot / Clear",
    "cloudy": "Cloudy",
    "rainy": "Rainy",
}


SPECIAL_EVENTS = {
    "2026-03-06": ("intramurals", "Foundation Day Booth Sales", True),
    "2026-03-25": ("intramurals", "Sports Fest Day 1", True),
    "2026-03-26": ("intramurals", "Sports Fest Day 2", True),
    "2026-04-07": ("exams", "Quarterly Exams", True),
    "2026-04-08": ("exams", "Quarterly Exams", True),
    "2026-04-09": ("holiday", "Araw ng Kagitingan", False),
    "2026-04-10": ("halfday", "Exam Checking Half-Day", True),
    "2026-04-16": ("halfday", "Recognition Practice", True),
}


SLOT_WINDOWS = {
    "breakfast": ((7, 5), (8, 45)),
    "recess": ((9, 15), (10, 35)),
    "lunch": ((11, 5), (13, 5)),
    "afternoon": ((14, 15), (15, 50)),
}


SLOT_WEIGHTS = {
    "breakfast": 0.22,
    "recess": 0.25,
    "lunch": 0.38,
    "afternoon": 0.15,
}


WEEKDAY_BASE_REVENUE = {
    0: 6800,
    1: 6100,
    2: 7200,
    3: 6400,
    4: 6500,
}


def _barcode(index: int) -> str:
    return f"SC-PROD-{index:03d}"


def _ph_to_utc_naive(day_value, hour: int, minute: int) -> datetime:
    local_value = datetime.combine(day_value, time(hour, minute), tzinfo=PH_TIMEZONE)
    return local_value.astimezone(timezone.utc).replace(tzinfo=None)


def _dated_random(day_value) -> random.Random:
    return random.Random(day_value.toordinal() * 37 + 20260418)


def _weather_for_day(day_value):
    rng = _dated_random(day_value)
    month = day_value.month
    if month in {3, 4, 5}:
        roll = rng.random()
        if roll < 0.12:
            weather = "rainy"
            temperature = rng.uniform(27.0, 30.5)
            rainfall = rng.uniform(7.0, 26.0)
            humidity = rng.uniform(78.0, 91.0)
        elif roll < 0.32:
            weather = "cloudy"
            temperature = rng.uniform(29.5, 32.0)
            rainfall = rng.uniform(0.0, 2.5)
            humidity = rng.uniform(70.0, 84.0)
        else:
            weather = "clear"
            temperature = rng.uniform(32.0, 35.8)
            rainfall = 0.0
            humidity = rng.uniform(56.0, 72.0)
    else:
        roll = rng.random()
        if roll < 0.18:
            weather = "rainy"
            temperature = rng.uniform(26.5, 29.5)
            rainfall = rng.uniform(6.0, 22.0)
            humidity = rng.uniform(78.0, 90.0)
        elif roll < 0.45:
            weather = "cloudy"
            temperature = rng.uniform(28.0, 31.5)
            rainfall = rng.uniform(0.0, 3.0)
            humidity = rng.uniform(68.0, 83.0)
        else:
            weather = "clear"
            temperature = rng.uniform(30.5, 34.0)
            rainfall = 0.0
            humidity = rng.uniform(58.0, 75.0)

    return {
        "weather": weather,
        "temperature_c": round(temperature, 1),
        "humidity_pct": round(humidity, 1),
        "rainfall_mm": round(rainfall, 1),
    }


def _event_for_day(day_value):
    date_key = day_value.isoformat()
    if date_key in SPECIAL_EVENTS:
        event_type, label, is_school_day = SPECIAL_EVENTS[date_key]
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

    if day_value.weekday() == 4 and day_value.day % 3 == 0:
        return {
            "event_type": "halfday",
            "label": "Club Activities Half-Day",
            "is_school_day": True,
        }

    return {
        "event_type": "none",
        "label": "Regular Classes",
        "is_school_day": True,
    }


def _event_factor(event_type: str) -> float:
    return {
        "intramurals": 1.32,
        "exams": 0.84,
        "halfday": 0.62,
        "holiday": 0.0,
    }.get(event_type, 1.0)


def _weather_revenue_factor(weather_row: dict) -> float:
    if weather_row["weather"] == "rainy":
        return 0.9
    if weather_row["weather"] == "clear" and weather_row["temperature_c"] >= 33:
        return 1.08
    return 1.0


def _weighted_choice(rng: random.Random, weighted_items):
    total = sum(weight for _, weight in weighted_items)
    marker = rng.uniform(0, total)
    upto = 0
    for item, weight in weighted_items:
        upto += weight
        if upto >= marker:
            return item
    return weighted_items[-1][0]


def _slot_for_transaction(rng: random.Random) -> str:
    return _weighted_choice(rng, list(SLOT_WEIGHTS.items()))


def _minute_in_slot(rng: random.Random, slot: str):
    (start_hour, start_minute), (end_hour, end_minute) = SLOT_WINDOWS[slot]
    start = start_hour * 60 + start_minute
    end = end_hour * 60 + end_minute
    minute = rng.randint(start, end)
    return divmod(minute, 60)


def _build_product_pools(products_by_name):
    by_category = {}
    for product in products_by_name.values():
        by_category.setdefault(product.category, []).append(product)

    return {
        "breakfast": (
            by_category.get("Bread", [])
            + by_category.get("Soup", [])
            + by_category.get("Drinks", [])
        ),
        "recess": (
            by_category.get("Snacks", [])
            + by_category.get("Bread", [])
            + by_category.get("Drinks", [])
            + by_category.get("Dessert", [])
        ),
        "lunch": (
            by_category.get("Staple", [])
            + by_category.get("Viand", [])
            + by_category.get("Soup", [])
            + by_category.get("Drinks", [])
            + by_category.get("Dessert", [])
        ),
        "afternoon": (
            by_category.get("Snacks", [])
            + by_category.get("Drinks", [])
            + by_category.get("Dessert", [])
            + by_category.get("Bread", [])
        ),
    }


def _product_weight(product, slot: str, weather_row: dict, event_type: str) -> float:
    category_weight = {
        "Staple": 2.1,
        "Viand": 2.2,
        "Soup": 1.1,
        "Snacks": 2.0,
        "Bread": 1.5,
        "Drinks": 2.4,
        "Dessert": 1.0,
    }.get(product.category, 1.0)

    if slot == "lunch" and product.category in {"Staple", "Viand", "Soup"}:
        category_weight *= 1.75
    if slot in {"recess", "afternoon"} and product.category in {"Snacks", "Drinks"}:
        category_weight *= 1.45
    if slot == "breakfast" and product.category in {"Bread", "Soup", "Drinks"}:
        category_weight *= 1.35

    if weather_row["weather"] == "rainy" and product.category == "Soup":
        category_weight *= 1.7
    if weather_row["weather"] == "rainy" and product.category == "Drinks":
        category_weight *= 0.75
    if weather_row["temperature_c"] >= 33 and product.category == "Drinks":
        category_weight *= 1.55
    if event_type == "intramurals" and product.category in {"Drinks", "Snacks"}:
        category_weight *= 1.5
    if event_type == "exams" and product.category in {"Bread", "Drinks"}:
        category_weight *= 1.2

    name = product.name.lower()
    if any(term in name for term in ["water", "iced tea", "soft drinks", "rice"]):
        category_weight *= 1.25
    if any(term in name for term in ["ampalaya", "halaya", "macaroni"]):
        category_weight *= 0.72

    return max(category_weight, 0.2)


def _choose_product(rng: random.Random, pool, slot: str, weather_row: dict, event_type: str):
    weighted_products = [
        (product, _product_weight(product, slot, weather_row, event_type))
        for product in pool
    ]
    return _weighted_choice(rng, weighted_products)


def _build_transaction_items(rng, products_by_name, pools, slot, weather_row, event_type):
    items = []
    used_product_ids = set()

    if slot == "lunch" and rng.random() < 0.62:
        rice = products_by_name.get("Rice (per order)")
        if rice:
            items.append((rice, 1))
            used_product_ids.add(rice.id)

    line_count = 1
    if rng.random() < 0.46:
        line_count += 1
    if rng.random() < 0.14:
        line_count += 1

    for _ in range(line_count):
        attempts = 0
        product = None
        while attempts < 8:
            candidate = _choose_product(rng, pools[slot], slot, weather_row, event_type)
            if candidate.id not in used_product_ids:
                product = candidate
                break
            attempts += 1

        if not product:
            continue

        quantity = 1
        if product.category in {"Drinks", "Snacks"} and rng.random() < 0.18:
            quantity = 2
        if product.name in {"Pandesal", "Pork BBQ Skewer"} and rng.random() < 0.25:
            quantity = 2

        items.append((product, quantity))
        used_product_ids.add(product.id)

    return items


def _daily_target(day_value, weather_row: dict, event_row: dict) -> float:
    rng = _dated_random(day_value)
    target = WEEKDAY_BASE_REVENUE.get(day_value.weekday(), 0)
    target *= _weather_revenue_factor(weather_row)
    target *= _event_factor(event_row["event_type"])
    target *= rng.uniform(0.92, 1.12)
    if day_value.day <= 3 or day_value.weekday() == 0:
        target *= 1.05
    if day_value.weekday() == 4:
        target *= 1.0
    return round(target, 2)


def _create_transactions(db: Session, products_by_name, cashier_user, staff_user, start_day, end_day):
    pools = _build_product_pools(products_by_name)
    day_value = start_day
    transactions_created = 0
    items_created = 0

    while day_value <= end_day:
        event_row = _event_for_day(day_value)
        weather_row = _weather_for_day(day_value)
        if not event_row["is_school_day"]:
            day_value += timedelta(days=1)
            continue

        rng = _dated_random(day_value)
        target = _daily_target(day_value, weather_row, event_row)
        if target <= 0:
            day_value += timedelta(days=1)
            continue

        minimum_count = max(18, int(target / 95))
        max_count = max(minimum_count + 10, min(165, int(target / 42)))
        if event_row["event_type"] == "intramurals":
            max_count = min(190, int(max_count * 1.16))
        if event_row["event_type"] == "exams":
            max_count = max(24, int(max_count * 0.92))

        index = 0
        day_revenue = 0.0
        while (day_revenue < target * 0.96 or index < minimum_count) and index < max_count:
            slot = _slot_for_transaction(rng)
            hour, minute = _minute_in_slot(rng, slot)
            created_at = _ph_to_utc_naive(day_value, hour, minute)
            line_items = _build_transaction_items(
                rng,
                products_by_name,
                pools,
                slot,
                weather_row,
                event_row["event_type"],
            )
            if not line_items:
                continue

            subtotal = sum(product.price * quantity for product, quantity in line_items)
            discount = 0.0
            if subtotal >= 180 and rng.random() < 0.06:
                discount = 5.0
            if subtotal >= 260 and rng.random() < 0.03:
                discount = 10.0

            transaction = models.Transaction(
                user_id=cashier_user.id if index % 11 else staff_user.id,
                total=max(0.0, subtotal - discount),
                discount=discount,
                payment_type="gcash" if rng.random() < 0.2 else "cash",
                notes=f"Demo {WEATHER_LABELS[weather_row['weather']]} sale - {slot}",
                created_at=created_at,
                synced=True,
            )
            db.add(transaction)
            db.flush()
            day_revenue += transaction.total

            for product, quantity in line_items:
                db.add(models.TransactionItem(
                    transaction_id=transaction.id,
                    product_id=product.id,
                    quantity=quantity,
                    unit_price=product.price,
                ))
                items_created += 1

            transactions_created += 1
            index += 1

        day_value += timedelta(days=1)

    return transactions_created, items_created


def _clear_demo_tables(db: Session):
    db.query(models.TransactionItem).delete(synchronize_session=False)
    db.query(models.Transaction).delete(synchronize_session=False)
    db.query(models.AuditLog).delete(synchronize_session=False)
    db.query(models.Product).delete(synchronize_session=False)
    db.query(models.WeatherHistory).delete(synchronize_session=False)
    db.query(models.SchoolEventHistory).delete(synchronize_session=False)
    db.query(models.User).delete(synchronize_session=False)
    db.flush()


def seed_demo_canteen_database(db: Session, *, reset: bool = False):
    """Seed a canteen-shaped dataset for dashboards, POS, and forecasts."""
    if reset:
        _clear_demo_tables(db)
    elif db.query(models.User).count() > 0:
        return {
            "message": "Already seeded - nothing changed.",
            "hint": "Use reset_demo=true to rebuild the canteen demo dataset.",
        }

    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)

    users = []
    for user_data in DEMO_USERS:
        user = models.User(
            username=user_data["username"],
            full_name=user_data["full_name"],
            password_hash=auth.get_password_hash(user_data["password"]),
            role=user_data["role"],
            is_active=True,
            created_at=now_utc - timedelta(days=110),
        )
        db.add(user)
        users.append(user)
    db.flush()

    products_by_name = {}
    for index, (name, category, price, stock, min_stock) in enumerate(DEMO_PRODUCTS, start=1):
        product = models.Product(
            name=name,
            category=category,
            price=price,
            stock=stock,
            min_stock=min_stock,
            barcode=_barcode(index),
            is_active=True,
            created_at=now_utc - timedelta(days=100),
            updated_at=now_utc - timedelta(hours=index % 24),
        )
        db.add(product)
        products_by_name[name] = product
    db.flush()

    today = get_ph_today()
    context_start = today - timedelta(days=150)
    day_value = context_start
    weather_rows = 0
    event_rows = 0
    while day_value <= today:
        weather_row = _weather_for_day(day_value)
        event_row = _event_for_day(day_value)
        db.add(models.WeatherHistory(
            date=day_value,
            weather=weather_row["weather"],
            temperature_c=weather_row["temperature_c"],
            humidity_pct=weather_row["humidity_pct"],
            rainfall_mm=weather_row["rainfall_mm"],
            source="demo",
            created_at=now_utc - timedelta(days=1),
            updated_at=now_utc - timedelta(hours=2),
        ))
        weather_rows += 1

        db.add(models.SchoolEventHistory(
            date=day_value,
            event_type=event_row["event_type"],
            label=event_row["label"],
            is_school_day=event_row["is_school_day"],
            source="demo",
            created_at=now_utc - timedelta(days=1),
            updated_at=now_utc - timedelta(hours=2),
        ))
        event_rows += 1
        day_value += timedelta(days=1)

    sales_end = today - timedelta(days=1)
    while sales_end.weekday() >= 5:
        sales_end -= timedelta(days=1)
    sales_start = sales_end - timedelta(days=75)

    users_by_role = {user.role: user for user in users}
    transactions_created, items_created = _create_transactions(
        db,
        products_by_name,
        users_by_role["cashier"],
        users_by_role["staff"],
        sales_start,
        sales_end,
    )

    db.add_all([
        models.AuditLog(
            user_id=users_by_role["admin"].id,
            action="DEMO_DATABASE_REBUILT",
            details="Loaded realistic SmartCanteen products, sales, weather, and school event history.",
            timestamp=now_utc,
        ),
        models.AuditLog(
            user_id=users_by_role["staff"].id,
            action="INVENTORY_REVIEW",
            details="Flagged Chicken Tinola, Calamansi Juice, Mango Float, and Puto Cheese for restock.",
            timestamp=now_utc - timedelta(hours=1),
        ),
        models.AuditLog(
            user_id=users_by_role["cashier"].id,
            action="POS_SHIFT_CLOSED",
            details="Closed latest school-day cashier shift with demo sales records.",
            timestamp=now_utc - timedelta(hours=3),
        ),
    ])

    db.commit()

    return {
        "message": "SmartCanteen demo database seeded.",
        "users": len(users),
        "products": len(products_by_name),
        "transactions": transactions_created,
        "transaction_items": items_created,
        "weather_days": weather_rows,
        "school_event_days": event_rows,
        "credentials": {
            "admin": "admin / admin123",
            "cashier": "cashier / cashier123",
            "staff": "staff / staff123",
        },
    }
