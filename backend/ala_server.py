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
        # The perfetto package looks for PERFETTO_TRACE_PROCESSOR_PATH first.
        tp_candidates = list(Path(_meipass).glob("perfetto/trace_processor/trace_processor_shell*"))
        if not tp_candidates:
            # Fallback: any trace_processor_shell binary in _MEIPASS
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

    uvicorn.run(
        "ala.main:app",
        host=host,
        port=port,
        # reload must be False when frozen – there are no source files to watch.
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
