import sys
import os

# Add the parent directory to sys.path so we can import app.py
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

try:
    from app import app
except ImportError:
    # Fallback
    sys.path.append(os.getcwd())
    from app import app

# This is required for Vercel to pick up the FastAPI instance
app = app
