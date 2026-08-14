"""
SmartCanteen - Root Entry Point
Usage:
    python app.py
    py app.py
    uvicorn app:app --reload
"""

import os
import sys

# Ensure repository root is on sys.path
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from backend.main import app

if __name__ == "__main__":
    import uvicorn

    host = os.getenv("SMARTCANTEEN_HOST", "0.0.0.0")
    port = int(os.getenv("SMARTCANTEEN_PORT", os.getenv("PORT", "8000")))
    uvicorn.run("backend.main:app", host=host, port=port, reload=True)
