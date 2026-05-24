import io
import re
import base64
import math
import warnings

import numpy as np
import sympy as sp
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

_X = sp.Symbol("x", real=True)

_FORBIDDEN_TOKENS = [
    "import", "exec", "eval", "compile", "open", "print",
    "globals", "locals", "vars", "dir", "getattr", "setattr",
    "delattr", "hasattr", "type", "isinstance", "issubclass",
    "callable", "iter", "next", "object", "super", "property",
    "classmethod", "staticmethod", "lambda",
    "subprocess", "sys", "builtins",
]

_SAFE_NS: dict = {
    "sin":     sp.sin,   "cos":   sp.cos,   "tan":    sp.tan,
    "asin":    sp.asin,  "acos":  sp.acos,  "atan":   sp.atan,
    "atan2":   sp.atan2,
    "sinh":    sp.sinh,  "cosh":  sp.cosh,  "tanh":   sp.tanh,
    "asinh":   sp.asinh, "acosh": sp.acosh, "atanh":  sp.atanh,
    "exp":     sp.exp,   "log":   sp.log,   "ln":     sp.log,
    "sqrt":    sp.sqrt,  "Abs":   sp.Abs,   "sign":   sp.sign,
    "floor":   sp.floor, "ceiling": sp.ceiling,
    "pi":      sp.pi,    "e":     sp.E,     "E":      sp.E,
    "x":       _X,
}

def safe_parse(expr_str: str) -> sp.Expr:
    if "__" in expr_str:
        raise ValueError("Expression contains forbidden pattern '__'.")

    for token in _FORBIDDEN_TOKENS:
        if re.search(r"\b" + re.escape(token) + r"\b", expr_str):
            raise ValueError(f"Expression contains forbidden token: '{token}'.")

    try:
        expr = sp.sympify(expr_str, locals=_SAFE_NS, evaluate=True)
    except (sp.SympifyError, SyntaxError, TypeError, ValueError) as exc:
        raise ValueError(f"Could not parse expression: {exc}") from exc

    if not isinstance(expr, sp.Basic):
        raise ValueError("Expression did not produce a valid mathematical object.")

    free = expr.free_symbols - {_X}
    if free:
        raise ValueError(
            f"Unknown variable(s) in expression: "
            f"{', '.join(str(s) for s in sorted(free, key=str))}"
        )

    return expr

def _make_numeric(sym_expr: sp.Expr):
    return sp.lambdify(_X, sym_expr, modules=["numpy"])

def _safe_eval(f_num, x: float, label: str = "f") -> float:
    try:
        val = float(f_num(x))
    except Exception as exc:
        raise ValueError(f"{label}({x}) could not be evaluated: {exc}") from exc
    if math.isnan(val):
        raise ValueError(f"{label}({x}) = NaN — function may be undefined at this point.")
    if math.isinf(val):
        raise ValueError(f"{label}({x}) = ±∞ — function diverges near this point.")
    return val

def _cancellation_warning(f_ph: float, f_mh: float, label: str) -> str | None:
    diff = abs(f_ph - f_mh)
    denom = max(abs(f_ph), abs(f_mh), 1e-300)
    if diff < denom * 1e-10:
        lost = math.log10(denom / (diff + 1e-300))
        return f"Catastrophic cancellation detected in {label}: ≈{lost:.0f} significant digit(s) lost. Consider using a larger step size h."
    return None

def central_difference(f_num, x: float, h: float) -> float:
    return (float(f_num(x + h)) - float(f_num(x - h))) / (2.0 * h)

def richardson_step(d_h: float, d_h2: float) -> float:
    return (4.0 * d_h2 - d_h) / 3.0

def richardson_tableau(f_num, x: float, h: float, levels: int = 4) -> tuple[list[list], list[float]]:
    T = [[None] * levels for _ in range(levels)]
    h_vals: list[float] = []
    hi = h
    for i in range(levels):
        h_vals.append(hi)
        T[i][0] = central_difference(f_num, x, hi)
        hi /= 2.0

    for j in range(1, levels):
        for i in range(j, levels):
            factor = 4.0 ** j
            T[i][j] = (factor * T[i][j - 1] - T[i - 1][j - 1]) / (factor - 1.0)

    return T, h_vals

def second_derivative_richardson(f_num, x: float, h: float) -> dict:
    f_x = float(f_num(x))
    f_ph = float(f_num(x + h))
    f_mh = float(f_num(x - h))
    f_ph2 = float(f_num(x + h / 2.0))
    f_mh2 = float(f_num(x - h / 2.0))

    d2_h = (f_ph - 2.0 * f_x + f_mh) / (h ** 2)
    d2_h2 = (f_ph2 - 2.0 * f_x + f_mh2) / ((h / 2.0) ** 2)
    rich = (4.0 * d2_h2 - d2_h) / 3.0

    return {"d2_h": d2_h, "d2_h2": d2_h2, "result": rich}

def estimate_error_bound(f_num, x: float, h: float) -> float | None:
    try:
        pts = [x - 2 * h, x - h, x, x + h, x + 2 * h]
        fs = [float(f_num(p)) for p in pts]
        f4 = (fs[0] - 4 * fs[1] + 6 * fs[2] - 4 * fs[3] + fs[4]) / (h ** 4)
        bound = (h ** 4 / 90.0) * abs(f4)
        return bound if math.isfinite(bound) else None
    except Exception:
        return None

def recommend_h(f_num, x: float, f_x: float | None = None) -> float | None:
    try:
        eps = 2.220446049250313e-16
        scale = max(abs(f_x), 1.0) if f_x is not None else 1.0
        h_opt = (eps * scale) ** 0.25
        return max(1e-8, min(h_opt, 1.0))
    except Exception:
        return None

def compute(expr_str: str, x_val: float, h_val: float) -> dict:
    sym_f = safe_parse(expr_str)
    sym_df = sp.diff(sym_f, _X)
    sym_d2f = sp.diff(sym_df, _X)

    h = float(h_val)

    def _exact_val(sym_expr):
        try:
            v = complex(sym_expr.subs(_X, sp.Float(x_val)))
            if abs(v.imag) > 1e-10 * (abs(v.real) + 1e-300):
                return None
            return float(v.real)
        except Exception:
            return None

    exact_f = _exact_val(sym_f)
    exact_df = _exact_val(sym_df)
    exact_d2f = _exact_val(sym_d2f)

    f_latex = sp.latex(sym_f)
    df_latex = sp.latex(sym_df)
    d2f_latex = sp.latex(sym_d2f)

    f_num = _make_numeric(sym_f)

    x_h = x_val + h
    x_mh = x_val - h
    x_h2 = x_val + h / 2.0
    x_mh2 = x_val - h / 2.0

    f_x = _safe_eval(f_num, x_val, "f")
    f_x_ph = _safe_eval(f_num, x_h, "f")
    f_x_mh = _safe_eval(f_num, x_mh, "f")
    f_x_ph2 = _safe_eval(f_num, x_h2, "f")
    f_x_mh2 = _safe_eval(f_num, x_mh2, "f")

    warn_h = _cancellation_warning(f_x_ph, f_x_mh, "D(h)")
    warn_h2 = _cancellation_warning(f_x_ph2, f_x_mh2, "D(h/2)")
    numerical_warnings = [w for w in [warn_h, warn_h2] if w]

    d_h = (f_x_ph - f_x_mh) / (2.0 * h)
    d_h2 = (f_x_ph2 - f_x_mh2) / (2.0 * (h / 2.0))
    rich = (4.0 * d_h2 - d_h) / 3.0

    tableau, h_vals = richardson_tableau(f_num, x_val, h, levels=4)

    try:
        d2_result = second_derivative_richardson(f_num, x_val, h)
    except ValueError as exc:
        d2_result = {"d2_h": None, "d2_h2": None, "result": None, "error": str(exc)}

    abs_error = abs(rich - exact_df) if exact_df is not None else None
    rel_error = (abs_error / abs(exact_df) * 100.0 if (exact_df is not None and abs(exact_df) > 1e-15) else None)
    cd_abs_error = abs(d_h - exact_df) if exact_df is not None else None
    error_bound = estimate_error_bound(f_num, x_val, h)

    d2_abs_error = (abs(d2_result["result"] - exact_d2f) if (d2_result.get("result") is not None and exact_d2f is not None) else None)

    h_recommended = recommend_h(f_num, x_val, f_x)

    convergence_order = None
    if exact_df is not None and cd_abs_error and cd_abs_error > 1e-15:
        err_h2 = abs(d_h2 - exact_df) if abs(d_h2 - exact_df) > 1e-15 else None
        if err_h2 and err_h2 > 1e-15:
            try:
                convergence_order = math.log2(cd_abs_error / err_h2)
            except Exception:
                convergence_order = None

    def _clean(v):
        if v is None:
            return None
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            return None
        return v

    tableau_clean = [[_clean(tableau[i][j]) for j in range(4)] for i in range(4)]

    return {
        "expr_str": expr_str,
        "f_latex": f_latex,
        "df_latex": df_latex,
        "d2f_latex": d2f_latex,
        "x_val": x_val,
        "h": h,
        "h_half": h / 2.0,
        "f_x": f_x,
        "f_x_ph": f_x_ph,
        "f_x_mh": f_x_mh,
        "f_x_ph2": f_x_ph2,
        "f_x_mh2": f_x_mh2,
        "d_h": d_h,
        "d_h2": d_h2,
        "richardson": rich,
        "d2_h": d2_result.get("d2_h"),
        "d2_h2": d2_result.get("d2_h2"),
        "d2_rich": d2_result.get("result"),
        "exact_d2f": exact_d2f,
        "d2_abs_error": d2_abs_error,
        "exact": exact_df,
        "abs_error": abs_error,
        "rel_error": rel_error,
        "cd_abs_error": cd_abs_error,
        "error_bound": error_bound,
        "convergence_order": convergence_order,
        "tableau": tableau_clean,
        "tableau_h_vals": h_vals,
        "h_recommended": h_recommended,
        "numerical_warnings": numerical_warnings,
    }

def generate_plot(sym_f: sp.Expr, sym_df: sp.Expr, x_val: float, h: float, f_num=None, df_num=None) -> str:
    if f_num is None:
        f_num = _make_numeric(sym_f)
    if df_num is None:
        df_num = _make_numeric(sym_df)

    x_range = max(abs(x_val) * 0.6, 3.0, abs(h) * 8)
    x_lo = x_val - x_range
    x_hi = x_val + x_range
    xs = np.linspace(x_lo, x_hi, 300)

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            ys = np.asarray(f_num(xs), dtype=float)
        except Exception:
            ys = np.full_like(xs, np.nan)

    finite_mask = np.isfinite(ys)
    if finite_mask.any():
        y_finite = ys[finite_mask]
        ymin, ymax = y_finite.min(), y_finite.max()
        y_margin = max((ymax - ymin) * 0.35, 1.5)
        y_lo = ymin - y_margin
        y_hi = ymax + y_margin
        clip_mask = (ys < y_lo - y_margin * 5) | (ys > y_hi + y_margin * 5)
        ys[clip_mask] = np.nan

    try:
        exact_slope = float(df_num(x_val))
    except Exception:
        exact_slope = None

    f_at_x = float(f_num(x_val)) if np.isfinite(float(f_num(x_val))) else 0.0

    try:
        d_h = central_difference(f_num, x_val, h)
        d_h2 = central_difference(f_num, x_val, h / 2.0)
        rich = (4.0 * d_h2 - d_h) / 3.0
    except Exception:
        rich = exact_slope

    t_span = min(x_range * 0.7, 2.5)
    t_xs = np.linspace(x_val - t_span, x_val + t_span, 200)

    fig, ax = plt.subplots(figsize=(9, 5), dpi=100)
    fig.patch.set_facecolor("#0f172a")
    ax.set_facecolor("#1e293b")

    ax.plot(xs, ys, color="#38bdf8", linewidth=2.2, label=r"$f(x)$", zorder=3)

    if exact_slope is not None and math.isfinite(exact_slope):
        ty = f_at_x + exact_slope * (t_xs - x_val)
        ax.plot(t_xs, ty, color="#f97316", linewidth=1.8, linestyle="--", label=f"Exact tangent  (slope = {exact_slope:.6f})", zorder=4)

    if rich is not None and math.isfinite(rich):
        ry = f_at_x + rich * (t_xs - x_val)
        ax.plot(t_xs, ry, color="#a3e635", linewidth=1.8, linestyle="-.", label=f"Richardson  (R = {rich:.6f})", zorder=4)

    ax.axvline(x_val, color="#64748b", linewidth=0.9, linestyle=":", zorder=2)

    pts = [
        (x_val + h, "#fb923c", f"x+h = {x_val + h:.4g}"),
        (x_val - h, "#fb923c", f"x−h = {x_val - h:.4g}"),
        (x_val + h / 2.0, "#c084fc", f"x+h/2 = {x_val + h/2:.4g}"),
        (x_val - h / 2.0, "#c084fc", f"x−h/2 = {x_val - h/2:.4g}"),
    ]
    for xp, col, lbl in pts:
        try:
            yp = float(f_num(xp))
            if math.isfinite(yp):
                ax.scatter(xp, yp, color=col, s=55, zorder=6)
        except Exception:
            pass

    ax.scatter(x_val, f_at_x, color="#facc15", s=90, zorder=7, label=f"$(x_0, f(x_0))$ = ({x_val}, {f_at_x:.5g})")

    import matplotlib.patches as mpatches
    h_patch = mpatches.Patch(color="#fb923c", label="±h  evaluation pts")
    h2_patch = mpatches.Patch(color="#c084fc", label="±h/2 evaluation pts")

    handles, labels = ax.get_legend_handles_labels()
    handles += [h_patch, h2_patch]
    labels += ["±h  eval pts", "±h/2 eval pts"]
    ax.legend(handles, labels, facecolor="#1e293b", edgecolor="#334155", labelcolor="#e2e8f0", fontsize=8.5, loc="best")

    ax.set_xlabel("x", color="#cbd5e1", fontsize=11)
    ax.set_ylabel("f(x)", color="#cbd5e1", fontsize=11)
    ax.set_title("Richardson Extrapolation — Geometric Visualisation", color="#f1f5f9", pad=14, fontsize=12, fontweight="bold")
    ax.tick_params(colors="#94a3b8", labelsize=9)
    for spine in ax.spines.values():
        spine.set_edgecolor("#334155")
    ax.grid(True, color="#1e3a5f", linewidth=0.6, alpha=0.7)

    if finite_mask.any():
        ax.set_ylim(y_lo, y_hi)

    plt.tight_layout(pad=1.5)
    buf = io.BytesIO()
    plt.savefig(buf, format="png", bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)
    buf.seek(0)
    encoded = base64.b64encode(buf.read()).decode("ascii")
    return f"data:image/png;base64,{encoded}"