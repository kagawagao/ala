"""
ALA standalone server entry point.

This file is used as the PyInstaller entry point.  It starts the uvicorn server
and, when running as a frozen executable, automatically opens the default browser
so the user does not need to know the URL.
"""
import sys
import threading
import time
import webbrowser

# ---------------------------------------------------------------------------
# Perfetto binary path – tell perfetto where to find the trace_processor binary
# that PyInstaller extracted into sys._MEIPASS.
# ---------------------------------------------------------------------------
_FROZEN = getattr(sys, "frozen", False)
if _FROZEN:
    import os
    from pathlib import Path

    _meipass = getattr(sys, "_MEIPASS", None)
    if _meipass:
        # Ensure the bundled source packages are importable.
        if _meipass not in sys.path:
            sys.path.insert(0, _meipass)

        # Tell perfetto where to find the trace_processor binary.
        tp_candidates = list(Path(_meipass).glob("perfetto/trace_processor/trace_processor_shell*"))
        if not tp_candidates:
            tp_candidates = list(Path(_meipass).glob("**/trace_processor_shell*"))
        if tp_candidates:
            os.environ.setdefault("PERFETTO_TRACE_PROCESSOR_PATH", str(tp_candidates[0]))


def _open_browser(port: int, delay: float = 1.5) -> None:
    """Open the default browser after a short delay to let uvicorn start up."""
    time.sleep(delay)
    webbrowser.open(f"http://localhost:{port}")


def main() -> None:
    import uvicorn

    from ala.config import settings  # noqa: PLC0415

    port = settings.port
    host = settings.host

    if _FROZEN:
        # Open the browser in a background thread so we don't block uvicorn.
        t = threading.Thread(target=_open_browser, args=(port,), daemon=True)
        t.start()

    if _FROZEN:
        # When frozen, uvicorn cannot resolve the app via a string import because
        # the module loader works differently inside a PyInstaller bundle.
        # Import the app object directly and pass it instead.
        from ala.main import app  # noqa: PLC0415

        uvicorn.run(app, host=host, port=port, reload=False, log_level="info")
    else:
        uvicorn.run(
            "ala.main:app",
            host=host,
            port=port,
            reload=False,
            log_level="info",
        )


if __name__ == "__main__":
    main()
