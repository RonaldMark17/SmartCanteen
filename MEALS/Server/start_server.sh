#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${MEALS_APP_DIR:-/var/www/meals}"
VENV_DIR="${MEALS_VENV_DIR:-$APP_DIR/venv}"
PYTHON_BIN="${MEALS_PYTHON_BIN:-python3}"

echo "================================================="
echo " Starting MEALS FastAPI Server Deployment Setup  "
echo "================================================="

cd "$APP_DIR"

if [ ! -d "$VENV_DIR" ]; then
    echo "Creating Python virtual environment..."
    "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

echo "Activating virtual environment..."
source "$VENV_DIR/bin/activate"

echo "Installing/Upgrading dependencies..."
python -m pip install --upgrade pip
python -m pip install -r backend/requirements.txt uvicorn gunicorn

echo "Running database initialization & migrations..."
python MEALS/Server/init_db.py

echo "Starting Uvicorn backend server on 127.0.0.1:8000..."
exec uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 4 --proxy-headers
