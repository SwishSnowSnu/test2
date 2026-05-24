import os
import time
import logging
import threading
import sympy as sp
from flask import Flask, render_template, request, jsonify, g
from methods.richardson import (
    safe_parse, compute, generate_plot, _make_numeric, _X,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("richardson")

app = Flask(__name__,
            static_folder="static",
            template_folder="templates")
app.secret_key = os.environ.get("SECRET_KEY") or os.urandom(32)

MAX_BODY_BYTES    = 4 * 1024
RATE_LIMIT_RPS    = 10
RATE_WINDOW_SEC   = 10

_rate_store: dict[str, list[float]] = {}
_rate_lock = threading.Lock()

def _is_rate_limited(ip: str) -> bool:
    now = time.monotonic()
    with _rate_lock:
        timestamps = _rate_store.setdefault(ip, [])
        cutoff = now - RATE_WINDOW_SEC
        timestamps[:] = [t for t in timestamps if t > cutoff]
        if len(timestamps) >= RATE_LIMIT_RPS * RATE_WINDOW_SEC:
            return True
        timestamps.append(now)
        return False

@app.after_request
def set_security_headers(response):
    response.headers["X-Content-Type-Options"]    = "nosniff"
    response.headers["X-Frame-Options"]           = "DENY"
    response.headers["Referrer-Policy"]           = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"]        = "geolocation=(), microphone=(), camera=()"
    response.headers["X-XSS-Protection"]          = "1; mode=block"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "frame-ancestors 'none';"
    )
    return response

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/calculate", methods=["POST"])
def calculate():
    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown")
    client_ip = client_ip.split(",")[0].strip()
    if _is_rate_limited(client_ip):
        log.warning("Rate limit hit: %s", client_ip)
        return jsonify({
            "ok": False,
            "errors": {"general": "Too many requests. Please wait a moment and try again."}
        }), 429

    if not request.content_type or "application/json" not in request.content_type:
        return jsonify({
            "ok": False,
            "errors": {"general": "Content-Type must be application/json."}
        }), 415

    raw = request.get_data(cache=True)
    if len(raw) > MAX_BODY_BYTES:
        return jsonify({
            "ok": False,
            "errors": {"general": f"Request body too large (max {MAX_BODY_BYTES} bytes)."}
        }), 413

    data = request.get_json(force=False, silent=True, cache=True)
    if data is None:
        return jsonify({"ok": False, "errors": {"general": "Invalid JSON body."}}), 400

    expr_str  = str(data.get("expr",  "") or "").strip()
    x_str     = str(data.get("x_val","") or "").strip()
    h_str     = str(data.get("h_val","") or "").strip()
    want_plot = bool(data.get("plot", True))

    errors: dict[str, str] = {}

    if not expr_str:
        errors["expr"] = "Function expression is required."
    elif len(expr_str) > 300:
        errors["expr"] = "Expression is too long (max 300 characters)."

    x_val = None
    if not x_str:
        errors["x_val"] = "x value is required."
    else:
        try:
            x_val = float(x_str)
            if not (-1e9 <= x_val <= 1e9):
                errors["x_val"] = "x must be in the range [−10⁹, 10⁹]."
        except ValueError:
            errors["x_val"] = "x must be a valid decimal number."

    h_val = None
    if not h_str:
        errors["h_val"] = "Step size h is required."
    else:
        try:
            h_val = float(h_str)
            if h_val == 0.0:
                errors["h_val"] = "Step size h cannot be zero."
            elif abs(h_val) < 1e-12:
                errors["h_val"] = "h is too small — floating-point cancellation will destroy accuracy. Minimum recommended: 1e-8."
            elif abs(h_val) > 1e6:
                errors["h_val"] = "h is unreasonably large (max 10⁶)."
        except ValueError:
            errors["h_val"] = "h must be a valid decimal number."

    if errors:
        return jsonify({"ok": False, "errors": errors}), 400

    try:
        result = compute(expr_str, x_val, h_val)
    except ValueError as exc:
        msg = str(exc)
        log.info("User ValueError: %s | expr=%s x=%s h=%s", msg, expr_str, x_val, h_val)
        field = "expr"
        if "x_val" in msg.lower() or "domain" in msg.lower():
            field = "x_val"
        elif "step" in msg.lower() or "h " in msg.lower():
            field = "h_val"
        return jsonify({"ok": False, "errors": {field: msg}}), 400
    except MemoryError:
        log.error("MemoryError for expr=%s", expr_str)
        return jsonify({
            "ok": False,
            "errors": {"general": "Expression too complex to evaluate."}
        }), 500
    except Exception as exc:
        log.exception("Unexpected compute error: expr=%s x=%s h=%s", expr_str, x_val, h_val)
        return jsonify({
            "ok": False,
            "errors": {"general": "An internal computation error occurred. Check your inputs."}
        }), 500

    plot_uri = None
    if want_plot:
        try:
            sym_f  = safe_parse(expr_str)
            sym_df = sp.diff(sym_f, _X)
            f_num  = _make_numeric(sym_f)
            df_num = _make_numeric(sym_df)
            plot_uri = generate_plot(sym_f, sym_df, x_val, h_val,
                                     f_num=f_num, df_num=df_num)
        except Exception as exc:
            log.warning("Plot generation failed: %s", exc)

    result["plot_uri"] = plot_uri
    result["ok"] = True
    return jsonify(result)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    log.info("Starting Richardson Extrapolation server on port %d", port)
    app.run(host="0.0.0.0", port=port, debug=False)