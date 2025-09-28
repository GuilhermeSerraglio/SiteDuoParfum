const ORIGIN = {
  city: "Sorriso",
  state: "MT",
  cep: "78890000",
};

const ORIGIN_LABEL = `${ORIGIN.city} - ${ORIGIN.state}`;

const CORREIOS_SERVICES = {
  pac: { code: "04510", name: "PAC" },
  sedex: { code: "04014", name: "SEDEX" },
};

const DEFAULT_SERVICE_KEY = "pac";
const MAX_DECLARED_VALUE = 10000;
const MAX_WEIGHT_KG = 30;
const MIN_REQUEST_WEIGHT_KG = 0.1; // peso mínimo considerado para o cálculo interno
const MIN_BILLABLE_WEIGHT_KG = 0.3; // peso mínimo aceito pelos Correios
const PACKAGE_BUFFER_WEIGHT_KG = 0.05; // envelope/embalagem leve
const BASE_ITEM_WEIGHT_KG = 0.02; // 20g por item quando não houver referência

const PACKAGE_DIMENSIONS = {
  formato: "1", // caixa/pacote
  comprimento: 16, // cm (mínimo 16)
  altura: 2, // cm (mínimo 2)
  largura: 11, // cm (mínimo 11)
  diametro: 0, // não aplicável
};

let cachedFetch = typeof fetch === "function" ? fetch : null;

async function ensureFetch() {
  if (cachedFetch) return cachedFetch;
  const { default: nodeFetch } = await import("node-fetch");
  cachedFetch = nodeFetch;
  return cachedFetch;
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch (err) {
      return {};
    }
  }
  return body;
}

function sanitizeCep(value = "") {
  return value.toString().replace(/\D/g, "").slice(0, 8);
}

function parseMl(value) {
  if (!value) return 0;
  const match = value.toString().match(/(\d+[\d,.]*)/);
  if (!match) return 0;
  const normalized = match[1].replace(/\./g, "").replace(/,/g, ".");
  const ml = Number(normalized);
  return Number.isFinite(ml) && ml > 0 ? ml : 0;
}

function computeItemWeightKg(rawItem = {}) {
  const qty = Math.max(1, Number(rawItem?.qty) || 1);
  const weightKg = Number(rawItem?.weightKg || rawItem?.weight || 0);
  if (Number.isFinite(weightKg) && weightKg > 0) {
    return qty * Math.min(MAX_WEIGHT_KG, weightKg);
  }
  const ml = parseMl(rawItem?.ml);
  const inferredKg = ml ? ml / 1000 : BASE_ITEM_WEIGHT_KG;
  return qty * Math.max(BASE_ITEM_WEIGHT_KG, inferredKg);
}

function computePhysicalWeightKg(items = []) {
  const itemsWeight = items.reduce((sum, item) => sum + computeItemWeightKg(item), 0);
  const total = itemsWeight + PACKAGE_BUFFER_WEIGHT_KG;
  const bounded = Math.min(MAX_WEIGHT_KG, Math.max(MIN_REQUEST_WEIGHT_KG, total));
  return Math.round(bounded * 1000) / 1000;
}

function computeBillableWeightKg(weightKg) {
  return Math.round(
    Math.min(MAX_WEIGHT_KG, Math.max(MIN_BILLABLE_WEIGHT_KG, weightKg)) * 1000
  ) / 1000;
}

function computeSubtotal(items = [], explicitSubtotal) {
  if (Number.isFinite(explicitSubtotal)) {
    return Math.max(0, explicitSubtotal);
  }
  return items.reduce((sum, item) => {
    const price = Number(item?.price) || 0;
    const qty = Math.max(1, Number(item?.qty) || 1);
    return sum + price * qty;
  }, 0);
}

function formatDeclaredValueBR(decimalsValue) {
  const safe = Math.min(
    MAX_DECLARED_VALUE,
    Math.max(0, Math.round(decimalsValue * 100) / 100)
  );
  return safe.toFixed(2).replace(".", ",");
}

function parseCorreiosPrice(value) {
  if (typeof value !== "string") return NaN;
  const normalized = value.replace(/\./g, "").replace(/,/g, ".");
  return Number(normalized);
}

function parseCorreiosPrazo(value) {
  const prazo = Number.parseInt(value, 10);
  return Number.isFinite(prazo) && prazo > 0 ? prazo : null;
}

function decodeHtmlEntities(value = "") {
  return value
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, code) => {
      const num = Number(code);
      return Number.isFinite(num) ? String.fromCharCode(num) : _;
    });
}

function parseCorreiosXml(text) {
  if (typeof text !== "string" || !text.trim()) {
    return null;
  }

  const serviceMatches = Array.from(text.matchAll(/<cServico>([\s\S]*?)<\/cServico>/gi));
  if (!serviceMatches.length) {
    return null;
  }

  const services = serviceMatches.map((match) => {
    const chunk = match[1];
    const fields = {};
    chunk.replace(/<([A-Za-z0-9]+)>([\s\S]*?)<\/\1>/g, (_, tag, value) => {
      fields[tag] = decodeHtmlEntities(value.trim());
      return "";
    });
    return fields;
  });

  return { Servicos: { cServico: services } };
}

function parseCorreiosResponse(rawText) {
  if (!rawText) return null;

  if (typeof rawText === "object") {
    return rawText;
  }

  if (typeof rawText === "string") {
    try {
      const data = JSON.parse(rawText);
      if (data && typeof data === "object") {
        return data;
      }
    } catch (err) {
      // ignore JSON parse errors and try XML fallback
    }

    return parseCorreiosXml(rawText);
  }

  return null;
}

const CORREIOS_PROTOCOLS = ["https", "http"];
const CORREIOS_RETURN_TYPES = ["json", "xml"];
const CORREIOS_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function buildCorreiosUrl({
  serviceCode,
  destinationCep,
  weightKg,
  declaredValue,
  protocol = "https",
  returnType = "json",
}) {
  const params = new URLSearchParams({
    nCdEmpresa: "",
    sDsSenha: "",
    nCdServico: serviceCode,
    sCepOrigem: ORIGIN.cep,
    sCepDestino: destinationCep,
    nVlPeso: weightKg.toFixed(2),
    nCdFormato: PACKAGE_DIMENSIONS.formato,
    nVlComprimento: PACKAGE_DIMENSIONS.comprimento.toFixed(1),
    nVlAltura: PACKAGE_DIMENSIONS.altura.toFixed(1),
    nVlLargura: PACKAGE_DIMENSIONS.largura.toFixed(1),
    nVlDiametro: PACKAGE_DIMENSIONS.diametro.toFixed(1),
    sCdMaoPropria: "N",
    nVlValorDeclarado: formatDeclaredValueBR(declaredValue),
    sCdAvisoRecebimento: "N",
    StrRetorno: returnType,
  });

  const safeProtocol = CORREIOS_PROTOCOLS.includes(protocol) ? protocol : "https";
  return `${safeProtocol}://ws.correios.com.br/calculador/CalcPrecoPrazo.asmx/CalcPrecoPrazo?${params.toString()}`;
}

async function fetchCorreiosQuote({
  serviceCode,
  destinationCep,
  weightKg,
  declaredValue,
  protocol,
  returnType,
}) {
  const url = buildCorreiosUrl({
    serviceCode,
    destinationCep,
    weightKg,
    declaredValue,
    protocol,
    returnType,
  });

  const fetchFn = await ensureFetch();
  const headers = {
    "User-Agent": CORREIOS_USER_AGENT,
    Accept:
      returnType === "json"
        ? "application/json, text/javascript, */*; q=0.01"
        : "application/xml, text/xml, */*; q=0.01",
  };

  try {
    const response = await fetchFn(url, { headers, cache: "no-store" });
    if (!response.ok) {
      const error = new Error(`Correios HTTP ${response.status}`);
      error.status = response.status;
      error.url = url;
      error.retryable = response.status >= 500 || response.status === 429;
      throw error;
    }

    const rawText = await response.text();
    const data = parseCorreiosResponse(rawText);
    if (!data) {
      const error = new Error("Resposta inválida dos Correios");
      error.response = rawText;
      error.url = url;
      error.retryable = true;
      throw error;
    }

    return { data, rawText };
  } catch (err) {
    if (typeof err.retryable === "undefined") {
      err.retryable = true;
    }
    err.url = url;
    throw err;
  }
}

async function requestCorreiosQuote({ cep, items, subtotal, serviceKey }) {
  const service = CORREIOS_SERVICES[serviceKey] || CORREIOS_SERVICES[DEFAULT_SERVICE_KEY];
  const physicalWeightKg = computePhysicalWeightKg(items);
  const billedWeightKg = computeBillableWeightKg(physicalWeightKg);
  const declaredValue = computeSubtotal(items, subtotal);
  const attempts = [];
  for (const protocol of CORREIOS_PROTOCOLS) {
    for (const returnType of CORREIOS_RETURN_TYPES) {
      attempts.push({ protocol, returnType });
    }
  }

  let lastError = null;

  for (const attempt of attempts) {
    try {
      const { data } = await fetchCorreiosQuote({
        serviceCode: service.code,
        destinationCep: cep,
        weightKg: billedWeightKg,
        declaredValue,
        ...attempt,
      });

      const serviceList = Array.isArray(data?.Servicos?.cServico)
        ? data.Servicos.cServico
        : [];
      if (!serviceList.length) {
        const error = new Error("Resposta sem serviços dos Correios");
        error.attempt = attempt;
        error.retryable = true;
        throw error;
      }

      const serviceData = serviceList.find((item) => item?.Codigo === service.code) || serviceList[0];
      if (!serviceData) {
        const error = new Error("Serviço dos Correios indisponível");
        error.attempt = attempt;
        error.retryable = true;
        throw error;
      }

      const errorCode = (serviceData?.Erro || "0").toString().trim();
      if (errorCode !== "0") {
        const message = serviceData?.MsgErro || "Não foi possível obter o frete";
        const error = new Error(message);
        error.code = errorCode;
        error.retryable = false;
        throw error;
      }

      const cost = parseCorreiosPrice(serviceData?.Valor);
      if (!Number.isFinite(cost) || cost <= 0) {
        const error = new Error("Valor de frete não informado pelos Correios");
        error.attempt = attempt;
        error.retryable = true;
        throw error;
      }

      const prazo = parseCorreiosPrazo(serviceData?.PrazoEntrega);
      const deliveryEstimate = prazo
        ? `${prazo} dia${prazo > 1 ? "s" : ""} útil${prazo > 1 ? "eis" : ""}`
        : "Prazo informado pelos Correios no ato da postagem";

      return {
        method: "correios",
        service: serviceData?.Nome?.trim() || service.name,
        serviceCode: service.code,
        cost: Math.round(cost * 100) / 100,
        currency: "BRL",
        deliveryEstimate,
        deliveryDays: prazo ? { min: prazo, max: prazo } : null,
        calculatedAt: new Date().toISOString(),
        origin: { ...ORIGIN },
        originLabel: ORIGIN_LABEL,
        package: {
          weightKg: physicalWeightKg,
          billedWeightKg,
          declaredValue: Math.round(declaredValue * 100) / 100,
          dimensions: { ...PACKAGE_DIMENSIONS },
        },
        correiosAttempt: attempt,
      };
    } catch (err) {
      lastError = err;
      if (err && err.retryable === false) {
        throw err;
      }
      continue;
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error("Não foi possível calcular o frete com os Correios");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido" });
  }

  const payload = parseBody(req.body);
  const cep = sanitizeCep(payload?.cep || payload?.zip || "");
  if (!cep || cep.length !== 8) {
    return res.status(400).json({ error: "CEP inválido para cálculo de frete" });
  }

  const items = Array.isArray(payload?.items) ? payload.items.filter(Boolean) : [];
  if (!items.length) {
    return res.status(400).json({ error: "Nenhum item informado para cálculo de frete" });
  }

  const subtotalValue = Number(payload?.subtotal);
  const serviceKey = (payload?.service || payload?.method || DEFAULT_SERVICE_KEY)
    .toString()
    .toLowerCase();

  try {
    const result = await requestCorreiosQuote({
      cep,
      items,
      subtotal: Number.isFinite(subtotalValue) ? subtotalValue : undefined,
      serviceKey,
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error("Erro ao consultar frete dos Correios:", err);
    const message =
      err?.message ||
      "Não foi possível calcular o frete com os Correios neste momento.";
    return res.status(502).json({ error: message });
  }
};
