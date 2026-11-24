import {
  normalizeNumber, toFloat, roundTo, evaluatePolynomialDescending,
  calculatePipePreview, calculatePipeTotals,
  getBestPumps, getPumpDetails, calculateCable
} from "./pump-engine.mjs";

const STORAGE_KEY = "pump-pars-naseri-static-v1";
const allowedPages = new Set(["welcome", "guide", "simple", "step1", "step2", "design", "match", "cable", "result"]);
const $ = (id) => document.getElementById(id);

let pipeRecords = [];
let pumpRecords = [];
let dataReady = false;
let dataError = null;

const defaultState = () => ({
  page: "welcome",
  mode: null,
  flow: null,
  final_q: null,
  final_h: null,
  static_level: null,
  dynamic_level: null,
  install_depth: null,
  diameter_inch: null,
  diameter_mm: null,
  depth: null,
  segments: [],
  nextPipeUid: 2,
  fittingsData: [],
  totalPipeHead: 0,
  totalOtherHead: 0,
  simpleFlowInput: "",
  simpleHeadInput: "",
  simpleFlowUnit: "m3h",
  selectedModel: null,
  motorPower: 0,
  pumpEfficiency: 0,
  pumpDetails: null,
  selectedCandidateIndex: null,
  panelDistance: null,
  startMethod: "تک ضرب",
  selectedCable: "---",
  calcArea: null,
  totalLengthCalc: null
});

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return saved && typeof saved === "object" ? { ...defaultState(), ...saved } : defaultState();
  } catch {
    return defaultState();
  }
}

let state = loadState();

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("Could not persist calculator state:", err);
  }
}

let alertReturnFocus = null;

function showAppAlert(message, title = "بررسی اطلاعات", focusAfterClose = null) {
  const modal = $("app-alert-modal");
  if (!modal) {
    console.warn("App alert:", message);
    return;
  }
  alertReturnFocus = focusAfterClose || document.activeElement;
  $("app-alert-title").textContent = title;
  $("app-alert-message").textContent = String(message ?? "");
  modal.hidden = false;
  document.body.classList.add("app-alert-open");
  window.requestAnimationFrame(() => $("app-alert-ok")?.focus());
}

function closeAppAlert() {
  const modal = $("app-alert-modal");
  if (modal) modal.hidden = true;
  document.body.classList.remove("app-alert-open");
  if (alertReturnFocus?.isConnected) alertReturnFocus.focus({ preventScroll: true });
  alertReturnFocus = null;
}

function clearFieldError(field) {
  if (!field) return;
  field.classList.remove("field-invalid");
  field.removeAttribute("aria-invalid");
  if (field.id) {
    document.getElementById(`${field.id}-inline-error`)?.remove();
    const describedBy = (field.getAttribute("aria-describedby") || "")
      .split(/\s+/).filter(id => id && id !== `${field.id}-inline-error`);
    if (describedBy.length) field.setAttribute("aria-describedby", describedBy.join(" "));
    else field.removeAttribute("aria-describedby");
  }
}

function showFieldError(field, message = "این فیلد باید تکمیل شود.") {
  if (!field) return;
  clearFieldError(field);
  field.classList.add("field-invalid");
  field.setAttribute("aria-invalid", "true");
  if (!field.id) return;
  const error = document.createElement("span");
  error.id = `${field.id}-inline-error`;
  error.className = "field-error";
  error.textContent = message;
  const anchor = field.closest(".input-group") || field;
  anchor.insertAdjacentElement("afterend", error);
  const describedBy = (field.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
  if (!describedBy.includes(error.id)) describedBy.push(error.id);
  field.setAttribute("aria-describedby", describedBy.join(" "));
}

function validateForm(form, message = "لطفاً اطلاعات خواسته‌شده را به‌درستی تکمیل کنید.") {
  if (!form) return false;
  const fields = Array.from(form.elements).filter(field => field.willValidate);
  fields.forEach(field => {
    if (field.validity.valueMissing) showFieldError(field);
    else if (field.validity.valid) clearFieldError(field);
  });
  const missingFields = fields.filter(field => field.validity.valueMissing);
  if (missingFields.length) {
    missingFields[0].focus({ preventScroll: true });
    missingFields[0].scrollIntoView?.({ behavior: "smooth", block: "center" });
    return false;
  }
  const invalidField = fields.find(field => !field.validity.valid);
  if (!invalidField) return true;
  showAppAlert(message, "بررسی اطلاعات", invalidField);
  return false;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

function showNumber(value, digits = 2) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "0";
  return roundTo(Number(value), digits).toFixed(digits).replace(/\.?0+$/, "");
}

function formatPipeSize(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "-") return "-";
  const match = raw.match(/([\d.]+)\s*(mm|MM|Mm|م\.م|میلیمتر|میلیمتر)?/i);
  if (match) return `${match[1]} mm`;
  return raw;
}

function numericOrDash(value, digits = 2) {
  if (value === null || value === undefined || value === "" || value === "-") return "-";
  return Number.isFinite(Number(value)) ? `${showNumber(value, digits)}` : "-";
}

function fittingHeadValue(item) {
  const z = Number(item?.z_height);
  const loss = Number(item?.loss);
  if (Number.isFinite(z) && Number.isFinite(loss)) return z + loss;
  if (Number.isFinite(loss)) return loss;
  return null;
}

function renderResultCableMiniSvg(bundleCount = cableBundleCount(), size = state.selectedCable ?? "---") {
  const sizeText = size && size !== '---' && size !== 'یافت نشد' ? `${size} mm²` : '---';
  if (bundleCount === 2) {
    return `
      <svg viewBox="0 0 220 132" class="result-cable-mini-svg" role="img" aria-label="دو کابل تخت ۳ رشته">
        <g transform="translate(110 49)">
          <rect x="-54" y="-18" width="108" height="36" rx="12" fill="#243746" stroke="#15242d" stroke-width="2.5"/>
          <rect x="-40" y="-10" width="22" height="22" rx="11" fill="#8d4c36" stroke="#fff" stroke-width="1.5"/>
          <rect x="-11" y="-10" width="22" height="22" rx="11" fill="#2d3945" stroke="#fff" stroke-width="1.5"/>
          <rect x="18" y="-10" width="22" height="22" rx="11" fill="#8a949c" stroke="#fff" stroke-width="1.5"/>
          <rect x="-38" y="-42" width="76" height="18" rx="9" fill="#eff6ff" stroke="#bfd6ef"/>
          <text x="0" y="-29" text-anchor="middle" font-size="10.5" font-weight="800" fill="#1c4e80" direction="ltr" unicode-bidi="bidi-override">${sizeText}</text>
        </g>
        <g transform="translate(110 88)">
          <rect x="-54" y="-18" width="108" height="36" rx="12" fill="#243746" stroke="#15242d" stroke-width="2.5"/>
          <rect x="-40" y="-10" width="22" height="22" rx="11" fill="#8d4c36" stroke="#fff" stroke-width="1.5"/>
          <rect x="-11" y="-10" width="22" height="22" rx="11" fill="#2d3945" stroke="#fff" stroke-width="1.5"/>
          <rect x="18" y="-10" width="22" height="22" rx="11" fill="#8a949c" stroke="#fff" stroke-width="1.5"/>
        </g>
      </svg>`;
  }
  return `
    <svg viewBox="0 0 220 120" class="result-cable-mini-svg" role="img" aria-label="یک کابل تخت ۳ رشته">
      <g transform="translate(110 62)">
        <rect x="-60" y="-20" width="120" height="40" rx="13" fill="#243746" stroke="#15242d" stroke-width="2.5"/>
        <rect x="-44" y="-11" width="24" height="24" rx="12" fill="#8d4c36" stroke="#fff" stroke-width="1.5"/>
        <rect x="-12" y="-11" width="24" height="24" rx="12" fill="#2d3945" stroke="#fff" stroke-width="1.5"/>
        <rect x="20" y="-11" width="24" height="24" rx="12" fill="#8a949c" stroke="#fff" stroke-width="1.5"/>
        <rect x="-42" y="-48" width="84" height="20" rx="10" fill="#eff6ff" stroke="#bfd6ef"/>
        <text x="0" y="-34" text-anchor="middle" font-size="11" font-weight="800" fill="#1c4e80" direction="ltr" unicode-bidi="bidi-override">${sizeText}</text>
      </g>
    </svg>`;
}

function renderResultWellSvg() {
  const staticLevel = Number(state.static_level) || 0;
  const dynamicLevel = Number(state.dynamic_level) || 0;
  const installDepth = Number(state.install_depth) || 0;
  const maxDepth = Math.max(staticLevel, dynamicLevel, installDepth, 10) * 1.5;
  const pxPerMeter = 430 / maxDepth;
  const staticY = Math.max(66, Math.min(486, 60 + staticLevel * pxPerMeter));
  const dynamicY = Math.max(66, Math.min(486, 60 + dynamicLevel * pxPerMeter));
  const pumpY = Math.max(125, Math.min(360, 60 + installDepth * pxPerMeter));
  const waterTop = Math.max(60, Math.min(500, dynamicY));
  const paleZoneHeight = Math.max(0, dynamicY - staticY);
  return `
    <svg viewBox="0 0 440 540" class="result-well-svg" role="img" aria-label="شماتیک چاه، سطوح استاتیک و دینامیک، پمپ شناور و لوله خروجی">
      <defs>
        <linearGradient id="rGround" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d7ccc8"/><stop offset="1" stop-color="#a1887f"/></linearGradient>
        <linearGradient id="rWater" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#78d3f2" stop-opacity=".58"/><stop offset="1" stop-color="#0383bf" stop-opacity=".82"/></linearGradient>
        <linearGradient id="rSteel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8899a4"/><stop offset=".5" stop-color="#edf2f4"/><stop offset="1" stop-color="#70818a"/></linearGradient>
      </defs>
      <rect x="0" y="60" width="440" height="480" fill="url(#rGround)" opacity=".8"/>
      <line x1="0" y1="60" x2="440" y2="60" stroke="#675240" stroke-width="5"/>

      <!-- Open well casing; the discharge pipe exits above the ground through an elbow. -->
      <rect x="150" y="60" width="72" height="465" fill="#263238"/>
      <line x1="150" y1="60" x2="150" y2="525" stroke="#aebbc1" stroke-width="7"/>
      <line x1="222" y1="60" x2="222" y2="525" stroke="#aebbc1" stroke-width="7"/>
      <line x1="150" y1="525" x2="222" y2="525" stroke="#7d8e96" stroke-width="5"/>
      <rect x="157" y="${staticY}" width="58" height="${paleZoneHeight}" fill="#dff2ff" opacity=".95"/>
      <rect x="157" y="${waterTop}" width="58" height="${Math.max(0,520-waterTop)}" fill="url(#rWater)"/>
      <path d="M157 ${waterTop+7} Q171 ${waterTop} 186 ${waterTop+7} T215 ${waterTop+7}" fill="none" stroke="#e7faff" stroke-width="2" opacity=".85"/>

      <!-- Riser to an elbow above ground, then horizontal discharge pipe to the right. -->
      <path d="M186 ${pumpY+8} V48 Q186 40 194 40 H438" fill="none" stroke="#566a75" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M186 ${pumpY+8} V48 Q186 40 194 40 H438" fill="none" stroke="url(#rSteel)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M194 34 H438" fill="none" stroke="#f7fafb" stroke-width="2" opacity=".65"/>

      <g transform="translate(0 ${pumpY})">
        <path d="M171 0 L201 0 L196 12 L176 12 Z" fill="#546e7a" stroke="#37474f" stroke-width="1"/>
        <rect x="171" y="12" width="30" height="46" rx="2" fill="url(#rSteel)" stroke="#455a64"/>
        <line x1="171" y1="22" x2="201" y2="22" stroke="#90a4ae" stroke-width="1"/>
        <line x1="171" y1="32" x2="201" y2="32" stroke="#90a4ae" stroke-width="1"/>
        <line x1="171" y1="42" x2="201" y2="42" stroke="#90a4ae" stroke-width="1"/>
        <rect x="174" y="58" width="24" height="18" fill="#263238"/>
        <path d="M174 62 H198 M174 66 H198 M174 70 H198 M174 74 H198" stroke="#90a4ae" stroke-width="1"/>
        <rect x="171" y="76" width="30" height="58" rx="3" fill="#37474f" stroke="#263238"/>
        <path d="M171 88 H201 M171 100 H201 M171 112 H201" stroke="#90a4ae" stroke-width="1.2"/>
      </g>

      <!-- Compact white labels: centered text, no arrowheads, and clear spacing from the well. -->
      <g transform="translate(0 ${staticY})">
        <line x1="0" y1="0" x2="145" y2="0" stroke="#0d6efd" stroke-width="2.2" stroke-dasharray="6 4"/>
        <rect x="18" y="-13" width="108" height="26" rx="6" fill="#fff" stroke="#dbe6ef" stroke-width=".8" opacity=".96"/>
        <text x="72" y="5" text-anchor="middle" font-size="13" font-weight="800" fill="#0d6efd">Hs : ${showNumber(staticLevel,1)} m</text>
      </g>
      <g transform="translate(0 ${dynamicY})">
        <line x1="227" y1="0" x2="440" y2="0" stroke="#dc3545" stroke-width="2.2" stroke-dasharray="6 4"/>
        <rect x="254" y="-13" width="112" height="26" rx="6" fill="#fff" stroke="#dbe6ef" stroke-width=".8" opacity=".96"/>
        <text x="310" y="5" text-anchor="middle" font-size="13" font-weight="800" fill="#dc3545">Hd : ${showNumber(dynamicLevel,1)} m</text>
      </g>
      <g transform="translate(0 ${pumpY+55})">
        <line x1="227" y1="0" x2="440" y2="0" stroke="#455a64" stroke-width="2.2" stroke-dasharray="6 4"/>
        <rect x="254" y="-13" width="112" height="26" rx="6" fill="#fff" stroke="#dbe6ef" stroke-width=".8" opacity=".96"/>
        <text x="310" y="5" text-anchor="middle" font-size="13" font-weight="800" fill="#455a64">Hi : ${showNumber(installDepth,1)} m</text>
      </g>
    </svg>`;
}

function setPage(page, updateHash = true) {
  if (!allowedPages.has(page)) page = "welcome";
  state.page = page;
  saveState();
  if (updateHash && location.hash !== `#${page}`) {
    location.hash = page;
  } else {
    render();
  }
}


function showMatchLoading(nextPage = "match") {
  const overlay = $("match-loading-overlay");
  if (!overlay) {
    setPage(nextPage);
    return;
  }
  overlay.hidden = false;
  document.body.classList.add("match-loading-open");
  window.setTimeout(() => {
    overlay.hidden = true;
    document.body.classList.remove("match-loading-open");
    setPage(nextPage);
  }, 1500);
}

function clearFlowState(mode = null) {
  state = defaultState();
  state.mode = mode;
  if (mode === "simple") state.totalPipeHead = 0;
  saveState();
}

function selectMethod(type) {
  const overlay = $("transition-overlay");
  if (overlay) overlay.classList.add("active");
  clearFlowState(type === "advanced" ? "advanced" : "simple");
  window.setTimeout(() => {
    if (overlay) overlay.classList.remove("active");
    setPage(type === "advanced" ? "step1" : "simple");
  }, 900);
}

function goHome() {
  closeHomeConfirm();
  clearFlowState(null);
  setPage("welcome");
}

function isDesignInProgress() {
  const workflowPages = new Set(["simple", "step1", "step2", "design", "match", "cable", "result"]);
  // The guide may be opened from an active workflow; do not silently discard that workflow.
  return workflowPages.has(state.page) || (state.page === "guide" && Boolean(state.mode));
}

function requestHome() {
  // On the welcome screen the brand is already pointing to the current page.
  if (state.page === "welcome") return;
  if (!isDesignInProgress()) {
    goHome();
    return;
  }
  const modal = $("home-confirm-modal");
  if (!modal) {
    if (window.confirm("با بازگشت به صفحه اصلی، اطلاعات طراحی فعلی پاک می‌شود. ادامه می‌دهید؟")) goHome();
    return;
  }
  modal.hidden = false;
  document.body.classList.add("home-confirm-open");
  window.requestAnimationFrame(() => $("home-confirm-cancel")?.focus());
}

function closeHomeConfirm() {
  const modal = $("home-confirm-modal");
  if (modal) modal.hidden = true;
  document.body.classList.remove("home-confirm-open");
  $("brand-home-link")?.focus?.();
}

function cancelHomeRequest() {
  closeHomeConfirm();
}

function confirmHomeRequest() {
  goHome();
}

function startOver() {
  const modal = $("restart-confirm-modal");
  if (!modal) {
    if (window.confirm("با شروع مجدد، اطلاعات و انتخاب‌های فعلی پاک می‌شوند و به صفحه خوش‌آمدگویی برمی‌گردید. ادامه می‌دهید؟")) {
      goHome();
    }
    return;
  }
  modal.hidden = false;
  document.body.classList.add("home-confirm-open");
  window.requestAnimationFrame(() => $("restart-confirm-cancel")?.focus());
}

function closeStartOverConfirm() {
  const modal = $("restart-confirm-modal");
  if (modal) modal.hidden = true;
  document.body.classList.remove("home-confirm-open");
}

function cancelStartOver() {
  closeStartOverConfirm();
  $("result-start-over-button")?.focus?.();
}

function confirmStartOver() {
  closeStartOverConfirm();
  goHome();
}

function loadExternalData() {
  return Promise.all([
    fetch("./data/pipes.json").then(r => {
      if (!r.ok) throw new Error("pipes.json");
      return r.json();
    }),
    fetch("./data/pumps.json").then(r => {
      if (!r.ok) throw new Error("pumps.json");
      return r.json();
    })
  ]).then(([pipes, pumps]) => {
    pipeRecords = pipes.records || [];
    pumpRecords = pumps.records || [];
    dataReady = true;
    render();
  }).catch(err => {
    console.error(err);
    dataError = "فایل‌های اطلاعاتی برنامه بارگذاری نشدند. پوشه data باید در کنار index.html قرار داشته باشد و برنامه از طریق Start-Offline.bat یا یک وب‌سرور اجرا شود.";
    render();
  });
}

function setPageStyles(page) {
  const pageStyles = new Set(["simple", "step1", "step2", "design", "match", "cable"]);
  let link = $("page-style");
  if (!pageStyles.has(page)) {
    if (link) link.remove();
  } else {
    const href = `./assets/css/pages/${page}.css`;
    if (!link) {
      link = document.createElement("link");
      link.id = "page-style";
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    if (link.getAttribute("href") !== href) link.setAttribute("href", href);
  }

  // Keep the shared responsive shell rules after every dynamically loaded page stylesheet.
  const shellStyle = $("shell-style");
  if (shellStyle) document.head.appendChild(shellStyle);
}

let matchChartObserver = null;

function render() {
  matchChartObserver?.disconnect();
  matchChartObserver = null;
  const host = $("app-main");
  if (!host) return;
  host.onclick = null;

  if (!dataReady && !dataError) {
    host.innerHTML = `<div class="content-box"><div class="spinner-border text-primary" role="status"></div><p class="mt-3 mb-0">در حال بارگذاری اطلاعات پمپ‌ها و لوله‌ها...</p></div>`;
    return;
  }
  if (dataError) {
    host.innerHTML = `<div class="content-box text-center"><h3 class="text-danger">خطا در بارگذاری اطلاعات</h3><p>${esc(dataError)}</p><button class="btn btn-primary" onclick="location.reload()">تلاش مجدد</button></div>`;
    return;
  }

  const page = allowedPages.has(state.page) ? state.page : "welcome";
  document.body.dataset.page = page;
  const topBar = $("top-bar");
  if (topBar) topBar.hidden = page === "welcome";
  const splash = $("splash");
  if (splash && page !== "welcome") splash.classList.add("hidden");
  setPageStyles(page);

  switch (page) {
    case "welcome": host.innerHTML = renderWelcome(); break;
    case "guide": host.innerHTML = renderGuide(); break;
    case "simple": host.innerHTML = renderSimple(); updateSimpleFlow(); break;
    case "step1": host.innerHTML = renderStep1(); drawWell(); break;
    case "step2": host.innerHTML = renderStep2(); updateAllPipeRows(); break;
    case "design": host.innerHTML = renderDesign(); break;
    case "match": renderMatch(); break;
    case "cable": host.innerHTML = renderCable(); break;
    case "result":
      host.innerHTML = renderResult();
      $("print-report").innerHTML = renderPrintReport();
      break;
    default: host.innerHTML = renderWelcome();
  }
  saveState();
}

function renderWelcome() {
  return `
    <div class="content-box">
      <div class="center-content">
        <h1>روش طراحی را انتخاب کنید</h1>
        <p class="subtitle">برای شروع یکی از دو روش زیر را انتخاب نمایید:</p>
        <div class="row justify-content-center g-2 g-md-4 mt-1 welcome-options-row">
          <div class="col-6 col-md-5">
            <div class="card h-100 shadow-sm option-card" onclick="App.selectMethod('advanced')">
              <div class="card-body p-4 d-flex flex-column">
                <div class="icon-box text-primary"><i class="bi bi-gear-wide-connected"></i></div>
                <h3 class="fw-bold text-primary">طراحی پیشرفته</h3>
                <p class="text-muted mt-2 mb-3 small" style="line-height:1.5;">محاسبه دقیق با جزئیات خط لوله و افت فشار.</p>
                <button class="btn btn-outline-primary w-100 rounded-pill mt-auto" type="button">شروع پیشرفته</button>
              </div>
            </div>
          </div>
          <div class="col-6 col-md-5">
            <div class="card h-100 shadow-sm option-card" onclick="App.selectMethod('simple')">
              <div class="card-body p-4 d-flex flex-column">
                <div class="icon-box text-success"><i class="bi bi-lightning-charge-fill"></i></div>
                <h3 class="fw-bold text-success">طراحی ساده</h3>
                <p class="text-muted mt-2 mb-3 small" style="line-height:1.5;">ورود مستقیم دبی (Q) و هد (H).</p>
                <button class="btn btn-outline-success w-100 rounded-pill mt-auto" type="button">شروع ساده</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function renderGuide() {
  return `
    <div class="container py-5">
      <div class="guide-card bg-white p-5 rounded-4 shadow-sm mx-auto">
        <h2 class="fw-bold text-center mb-5" style="color:#1c4e80;">راهنمای گام‌به‌گام انتخاب پمپ</h2>
        <div class="row align-items-center mb-5">
          <div class="col-md-2 text-center"><div class="display-4 text-primary fw-bold">1</div></div>
          <div class="col-md-10">
            <h4 class="fw-bold">مشخصات چاه</h4>
            <p class="text-muted">ابتدا اطلاعات پایه چاه خود شامل <strong>عمق نصب الکتروپمپ</strong> (فاصله دهانه تا پمپ)، <strong>قطر دهانه</strong> و میزان <strong>دبی (آبدهی)</strong> مورد نیاز خود را وارد کنید. این اطلاعات پایه محاسبات است.</p>
          </div>
        </div>
        <div class="row align-items-center mb-5">
          <div class="col-md-2 text-center"><div class="display-4 text-primary fw-bold">2</div></div>
          <div class="col-md-10">
            <h4 class="fw-bold">طراحی خط لوله</h4>
            <p class="text-muted">در این مرحله مسیر لوله‌کشی را تعریف می‌کنید.<br><span class="badge bg-info text-dark mt-2">نکته مهم</span> ردیف اول، همیشه مربوط به <strong>لوله داخل چاه</strong> است. اگر بعد از خروج از چاه، لوله روی زمین ادامه داشت، با دکمه «افزودن لوله سطح» مسیرهای جدید را اضافه کنید. نرم‌افزار، افت فشار ناشی از اصطکاک را محاسبه می‌کند.</p>
          </div>
        </div>
        <div class="row align-items-center mb-5">
          <div class="col-md-2 text-center"><div class="display-4 text-primary fw-bold">3</div></div>
          <div class="col-md-10">
            <h4 class="fw-bold">مشخصات کابل</h4>
            <p class="text-muted">اطلاعات کابل‌کشی را وارد کنید. انتخاب سطح مقطع صحیح برای جلوگیری از افت ولتاژ و سلامت الکتروموتور ضروری است.</p>
          </div>
        </div>
        <div class="row align-items-center mb-5">
          <div class="col-md-2 text-center"><div class="display-4 text-success fw-bold">4</div></div>
          <div class="col-md-10">
            <h4 class="fw-bold">انتخاب هوشمند</h4>
            <p class="text-muted">سیستم هوشمند انتخاب الکتروپمپ با بررسی ورودی‌های کاربر، از میان مدل‌های موجود شروع به پیشنهاد بهترین الکتروپمپ از نظر راندمان و کارایی میکند.</p>
          </div>
        </div>
        <div class="text-center mt-5"><button class="btn btn-primary btn-lg px-5" onclick="App.goHome()">شروع طراحی</button></div>
      </div>
    </div>`;
}

function renderSimple() {
  return `
    <div class="container py-4 mobile-scroll-fix">
      <div class="input-card shadow-lg">
        <div class="card-header text-center">
          <h3 class="fw-bold mb-0">طراحی سریع </h3>
          <p class="text-muted small mt-2">مقادیر مورد نظر را مستقیماً وارد نمایید</p>
        </div>
        <div class="card-body p-4">
          <form id="simple-form" novalidate onsubmit="App.submitSimple(event)">
            <div class="mb-4">
              <label class="form-label fw-bold">دبی مورد نیاز </label>
              <div class="input-group simple-numeric-group">
                <select id="flow_unit" class="form-select bg-light fw-bold simple-unit" onchange="App.updateSimpleFlow()">
                  <option value="m3h" ${state.simpleFlowUnit === "m3h" ? "selected" : ""}>m³/h</option><option value="ls" ${state.simpleFlowUnit === "ls" ? "selected" : ""}>L/s</option>
                </select>
                <input type="number" step="any" id="display_flow" min="0" inputmode="decimal" class="form-control simple-number" placeholder="0" value="${esc(state.simpleFlowInput)}" required oninput="App.updateSimpleFlow()">
              </div>
              <input type="hidden" name="flow" id="final_flow">
              <div class="form-text text-end">واحد را انتخاب کرده و مقدار دبی را وارد کنید.</div>
            </div>
            <div class="mb-4">
              <label class="form-label fw-bold">هد کل مورد نیاز </label>
              <div class="input-group simple-numeric-group">
                <span class="input-group-text unit-label simple-unit">m</span>
                <input type="number" step="any" name="head" id="simple-head" min="0" inputmode="decimal" class="form-control simple-number" placeholder="0" value="${esc(state.simpleHeadInput)}" required oninput="App.updateSimpleHead(this.value)">
              </div>
              <div class="form-text text-end">مجموع ارتفاع عمودی و افت اصطکاک مسیر</div>
            </div>
            <div class="alert alert-warning py-2 mb-4" style="font-size:.85rem;">
              <i class="bi bi-exclamation-triangle-fill me-2"></i>
              در این حالت، محاسبات افت لوله‌ها انجام نمی‌شود و هد وارد شده ملاک انتخاب پمپ است.
            </div>
            <div class="d-grid gap-2">
              <button type="submit" class="btn btn-success btn-lg py-3 fw-bold">تأیید و جستجوی پمپ <i class="bi bi-search ms-2"></i></button>
              <button type="button" class="btn btn-link text-secondary" onclick="App.goHome()">بازگشت به صفحه اصلی</button>
            </div>
            <div id="flow-error" class="text-danger fw-bold mt-3" style="display:none;font-size:.85rem;">
              <i class="bi bi-exclamation-circle-fill"></i> حداکثر دبی مجاز 800 مترمکعب بر ساعت می‌باشد.
            </div>
          </form>
        </div>
      </div>
    </div>`;
}

function renderStep1() {
  const flow = state.flow ?? "";
  const stat = state.static_level ?? "";
  const dyn = state.dynamic_level ?? "";
  const install = state.install_depth ?? "";
  const dia = state.diameter_inch ?? "";
  return `
    <div class="content-wrapper">
      <div class="form-section">
        <h3 class="text-center mb-4" style="color:#1c4e80;">ورود اطلاعات چاه</h3>
        <form id="step1-form" novalidate onsubmit="App.submitStep1(event)">
          <div class="mb-3">
            <label>دبی مورد نیاز <span class="var-symbol">(Q<sub>r</sub>)</span></label>
            <div class="input-group">
              <select class="form-select bg-light fw-bold" id="step1-flow-unit" style="max-width:90px;color:#555;">
                <option value="m3h">m³/h</option><option value="lit_sec">Lit/s</option>
              </select>
              <input type="number" class="form-control" id="step1-flow" min="0" step="any" inputmode="decimal" required value="${esc(flow)}">
            </div>
          </div>
          <div class="row g-2 mb-3">
            <div class="col-6">
              <label>سطح استاتیک <span class="var-symbol">(H<sub>s</sub>)</span></label>
              <div class="input-group"><span class="input-group-text unit-label">m</span>
                <input type="number" min="0" step="any" class="form-control" id="static_level" required value="${esc(stat)}" oninput="App.drawWell()">
              </div>
            </div>
            <div class="col-6">
              <label>سطح دینامیک <span class="var-symbol">(H<sub>d</sub>)</span></label>
              <div class="input-group"><span class="input-group-text unit-label">m</span>
                <input type="number" min="0" step="any" class="form-control" id="dynamic_level" required value="${esc(dyn)}" oninput="App.drawWell()">
              </div>
            </div>
          </div>
          <div class="mb-3">
            <label>عمق نصب پمپ <span class="var-symbol">(D<sub>i</sub>)</span></label>
            <div class="input-group"><span class="input-group-text unit-label">m</span>
              <input type="number" min="0" step="any" class="form-control" id="install_depth" required value="${esc(install)}" oninput="App.drawWell()">
            </div>
            <div class="form-text text-muted small">محل قرارگیری پمپ نسبت به دهانه چاه</div>
          </div>
          <div class="mb-3">
            <label>قطر دهانه چاه <span class="var-symbol">(D<sub>well</sub>)</span></label>
            <div class="input-group">
              <span class="input-group-text bg-light fw-bold" style="min-width:70px;color:#333;">Inch</span>
              <input type="hidden" id="diameter_unit" value="inch">
              <input type="number" min="0" step="any" class="form-control" id="diameter" inputmode="decimal" required value="${esc(dia)}" oninput="App.drawWell()">
            </div>
          </div>
          <button type="submit" class="btn btn-primary btn-next">تأیید و ادامه</button>
        </form>
      </div>
      <div class="diagram-box">
        ${wellDiagramSvg()}
      </div>
    </div>`;
}

function wellDiagramSvg() {
  return `
    <svg viewBox="0 0 300 600" id="well-diagram" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="groundGrad" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#d7ccc8;stop-opacity:1"/><stop offset="100%" style="stop-color:#a1887f;stop-opacity:1"/></linearGradient>
        <linearGradient id="waterGrad" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#4fc3f7;stop-opacity:.62"/><stop offset="100%" style="stop-color:#0288d1;stop-opacity:.82"/></linearGradient>
        <linearGradient id="steelGrad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" style="stop-color:#cfd8dc;stop-opacity:1"/><stop offset="20%" style="stop-color:#eceff1;stop-opacity:1"/><stop offset="50%" style="stop-color:#b0bec5;stop-opacity:1"/><stop offset="100%" style="stop-color:#78909c;stop-opacity:1"/></linearGradient>
        <linearGradient id="casingGrad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" style="stop-color:#666;stop-opacity:1"/><stop offset="10%" style="stop-color:#eee;stop-opacity:1"/><stop offset="90%" style="stop-color:#eee;stop-opacity:1"/><stop offset="100%" style="stop-color:#666;stop-opacity:1"/></linearGradient>
        <linearGradient id="drawdownGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bde9ff" stop-opacity=".45"/><stop offset="1" stop-color="#5fc6f5" stop-opacity=".18"/></linearGradient>
      </defs>
      <rect x="0" y="50" width="300" height="550" fill="url(#groundGrad)"/><line x1="0" y1="50" x2="300" y2="50" stroke="#5d4037" stroke-width="6"/>
      <rect id="svg-casing" x="100" y="50" width="100" height="550" fill="url(#casingGrad)" stroke="#555" stroke-width="1"/>
      <rect id="svg-void" x="105" y="50" width="90" height="550" fill="#263238"/>
      <rect id="svg-drawdown" x="105" y="120" width="90" height="80" fill="#dff2ff" opacity=".95"/>
      <rect id="svg-water" x="105" y="200" width="90" height="400" fill="url(#waterGrad)"/>
      <g id="svg-pump-group" transform="translate(0,50)">
        <rect id="svg-pipe" x="145" y="-600" width="10" height="600" fill="url(#steelGrad)" stroke="#455a64" stroke-width="1"/>
        <line x1="156" y1="-600" x2="156" y2="10" stroke="#212121" stroke-width="2"/>
        <g id="svg-pump-body">
          <path d="M140,0 L160,0 L155,15 L145,15 Z" fill="#546e7a"/>
          <rect x="135" y="15" width="30" height="50" rx="2" fill="url(#steelGrad)" stroke="#455a64"/>
          <line x1="135" y1="25" x2="165" y2="25" stroke="#90a4ae" stroke-width="1"/>
          <line x1="135" y1="35" x2="165" y2="35" stroke="#90a4ae" stroke-width="1"/>
          <line x1="135" y1="45" x2="165" y2="45" stroke="#90a4ae" stroke-width="1"/>
          <rect x="138" y="65" width="24" height="20" fill="#263238"/>
          <path d="M138,68 L162,68 M138,72 L162,72 M138,76 L162,76 M138,80 L162,80" stroke="#78909c" stroke-width="1"/>
          <rect x="135" y="85" width="30" height="60" rx="3" fill="#37474f" stroke="#263238"/>
          <text x="182" y="50" class="svg-label" fill="#455a64">Pump</text>
        </g>
      </g>
      <rect id="svg-cap" x="90" y="40" width="120" height="10" rx="2" fill="#5d4037"/>
      <rect x="140" y="30" width="20" height="20" fill="#78909c"/>
      <g id="svg-static-group">
        <line x1="0" y1="0" x2="300" y2="0" stroke="#0d6efd" class="level-line"/>
        <text x="72" y="-8" class="svg-label level-text" fill="#0d6efd" text-anchor="middle">سطح استاتیک</text>
        <polygon points="120,0 115,-6 125,-6" fill="#0d6efd"/>
      </g>
      <g id="svg-dynamic-group">
        <line x1="0" y1="0" x2="300" y2="0" stroke="#dc3545" class="level-line"/>
        <text x="228" y="-8" class="svg-label level-text" fill="#dc3545" text-anchor="middle">سطح دینامیک</text>
        <polygon points="180,0 175,-6 185,-6" fill="#dc3545"/>
      </g>
    </svg>`;
}

function drawWell() {
  if (!$("static_level")) return;
  const staticM = parseFloat($("static_level").value) || 0;
  const dynamicM = parseFloat($("dynamic_level").value) || 0;
  const installM = parseFloat($("install_depth").value) || 0;
  let maxDepthM = Math.max(installM, dynamicM, staticM);
  if (maxDepthM < 20) maxDepthM = 50;
  maxDepthM *= 1.3;
  const pxPerMeter = 530 / maxDepthM;
  const staticY = 50 + staticM * pxPerMeter;
  const dynamicY = 50 + dynamicM * pxPerMeter;
  const pumpY = 50 + installM * pxPerMeter;

  $("svg-pump-group")?.setAttribute("transform", `translate(0, ${pumpY})`);
  const water = $("svg-water");
  if (water) {
    water.setAttribute("y", dynamicY);
    let waterH = 600 - dynamicY;
    if (waterH < 0) waterH = 0;
    water.setAttribute("height", waterH);
  }
  $("svg-static-group")?.setAttribute("transform", `translate(0, ${staticY})`);
  $("svg-dynamic-group")?.setAttribute("transform", `translate(0, ${dynamicY})`);

  const diameterInput = parseFloat($("diameter")?.value) || 0;
  // Display-only scale: zero is shown just under 1 inch; the visual range now grows gently to 12 inches.
  // This changes only the casing illustration, never the pump-selection calculations.
  const visualDiameter = diameterInput <= 0 ? 0.85 : Math.min(12, Math.max(1, diameterInput));
  const visualWidth = 60 + ((visualDiameter - 1) / 11) * 140;
  const newX = 150 - visualWidth / 2;
  $("svg-casing")?.setAttribute("x", newX);
  $("svg-casing")?.setAttribute("width", visualWidth);
  $("svg-void")?.setAttribute("x", newX + 5);
  $("svg-void")?.setAttribute("width", visualWidth - 10);
  $("svg-water")?.setAttribute("x", newX + 5);
  $("svg-water")?.setAttribute("width", visualWidth - 10);
  $("svg-cap")?.setAttribute("x", newX - 10);
  $("svg-cap")?.setAttribute("width", visualWidth + 20);
  const drawdown = $("svg-drawdown");
  if (drawdown) {
    drawdown.setAttribute("x", newX + 5);
    drawdown.setAttribute("width", Math.max(0, visualWidth - 10));
    drawdown.setAttribute("y", staticY);
    drawdown.setAttribute("height", Math.max(0, dynamicY - staticY));
  }
}

function renderStep2() {
  if (!Array.isArray(state.segments) || state.segments.length === 0) {
    state.segments = [{
      uid: 1, materialId: "", length: toFloat(state.install_depth), height: toFloat(state.install_depth), isWell: true
    }];
    state.nextPipeUid = Math.max(2, toFloat(state.nextPipeUid));
  }
  const materials = [...new Set(pipeRecords.map(p => p.material_group))];
  return `
    <form id="pipeForm" class="form-section" novalidate onsubmit="return false;">
      <input type="hidden" name="total_other_head" id="hidden_other_head" value="0">
      <div class="form-box">
        <h3><i class="bi bi-gear-wide-connected me-2"></i> طراحی مسیر لوله‌کشی</h3>
        <div class="alert alert-light border py-2 mb-3 d-flex justify-content-between align-items-center">
          <span class="base-flow-label"><i class="bi bi-info-circle-fill text-primary me-1"></i> دبی مبنا: <bdi class="base-flow-value" dir="ltr"><strong>${showNumber(state.flow, 3)}</strong> m³/h</bdi></span>
        </div>
        <div class="pipe-table-scroll">
          <div class="pipe-row-header">
            <span>#</span><span>جنس لوله</span><span>سایز</span><span>طول (m)</span><span>ارتفاع (m)</span><span>سرعت (m/s)</span><span>افت هد (m)</span><span></span>
          </div>
          <div id="pipes-container">
            ${state.segments.map((seg, index) => renderPipeRow(seg, index, materials)).join("")}
          </div>
        </div>
        <div class="mt-3"><button type="button" class="btn-add" onclick="App.addPipeRow()"><i class="bi bi-plus-lg"></i> افزودن لوله سطح</button></div>
      </div>
      <button type="button" class="btn-next" onclick="App.openOtherLossModal()">تأیید و ادامه <i class="bi bi-arrow-left ms-2"></i></button>
    </form>
    <div id="otherHeadModal" class="custom-modal">
      <div class="modal-content">
        <h4 class="fw-bold text-primary mb-2">سایر افت‌های هد</h4>
        <p class="text-muted small mb-3">مجموع افت هد مربوط به اتصالات و تغییرات مسیر جریان را وارد کنید.</p>
        <div class="other-loss-illustration" role="img" aria-label="شماتیک زانویی، شیر و تبدیل در مسیر لوله که موجب افت موضعی می‌شوند">
          <div class="other-loss-illustration-title">نمونه عوامل ایجاد افت موضعی</div>
          <svg viewBox="0 0 620 158" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
              <marker id="otherLossArrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="#1686c7"/></marker>
              <linearGradient id="otherPipeGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d8e7f2"/><stop offset=".5" stop-color="#8eafc7"/><stop offset="1" stop-color="#d8e7f2"/></linearGradient>
            </defs>
            <path d="M24 68 H152 Q174 68 174 46 V44 Q174 26 194 26 H590" fill="none" stroke="url(#otherPipeGrad)" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M24 68 H152 Q174 68 174 46 V44 Q174 26 194 26 H590" fill="none" stroke="#557b98" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M42 68 H105 M250 26 H300 M420 26 H455 M525 26 H580" fill="none" stroke="#1686c7" stroke-width="3" marker-end="url(#otherLossArrow)"/>
            <circle cx="174" cy="46" r="5" fill="#f59e0b" stroke="#fff" stroke-width="2"/>
            <path d="M338 12 L362 26 L338 40 Z M386 12 L362 26 L386 40 Z" fill="#f0b44c" stroke="#9b6b16" stroke-width="2"/>
            <path d="M362 12 V5 M348 5 H376" stroke="#9b6b16" stroke-width="3" stroke-linecap="round"/>
            <path d="M474 17 L492 17 L510 26 L528 26" fill="none" stroke="#557b98" stroke-width="2"/>
            <path d="M474 35 L492 35 L510 26 L528 26" fill="none" stroke="#557b98" stroke-width="2"/>
            <g font-family="Vazirmatn, sans-serif" font-size="15" font-weight="700" fill="#254b68" text-anchor="middle">
              <text x="174" y="102">زانو</text><text x="362" y="102">شیر</text><text x="505" y="102">تغییر قطر</text>
            </g>
            <g stroke="#9db4c5" stroke-width="1.5" stroke-dasharray="3 3"><path d="M174 74 V90"/><path d="M362 42 V90"/><path d="M505 42 V90"/></g>
            <text x="310" y="143" font-family="Vazirmatn, sans-serif" font-size="12" fill="#647b8c" text-anchor="middle">تغییر جهت، باز و بسته‌شدن شیر و تغییر سطح مقطع، انرژی جریان را کاهش می‌دهد.</text>
          </svg>
        </div>
        <div class="form-group mb-3">
          <div class="input-group" dir="ltr"><span class="input-group-text">m</span><input type="number" id="modal_input_head" class="form-control text-center" value="" placeholder="0" min="0" step="0.1" onfocus="App.selectAllValue(this)" onclick="App.selectAllValue(this)"></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeOtherLossModal()">بازگشت</button>
          <button type="button" class="btn btn-success" onclick="App.confirmPipeAndContinue()">ثبت و ادامه</button>
        </div>
      </div>
    </div>`;
}

function renderPipeRow(seg, index, materials) {
  const selectedPipe = pipeRecords.find(p => String(p.index) === String(seg.materialId));
  const selectedGroup = selectedPipe?.material_group ?? seg.materialGroup ?? "";
  const materialOptions = materials.map(m => `<option value="${esc(m)}" ${m === selectedGroup ? "selected" : ""}>${esc(m)}</option>`).join("");
  const sizeOptions = pipeRecords.filter(p => p.material_group === selectedGroup).map(p =>
    `<option value="${p.index}" ${String(p.index) === String(seg.materialId) ? "selected" : ""}>${esc(p.size_label)}</option>`
  ).join("");
  const preview = selectedPipe ? calculatePipePreview(state.flow, selectedPipe.inner_d, selectedPipe.C, seg.length, seg.height) : null;
  const velocity = preview?.velocity === null || !preview ? "-" : showNumber(preview.velocity, 2);
  const loss = preview?.displayedLoss === null || !preview ? "-" : showNumber(preview.displayedLoss, 2);

  const lengthControl = seg.isWell
    ? `<div class="pipe-well-length"><input type="text" class="form-control bg-light" value="لوله داخل چاه" readonly tabindex="-1" style="font-size:.8rem;font-weight:bold;"><input type="hidden" id="length_${seg.uid}" value="${esc(seg.length)}"></div>`
    : `<input type="number" id="length_${seg.uid}" required min="0" step="any" inputmode="decimal" placeholder="طول" value="${esc(seg.length ?? "")}" oninput="App.updatePipeField(${seg.uid},'length',this.value)">`;

  const heightValue = seg.isWell
    ? (seg.height ?? "")
    : (seg.heightEntered ? (seg.height ?? "") : ((seg.height === 0 || seg.height === "0" || seg.height == null) ? "" : seg.height));
  const heightControl = seg.isWell
    ? `<input type="number" id="height_${seg.uid}" class="form-control bg-light" value="${esc(heightValue)}" readonly tabindex="-1">`
    : `<input type="number" id="height_${seg.uid}" required min="0" max="${esc(seg.length ?? "")}" step="any" inputmode="decimal" value="${esc(heightValue)}" placeholder="اختلاف ارتفاع" oninput="App.updatePipeField(${seg.uid},'height',this.value)">`;

  const lastCell = seg.isWell
    ? `<span class="pipe-badge">داخل چاه</span>`
    : `<button type="button" class="btn-delete" title="حذف این ردیف" aria-label="حذف ردیف ${index + 1}" onclick="App.deletePipeRow(${seg.uid})"><i class="bi bi-x-lg" aria-hidden="true"></i></button>`;
  const computedTooltip = "این سلول قابل ویرایش نیست و نتیجه محاسبات است.";

  return `
    <div class="pipe-row ${seg.isWell ? "static-row" : ""}" data-pipe-uid="${seg.uid}">
      <div class="pipe-cell pipe-cell-number"><span class="row-number">${index + 1}</span></div>
      <div class="pipe-cell pipe-cell-material">
        <label for="filter_mat_${seg.uid}">جنس لوله</label>
        <select id="filter_mat_${seg.uid}" onchange="App.changePipeMaterial(${seg.uid},this.value)">
          <option value="">انتخاب جنس...</option>${materialOptions}
        </select>
      </div>
      <div class="pipe-cell pipe-cell-size">
        <label for="size_select_${seg.uid}">سایز</label>
        <select id="size_select_${seg.uid}" required onchange="App.changePipeSize(${seg.uid},this.value)">
          <option value="">${selectedGroup ? "انتخاب سایز..." : "ابتدا جنس را انتخاب کنید"}</option>${sizeOptions}
        </select>
      </div>
      <div class="pipe-cell pipe-cell-length">
        <label for="length_${seg.uid}">طول (m)</label>
        ${lengthControl}
      </div>
      <div class="pipe-cell pipe-cell-height">
        <label for="height_${seg.uid}">اختلاف ارتفاع (m)</label>
        ${heightControl}
      </div>
      <div class="pipe-cell calc-cell-wrap pipe-cell-velocity" data-tooltip="${computedTooltip}" title="${computedTooltip}">
        <label for="velocity_${seg.uid}">سرعت (m/s)</label>
        <input type="text" id="velocity_${seg.uid}" readonly tabindex="-1" class="calc-field" aria-label="سرعت؛ نتیجه محاسبات و غیرقابل ویرایش" placeholder="-" value="${velocity}">
      </div>
      <div class="pipe-cell calc-cell-wrap pipe-cell-loss" data-tooltip="${computedTooltip}" title="${computedTooltip}">
        <label for="loss_${seg.uid}">افت هد (m)</label>
        <input type="text" id="loss_${seg.uid}" readonly tabindex="-1" class="calc-field" aria-label="افت هد؛ نتیجه محاسبات و غیرقابل ویرایش" placeholder="-" value="${loss}">
      </div>
      <div class="pipe-cell pipe-cell-delete">${lastCell}</div>
      <input type="hidden" id="diameter_${seg.uid}" value="${selectedPipe ? selectedPipe.inner_d : ""}">
    </div>`;
}

function updateAllPipeRows() {
  state.segments.forEach(seg => updatePipeRow(seg.uid));
}

function updatePipeRow(uid) {
  const seg = state.segments.find(s => Number(s.uid) === Number(uid));
  if (!seg) return;
  const pipe = pipeRecords.find(p => String(p.index) === String(seg.materialId));
  const velocityEl = $(`velocity_${uid}`);
  const lossEl = $(`loss_${uid}`);
  const diameterEl = $(`diameter_${uid}`);
  if (!velocityEl || !lossEl) return;

  if (!pipe) {
    velocityEl.value = "-";
    lossEl.value = "-";
    if (diameterEl) diameterEl.value = "";
    saveState();
    return;
  }
  if (diameterEl) diameterEl.value = pipe.inner_d;
  const preview = calculatePipePreview(state.flow, pipe.inner_d, pipe.C, seg.length, seg.height);
  velocityEl.value = preview.velocity === null ? "-" : showNumber(preview.velocity, 2);
  lossEl.value = preview.displayedLoss === null ? "-" : showNumber(preview.displayedLoss, 2);
  saveState();
}

function addPipeRow() {
  const uid = Math.max(1, toFloat(state.nextPipeUid) || 1);
  state.nextPipeUid = uid + 1;
  state.segments.push({ uid, materialId: "", materialGroup: "", length: "", height: "", heightEntered: false, isWell: false });
  render();
}

function changePipeMaterial(uid, materialGroup) {
  const seg = state.segments.find(s => Number(s.uid) === Number(uid));
  if (!seg) return;
  seg.materialGroup = materialGroup;
  seg.materialId = "";
  render();
}

function changePipeSize(uid, materialId) {
  const seg = state.segments.find(s => Number(s.uid) === Number(uid));
  if (!seg) return;
  seg.materialId = materialId;
  updatePipeRow(uid);
}

function updatePipeField(uid, field, value) {
  const seg = state.segments.find(s => Number(s.uid) === Number(uid));
  if (!seg || !["length", "height"].includes(field)) return;
  seg[field] = value;
  if (field === "height") seg.heightEntered = true;
  const lengthValue = normalizeNumber(seg.length);
  const heightValue = normalizeNumber(seg.height);
  const heightInput = $(`height_${uid}`);
  if (heightInput && !seg.isWell) {
    if (lengthValue !== null) heightInput.max = String(lengthValue);
    else heightInput.removeAttribute("max");
    const exceeds = lengthValue !== null && heightValue !== null && heightValue > lengthValue;
    heightInput.setCustomValidity(exceeds ? "اختلاف ارتفاع نمی‌تواند از طول لوله بیشتر باشد." : "");
    heightInput.classList.toggle("is-invalid", exceeds);
    heightInput.title = exceeds ? "اختلاف ارتفاع نمی‌تواند از طول لوله بیشتر باشد." : "";
  }
  updatePipeRow(uid);
}

function deletePipeRow(uid) {
  state.segments = state.segments.filter(s => Number(s.uid) !== Number(uid));
  render();
}

function openOtherLossModal() {
  const form = $("pipeForm");
  const excessiveHeight = state.segments.find(seg => !seg.isWell && normalizeNumber(seg.height) !== null && normalizeNumber(seg.length) !== null && normalizeNumber(seg.height) > normalizeNumber(seg.length));
  if (excessiveHeight) {
    const heightInput = $(`height_${excessiveHeight.uid}`);
    heightInput?.setCustomValidity("اختلاف ارتفاع نمی‌تواند از طول لوله بیشتر باشد.");
    heightInput?.classList.add("is-invalid");
    showAppAlert("اختلاف ارتفاع هر بخش نمی‌تواند از طول همان بخش بیشتر باشد.", "بررسی مسیر لوله‌کشی", heightInput);
    return;
  }
  if (!validateForm(form, "لطفاً جنس، سایز، طول و اختلاف ارتفاع تمام ردیف‌های لوله را تکمیل کنید.")) return;
  const missing = state.segments.find(s => !s.materialId);
  if (missing) {
    showAppAlert("لطفاً جنس و سایز تمام ردیف‌های لوله را انتخاب کنید.");
    return;
  }
  $("otherHeadModal").style.display = "flex";
}

function closeOtherLossModal() {
  $("otherHeadModal").style.display = "none";
}

function confirmPipeAndContinue() {
  const otherLossInput = $("modal_input_head");
  if (otherLossInput && !otherLossInput.validity.valid) {
    showAppAlert("مقدار سایر افت‌های هد را به‌صورت عددی و غیرمنفی وارد کنید.", "بررسی اطلاعات", otherLossInput);
    return;
  }
  const enteredOtherLoss = normalizeNumber(otherLossInput?.value);
  const otherLoss = enteredOtherLoss ?? 0;
  if (otherLoss < 0) {
    showAppAlert("مقدار سایر افت‌های هد نمی‌تواند منفی باشد.", "بررسی اطلاعات", otherLossInput);
    return;
  }
  const result = calculatePipeTotals(state.flow, state.segments, pipeRecords, otherLoss);
  state.segments = state.segments.map(s => ({ ...s, length: toFloat(s.length), height: toFloat(s.height) }));
  state.fittingsData = result.fittingsData;
  state.totalPipeHead = result.totalPipeHead;
  state.totalOtherHead = result.totalOtherHead;

  saveState();
  setPage("design");
}

function calculateDesignHead() {
  // totalPipeHead already includes segment elevation/friction losses and, when entered, otherLoss.
  return toFloat(state.totalPipeHead);
}

function renderDesign() {
  const head = roundTo(calculateDesignHead(), 2);
  return `
    <div class="design-main">
      <div class="design-card">
        <div class="card-header text-center">
          <h3 class="mb-0">نقطه کاری سیستم </h3>
          <p class="text-muted small">نتایج نهایی محاسبات هیدرولیکی</p>
        </div>
        <div class="card-body p-4">
          <form onsubmit="App.submitDesign(event)">
            <div class="mb-4">
              <label class="form-label fw-bold">دبی مورد نیاز (Q<sub>r</sub>)</label>
              <div class="input-group"><span class="input-group-text bg-light text-dark fw-bold">m³/h</span><input type="text" class="form-control bg-light text-center fw-bold fs-4" value="${esc(showNumber(state.flow, 3))}" readonly></div>
            </div>
            <div class="mb-4">
              <label class="form-label fw-bold">هد کل مورد نیاز (H<sub>r</sub>)</label>
              <div class="input-group"><span class="input-group-text unit-label">m</span><input type="text" class="form-control bg-light text-center fw-bold fs-4" value="${esc(showNumber(head, 2))}" readonly></div>
            </div>
            <div class="d-grid gap-2">
              <button type="submit" class="btn btn-primary btn-lg py-3 fw-bold">جستجوی پمپ‌های مناسب <i class="bi bi-search ms-2"></i></button>
              <button type="button" class="btn btn-outline-secondary" onclick="App.goTo('step2')"><i class="bi bi-arrow-right me-2"></i> اصلاح مشخصات لوله‌کشی</button>
            </div>
          </form>
        </div>
      </div>
    </div>`;
}

function submitDesign(event) {
  event.preventDefault();
  state.final_q = state.flow;
  state.final_h = calculateDesignHead();
  state.selectedCandidateIndex = null;
  saveState();
  showMatchLoading("match");
}

function renderMatch() {
  const host = $("app-main");
  const match = getBestPumps(state.final_q, state.final_h, pumpRecords, 6);
  if (!match.candidates.length) {
    host.innerHTML = `
      <div class="container py-4">
        <div class="alert alert-danger text-center mt-5">
          <h4 class="fw-bold">موردی یافت نشد.</h4>
          <p class="mb-3">با دبی و هد واردشده، پمپی مطابق شرایط فیلترهای کاتالوگ پیدا نشد.</p>
          <button class="btn btn-outline-primary" onclick="App.goTo('${state.mode === "advanced" ? "design" : "simple"}')">بازگشت و اصلاح اطلاعات</button>
        </div>
      </div>`;
    return;
  }

  host.innerHTML = `
    <div class="container-fluid py-4">
      <div class="row g-4 match-layout">
        <div class="col-lg-8 order-1 match-charts-col">
          <div class="chart-container shadow-sm">
            <div class="chart-label"><i class="bi bi-graph-up me-2"></i>منحنی عملکرد هیدرولیکی (H-Q)</div>
            <div id="headChart" class="chart-svg-host"></div>
          </div>
          <div class="chart-container eff-container shadow-sm">
            <div class="chart-label text-success"><span class="me-2" aria-hidden="true" style="font-family:Georgia,serif;font-style:italic;font-weight:700;display:inline-block;">η</span>منحنی راندمان (η-Q)</div>
            <div id="effChart" class="chart-svg-host"></div>
          </div>
        </div>
        <div class="col-lg-4 order-2 match-candidates-col">
          <div class="card border-0 shadow-sm mb-4 bg-primary text-white">
            <div class="card-body p-3">
              <div class="row text-center">
                <div class="col-6 border-end"><small class="d-block opacity-75">دبی هدف</small><span class="h4 fw-bold target-value" dir="ltr"><span>${esc(showNumber(state.final_q, 2))}</span><span>m³/h</span></span></div>
                <div class="col-6"><small class="d-block opacity-75">هد هدف</small><span class="h4 fw-bold target-value" dir="ltr"><span>${esc(showNumber(state.final_h, 1))}</span><span>m</span></span></div>
              </div>
            </div>
          </div>
          <h6 class="fw-bold mb-3 text-dark px-1">۶ مدل برتر پیشنهادی:</h6>
          <div id="candidates-list">
            ${match.candidates.map((c, idx) => renderCandidateCard(c, idx)).join("")}
          </div>
          <div id="action-area" class="mt-4" style="display:${state.selectedCandidateIndex === null ? "none" : "block"};">
            <button id="confirm-btn" class="btn btn-success btn-lg w-100 py-3 shadow fw-bold" onclick="App.confirmPumpSelection()">
              تأیید و محاسبه کابل برق <i class="bi bi-arrow-left-circle ms-2"></i>
            </button>
          </div>
        </div>
      </div>
    </div>`;

  renderCandidateCharts(match.candidates, state.selectedCandidateIndex);
  // SVG coordinates track the actual chart host, including orientation changes.
  if (typeof ResizeObserver !== "undefined") {
    matchChartObserver = new ResizeObserver(() => {
      if (state.page === "match" && $("headChart") && $("effChart")) {
        renderCandidateCharts(match.candidates, state.selectedCandidateIndex);
      }
    });
    matchChartObserver.observe($("headChart"));
    matchChartObserver.observe($("effChart"));
  }

  host.onclick = (event) => {
    const seriesTarget = event.target?.closest?.("[data-candidate-index]");
    if (seriesTarget) {
      const index = Number(seriesTarget.getAttribute("data-candidate-index"));
      updateCandidateSelectionUI(index);
      return;
    }
    if (event.target?.closest?.(".candidate-card, #action-area")) return;
    if (state.selectedCandidateIndex !== null) {
      updateCandidateSelectionUI(null);
    }
  };
  host.ondblclick = (event) => {
    const card = event.target?.closest?.(".candidate-card");
    if (!card) return;
    event.preventDefault();
    const index = Number(card.getAttribute("data-card-index"));
    const current = state.selectedCandidateIndex === null || state.selectedCandidateIndex === undefined
      ? null : Number(state.selectedCandidateIndex);
    if (current !== index) {
      updateCandidateSelectionUI(index);
      return;
    }
    confirmPumpSelection();
  };
}

function renderCandidateCard(candidate, index) {
  const selected = state.selectedCandidateIndex !== null && state.selectedCandidateIndex !== undefined && Number(state.selectedCandidateIndex) === index;
  const color = chartColors[index % chartColors.length];
  return `
    <div class="candidate-card shadow-sm ${selected ? "selected" : ""}" style="--candidate-color:${color}" onclick="App.selectCandidate(${index})" ondblclick="App.confirmCandidateCard(${index}, event)" data-card-index="${index}" role="button" tabindex="0" aria-pressed="${selected}">
      <div class="candidate-heading d-flex justify-content-between align-items-center">
        <span class="candidate-name-wrap"><span class="candidate-color-dot" aria-hidden="true"></span><strong class="h6 mb-0">${esc(candidate.name)}</strong></span>
        <span class="badge bg-outline-primary text-primary border border-primary" dir="ltr" style="unicode-bidi:isolate; white-space:nowrap;">${esc(showNumber(candidate.motor_power, 2))} kW</span>
      </div>
      <div class="candidate-metrics">
        <bdi dir="ltr" style="white-space:nowrap;" aria-label="راندمان در نقطه انتخاب">η = <b>${esc(showNumber(candidate.calc_eff, 1))}%</b></bdi>
        <bdi dir="ltr" style="white-space:nowrap;" aria-label="هد در نقطه انتخاب">H<sub>avl</sub> = <b>${esc(showNumber(candidate.calc_head, 2))} m</b></bdi>
      </div>
    </div>`;
}

const chartColors = ["#0d6efd", "#fd7e14", "#198754", "#dc3545", "#6f42c1", "#20c997"];

function renderCandidateCharts(candidates, selectedIndex) {
  const headSeries = candidates.map((c, i) => ({
    id: c.name, label: c.name, color: chartColors[i % chartColors.length],
    points: c.flow_vec.map((q, j) => ({ x: Number(q), y: Number(c.head_vec[j]) })).filter(p => Number.isFinite(p.y))
  }));
  const effSeries = candidates.map((c, i) => {
    const series = {
      id: c.name, label: c.name, color: chartColors[i % chartColors.length],
      points: c.flow_vec.map((q, j) => ({ x: Number(q), y: Number(c.eff_vec[j]) })).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
    };
    // Only 6608: draw the existing efficiency polynomial, just as the
    // calculation engine evaluates it. Keep catalog data and coefficients intact.
    if (Number(c.pump_model) !== 6608 || series.points.length < 2) return series;
    const record = pumpRecords.find(p => Number(p.pump_model) === 6608 && p.model === c.name);
    const coeff = record?.efficiency_flow_poly;
    if (!Array.isArray(coeff) || !coeff.length || !coeff.every(Number.isFinite)) return series;
    const min = Math.min(...series.points.map(p => p.x));
    const max = Math.max(...series.points.map(p => p.x));
    if (!(max > min)) return series;
    const fittedPoint = q => ({ x: q, y: evaluatePolynomialDescending(coeff, q) });
    const curvePoints = Array.from({ length: 141 }, (_, j) => fittedPoint(min + (max - min) * j / 140));
    const markers = series.points.map(p => fittedPoint(p.x));
    if (![...curvePoints, ...markers].every(p => Number.isFinite(p.y))) return series;
    return { ...series, points: markers, curvePoints, fitted: true };
  });
  drawSvgChart("headChart", headSeries, {
    target: { x: Number(state.final_q), y: Number(state.final_h) },
    selectedIndex, yTitle: "Head (m)", showXAxis: true, fixedY: null
  });
  drawSvgChart("effChart", effSeries, {
    target: null, selectedIndex, yTitle: "Efficiency (%)", showXAxis: true, fixedY: [0, 100]
  });
}

function drawSvgChart(hostId, series, options) {
  const host = $(hostId);
  if (!host) return;
  const width = Math.max(120, host.clientWidth || 820);
  const height = Math.max(120, host.clientHeight || (hostId === "headChart" ? 300 : 250));
  const compact = width < 350;
  const titleX = compact ? 10 : 13;
  const margin = { left: compact ? 37 : 58, right: compact ? 15 : 23, top: 11, bottom: options.showXAxis ? (compact ? 33 : 40) : 11 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const allPoints = series.flatMap(s => s.curvePoints || s.points);
  if (options.target) allPoints.push(options.target);
  let xMin = Math.min(...allPoints.map(p => p.x));
  let xMax = Math.max(...allPoints.map(p => p.x));
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) { xMin = 0; xMax = 1; }
  if (xMin === xMax) { xMin -= 1; xMax += 1; }
  const yValues = allPoints.map(p => p.y).filter(Number.isFinite);
  let yMin = options.fixedY ? options.fixedY[0] : Math.min(...yValues);
  let yMax = options.fixedY ? options.fixedY[1] : Math.max(...yValues);
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) { yMin = 0; yMax = 1; }
  if (!options.fixedY) {
    const pad = Math.max((yMax - yMin) * 0.12, 1);
    yMin -= pad; yMax += pad;
  }
  if (yMin === yMax) { yMin -= 1; yMax += 1; }

  const x = v => margin.left + ((v - xMin) / (xMax - xMin)) * plotW;
  const y = v => margin.top + ((yMax - v) / (yMax - yMin)) * plotH;
  const yTicks = 5;
  const grid = [];
  for (let i = 0; i <= yTicks; i++) {
    const value = yMin + (yMax - yMin) * i / yTicks;
    const yy = y(value);
    grid.push(`<line x1="${margin.left}" y1="${yy}" x2="${width-margin.right}" y2="${yy}" class="chart-grid"/>`);
    grid.push(`<text x="${margin.left-6}" y="${yy+4}" text-anchor="end" class="chart-tick">${value.toFixed(0)}</text>`);
  }
  let xAxis = "";
  if (options.showXAxis) {
    const xTicks = compact ? (width < 205 ? 3 : 4) : 6;
    for (let i = 0; i <= xTicks; i++) {
      const value = xMin + (xMax - xMin) * i / xTicks;
      const xx = x(value);
      xAxis += `<line x1="${xx}" y1="${margin.top}" x2="${xx}" y2="${margin.top+plotH}" class="chart-grid vertical"/>`;
      xAxis += `<text x="${xx}" y="${height-(compact ? 17 : 22)}" text-anchor="middle" class="chart-tick">${showNumber(value, 1)}</text>`;
    }
    xAxis += `<text x="${margin.left+plotW/2}" y="${height-4}" text-anchor="middle" class="chart-axis-title">Flow Rate (m³/h)</text>`;
  }

  const lines = series.map((s, i) => {
    const active = options.selectedIndex === null || options.selectedIndex === undefined || options.selectedIndex === i;
    const stroke = s.color;
    const strokeWidth = options.selectedIndex === null || options.selectedIndex === undefined ? 2.8 : (active ? 5 : 2);
    const opacity = options.selectedIndex === null || options.selectedIndex === undefined || active ? 1 : 0.24;
    const points = s.points;
    const path = smoothPath((s.curvePoints || points).map(p => ({ x: x(p.x), y: y(p.y) })));
    const hitPath = `<path class="pump-series-hit" data-candidate-index="${i}" d="${path}" fill="none" stroke="transparent" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" tabindex="0" role="button" aria-label="انتخاب ${esc(s.label)}"><title>${esc(s.label)} — برای انتخاب کلیک کنید</title></path>`;
    const visiblePath = `<path class="pump-series-visible" d="${path}" fill="none" stroke="${stroke}" stroke-opacity="${opacity}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>`;
    const circles = points.map(p => {
      const r = options.selectedIndex === null || options.selectedIndex === undefined ? 3 : (active ? 4 : 2);
      return `<circle cx="${x(p.x)}" cy="${y(p.y)}" r="${r}" fill="${stroke}" fill-opacity="${opacity}" pointer-events="none"><title>${esc(s.label)} — Q: ${showNumber(p.x,1)}, ${esc(options.yTitle)}${s.fitted ? " (Poly fit)" : ""}: ${showNumber(p.y,1)}</title></circle>`;
    }).join("");
    return `${hitPath}${visiblePath}${circles}`;
  }).join("");

  const target = options.target
    ? `<circle cx="${x(options.target.x)}" cy="${y(options.target.y)}" r="8" fill="red" stroke="#fff" stroke-width="2"><title>نقطه هدف — Q: ${showNumber(options.target.x,1)}, H: ${showNumber(options.target.y,1)}</title></circle>`
    : "";

  host.innerHTML = `
    <svg class="pump-chart-svg${compact ? " chart-compact" : ""}" direction="ltr" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(options.yTitle)} chart">
      ${grid.join("")}${xAxis}
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top+plotH}" class="chart-axis"/>
      ${options.showXAxis ? `<line x1="${margin.left}" y1="${margin.top+plotH}" x2="${width-margin.right}" y2="${margin.top+plotH}" class="chart-axis"/>` : ""}
      ${lines}${target}
      <text x="${titleX}" y="${margin.top+plotH/2}" transform="rotate(-90 ${titleX} ${margin.top+plotH/2})" text-anchor="middle" class="chart-axis-title">${esc(options.yTitle)}</text>
    </svg>`;
}

function smoothPath(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) * 0.15;
    const cp1y = p1.y + (p2.y - p0.y) * 0.15;
    const cp2x = p2.x - (p3.x - p1.x) * 0.15;
    const cp2y = p2.y - (p3.y - p1.y) * 0.15;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

function updateCandidateSelectionUI(index) {
  const selectedIndex = index === null || index === undefined ? null : Number(index);
  state.selectedCandidateIndex = selectedIndex;
  saveState();

  document.querySelectorAll("#candidates-list .candidate-card").forEach((card, cardIndex) => {
    const selected = selectedIndex === cardIndex;
    card.classList.toggle("selected", selected);
    card.setAttribute("aria-pressed", String(selected));
  });

  const actionArea = $("action-area");
  if (actionArea) actionArea.style.display = selectedIndex === null ? "none" : "block";

  const match = getBestPumps(state.final_q, state.final_h, pumpRecords, 6);
  if (match.candidates.length) renderCandidateCharts(match.candidates, selectedIndex);
}

function selectCandidate(index) {
  // Clicking a card selects it; deselection remains available by clicking outside the cards.
  // Keeping the same selection on the second click also preserves the existing double-click confirm behavior.
  updateCandidateSelectionUI(Number(index));
}

function confirmCandidateCard(index, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const idx = Number(index);
  const current = state.selectedCandidateIndex === null || state.selectedCandidateIndex === undefined
    ? null : Number(state.selectedCandidateIndex);
  if (current !== idx) {
    updateCandidateSelectionUI(idx);
    return;
  }
  confirmPumpSelection();
}

function confirmPumpSelection() {
  const match = getBestPumps(state.final_q, state.final_h, pumpRecords, 6);
  const candidate = match.candidates[state.selectedCandidateIndex];
  if (!candidate) {
    showAppAlert("لطفاً یک پمپ انتخاب کنید.");
    return;
  }
  state.selectedModel = candidate.name;
  state.motorPower = candidate.motor_power;
  state.pumpEfficiency = candidate.calc_eff;
  state.pumpDetails = getPumpDetails(candidate.name, pumpRecords);
  saveState();
  setPage("cable");
}

function cableBundleCount() {
  return state.startMethod === "دو ضرب" ? 2 : 1;
}

function cableArrangementLabel() {
  return cableBundleCount() === 2 ? "۲ کابل ۳ رشته" : "۱ کابل ۳ رشته";
}

function cableNotation() {
  const size = state.selectedCable ?? "---";
  if (size === "---" || size === "یافت نشد" || size === null || size === "") {
    return `${cableBundleCount()} کابل × ۳ رشته`;
  }
  return `${cableBundleCount()} کابل × ۳ رشته × ${size} mm²`;
}

function cableTypeLabel() {
  return "تخت (Flat)";
}

function cableDistanceGeometry(distance = state.panelDistance) {
  const parsed = normalizeNumber(distance);
  const visualMaxDistance = 250; // visual scale only; it never limits the engineering calculation
  const ratio = parsed === null ? 0 : Math.min(1, Math.max(0, parsed / visualMaxDistance));
  const panelShift = 120 * (1 - ratio);
  const cableStartX = 164 + panelShift;
  const cableX = 513;
  const arrowStart = cableStartX + 17;
  const arrowEnd = 473;
  return {
    panelShift,
    cableStartX,
    cableX,
    arrowStart,
    arrowEnd,
    labelX: (arrowStart + arrowEnd) / 2,
    outletEnd: 659
  };
}

function renderCableRouteSvg(bundleCount = cableBundleCount(), distance = state.panelDistance) {
  const geometry = cableDistanceGeometry(distance);
  const cableOffsets = bundleCount === 1 ? [0] : [-2.2, 2.2];
  const cableLines = cableOffsets.map((offset, index) => `
    <line id="cable-run-h-${index}" x1="${geometry.cableStartX}" y1="${96 + offset}" x2="${geometry.cableX + offset}" y2="${96 + offset}" stroke="#1f2d36" stroke-width="6.5" stroke-linecap="round"/>
    <line id="cable-run-h-core-${index}" x1="${geometry.cableStartX}" y1="${96 + offset}" x2="${geometry.cableX + offset}" y2="${96 + offset}" stroke="#f0a437" stroke-width="2.1" stroke-linecap="round" stroke-dasharray="6 4"/>
    <line id="cable-run-v-${index}" x1="${geometry.cableX + offset}" y1="${96 + offset}" x2="${geometry.cableX + offset}" y2="164" stroke="#1f2d36" stroke-width="6.5" stroke-linecap="round"/>
    <line id="cable-run-v-core-${index}" x1="${geometry.cableX + offset}" y1="${96 + offset}" x2="${geometry.cableX + offset}" y2="164" stroke="#f0a437" stroke-width="2.1" stroke-linecap="round" stroke-dasharray="6 4"/>`).join("");

  return `
    <svg viewBox="0 0 660 300" role="img" aria-label="شماتیک تابلو برق، مسیر کابل با فاصله متغیر، چاه و الکتروپمپ شناور" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="soilFlat" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dbc7b5"/><stop offset="1" stop-color="#b08f72"/></linearGradient>
        <linearGradient id="waterFlat" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ad8f2"/><stop offset="1" stop-color="#0f8ec5"/></linearGradient>
        <linearGradient id="steelFlat" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7a8a93"/><stop offset="0.5" stop-color="#eef3f5"/><stop offset="1" stop-color="#7a8a93"/></linearGradient>
        <linearGradient id="panelFlat" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f80a7"/><stop offset="1" stop-color="#1c4e80"/></linearGradient>
        <marker id="arrS" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto"><path d="M8 0 L0 4 L8 8" fill="none" stroke="#1c4e80" stroke-width="1.4"/></marker>
        <marker id="arrE" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8" fill="none" stroke="#1c4e80" stroke-width="1.4"/></marker>
      </defs>
      <rect x="0" y="104" width="660" height="196" fill="url(#soilFlat)" opacity=".76"/>
      <line x1="0" y1="104" x2="660" y2="104" stroke="#755d48" stroke-width="5"/>

      <g id="cable-panel-group" style="transform:translate(${geometry.panelShift}px,0);transform-origin:0 0;transition:transform .8s cubic-bezier(.25,1,.5,1)">
        <rect x="36" y="32" width="128" height="126" rx="12" fill="url(#panelFlat)" stroke="#163c62" stroke-width="3"/>
        <rect x="52" y="47" width="96" height="80" rx="6" fill="#eef5fb" stroke="#163c62" stroke-width="2"/>
        <path d="M101 58 L88 85 H101 L95 109 L122 76 H108 L114 58 Z" fill="#f1b442" stroke="#a46a12" stroke-width="1.4" stroke-linejoin="round"/>
        <circle cx="69" cy="63" r="5" fill="#2cb978"/><circle cx="69" cy="84" r="5" fill="#f4b400"/>
        <text x="100" y="176" text-anchor="middle" font-size="16" font-weight="800" fill="#1c4e80">تابلو برق</text>
      </g>

      <line id="cable-distance-arrow" x1="${geometry.arrowStart}" y1="62" x2="${geometry.arrowEnd}" y2="62" stroke="#1c4e80" stroke-width="2.1" marker-start="url(#arrS)" marker-end="url(#arrE)"/>
      <text id="cable-distance-label" x="${geometry.labelX}" y="50" text-anchor="middle" font-size="13" font-weight="700" fill="#1c4e80">فاصله تابلو تا دهانه چاه</text>

      <g id="cable-run-lines">${cableLines}</g>

      <g id="cable-well-group">
        <rect x="489" y="104" width="78" height="180" fill="#28363d" opacity=".96"/>
        <line x1="489" y1="104" x2="489" y2="284" stroke="#aebbc1" stroke-width="8"/>
        <line x1="567" y1="104" x2="567" y2="284" stroke="#aebbc1" stroke-width="8"/>
        <line x1="489" y1="284" x2="567" y2="284" stroke="#7d8e96" stroke-width="5"/>
        <rect x="497" y="174" width="62" height="109" fill="url(#waterFlat)"/>
        <path d="M497 181 Q512 174 528 181 T559 181" fill="none" stroke="#e9fbff" stroke-width="2.5" opacity=".9"/>

        <path d="M528 164 V88 Q528 80 536 80 H${geometry.outletEnd}" fill="none" stroke="#566a75" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M528 164 V88 Q528 80 536 80 H${geometry.outletEnd}" fill="none" stroke="url(#steelFlat)" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M538 74 H${geometry.outletEnd}" fill="none" stroke="#f8fbfc" stroke-width="2" opacity=".7"/>

        <g transform="translate(0 164)">
          <path d="M513 0 L543 0 L538 10 L518 10 Z" fill="#546e7a" stroke="#37474f" stroke-width="1"/>
          <rect x="513" y="10" width="30" height="40" rx="2" fill="url(#steelFlat)" stroke="#455a64"/>
          <line x1="513" y1="20" x2="543" y2="20" stroke="#90a4ae" stroke-width="1"/>
          <line x1="513" y1="30" x2="543" y2="30" stroke="#90a4ae" stroke-width="1"/>
          <line x1="513" y1="40" x2="543" y2="40" stroke="#90a4ae" stroke-width="1"/>
          <rect x="516" y="50" width="24" height="16" fill="#263238"/>
          <path d="M516 54 H540 M516 58 H540 M516 62 H540" stroke="#90a4ae" stroke-width="1"/>
          <rect x="513" y="66" width="30" height="50" rx="3" fill="#37474f" stroke="#263238"/>
          <path d="M513 76 H543 M513 86 H543 M513 96 H543 M513 106 H543" stroke="#90a4ae" stroke-width="1.1"/>
        </g>
      </g>
    </svg>`;
}

function renderCableCrossSectionSvg(bundleCount = cableBundleCount(), size = state.selectedCable ?? "---") {
  const sizeText = size && size !== '---' && size !== 'یافت نشد' ? `${size} mm²` : '---';
  if (bundleCount === 2) {
    return `
      <svg viewBox="0 0 420 240" role="img" aria-label="دو کابل تخت ۳ رشته" xmlns="http://www.w3.org/2000/svg">
        <text x="210" y="24" text-anchor="middle" font-size="16" font-weight="800" fill="#1c4e80">دو کابل تخت ۳ رشته</text>
        <g transform="translate(210 90)">
          <rect x="-86" y="-26" width="172" height="52" rx="16" fill="#243746" stroke="#15242d" stroke-width="3"/>
          <rect x="-64" y="-14" width="30" height="30" rx="15" fill="#8d4c36" stroke="#fff" stroke-width="2"/>
          <rect x="-15" y="-14" width="30" height="30" rx="15" fill="#2d3945" stroke="#fff" stroke-width="2"/>
          <rect x="34" y="-14" width="30" height="30" rx="15" fill="#8a949c" stroke="#fff" stroke-width="2"/>
          <rect x="-52" y="-58" width="104" height="24" rx="12" fill="#eff6ff" stroke="#bfd6ef"/>
          <text x="0" y="-41" text-anchor="middle" font-size="13" font-weight="800" fill="#1c4e80">${sizeText}</text>
        </g>
        <g transform="translate(210 165)">
          <rect x="-86" y="-26" width="172" height="52" rx="16" fill="#243746" stroke="#15242d" stroke-width="3"/>
          <rect x="-64" y="-14" width="30" height="30" rx="15" fill="#8d4c36" stroke="#fff" stroke-width="2"/>
          <rect x="-15" y="-14" width="30" height="30" rx="15" fill="#2d3945" stroke="#fff" stroke-width="2"/>
          <rect x="34" y="-14" width="30" height="30" rx="15" fill="#8a949c" stroke="#fff" stroke-width="2"/>
        </g>
      </svg>`;
  }
  return `
    <svg viewBox="0 0 420 170" role="img" aria-label="یک کابل تخت ۳ رشته" xmlns="http://www.w3.org/2000/svg">
      <text x="210" y="24" text-anchor="middle" font-size="16" font-weight="800" fill="#1c4e80">یک کابل تخت ۳ رشته</text>
      <g transform="translate(210 96)">
        <rect x="-86" y="-26" width="172" height="52" rx="16" fill="#243746" stroke="#15242d" stroke-width="3"/>
        <rect x="-64" y="-14" width="30" height="30" rx="15" fill="#8d4c36" stroke="#fff" stroke-width="2"/>
        <rect x="-15" y="-14" width="30" height="30" rx="15" fill="#2d3945" stroke="#fff" stroke-width="2"/>
        <rect x="34" y="-14" width="30" height="30" rx="15" fill="#8a949c" stroke="#fff" stroke-width="2"/>
        <rect x="-52" y="-58" width="104" height="24" rx="12" fill="#eff6ff" stroke="#bfd6ef"/>
        <text x="0" y="-41" text-anchor="middle" font-size="13" font-weight="800" fill="#1c4e80">${sizeText}</text>
      </g>
      <text x="210" y="156" text-anchor="middle" font-size="13" font-weight="700" fill="#4c6273">سطح مقطع هر رشته: ${sizeText}</text>
    </svg>`;
}

function updateCableSchematic() {
  const method = document.querySelector('input[name="start_method"]:checked')?.value || state.startMethod || "تک ضرب";
  state.startMethod = method;
  const count = cableBundleCount();
  const svgHost = $("cable-route-svg");
  if (svgHost) svgHost.innerHTML = renderCableRouteSvg(count, state.panelDistance);
  saveState();
}

function updateCableDistance(value) {
  state.panelDistance = String(value ?? "");
  const geometry = cableDistanceGeometry(value);
  const panelGroup = $("cable-panel-group");
  if (panelGroup) panelGroup.style.transform = `translate(${geometry.panelShift}px, 0px)`;
  const runLines = $("cable-run-lines");
  if (runLines) {
    runLines.querySelectorAll("line").forEach(line => {
      const isVertical = /-v(?:-core)?-/.test(line.id);
      if (!isVertical) line.setAttribute("x1", geometry.cableStartX);
    });
  }
  $("cable-distance-arrow")?.setAttribute("x1", geometry.arrowStart);
  $("cable-distance-arrow")?.setAttribute("x2", geometry.arrowEnd);
  $("cable-distance-label")?.setAttribute("x", geometry.labelX);
  saveState();
}

function renderCable() {
  const pump = state.pumpDetails || getPumpDetails(state.selectedModel, pumpRecords);
  const bundleCount = cableBundleCount();
  return `
    <div class="cable-main container">
      <div class="card shadow-lg border-0 cable-card">
        <div class="card-header cable-card-header text-center">
          <h4 class="mb-0">مشخصات فنی و انتخاب کابل</h4>
          <small>اطلاعات الکتروپمپ و آرایش کابل تغذیه</small>
        </div>
        <div class="card-body" dir="rtl">
          <div class="cable-summary">
            <div class="cable-summary-item"><label>مدل الکتروپمپ</label><strong title="${esc(pump.showing_name || "---")}">${esc(pump.showing_name || "---")}</strong></div>
            <div class="cable-summary-item"><label>جریان نامی</label><strong dir="ltr">${esc(showNumber(pump.current, 2))} A</strong></div>
            <div class="cable-summary-item"><label>توان موتور</label><strong dir="ltr">${esc(showNumber(state.motorPower, 2))} kW</strong></div>
          </div>
          <div class="cable-body-grid">
            <section class="cable-schematic" aria-label="شماتیک تابلو برق و چاه">
              <div class="cable-schematic-heading"><strong>شماتیک مسیر تغذیه الکتروپمپ</strong><span>تابلو برق تا موتور شناور</span></div>
              <div id="cable-route-svg">${renderCableRouteSvg(bundleCount)}</div>
            </section>
            <div class="cable-form-panel">
              <div class="cable-form-intro">
                <i class="bi bi-rulers" aria-hidden="true"></i>
                <span>فاصله تابلو تا دهانه چاه و روش راه‌اندازی را مشخص کنید.</span>
              </div>
              <form novalidate onsubmit="App.submitCable(event)">
                <div class="cable-form-field">
                  <label class="form-label" for="panel_distance">فاصله تابلو از دهانه چاه (متر)</label>
                  <input type="number" name="panel_distance" id="panel_distance" class="form-control form-control-lg text-center" placeholder="مثلاً 50" min="0" step="any" required value="${esc(state.panelDistance ?? "")}" oninput="App.updateCableDistance(this.value)">
                </div>
                <fieldset class="cable-start-fieldset">
                  <legend>نوع راه‌اندازی</legend>
                  <div class="cable-start-options">
                    <input type="radio" class="btn-check" name="start_method" id="s1" value="تک ضرب" ${state.startMethod !== "دو ضرب" ? "checked" : ""} onchange="App.updateCableSchematic()">
                    <label class="cable-start-option" for="s1">
                      <strong>تک‌ضرب</strong><span>۱ کابل ۳ رشته</span><small>راه‌اندازی مستقیم</small>
                    </label>
                    <input type="radio" class="btn-check" name="start_method" id="s2" value="دو ضرب" ${state.startMethod === "دو ضرب" ? "checked" : ""} onchange="App.updateCableSchematic()">
                    <label class="cable-start-option" for="s2">
                      <strong>دو‌ضرب</strong><span>۲ کابل ۳ رشته</span><small>ستاره–مثلث</small>
                    </label>
                  </div>
                </fieldset>
                <div class="cable-actions">
                  <button type="button" class="btn btn-outline-secondary" onclick="App.goTo('match')"><i class="bi bi-arrow-right me-1"></i> انتخاب مجدد پمپ</button>
                  <button type="submit" class="btn btn-success">محاسبه نهایی <i class="bi bi-calculator ms-1"></i></button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function submitCable(event) {
  event.preventDefault();
  const form = document.querySelector(".cable-main form");
  if (!validateForm(form, "لطفاً فاصله تابلو از دهانه چاه را وارد کنید.")) return;
  const panelDistance = normalizeNumber($("panel_distance").value);
  if (panelDistance === null || panelDistance < 0) {
    showAppAlert("لطفاً فاصله تابلو را به‌درستی وارد کنید.");
    return;
  }
  const startMethod = document.querySelector('input[name="start_method"]:checked')?.value || "تک ضرب";
  const pump = state.pumpDetails || getPumpDetails(state.selectedModel, pumpRecords);
  const result = calculateCable(panelDistance, pump.current, startMethod, state.install_depth);
  state.panelDistance = panelDistance;
  state.startMethod = startMethod;
  state.selectedCable = result.selectedCable;
  state.calcArea = result.calculatedArea;
  state.totalLengthCalc = result.totalLength;
  saveState();
  setPage("result");
}

function renderResult(includeActions = true) {
  const fittings = Array.isArray(state.fittingsData) ? state.fittingsData : [];
  const isAdvanced = state.mode === "advanced";
  const bundleCount = cableBundleCount();
  const cableSize = state.selectedCable ?? "---";
  const selectedPumpDetails = getPumpDetails(state.selectedModel, pumpRecords);
  const pumpName = state.pumpDetails?.showing_name || selectedPumpDetails.showing_name || state.selectedModel || "---";
  const categoryFallbackUrl = "https://parsnasseripump.com/product-category/%D9%BE%D9%85%D9%BE-%D9%87%D8%A7%DB%8C-%D8%B4%D9%86%D8%A7%D9%88%D8%B1";
  const productUrl = selectedPumpDetails.product_url || categoryFallbackUrl;
  const productLinkLabel = selectedPumpDetails.product_url ? "مشاهده صفحه اختصاصی این مدل" : "مشاهده فهرست پمپ‌های شناور";
  const productLinkTitle = selectedPumpDetails.product_url ? `مشاهده صفحه رسمی مدل ${selectedPumpDetails.pump_model}` : "صفحه اختصاصی این خانواده در فهرست ارسالی موجود نیست؛ مشاهده فهرست پمپ‌های شناور";
  const technicalCableNotation = `${bundleCount} × 3C × ${cableSize} mm²`;
  const tableHtml = isAdvanced ? `
    <div class="result-piping-panel">
      <div class="table-responsive">
        <table class="table table-bordered table-hover align-middle result-piping-table">
          <thead>
            <tr>
              <th class="col-material">جنس لوله</th>
              <th class="col-size">سایز</th>
              <th class="col-length">طول</th>
              <th class="col-height">اختلاف ارتفاع</th>
              <th class="col-velocity">سرعت جریان (m/s)</th>
              <th class="col-head">هد (m)</th>
            </tr>
          </thead>
          <tbody>
            ${fittings.map(item => `
              <tr>
                <td class="fw-bold">${esc(item.name)}</td>
                <td dir="ltr">${esc(formatPipeSize(item.size))}</td>
                <td dir="ltr">${esc(item.quantity)}</td>
                <td dir="ltr">${esc(numericOrDash(item.z_height, 2))}</td>
                <td dir="ltr">${esc(numericOrDash(item.velocity, 2))}</td>
                <td dir="ltr" class="text-danger fw-bold">${esc(numericOrDash(fittingHeadValue(item), 2))}</td>
              </tr>`).join("")}
          </tbody>
          <tfoot>
            <tr>
              <th colspan="5">مجموع هد مسیر و افت‌های ثبت‌شده</th>
              <th dir="ltr">${esc(showNumber(state.totalPipeHead, 2))} m</th>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>` : "";
  const hydraulicHtml = isAdvanced ? `
    <section class="result-hydraulic-layout is-advanced">
      <div class="result-section-heading">
        <div><i class="bi bi-water"></i><h3>شماتیک چاه و جزئیات مسیر</h3></div>
        <span>نمای شماتیک مرحله اول طراحی و خلاصه مسیر لوله‌کشی</span>
      </div>
      <div class="result-hydraulic-grid with-table">
        <div class="result-well-panel">${renderResultWellSvg()}</div>
        ${tableHtml}
      </div>
    </section>` : "";

  return `
    <div class="result-main container-fluid">
      <article class="result-card shadow-lg">
        <header class="result-header">
          <div>
            <span class="result-kicker">PUMP PARS NASERI · TECHNICAL REPORT</span>
            <h2>گزارش نهایی فنی سیستم</h2>
            <p>خلاصه مشخصات الکتروپمپ انتخاب‌شده و محاسبات کابل تغذیه</p>
          </div>
          <div class="result-status"><i class="bi bi-check-circle-fill" aria-hidden="true"></i><span>انتخاب تکمیل شد</span></div>
        </header>

        <section class="result-overview-grid">
          <div class="result-info-card result-operating-card">
            <div class="result-info-heading"><i class="bi bi-speedometer2"></i><span>نقطه کار سیستم</span></div>
            <div class="result-pair"><small>دبی هدف</small><strong dir="ltr">Q = ${esc(showNumber(state.final_q, 2))} <span>m³/h</span></strong></div>
            <div class="result-pair"><small>هد هدف</small><strong dir="ltr">H = ${esc(showNumber(state.final_h, 1))} <span>m</span></strong></div>
          </div>
          <div class="result-info-card result-pump-card">
            <div class="result-info-heading"><i class="bi bi-water"></i><span>الکتروپمپ انتخاب‌شده</span></div>
            <strong class="result-model-name" title="${esc(pumpName)}">${esc(pumpName)}</strong>
            <a class="result-product-category-link" href="${esc(productUrl)}" target="_blank" rel="noopener noreferrer" title="${esc(productLinkTitle)}">
              <i class="bi bi-box-arrow-up-left" aria-hidden="true"></i> ${esc(productLinkLabel)}
            </a>
            <div class="result-mini-metrics">
              <span><small>توان</small><b dir="ltr">${esc(showNumber(state.motorPower, 2))} kW</b></span>
              <span><small>راندمان در نقطه انتخاب</small><b dir="ltr">${esc(showNumber(state.pumpEfficiency, 1))}%</b></span>
            </div>
          </div>
          <div class="result-info-card result-cable-card result-cable-wide-card">
            <div class="result-info-heading"><i class="bi bi-lightning-charge-fill"></i><span>کابل پیشنهادی</span></div>
            <div class="result-cable-card-grid">
              <div class="result-cable-mini-wrap">${renderResultCableMiniSvg(bundleCount, cableSize)}</div>
              <div class="result-cable-card-copy">
                <bdi class="result-cable-notation-technical" dir="ltr">${esc(technicalCableNotation)}</bdi>
                <small class="result-cable-type">Flat submersible pump cable · ${bundleCount} ${bundleCount === 1 ? "run" : "runs"}</small>
                <div class="result-cable-meta">
                  <span><small>طول محاسباتی کابل</small><b>${esc(showNumber(state.totalLengthCalc, 1))} متر</b></span>
                  <span><small>روش راه‌اندازی</small><b>${esc(state.startMethod)}</b></span>
                </div>
                <small class="result-cable-length-basis">طول کابل = فاصله تابلو تا دهانه چاه + عمق نصب پمپ</small>
              </div>
            </div>
          </div>
        </section>

        ${hydraulicHtml}

        ${includeActions ? `<div class="result-actions d-print-none">
          <button type="button" class="btn btn-success btn-lg" onclick="App.printReport()"><i class="bi bi-file-earmark-pdf-fill ms-2"></i> دریافت فایل PDF گزارش</button>
          <button type="button" id="result-start-over-button" class="btn btn-outline-primary btn-lg" onclick="App.startOver()">شروع مجدد</button>
        </div>` : ""}
      </article>
    </div>`;
}

function renderPrintReport() {
  return renderResult(false);
}

function printReport() {
  window.print();
}

function updateSimpleFlow() {
  const flowInput = $("display_flow");
  const displayVal = normalizeNumber(flowInput?.value);
  const unit = $("flow_unit")?.value || state.simpleFlowUnit || "m3h";
  const finalInput = $("final_flow");
  const errorDiv = $("flow-error");
  const submitBtn = document.querySelector('#simple-form button[type="submit"]');
  if (flowInput) state.simpleFlowInput = flowInput.value;
  state.simpleFlowUnit = unit;
  if (finalInput && errorDiv && submitBtn) {
    if (displayVal === null) {
      finalInput.value = "";
      errorDiv.style.display = "none";
      submitBtn.disabled = false;
    } else {
      const m3hValue = unit === "ls" ? displayVal * 3.6 : displayVal;
      // Range errors are reported through the shared modal on submit, not inline/native UI.
      errorDiv.style.display = "none";
      submitBtn.disabled = false;
      finalInput.value = m3hValue.toFixed(3);
    }
  }
  saveState();
}

function updateSimpleHead(value) {
  state.simpleHeadInput = String(value ?? "");
  saveState();
}


function goToInputs() {
  if (state.page === "welcome") return;
  const inputPage = state.mode === "advanced" ? "step1" : (state.mode === "simple" ? "simple" : null);
  if (!inputPage) return;
  if (state.page === inputPage) {
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  setPage(inputPage);
}

function submitSimple(event) {
  event.preventDefault();
  const form = $("simple-form");
  if (!validateForm(form, "لطفاً دبی و هد مورد نیاز را وارد کنید.")) return;
  updateSimpleFlow();
  const enteredFlow = normalizeNumber($("display_flow").value);
  const flow = normalizeNumber($("final_flow").value);
  const head = normalizeNumber($("simple-head").value);
  if (enteredFlow === null || flow === null || flow <= 0) {
    showAppAlert("دبی مورد نیاز باید بزرگ‌تر از صفر باشد.", "بررسی اطلاعات", $("display_flow"));
    return;
  }
  if (head === null || head <= 0) {
    showAppAlert("هد کل مورد نیاز باید بزرگ‌تر از صفر باشد.", "بررسی اطلاعات", $("simple-head"));
    return;
  }
  if (flow > 800) {
    showAppAlert("دبی بیش از حد مجاز است (حداکثر 800 مترمکعب بر ساعت).");
    return;
  }
  state.mode = "simple";
  state.flow = flow;
  state.final_q = flow;
  state.final_h = head;
  state.totalPipeHead = 0;
  state.totalOtherHead = 0;
  state.fittingsData = [];
  saveState();
  showMatchLoading("match");
}

function submitStep1(event) {
  event.preventDefault();
  const form = $("step1-form");
  if (!validateForm(form, "لطفاً تمام مشخصات چاه را تکمیل کنید.")) return;
  const rawFlow = normalizeNumber($("step1-flow").value);
  const flowUnit = $("step1-flow-unit").value;
  const staticLevel = normalizeNumber($("static_level").value);
  const dynamicLevel = normalizeNumber($("dynamic_level").value);
  const installDepth = normalizeNumber($("install_depth").value);
  const diameterInch = normalizeNumber($("diameter").value);

  if (rawFlow === null || rawFlow <= 0) {
    showAppAlert("دبی مورد نیاز باید بزرگ‌تر از صفر باشد.", "بررسی اطلاعات", $("step1-flow"));
    return;
  }
  const positiveLevelFields = [
    { value: staticLevel, input: $("static_level"), label: "سطح استاتیک" },
    { value: dynamicLevel, input: $("dynamic_level"), label: "سطح دینامیک" },
    { value: installDepth, input: $("install_depth"), label: "عمق نصب پمپ" }
  ];
  const invalidLevel = positiveLevelFields.find(item => item.value === null || item.value <= 0);
  if (invalidLevel) {
    showAppAlert(`${invalidLevel.label} باید بزرگ‌تر از صفر باشد.`, "بررسی اطلاعات", invalidLevel.input);
    return;
  }
  if (diameterInch === null || diameterInch <= 0) {
    showAppAlert("قطر دهانه چاه نمی‌تواند صفر باشد و باید بزرگ‌تر از صفر وارد شود.", "بررسی اطلاعات", $("diameter"));
    return;
  }
  if (dynamicLevel < staticLevel) {
    showAppAlert("توجه: سطح استاتیک نمی‌تواند بیشتر از سطح دینامیک باشد.");
    return;
  }
  if (installDepth < dynamicLevel) {
    showAppAlert("هشدار: عمق نصب الکتروپمپ باید بیشتر از سطح دینامیک باشد.");
    return;
  }

  const finalFlow = flowUnit === "lit_sec" && rawFlow ? rawFlow * 3.6 : rawFlow;
  state.flow = finalFlow;
  state.static_level = staticLevel;
  state.dynamic_level = dynamicLevel;
  state.install_depth = installDepth;
  state.diameter_inch = diameterInch;
  state.diameter_mm = diameterInch * 25.4;
  state.depth = dynamicLevel;
  state.segments = [{
    uid: 1, materialId: "", materialGroup: "", length: installDepth, height: installDepth, isWell: true
  }];
  state.nextPipeUid = 2;
  saveState();
  setPage("step2");
}


function selectAllValue(input) {
  if (!input) return;
  window.requestAnimationFrame(() => {
    try { input.select(); } catch (err) {}
  });
}

function goTo(page) {
  setPage(page);
}

function goBack() {
  const previous = {
    guide: "welcome",
    simple: "welcome",
    step1: "welcome",
    step2: "step1",
    design: "step2",
    match: state.mode === "advanced" ? "design" : "simple",
    cable: "match",
    result: "cable"
  };
  setPage(previous[state.page] || "welcome");
}

function onHashChange() {
  const page = location.hash.replace(/^#/, "") || "welcome";
  if (!allowedPages.has(page)) {
    setPage("welcome", false);
    return;
  }
  state.page = page;
  render();
}

const App = {
  selectMethod, goHome, requestHome, cancelHomeRequest, confirmHomeRequest, closeAppAlert, startOver, cancelStartOver, confirmStartOver, goTo, goBack, drawWell,
  updateSimpleFlow, updateSimpleHead, goToInputs, submitSimple, submitStep1,
  addPipeRow, changePipeMaterial, changePipeSize, updatePipeField, deletePipeRow,
  openOtherLossModal, closeOtherLossModal, confirmPipeAndContinue,
  submitDesign, selectCandidate, confirmCandidateCard, confirmPumpSelection,
  submitCable, updateCableSchematic, updateCableDistance, printReport
};
window.App = App;

// Preserve the shared input behavior from the original Flask layout.
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("restart-confirm-modal")?.hidden) {
    event.preventDefault();
    cancelStartOver();
    return;
  }
  if (event.key === "Escape" && !$("app-alert-modal")?.hidden) {
    event.preventDefault();
    closeAppAlert();
    return;
  }
  if (event.key === "Escape" && !$("home-confirm-modal")?.hidden) {
    event.preventDefault();
    cancelHomeRequest();
    return;
  }
  if (event.target?.type === "number" && ["e", "E", "-", "+"].includes(event.key)) {
    event.preventDefault();
    return;
  }
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (!target?.matches?.('input[type="text"], input[type="number"], input[type="tel"]')) return;
  const map = {
    "۰":"0","۱":"1","۲":"2","۳":"3","۴":"4","۵":"5","۶":"6","۷":"7","۸":"8","۹":"9",
    "٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9"
  };
  target.value = target.value.replace(/[۰-۹٠-٩]/g, (digit) => map[digit]);
  if (target.type === "number" && Number.parseFloat(target.value) < 0) target.value = 0;
  if (typeof target.setCustomValidity === "function") target.setCustomValidity("");
  if (target.willValidate && target.validity.valid && String(target.value ?? "").trim() !== "") {
    clearFieldError(target);
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target?.willValidate && target.validity.valid && String(target.value ?? "").trim() !== "") {
    clearFieldError(target);
  }
});

window.addEventListener("hashchange", onHashChange);
window.addEventListener("load", () => {
  window.setTimeout(() => $("splash")?.classList.add("hidden"), 2000);
});

// A new browser session always opens on Welcome. Workflow state is reset when a method is selected.
state.page = "welcome";
if (location.hash !== "#welcome") {
  history.replaceState(null, "", `${location.pathname}${location.search}#welcome`);
}
render();
loadExternalData();
