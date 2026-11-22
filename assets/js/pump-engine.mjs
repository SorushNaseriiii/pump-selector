// Pure calculation layer ported from the original Run.py and step2.html.
// Keep formulas and filtering rules aligned with the Flask source.
export const CABLE_SIZES = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400];
export const CABLE_FACTOR = 0.0027803571429;

// Official product pages supplied by the user, keyed by pump family/model code.
export const PUMP_PRODUCT_URLS = Object.freeze({
  193: "https://parsnasseripump.com/product/%D8%A7%D9%84%DA%A9%D8%AA%D8%B1%D9%88-%D9%BE%D9%85%D9%BE-%D8%B4%D9%86%D8%A7%D9%88%D8%B1-uqh-193",
  6611: "https://parsnasseripump.com/product/%D8%A7%D9%84%DA%A9%D8%AA%D8%B1%D9%88-%D9%BE%D9%85%D9%BE-%D8%B4%D9%86%D8%A7%D9%88%D8%B1ritz-6611",
  233: "https://parsnasseripump.com/product/%D9%85%D8%AD%D8%B5%D9%88%D9%84-11",
  293: "https://parsnasseripump.com/product/%D9%85%D8%AD%D8%B5%D9%88%D9%84-10",
  345: "https://parsnasseripump.com/product/%D9%85%D8%AD%D8%B5%D9%88%D9%84-9",
  374: "https://parsnasseripump.com/product/%D9%85%D8%AD%D8%B5%D9%88%D9%84-8",
  384: "https://parsnasseripump.com/product/%D9%85%D8%AD%D8%B5%D9%88%D9%84-7",
  425: "https://parsnasseripump.com/product/%D9%85%D8%AD%D8%B5%D9%88%D9%84-6",
  435: "https://parsnasseripump.com/product/%D9%85%D8%AD%D8%B5%D9%88%D9%84-5",
  466: "https://parsnasseripump.com/product/%D9%85%D8%AD%D8%B5%D9%88%D9%84-4",
  486: "https://parsnasseripump.com/product/%D9%85%D8%AD%D8%B5%D9%88%D9%84-3",
  6608: "https://parsnasseripump.com/product/%D9%85%D8%AD%D8%B5%D9%88%D9%84-2",
  6609: "https://parsnasseripump.com/product/%D9%85%D8%AD%D8%B5%D9%88%D9%84-1",
});

export function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  let s = String(value).trim();
  for (let i = 0; i < 10; i++) {
    s = s.replaceAll(persian[i], String(i)).replaceAll(arabic[i], String(i));
  }
  s = s.replaceAll(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function toFloat(value) {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(String(value).replaceAll(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function roundTo(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const places = Math.max(0, Math.min(12, Math.trunc(digits)));
  if (number === 0) return number;
  // Reproduce Python round(float, ndigits): exact binary value, ties to even.
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, number, false);
  const bits = view.getBigUint64(0, false);
  const negative = (bits >> 63n) === 1n;
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  const mantissa = exponentBits === 0 ? fraction : ((1n << 52n) | fraction);
  const exponent2 = exponentBits === 0 ? (1 - 1023 - 52) : (exponentBits - 1023 - 52);
  let numerator = mantissa * (10n ** BigInt(places));
  let denominator = 1n;
  if (exponent2 >= 0) numerator <<= BigInt(exponent2);
  else denominator <<= BigInt(-exponent2);
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const comparison = remainder * 2n - denominator;
  if (comparison > 0n || (comparison === 0n && quotient % 2n === 1n)) quotient += 1n;
  const rounded = Number(quotient) / (10 ** places);
  return negative ? -rounded : rounded;
}

// np.poly1d(coefficients) evaluates coefficients from highest power to constant.
export function evaluatePolynomialDescending(coefficients, x) {
  if (!Array.isArray(coefficients) || coefficients.length === 0) return null;
  let value = 0;
  for (const coefficient of coefficients) {
    value = value * x + Number(coefficient);
  }
  return Number.isFinite(value) ? value : null;
}

// Equivalent to numpy.interp for the in-range flow values used by the source.
export function interpolateLinear(x, xs, ys) {
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length === 0 || xs.length !== ys.length) return null;
  if (x <= xs[0]) return Number(ys[0]);
  if (x >= xs[xs.length - 1]) return Number(ys[ys.length - 1]);
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const x0 = Number(xs[i - 1]);
      const x1 = Number(xs[i]);
      const y0 = Number(ys[i - 1]);
      const y1 = Number(ys[i]);
      if (x1 === x0) return y1;
      return y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
    }
  }
  return null;
}

// Preview formula used by step2.html (velocity and hf + elevation).
export function calculatePipePreview(flowM3h, innerDiameterMm, hazenWilliamsC, lengthM, elevationM) {
  const Q = toFloat(flowM3h);
  const d = toFloat(innerDiameterMm);
  const C = toFloat(hazenWilliamsC);
  const L = toFloat(lengthM);
  const Z = toFloat(elevationM);

  if (!(d > 0 && Q > 0)) {
    return { velocity: null, frictionLoss: 0, displayedLoss: null };
  }

  const qM3s = Q / 3600;
  const dM = d / 1000;
  const velocity = qM3s / (Math.PI * Math.pow(dM, 2) / 4);
  let frictionLoss = 0;
  if (L > 0 && C > 0) {
    frictionLoss = (10.67 * L * Math.pow(qM3s, 1.852)) /
      (Math.pow(C, 1.852) * Math.pow(dM, 4.871));
  }
  return {
    velocity,
    frictionLoss,
    displayedLoss: frictionLoss + Z
  };
}

// Backend step2 calculation: total includes friction + elevation for each segment.
// The report's per-row "loss" field displays friction only, as the original source does.
export function calculatePipeTotals(flowM3h, segments, pipeRecords, otherLossValue = 0) {
  const qM3s = flowM3h ? Number(flowM3h) / 3600 : 0;
  const byId = new Map((pipeRecords || []).map(p => [String(p.index), p]));
  let totalPipeHead = 0;
  const fittingsData = [];
  const normalizedSegments = [];

  for (const segment of (segments || [])) {
    const L = toFloat(segment.length);
    const Z = toFloat(segment.height);
    const matId = segment.materialId === null || segment.materialId === undefined
      ? "" : String(segment.materialId);
    const pipe = byId.get(matId);
    let diameterMm = pipe ? toFloat(pipe.inner_d) : toFloat(segment.diameterMm);
    let C = pipe ? toFloat(pipe.C) : 100;
    let displayName = pipe ? pipe.material_group : matId;
    let displaySize = pipe ? pipe.size_label : `${diameterMm} mm`;

    let frictionLoss = 0;
    let velocity = null;
    if (diameterMm > 0 && qM3s > 0) {
      const dM = diameterMm / 1000;
      velocity = qM3s / (Math.PI * Math.pow(dM, 2) / 4);
      if (L > 0 && C > 0) {
        frictionLoss = (10.67 * L * Math.pow(qM3s, 1.852)) /
          (Math.pow(C, 1.852) * Math.pow(dM, 4.871));
      }
    }

    totalPipeHead += frictionLoss + Z;
    normalizedSegments.push({
      length: L,
      diameter: diameterMm,
      height: Z,
      material: matId
    });
    fittingsData.push({
      name: displayName,
      size: displaySize,
      quantity: `${L} m`,
      z_height: Z,
      velocity: velocity === null ? null : roundTo(velocity, 2),
      loss: roundTo(frictionLoss, 2)
    });
  }

  const otherLoss = toFloat(otherLossValue) || 0;
  if (otherLoss > 0) {
    fittingsData.push({
      name: "سایر اتصالات و افت‌ها",
      size: "-",
      quantity: "-",
      z_height: "-",
      velocity: null,
      loss: roundTo(otherLoss, 2)
    });
    totalPipeHead += otherLoss;
  }

  return {
    segments: normalizedSegments,
    fittingsData,
    totalPipeHead,
    totalOtherHead: otherLoss
  };
}

// Exact matching rules from Run.py:get_best_pumps.
export function getBestPumps(desiredFlow, requiredHead, pumpRecords, limit = 6) {
  const candidates = [];
  const qr = Number(desiredFlow);
  const hr = Number(requiredHead);

  for (const row of (pumpRecords || [])) {
    const flowVector = Array.isArray(row.flow_vector) ? row.flow_vector : [];
    const headVector = Array.isArray(row.head_vector) ? row.head_vector : [];
    const efficiencyVector = Array.isArray(row.efficiency_vector) ? row.efficiency_vector : [];

    if (flowVector.length === 0 || headVector.length === 0) continue;

    const minFlow = Math.min(...flowVector);
    const maxFlow = Math.max(...flowVector);
    if (!(minFlow <= qr && qr <= maxFlow)) continue;

    let calculatedHead;
    if (Array.isArray(row.head_flow_poly) && row.head_flow_poly.length > 0) {
      calculatedHead = evaluatePolynomialDescending(row.head_flow_poly, qr);
    } else {
      calculatedHead = interpolateLinear(qr, flowVector, headVector);
    }
    if (calculatedHead === null || !Number.isFinite(calculatedHead)) continue;

    // Original tolerance is exactly 5 m: calculated head >= required head - 5.
    if (calculatedHead >= hr - 5) {
      let calculatedEfficiency = 0;
      if (Array.isArray(row.efficiency_flow_poly) && row.efficiency_flow_poly.length > 0) {
        const value = evaluatePolynomialDescending(row.efficiency_flow_poly, qr);
        calculatedEfficiency = value === null ? 0 : value;
      }

      candidates.push({
        name: row.model ?? "Unknown",
        motor_power: toFloat(row.motor_power),
        calc_head: roundTo(calculatedHead, 2),
        calc_eff: roundTo(calculatedEfficiency, 1),
        flow_vec: flowVector,
        head_vec: headVector,
        eff_vec: efficiencyVector,
        raw_model: row.model,
        current: toFloat(row.current),
        pump_model: row.pump_model,
        pump_no: row.pump_no,
        motor_model: row.motor_model,
        source_row: row.source_row
      });
    }
  }

  // Python's sort is stable; modern JavaScript sort is stable as well.
  candidates.sort((a, b) =>
    (a.motor_power - b.motor_power) || (b.calc_eff - a.calc_eff)
  );

  return {
    Desired_Q: qr,
    Desired_H: hr,
    total_candidates: candidates.length,
    candidates: candidates.slice(0, limit)
  };
}

export function getPumpDetails(selectedModel, pumpRecords) {
  const target = String(selectedModel ?? "").trim();
  const row = (pumpRecords || []).find(p => String(p.model ?? "").trim() === target);
  if (!row) {
    return {
      showing_name: selectedModel,
      motor_power: 0,
      current: 0,
      pump_model: "---",
      pump_no: 0,
      motor_model: null,
      product_url: null
    };
  }
  const pumpModelCode = row.pump_model === null || row.pump_model === undefined
    ? null
    : Math.trunc(toFloat(row.pump_model));
  return {
    showing_name: row.model,
    motor_power: toFloat(row.motor_power),
    current: toFloat(row.current),
    pump_model: pumpModelCode === null ? "---" : pumpModelCode,
    pump_no: row.pump_no === null ? 0 : Math.trunc(toFloat(row.pump_no)),
    motor_model: row.motor_model,
    product_url: pumpModelCode === null ? null : (PUMP_PRODUCT_URLS[pumpModelCode] || null)
  };
}

// Cable sizing: total cable run is panel-to-wellhead distance plus pump installation depth; standard sections and start-method factor are retained.
export function calculateCable(panelDistance, selectedPumpCurrent, startMethod, installationDepth) {
  const panelDist = toFloat(panelDistance);
  const installedDepth = toFloat(installationDepth);
  const totalLength = panelDist + installedDepth;
  let calculatedArea = totalLength * toFloat(selectedPumpCurrent) * CABLE_FACTOR;

  if (startMethod === "دو ضرب") calculatedArea *= 0.58;

  let selectedCable = "یافت نشد";
  for (const size of CABLE_SIZES) {
    if (size >= calculatedArea) {
      selectedCable = size;
      break;
    }
  }

  return {
    panelDistance: panelDist,
    installationDepth: installedDepth,
    wellHead: installedDepth,
    totalLength,
    calculatedArea: roundTo(calculatedArea, 3),
    selectedCable
  };
}
