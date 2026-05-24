"use strict";

function escapeHtml(str) {
  if (str === null || str === undefined) return "N/A";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmt(n) {
  if (n === null || n === undefined || (typeof n === "number" && isNaN(n))) {
    return "N/A";
  }
  return Number(n).toFixed(5);
}

function fmtExp(n, digits) {
  if (n === null || n === undefined) return "N/A";
  digits = digits || 5;
  return Number(n).toExponential(digits);
}

function fmtFixed(n, places) {
  if (n === null || n === undefined) return "N/A";
  places = places || 5;
  return Number(n).toFixed(places);
}

(function initTheme() {
  const saved = localStorage.getItem("theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
})();

function toggleTheme() {
  const html  = document.documentElement;
  const next  = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
  html.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
}

function toggleNav() {
  const links = document.getElementById("navLinks");
  if (links) links.classList.toggle("open");
}

(function wireUI() {

  var themeBtn = document.getElementById("themeToggle");
  if (themeBtn) {
    themeBtn.addEventListener("click", function () { toggleTheme(); });
  }

  var burger = document.getElementById("hamburger");
  if (burger) {
    burger.addEventListener("click", function () {
      var links = document.getElementById("navLinks");
      if (!links) return;
      links.classList.toggle("open");
      burger.setAttribute("aria-expanded",
        links.classList.contains("open") ? "true" : "false");
    });
  }

  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener("click", function (e) {
      var href = a.getAttribute("href");
      var target = href ? document.querySelector(href) : null;
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      var links = document.getElementById("navLinks");
      if (links) links.classList.remove("open");
    });
  });

  document.querySelectorAll(".quick-fn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var expr = btn.getAttribute("data-expr");
      if (expr) insertFunction(expr);
    });
    btn.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        var expr = btn.getAttribute("data-expr");
        if (expr) insertFunction(expr);
      }
    });
  });

  var calcBtn = document.getElementById("calcBtn");
  if (calcBtn) {
    calcBtn.addEventListener("click", function () { calculate(); });
  }

  ["exprInput", "xInput", "hInput"].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter") calculate();
    });
    el.addEventListener("input", function () {
      clearFieldError(id, id.replace("Input", "Error"));
    });
  });

}());

function insertFunction(expr) {
  const inp = document.getElementById("exprInput");
  if (!inp) return;
  inp.value = expr;
  inp.focus();
  clearFieldError("exprInput", "exprError");
}

function showFieldError(inputId, errorId, msg) {
  const inp = document.getElementById(inputId);
  const err = document.getElementById(errorId);
  if (inp) inp.classList.add("input-error");
  if (err) {
    err.textContent = msg;
    err.classList.add("visible");
  }
}

function clearFieldError(inputId, errorId) {
  const inp = document.getElementById(inputId);
  const err = document.getElementById(errorId);
  if (inp) inp.classList.remove("input-error");
  if (err) { err.textContent = ""; err.classList.remove("visible"); }
}

function clearAllErrors() {
  [["exprInput","exprError"], ["xInput","xError"], ["hInput","hError"]].forEach(
    function (pair) { clearFieldError(pair[0], pair[1]); }
  );
}

var _lastCalcTime = 0;
var CALC_COOLDOWN_MS = 500;

function calculate() {
  clearAllErrors();

  const now = Date.now();
  if (now - _lastCalcTime < CALC_COOLDOWN_MS) return;
  _lastCalcTime = now;

  const exprEl = document.getElementById("exprInput");
  const xEl    = document.getElementById("xInput");
  const hEl    = document.getElementById("hInput");
  if (!exprEl || !xEl || !hEl) return;

  const expr = (exprEl.value || "").trim();
  const xVal = (xEl.value   || "").trim();
  const hVal = (hEl.value   || "").trim();

  let valid = true;
  if (!expr) { showFieldError("exprInput", "exprError", "Function is required."); valid = false; }
  if (!xVal) { showFieldError("xInput",    "xError",    "x value is required."); valid = false; }
  if (!hVal) {
    showFieldError("hInput", "hError", "Step size is required."); valid = false;
  } else if (parseFloat(hVal) === 0) {
    showFieldError("hInput", "hError", "h cannot be zero."); valid = false;
  }
  if (!valid) return;

  const btn = document.getElementById("calcBtn");
  if (!btn) return;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Computing…';
  showResultLoading();

  fetch("/calculate", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ expr: expr, x_val: xVal, h_val: hVal, plot: true }),
  })
    .then(function (resp) {
      return resp.json().then(function (d) { return { status: resp.status, data: d }; });
    })
    .then(function (res) {
      btn.disabled = false;
      btn.innerHTML = "⟨ Calculate ⟩";

      const d = res.data;
      if (!d.ok) {
        const errs = d.errors || {};
        if (errs.expr)    showFieldError("exprInput", "exprError", errs.expr);
        if (errs.x_val)   showFieldError("xInput",    "xError",    errs.x_val);
        if (errs.h_val)   showFieldError("hInput",    "hError",    errs.h_val);
        const generalMsg  = errs.general || "Please fix the errors above and try again.";
        if (!errs.expr && !errs.x_val && !errs.h_val) {
          showResultError(generalMsg);
        } else {
          showResultError("Please fix the highlighted fields above.");
        }
        return;
      }

      window._lastResult = d;
      renderResult(d);
    })
    .catch(function (err) {
      btn.disabled = false;
      btn.innerHTML = "⟨ Calculate ⟩";
      showResultError("Network error — please check your connection and try again.");
      console.error("[Richardson] fetch error:", err);
    });
}

function makeMetric(label, value, extra) {
  const div   = document.createElement("div");
  div.className = "metric" + (extra ? " " + extra : "");

  const lbl   = document.createElement("div");
  lbl.className = "m-label";
  lbl.textContent = label;

  const val   = document.createElement("div");
  val.className = "m-value";
  val.textContent = value;

  div.appendChild(lbl);
  div.appendChild(val);
  return div;
}

function makeWarning(msg) {
  const div = document.createElement("div");
  div.className = "warn-box";

  const icon = document.createElement("span");
  icon.textContent = "⚠ ";
  icon.setAttribute("aria-hidden", "true");

  const text = document.createElement("span");
  text.textContent = msg;

  div.appendChild(icon);
  div.appendChild(text);
  return div;
}

function renderResult(d) {
  const panel = document.getElementById("resultPanel");
  if (!panel) return;

  while (panel.firstChild) panel.removeChild(panel.firstChild);

  const title = document.createElement("h3");
  title.textContent = "Computation Results";
  panel.appendChild(title);

  const scroll = document.createElement("div");
  scroll.className = "result-scroll fade-in";
  panel.appendChild(scroll);

  if (d.numerical_warnings && d.numerical_warnings.length > 0) {
    d.numerical_warnings.forEach(function (w) {
      scroll.appendChild(makeWarning(w));
    });
  }

  if (d.h_recommended && Math.abs(d.h_recommended - d.h) / (d.h_recommended + 1e-300) > 0.5) {
    const hint = document.createElement("div");
    hint.className = "hint-box";
    hint.textContent =
      "Tip: Optimal step size for this function is approximately h ≈ " +
      Number(d.h_recommended).toExponential(1) +
      ". Try it for best accuracy.";
    scroll.appendChild(hint);
  }

  const funcRow = document.createElement("div");
  funcRow.className = "func-display";

  const funcLabel = document.createElement("span");
  funcLabel.className = "func-label";
  funcLabel.textContent = "f(x) = ";
  funcRow.appendChild(funcLabel);

  const funcTex = document.createElement("span");
  funcTex.className = "func-tex";
  funcTex.textContent = "\\(" + (d.f_latex || escapeHtml(d.expr_str)) + "\\)";
  funcRow.appendChild(funcTex);

  const dfTex = document.createElement("span");
  dfTex.className = "func-label";
  dfTex.textContent = "\u00a0\u00a0\u00a0f\u2032(x) = ";
  funcRow.appendChild(dfTex);

  const dfTexVal = document.createElement("span");
  dfTexVal.className = "func-tex";
  dfTexVal.textContent = "\\(" + (d.df_latex || "?") + "\\)";
  funcRow.appendChild(dfTexVal);

  scroll.appendChild(funcRow);

  const grid = document.createElement("div");
  grid.className = "metrics-grid";

  grid.appendChild(makeMetric("D(h) — Central diff. at h",        fmt(d.d_h)));
  grid.appendChild(makeMetric("D(h/2) — Central diff. at h/2",    fmt(d.d_h2)));
  grid.appendChild(makeMetric("Richardson Extrapolation  R",      fmt(d.richardson), "highlight"));
  grid.appendChild(makeMetric("Exact  f\u2032(x)",                d.exact !== null ? fmt(d.exact) : "N/A"));
  grid.appendChild(makeMetric("|R \u2212 f\u2032(x)|  Abs. error",
    d.abs_error !== null ? fmtExp(d.abs_error) : "N/A"));
  grid.appendChild(makeMetric("Relative error  (%)",
    d.rel_error !== null ? fmtFixed(d.rel_error, 5) + " %" : "N/A"));
  grid.appendChild(makeMetric("Error bound estimate",
    d.error_bound !== null ? fmtExp(d.error_bound) : "N/A"));
  grid.appendChild(makeMetric("Observed convergence order",
    d.convergence_order !== null ? fmtFixed(d.convergence_order, 2) + "  (expected ≈ 2.00)" : "N/A"));

  scroll.appendChild(grid);

  if (d.abs_error !== null && d.cd_abs_error !== null && d.abs_error > 0 && d.cd_abs_error > 0) {
    const factor = d.cd_abs_error / d.abs_error;
    const imp = document.createElement("div");
    imp.className = "improvement-box";
    const impText = document.createElement("span");
    impText.textContent =
      "Richardson is " + factor.toFixed(0) +
      "× more accurate than the central-difference formula for this h.";
    imp.appendChild(impText);
    scroll.appendChild(imp);
  }

  scroll.appendChild(buildStepsAccordion(d));

  if (d.tableau) {
    scroll.appendChild(buildTableauSection(d));
  }

  if (d.d2_rich !== null && d.d2_rich !== undefined) {
    scroll.appendChild(buildSecondDerivSection(d));
  }

  if (d.plot_uri) {
    const plotWrap = document.createElement("div");
    plotWrap.className = "plot-container";
    const img = document.createElement("img");
    img.src = d.plot_uri;
    img.alt = "Plot of f(x) with exact tangent, Richardson tangent, and evaluation points";
    plotWrap.appendChild(img);
    scroll.appendChild(plotWrap);
  }

  scroll.appendChild(buildActionBar(d));

  if (window.MathJax && window.MathJax.typesetPromise) {
    MathJax.typesetPromise([panel]).catch(function () {});
  }
}

function buildStepsAccordion(d) {
  const wrapper = document.createElement("div");
  wrapper.className = "steps-accordion";

  const header = document.createElement("div");
  header.className = "steps-header open";
  header.setAttribute("role", "button");
  header.setAttribute("tabindex", "0");
  header.setAttribute("aria-expanded", "true");
  header.addEventListener("click", function () { toggleSteps(this); });
  header.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSteps(this); }
  });

  const headerText = document.createElement("span");
  headerText.textContent = "Step-by-step computation";
  const chevron = document.createElement("span");
  chevron.className = "chevron";
  chevron.textContent = "▾";
  header.appendChild(headerText);
  header.appendChild(chevron);

  const body = document.createElement("div");
  body.className = "steps-body visible";

  const pre = document.createElement("pre");
  pre.className = "steps-pre";
  pre.textContent = buildStepsText(d);

  body.appendChild(pre);
  wrapper.appendChild(header);
  wrapper.appendChild(body);
  return wrapper;
}

function buildStepsText(d) {
  const f  = function (n) { return n !== null && n !== undefined ? Number(n).toFixed(5) : "N/A"; };
  const fe = function (n) { return n !== null && n !== undefined ? Number(n).toExponential(5) : "N/A"; };

  var xph  = Number(d.x_val) + Number(d.h);
  var xmh  = Number(d.x_val) - Number(d.h);
  var xph2 = Number(d.x_val) + Number(d.h) / 2;
  var xmh2 = Number(d.x_val) - Number(d.h) / 2;

  var lines = [
    "Given",
    "  f(x) = " + d.expr_str,
    "  x₀   = " + d.x_val,
    "  h    = " + d.h,
    "",
    "─────────────────────────────────────────────",
    "Step 1 — Evaluate f at x₀ ± h and x₀ ± h/2",
    "─────────────────────────────────────────────",
    "  f(x₀ + h)   = f(" + xph.toFixed(5)  + ") = " + f(d.f_x_ph),
    "  f(x₀ − h)   = f(" + xmh.toFixed(5)  + ") = " + f(d.f_x_mh),
    "  f(x₀ + h/2) = f(" + xph2.toFixed(5) + ") = " + f(d.f_x_ph2),
    "  f(x₀ − h/2) = f(" + xmh2.toFixed(5) + ") = " + f(d.f_x_mh2),
    "",
    "─────────────────────────────────────────────",
    "Step 2 — Central difference D(h)",
    "─────────────────────────────────────────────",
    "  D(h) = [f(x₀+h) − f(x₀−h)] / (2h)",
    "       = [" + f(d.f_x_ph) + " − " + f(d.f_x_mh) + "]",
    "         / (2 × " + d.h + ")",
    "       = " + f(d.d_h),
    "  Truncation error: O(h²) ≈ O(" + Math.pow(Number(d.h), 2).toExponential(2) + ")",
    "",
    "─────────────────────────────────────────────",
    "Step 3 — Central difference D(h/2)",
    "─────────────────────────────────────────────",
    "  D(h/2) = [f(x₀+h/2) − f(x₀−h/2)] / (2·h/2)",
    "         = [" + f(d.f_x_ph2) + " − " + f(d.f_x_mh2) + "]",
    "           / " + d.h,
    "         = " + f(d.d_h2),
    "",
    "─────────────────────────────────────────────",
    "Step 4 — Richardson Extrapolation",
    "─────────────────────────────────────────────",
    "  R = [4·D(h/2) − D(h)] / 3",
    "    = [4 × " + f(d.d_h2) + " − " + f(d.d_h) + "] / 3",
    "    = " + f(d.richardson),
    "  Truncation error: O(h⁴) ≈ O(" + Math.pow(Number(d.h), 4).toExponential(2) + ")",
    "",
    "─────────────────────────────────────────────",
    "Step 5 — Error Analysis",
    "─────────────────────────────────────────────",
  ];

  if (d.exact !== null && d.exact !== undefined) {
    lines.push(
      "  Exact f\u2032(x₀)     = " + f(d.exact),
      "  |D(h) − f\u2032|      = " + fe(d.cd_abs_error) + "   (central difference)",
      "  |R − f\u2032|         = " + fe(d.abs_error)    + "   (Richardson)",
      "  Relative error   = " + (d.rel_error !== null ? Number(d.rel_error).toFixed(5) + " %" : "N/A"),
      "  Error bound est. = " + fe(d.error_bound),
    );
    if (d.abs_error > 0 && d.cd_abs_error > 0) {
      lines.push(
        "  Improvement      = " + (d.cd_abs_error / d.abs_error).toFixed(1) + "× over central diff",
      );
    }
  } else {
    lines.push("  Exact derivative not analytically available.");
  }

  if (d.d2_rich !== null && d.d2_rich !== undefined) {
    lines.push(
      "",
      "─────────────────────────────────────────────",
      "Bonus — Second Derivative Richardson",
      "─────────────────────────────────────────────",
      "  f\u2033(x₀) ≈ R₂ = " + f(d.d2_rich),
      d.exact_d2f !== null ? "  Exact f\u2033(x₀)  = " + f(d.exact_d2f) : "",
      d.d2_abs_error !== null ? "  |R₂ − f\u2033|   = " + fe(d.d2_abs_error) : "",
    );
  }

  return lines.join("\n");
}

function buildTableauSection(d) {
  const section = document.createElement("div");
  section.className = "tableau-section";

  const hdr = document.createElement("div");
  hdr.className = "sub-section-title";
  hdr.textContent = "Richardson Extrapolation Tableau";
  section.appendChild(hdr);

  const desc = document.createElement("p");
  desc.className = "tableau-desc";
  desc.textContent =
    "Each column eliminates one more error term. " +
    "Column 0 = central difference O(h²); Column 1 = Richardson O(h⁴); " +
    "Column 2 = O(h⁶); Column 3 = O(h⁸).";
  section.appendChild(desc);

  const tbl = document.createElement("table");
  tbl.className = "tableau-table";
  tbl.setAttribute("aria-label", "Richardson Extrapolation tableau");

  const thead = document.createElement("thead");
  const hrow  = document.createElement("tr");
  ["h value", "D(h)  [O(h²)]", "R₁  [O(h⁴)]", "R₂  [O(h⁶)]", "R₃  [O(h⁸)]"].forEach(
    function (txt) {
      const th = document.createElement("th");
      th.textContent = txt;
      hrow.appendChild(th);
    }
  );
  thead.appendChild(hrow);
  tbl.appendChild(thead);

  const tbody = document.createElement("tbody");
  var T = d.tableau;
  var H = d.tableau_h_vals;
  for (var i = 0; i < 4; i++) {
    const row = document.createElement("tr");
    const hCell = document.createElement("td");
    hCell.className = "mono";
    hCell.textContent = H && H[i] != null ? Number(H[i]).toExponential(3) : "—";
    row.appendChild(hCell);

    for (var j = 0; j < 4; j++) {
      const td = document.createElement("td");
      td.className = "mono" + (j === 1 ? " col-highlight" : "");
      var val = T && T[i] && T[i][j] != null ? T[i][j] : null;
      if (val !== null && i >= j) {
        td.textContent = Number(val).toFixed(5);
        if (j === i && j > 0) {
          td.className += " tableau-best";
        }
      } else {
        td.textContent = "—";
        td.style.color = "var(--text-light)";
      }
      row.appendChild(td);
    }
    tbody.appendChild(row);
  }
  tbl.appendChild(tbody);
  section.appendChild(tbl);

  if (d.exact !== null && T && T[3] && T[3][1] !== null) {
    const r3_err = Math.abs(T[3][1] - d.exact);
    const r3_label = document.createElement("p");
    r3_label.className = "tableau-note";
    r3_label.textContent =
      "Best tableau estimate (bottom-right): " +
      Number(T[3][T[3].findLast ? T[3].findLastIndex(function(v){return v!==null;}) : 1] || T[3][1]).toFixed(5) +
      (d.exact !== null ? "  |  Error: " + r3_err.toExponential(5) : "");
    section.appendChild(r3_label);
  }

  return section;
}

function buildSecondDerivSection(d) {
  const section = document.createElement("div");
  section.className = "d2-section";

  const hdr = document.createElement("div");
  hdr.className = "sub-section-title";
  hdr.textContent = "Second Derivative Richardson Extrapolation";
  section.appendChild(hdr);

  const grid = document.createElement("div");
  grid.className = "metrics-grid metrics-grid-3";

  grid.appendChild(makeMetric("D₂(h) — 2nd central diff at h",   fmt(d.d2_h)));
  grid.appendChild(makeMetric("D₂(h/2) — 2nd central diff h/2", fmt(d.d2_h2)));
  grid.appendChild(makeMetric("R₂  —  f\u2033(x) Richardson",    fmt(d.d2_rich), "highlight"));

  if (d.exact_d2f !== null && d.exact_d2f !== undefined) {
    grid.appendChild(makeMetric("Exact  f\u2033(x)",              fmt(d.exact_d2f)));
    grid.appendChild(makeMetric("|R₂ \u2212 f\u2033(x)|  Abs. error",
      d.d2_abs_error !== null ? fmtExp(d.d2_abs_error) : "N/A"));
  }

  const formula = document.createElement("div");
  formula.className = "d2-formula";
  formula.textContent =
    "\\[ D_2(h) = \\frac{f(x+h) - 2f(x) + f(x-h)}{h^2} \\quad R_2 = \\frac{4 D_2(h/2) - D_2(h)}{3} \\]";

  section.appendChild(grid);
  section.appendChild(formula);
  return section;
}

function buildActionBar(d) {
  const bar = document.createElement("div");
  bar.className = "download-bar";

  const btnTxt = document.createElement("button");
  btnTxt.className = "btn btn-sm btn-primary";
  btnTxt.textContent = "⬇ Download .txt";
  btnTxt.addEventListener("click", downloadTxt);
  bar.appendChild(btnTxt);

  const btnJson = document.createElement("button");
  btnJson.className = "btn btn-sm btn-primary";
  btnJson.textContent = "⬇ Download .json";
  btnJson.addEventListener("click", downloadJson);
  bar.appendChild(btnJson);

  const btnCopy = document.createElement("button");
  btnCopy.className = "btn btn-sm btn-outline-action";
  btnCopy.textContent = "⧉ Copy Summary";
  btnCopy.addEventListener("click", function () { copySummary(btnCopy); });
  bar.appendChild(btnCopy);

  return bar;
}

function toggleSteps(header) {
  const isOpen = header.classList.toggle("open");
  header.setAttribute("aria-expanded", isOpen ? "true" : "false");
  const body = header.nextElementSibling;
  if (body) body.classList.toggle("visible");
}

function showResultLoading() {
  const panel = document.getElementById("resultPanel");
  if (!panel) return;
  while (panel.firstChild) panel.removeChild(panel.firstChild);

  const h = document.createElement("h3");
  h.textContent = "Computation Results";
  panel.appendChild(h);

  const ph = document.createElement("div");
  ph.className = "placeholder-state";

  const sp2 = document.createElement("div");
  sp2.className = "spinner-lg";
  sp2.setAttribute("aria-label", "Computing…");
  const msg = document.createElement("p");
  msg.textContent = "Running Richardson Extrapolation…";

  ph.appendChild(sp2);
  ph.appendChild(msg);
  panel.appendChild(ph);
}

function showResultError(msg) {
  const panel = document.getElementById("resultPanel");
  if (!panel) return;
  while (panel.firstChild) panel.removeChild(panel.firstChild);

  const h = document.createElement("h3");
  h.textContent = "Computation Results";
  panel.appendChild(h);

  const ph = document.createElement("div");
  ph.className = "placeholder-state";

  const icon = document.createElement("div");
  icon.className = "icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "⚠";

  const p = document.createElement("p");
  p.className = "error-text";
  p.textContent = msg;

  ph.appendChild(icon);
  ph.appendChild(p);
  panel.appendChild(ph);
}

function downloadTxt() {
  const d = window._lastResult;
  if (!d) return;

  const f  = function (n) { return n !== null && n !== undefined ? Number(n).toFixed(5) : "N/A"; };
  const fe = function (n) { return n !== null && n !== undefined ? Number(n).toExponential(5) : "N/A"; };

  var lines = [
    "Richardson Extrapolation — Computation Report",
    "================================================",
    "Generated: " + new Date().toISOString(),
    "",
    "INPUT",
    "  Function  : " + d.expr_str,
    "  f(x)      : " + d.f_latex,
    "  f'(x)     : " + d.df_latex,
    "  x₀        : " + d.x_val,
    "  h         : " + d.h,
    "",
    "FIRST DERIVATIVE — RESULTS",
    "  D(h)      [O(h²)] : " + f(d.d_h),
    "  D(h/2)    [O(h²)] : " + f(d.d_h2),
    "  Richardson [O(h⁴)] : " + f(d.richardson),
    "  Exact f'(x)        : " + f(d.exact),
    "  Abs. error (D(h))  : " + fe(d.cd_abs_error),
    "  Abs. error (Rich.) : " + fe(d.abs_error),
    "  Relative error     : " + (d.rel_error !== null ? Number(d.rel_error).toFixed(5) + " %" : "N/A"),
    "  Error bound est.   : " + fe(d.error_bound),
    "  Improvement factor : " + (d.abs_error > 0 && d.cd_abs_error > 0
      ? (d.cd_abs_error / d.abs_error).toFixed(1) + "×" : "N/A"),
    "",
  ];

  if (d.d2_rich !== null && d.d2_rich !== undefined) {
    lines = lines.concat([
      "SECOND DERIVATIVE — RESULTS",
      "  D₂(h)              : " + f(d.d2_h),
      "  D₂(h/2)            : " + f(d.d2_h2),
      "  R₂ (Richardson)    : " + f(d.d2_rich),
      "  Exact f''(x)       : " + f(d.exact_d2f),
      "  Abs. error (R₂)    : " + fe(d.d2_abs_error),
      "",
    ]);
  }

  if (d.tableau) {
    lines.push("RICHARDSON TABLEAU");
    lines.push("  (rows = step sizes h, h/2, h/4, h/8; cols = extrapolation levels)");
    var H = d.tableau_h_vals || [];
    d.tableau.forEach(function (row, i) {
      var cells = row.map(function (v) {
        return v !== null ? Number(v).toFixed(5) : "    ——    ";
      });
      lines.push("  h=" + (H[i] != null ? Number(H[i]).toExponential(2) : "?") +
        " | " + cells.join(" | "));
    });
    lines.push("");
  }

  var blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  triggerDownload(blob, "richardson_result.txt");
}

function downloadJson() {
  const d = window._lastResult;
  if (!d) return;
  var payload = Object.assign({}, d);
  delete payload.plot_uri;
  var blob = new Blob([JSON.stringify(payload, null, 2)],
    { type: "application/json;charset=utf-8" });
  triggerDownload(blob, "richardson_result.json");
}

function triggerDownload(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a   = document.createElement("a");
  a.href  = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

function copySummary(btn) {
  const d = window._lastResult;
  if (!d) return;
  var text = [
    "f(x) = " + d.expr_str,
    "x = " + d.x_val + ", h = " + d.h,
    "D(h) = " + Number(d.d_h).toFixed(5),
    "D(h/2) = " + Number(d.d_h2).toFixed(5),
    "Richardson R = " + Number(d.richardson).toFixed(5),
    d.exact !== null ? "Exact f'(x) = " + Number(d.exact).toFixed(5) : "",
    d.abs_error !== null ? "|R - f'| = " + Number(d.abs_error).toExponential(5) : "",
  ].filter(Boolean).join("\n");

  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(function () {
      var orig = btn.textContent;
      btn.textContent = "✓ Copied!";
      setTimeout(function () { btn.textContent = orig; }, 2000);
    }).catch(function () {
      btn.textContent = "Copy failed";
    });
  }
}