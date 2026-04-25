import importlib.util
from pathlib import Path 


def _load_ui_app():
    """
    Load `ui/app.py` directly by file path.

    Vercel also has a top-level `app.py` in this repository, and plain
    `from app import app` may resolve to the wrong module.
    
    """
    repo_root = Path(__file__).resolve().parent.parent
    ui_app_path = repo_root / "ui" / "app.py"

    if not ui_app_path.exists():
        raise FileNotFoundError(f"Could not find UI app module at: {ui_app_path}")

    spec = importlib.util.spec_from_file_location("ui_app_module", ui_app_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not create import spec for: {ui_app_path}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    loaded_app = getattr(module, "app", None)
    if loaded_app is None:
        raise ImportError(f"`app` not found in module: {ui_app_path}")
    return loaded_app


# Vercel Python entrypoint expects a top-level variable named `app`.
app = _load_ui_app()
