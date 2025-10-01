const { parseStringPromise } = require("xml2js");
const { getAccessToken } = require("./melhorenvio-auth");

const ORIGIN = {
  city: "Sorriso",
  state: "MT",
  cep: "78890000",
};

const ORIGIN_LABEL = `${ORIGIN.city} - ${ORIGIN.state}`;

const CORREIOS_SERVICES = [
  { key: "pac", code: "04510", name: "PAC" },
  { key: "sedex", code: "04014", name: "SEDEX" },
];

const DEFAULT_SERVICE_KEY = "pac";
const MAX_DECLARED_VALUE = 10000;
const MAX_WEIGHT_KG = 30;
const MIN_PHYSICAL_WEIGHT_KG = 0.1;
const MIN_BILLABLE_WEIGHT_KG = 0.3;
const PACKAGE_BUFFER_WEIGHT_KG = 0.05;
const ITEM_WEIGHT_KG = 0.045;
const PACKAGE_DIMENSIONS = {
  formato: "1",
  comprimento: 16,
  altura: 2,
  largura: 11,
  diametro: 0,
};

function getFetch() {
  if (typeof fetch === "function") {
    return fetch.bind(globalThis);
  }
  // eslint-disable-next-line global-require
  const fetchModule = require("node-fetch");
  return (fetchModule && fetchModule.default) || fetchModule;
}

const fetchFn = getFetch();

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch (err) {
      return {};
    }
  }
  if (typeof body === "object") return body;
  return {};
}

function sanitizeString(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function sanitizeCep(value = "") {
  return value.toString().replace(/\D/g, "").slice(0, 8);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundKg(value) {
  return Math.round(value * 1000) / 1000;
}

function computeCartMetrics(items = [], explicitSubtotal) {
  let quantity = 0;
  let subtotal = 0;

  items.forEach((rawItem) => {
    const qty = Math.max(1, toNumber(rawItem?.qty, 1));
    quantity += qty;
    const price = Math.max(0, toNumber(rawItem?.price, 0));
    subtotal += price * qty;
  });

  if (Number.isFinite(explicitSubtotal)) {
    subtotal = Math.max(subtotal, explicitSubtotal);
  }

  const physicalWeight = Math.min(
    MAX_WEIGHT_KG,
    Math.max(MIN_PHYSICAL_WEIGHT_KG, quantity * ITEM_WEIGHT_KG + PACKAGE_BUFFER_WEIGHT_KG)
  );
  const billedWeight = Math.min(
    MAX_WEIGHT_KG,
    Math.max(MIN_BILLABLE_WEIGHT_KG, physicalWeight)
  );

  return {
    quantity,
    subtotal: Math.round(subtotal * 100) / 100,
    physicalWeightKg: roundKg(physicalWeight),
    billedWeightKg: roundKg(billedWeight),
  };
}

function formatDeclaredValueBR(value) {
  const safe = Math.min(MAX_DECLARED_VALUE, Math.max(0, Math.round(value * 100) / 100));
  return safe.toFixed(2).replace(".", ",");
}

function resolveApiBase() {
  const explicit = sanitizeString(process.env.MELHOR_ENVIO_API_URL);
  if (explicit) return explicit;

  const env = sanitizeString(process.env.MELHOR_ENVIO_ENV || process.env.MELHOR_ENVIO_MODE).toLowerCase();
  if (env === "production" || env === "prod") {
    return "https://www.melhorenvio.com.br/api/v2";
  }

  return "https://sandbox.melhorenvio.com.br/api/v2";
}

function loadSenderConfig() {
  try {
    const rawJson = sanitizeString(
      process.env.MELHOR_ENVIO_SENDER_JSON ||
        process.env.MELHOR_ENVIO_FROM_JSON ||
        process.env.MELHOR_ENVIO_SENDER ||
        ""
    );
    if (rawJson) {
      const parsed = JSON.parse(rawJson);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    }
  } catch (err) {
    console.warn("MELHOR_ENVIO_SENDER_JSON inválido:", err);
  }

  return {
    name: sanitizeString(process.env.MELHOR_ENVIO_FROM_NAME || "Duo Parfum"),
    phone: sanitizeString(process.env.MELHOR_ENVIO_FROM_PHONE),
    email: sanitizeString(process.env.MELHOR_ENVIO_FROM_EMAIL || process.env.SUPPORT_EMAIL || ""),
    document: sanitizeString(process.env.MELHOR_ENVIO_FROM_DOCUMENT || process.env.MELHOR_ENVIO_DOCUMENT),
    postal_code: sanitizeCep(process.env.MELHOR_ENVIO_FROM_CEP || ORIGIN.cep),
    address: sanitizeString(process.env.MELHOR_ENVIO_FROM_ADDRESS),
    number: sanitizeString(process.env.MELHOR_ENVIO_FROM_NUMBER),
    complement: sanitizeString(process.env.MELHOR_ENVIO_FROM_COMPLEMENT),
    district: sanitizeString(process.env.MELHOR_ENVIO_FROM_DISTRICT),
    city: sanitizeString(process.env.MELHOR_ENVIO_FROM_CITY || ORIGIN.city),
    state_abbr: sanitizeString(process.env.MELHOR_ENVIO_FROM_STATE || ORIGIN.state),
    country: sanitizeString(process.env.MELHOR_ENVIO_FROM_COUNTRY || ORIGIN.country || "BR"),
  };
}

function buildMelhorEnvioConfig() {
  return {
    baseUrl: resolveApiBase(),
    userAgent: sanitizeString(process.env.MELHOR_ENVIO_USER_AGENT || "SiteDuoParfum/1.0"),
    sender: loadSenderConfig(),
  };
}

async function melhorEnvioRequest(config, path, { method = "GET", body } = {}) {
  let token;
  try {
    token = await getAccessToken();
  } catch (authError) {
    console.error("Falha ao autenticar no Melhor Envio:", authError);
    const error = new Error("Falha ao autenticar no Melhor Envio");
    error.status = 500;
    error.cause = authError;
    throw error;
  }

  const url = `${config.baseUrl}${path}`;
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "User-Agent": config.userAgent,
  };

  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const response = await fetchFn(url, { method, headers, body: payload });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (err) {
      console.warn("Resposta não JSON do Melhor Envio em", path, err);
    }
  }

  if (!response.ok) {
    const message = data?.message || data?.error || `Melhor Envio HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

function resolveServiceId(serviceCode) {
  const normalized = sanitizeString(serviceCode);
  if (!normalized) return null;
  const envDirect = sanitizeString(process.env[`MELHOR_ENVIO_SERVICE_${normalized}`]);
  if (envDirect) return envDirect;
  if (normalized === "04014") {
    return (
      sanitizeString(process.env.MELHOR_ENVIO_SERVICE_SEDEX) ||
      sanitizeString(process.env.MELHOR_ENVIO_SERVICE_SEDEX_ID) ||
      null
    );
  }
  if (normalized === "04510") {
    return (
      sanitizeString(process.env.MELHOR_ENVIO_SERVICE_PAC) ||
      sanitizeString(process.env.MELHOR_ENVIO_SERVICE_PAC_ID) ||
      null
    );
  }
  return null;
}

function buildVolumeForMelhorEnvio(metrics = {}) {
  const billedWeight = Number(Math.max(MIN_BILLABLE_WEIGHT_KG, metrics.billedWeightKg || MIN_BILLABLE_WEIGHT_KG).toFixed(3));
  return {
    height: PACKAGE_DIMENSIONS.altura,
    width: PACKAGE_DIMENSIONS.largura,
    length: PACKAGE_DIMENSIONS.comprimento,
    weight: billedWeight,
  };
}

function buildMelhorEnvioProducts(items = []) {
  if (!Array.isArray(items)) return [];

  return items.map((item, index) => {
    const qty = Math.max(1, toNumber(item?.qty, 1));
    const rawPrice = toNumber(item?.price, 0);
    const price = Number.isFinite(rawPrice) ? Math.max(0, rawPrice) : 0;
    const normalizedPrice = Math.round(price * 100) / 100;
    return {
      name: sanitizeString(item?.name || item?.title || `Produto ${index + 1}`),
      quantity: qty,
      unitary_value: Number.isFinite(normalizedPrice) ? normalizedPrice : 0,
    };
  });
}

function pickFirstFinite(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const num = Number(value);
    if (Number.isFinite(num)) {
      return num;
    }
  }
  return null;
}

function normalizeDeliveryInfo(quote = {}) {
  const time = quote?.delivery_time || quote?.deliveryTime || {};
  const min = pickFirstFinite(time.min, time.from, time.lower, time.days, time.day, quote?.min_delivery_time);
  const max = pickFirstFinite(time.max, time.to, time.upper, time.days, time.day, quote?.max_delivery_time);
  const estimate = pickFirstFinite(time.estimate, time.days, quote?.estimated_days);

  let deliveryDays = null;
  if (min !== null || max !== null) {
    const minValue = min !== null ? Math.round(min) : (max !== null ? Math.round(max) : null);
    const maxValue = max !== null ? Math.round(max) : (min !== null ? Math.round(min) : null);
    deliveryDays = {
      min: minValue !== null ? Math.max(0, minValue) : null,
      max: maxValue !== null ? Math.max(0, maxValue) : null,
    };
  } else if (estimate !== null) {
    const rounded = Math.max(0, Math.round(estimate));
    deliveryDays = { min: rounded, max: rounded };
  }

  const text =
    sanitizeString(time.full_text) ||
    sanitizeString(time.text) ||
    sanitizeString(time.description) ||
    sanitizeString(time.humanized) ||
    sanitizeString(quote?.deliveryRange);

  let deliveryEstimate = text;
  if (!deliveryEstimate && deliveryDays) {
    const minValue = deliveryDays.min ?? deliveryDays.max;
    const maxValue = deliveryDays.max ?? deliveryDays.min;
    if (minValue !== null && maxValue !== null && minValue !== maxValue) {
      deliveryEstimate = `${minValue} a ${maxValue} dias úteis`;
    } else if (minValue !== null) {
      deliveryEstimate = formatDeliveryEstimate(minValue);
    }
  }

  return {
    deliveryDays,
    deliveryEstimate,
  };
}

async function calculateMelhorEnvioShipping({ destinationCep, items, metrics }) {
  const config = buildMelhorEnvioConfig();
  const sender = config.sender || {};
  const senderCep = sanitizeCep(sender.postal_code || ORIGIN.cep);

  const servicesToRequest = CORREIOS_SERVICES.map((service) => ({
    ...service,
    melhorEnvioId: resolveServiceId(service.code),
  })).filter((service) => service.melhorEnvioId);

  if (!servicesToRequest.length) {
    const error = new Error("Serviços do Melhor Envio não configurados");
    error.code = "melhor_envio_service_not_configured";
    throw error;
  }

  const declaredValue = metrics.subtotal;
  const volume = buildVolumeForMelhorEnvio(metrics);
  const products = buildMelhorEnvioProducts(items);

  const shipments = servicesToRequest.map((service) => ({
    service: service.melhorEnvioId,
    from: {
      postal_code: senderCep,
      country: "BR",
    },
    to: {
      postal_code: destinationCep,
      country: "BR",
    },
    products,
    volumes: [volume],
    options: {
      receipt: false,
      own_hand: false,
      reverse: false,
      collect: false,
      non_commercial: true,
      insurance_value: Number(Math.max(0, declaredValue).toFixed(2)),
    },
  }));

  const response = await melhorEnvioRequest(config, "/me/shipment/calculate", {
    method: "POST",
    body: shipments,
  });

  const rawQuotes = Array.isArray(response) ? response : response?.data || [];
  const mapKey = (value) => sanitizeString(value).toLowerCase();
  const quotesByService = new Map();
  rawQuotes.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const id = mapKey(entry.service || entry.service_id || entry.serviceId || entry.id_service || entry.id);
    if (id) {
      quotesByService.set(id, entry);
    }
  });

  const services = [];
  const errors = [];

  servicesToRequest.forEach((service) => {
    const quote = quotesByService.get(mapKey(service.melhorEnvioId));
    const baseInfo = {
      method: "melhorenvio",
      name: service.name,
      serviceCode: service.code,
      calculatedAt: new Date().toISOString(),
    };

    if (!quote) {
      const message = "Serviço não retornado pelo Melhor Envio";
      services.push({
        ...baseInfo,
        currency: "BRL",
        cost: null,
        deliveryEstimate: "",
        deliveryDays: null,
        error: message,
      });
      errors.push({
        service: service.name,
        serviceCode: service.code,
        message,
        code: "not_found",
      });
      return;
    }

    const quoteError = quote.error || quote.error_message || quote.message;
    if (quoteError) {
      const message = sanitizeString(
        (typeof quoteError === "string" && quoteError) ||
          quote?.error?.message ||
          quote?.error_message ||
          "Serviço indisponível"
      ) || "Serviço indisponível";
      services.push({
        ...baseInfo,
        currency: "BRL",
        cost: null,
        deliveryEstimate: "",
        deliveryDays: null,
        error: message,
      });
      errors.push({
        service: service.name,
        serviceCode: service.code,
        message,
        code: sanitizeString(quote?.error?.code || quote?.error_code || quote?.code || ""),
      });
      return;
    }

    const rawCost = pickFirstFinite(
      quote.price,
      quote.total,
      quote.final_price,
      quote.cost,
      quote.delivery_price
    );

    if (!Number.isFinite(rawCost)) {
      const message = "Valor de frete não informado pelo Melhor Envio";
      services.push({
        ...baseInfo,
        cost: null,
        deliveryEstimate: "",
        deliveryDays: null,
        error: message,
      });
      errors.push({
        service: service.name,
        serviceCode: service.code,
        message,
        code: "missing_price",
      });
      return;
    }

    const deliveryInfo = normalizeDeliveryInfo(quote);
    const currency =
      sanitizeString(quote.currency || quote.currency_code || quote.currencyCode || "BRL") || "BRL";

    services.push({
      ...baseInfo,
      currency,
      cost: Math.round(rawCost * 100) / 100,
      deliveryEstimate: deliveryInfo.deliveryEstimate || "",
      deliveryDays: deliveryInfo.deliveryDays,
      error: null,
    });
  });

  const preferredServiceCode =
    services.find((service) => service.serviceCode === CORREIOS_SERVICES[0].code)?.serviceCode ||
    services[0]?.serviceCode ||
    CORREIOS_SERVICES.find((service) => service.key === DEFAULT_SERVICE_KEY)?.code ||
    null;

  return {
    origin: { ...ORIGIN },
    originLabel: ORIGIN_LABEL,
    destinationCep,
    itemCount: metrics.quantity,
    package: {
      weightKg: metrics.physicalWeightKg,
      billedWeightKg: metrics.billedWeightKg,
      declaredValue,
      dimensions: { ...PACKAGE_DIMENSIONS },
    },
    services,
    errors,
    calculatedAt: new Date().toISOString(),
    preferredServiceCode,
    provider: "melhorenvio",
  };
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

async function parseCorreiosResponse(raw) {
  if (!raw) return null;

  if (typeof raw === "object") {
    return raw;
  }

  if (typeof raw === "string") {
    try {
      const json = JSON.parse(raw);
      if (json && typeof json === "object") {
        return json;
      }
    } catch (err) {
      // ignore JSON parse error and fallback to XML
    }

    try {
      const xml = await parseStringPromise(raw, {
        explicitArray: false,
        ignoreAttrs: true,
        trim: true,
      });
      return xml;
    } catch (err) {
      return null;
    }
  }

  return null;
}

function normalizeCorreiosService(rawService = {}) {
  const normalized = {};
  Object.keys(rawService || {}).forEach((key) => {
    normalized[key.toLowerCase()] = rawService[key];
  });
  return normalized;
}

function extractCorreiosServices(data) {
  if (!data || typeof data !== "object") return [];

  const servicos =
    data.Servicos ||
    data.servicos ||
    data.CResultado ||
    data.cResultado ||
    data.cservico ||
    null;

  if (!servicos) return [];

  const list = servicos.cServico || servicos.CServico || servicos.servico || servicos.Servico;
  if (!list) return [];
  if (Array.isArray(list)) return list;
  return [list];
}

function buildCorreiosUrl({ serviceCode, destinationCep, weightKg, declaredValue }) {
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
    StrRetorno: "json",
  });

  return `https://ws.correios.com.br/calculador/CalcPrecoPrazo.asmx/CalcPrecoPrazo?${params.toString()}`;
}

function formatDeliveryEstimate(prazo) {
  if (!prazo) {
    return "Prazo informado pelos Correios no ato da postagem";
  }
  return `${prazo} dia${prazo > 1 ? "s" : ""} útil${prazo > 1 ? "eis" : ""}`;
}

async function requestCorreiosQuoteForService({
  service,
  destinationCep,
  billedWeightKg,
  declaredValue,
}) {
  const url = buildCorreiosUrl({
    serviceCode: service.code,
    destinationCep,
    weightKg: billedWeightKg,
    declaredValue,
  });

  const response = await fetchFn(url, { method: "GET", cache: "no-store" });
  if (!response.ok) {
    const error = new Error(`Correios HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const rawText = await response.text();
  const data = await parseCorreiosResponse(rawText);
  if (!data) {
    const error = new Error("Resposta inválida dos Correios");
    error.response = rawText;
    throw error;
  }

  const serviceList = extractCorreiosServices(data).map(normalizeCorreiosService);
  if (!serviceList.length) {
    throw new Error("Serviço dos Correios indisponível");
  }

  const normalizedCode = service.code.toLowerCase();
  const serviceData =
    serviceList.find((item) => (item.codigo || item.code || "").toString() === service.code) ||
    serviceList.find((item) => (item.codigo || item.code || "").toString().toLowerCase() === normalizedCode) ||
    serviceList[0];

  if (!serviceData) {
    throw new Error("Serviço dos Correios indisponível");
  }

  const errorCode = (serviceData.erro || serviceData.error || "0").toString().trim();
  if (errorCode && errorCode !== "0") {
    const message =
      serviceData.msgerro ||
      serviceData.mensagem ||
      serviceData.msgErro ||
      serviceData.msgerro ||
      "Não foi possível obter o frete";
    const err = new Error(message);
    err.code = errorCode;
    throw err;
  }

  const cost = parseCorreiosPrice(serviceData.valor || serviceData.custo || serviceData.valorcomdesconto);
  if (!Number.isFinite(cost) || cost <= 0) {
    throw new Error("Valor de frete não informado pelos Correios");
  }

  const prazo =
    parseCorreiosPrazo(serviceData.prazoentrega || serviceData.prazo || serviceData.prazoEntrega) ||
    null;

  return {
    method: "correios",
    name: serviceData.nome?.trim() || service.name,
    serviceCode: service.code,
    cost: Math.round(cost * 100) / 100,
    currency: "BRL",
    deliveryEstimate: formatDeliveryEstimate(prazo),
    deliveryDays: prazo ? { min: prazo, max: prazo } : null,
    calculatedAt: new Date().toISOString(),
    error: null,
  };
}

async function calculateCorreiosShipping({ cep, items, subtotal, metrics }) {
  const destinationCep = sanitizeCep(cep);
  if (!destinationCep || destinationCep.length !== 8) {
    const error = new Error("CEP inválido para cálculo de frete");
    error.status = 400;
    throw error;
  }

  const normalizedItems = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!normalizedItems.length) {
    const error = new Error("Nenhum item informado para cálculo de frete");
    error.status = 400;
    throw error;
  }

  const computedMetrics =
    metrics && typeof metrics === "object"
      ? metrics
      : computeCartMetrics(normalizedItems, Number(subtotal));
  const declaredValue = computedMetrics.subtotal;

  const services = [];
  const errors = [];

  for (const service of CORREIOS_SERVICES) {
    try {
      const quote = await requestCorreiosQuoteForService({
        service,
        destinationCep,
        billedWeightKg: computedMetrics.billedWeightKg,
        declaredValue,
      });
      services.push(quote);
    } catch (err) {
      services.push({
        method: "correios",
        name: service.name,
        serviceCode: service.code,
        cost: null,
        currency: "BRL",
        deliveryEstimate: "",
        deliveryDays: null,
        calculatedAt: new Date().toISOString(),
        error: err?.message || "Serviço indisponível",
      });
      errors.push({
        service: service.name,
        serviceCode: service.code,
        message: err?.message || "Serviço indisponível",
        code: err?.code || null,
      });
    }
  }

  const validServices = services.filter((service) => Number.isFinite(service.cost) && !service.error);
  validServices.sort((a, b) => a.cost - b.cost);

  const preferredServiceCode =
    validServices.find((service) => service.serviceCode === CORREIOS_SERVICES[0].code)?.serviceCode ||
    validServices[0]?.serviceCode ||
    CORREIOS_SERVICES.find((service) => service.key === DEFAULT_SERVICE_KEY)?.code ||
    null;

  return {
    origin: { ...ORIGIN },
    originLabel: ORIGIN_LABEL,
    destinationCep,
    itemCount: computedMetrics.quantity,
    package: {
      weightKg: computedMetrics.physicalWeightKg,
      billedWeightKg: computedMetrics.billedWeightKg,
      declaredValue,
      dimensions: { ...PACKAGE_DIMENSIONS },
    },
    services,
    errors,
    calculatedAt: new Date().toISOString(),
    preferredServiceCode,
    provider: "correios",
  };
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

  const subtotal = Number(payload?.subtotal);
  const metrics = computeCartMetrics(items, Number.isFinite(subtotal) ? subtotal : undefined);

  try {
    const shouldUseMelhorEnvio = CORREIOS_SERVICES.some((service) => resolveServiceId(service.code));
    let melhorEnvioResult = null;
    let melhorEnvioError = null;

    if (shouldUseMelhorEnvio) {
      try {
        melhorEnvioResult = await calculateMelhorEnvioShipping({
          destinationCep: cep,
          items,
          metrics,
        });
      } catch (err) {
        console.error("Erro ao consultar frete no Melhor Envio:", err);
        melhorEnvioError = err;
      }
    }

    let responsePayload = melhorEnvioResult;

    const hasValidMelhorEnvioServices =
      responsePayload &&
      Array.isArray(responsePayload.services) &&
      responsePayload.services.some((service) => Number.isFinite(service?.cost));

    if (!hasValidMelhorEnvioServices) {
      responsePayload = await calculateCorreiosShipping({
        cep,
        items,
        subtotal: metrics.subtotal,
        metrics,
      });

      if (!Array.isArray(responsePayload.errors)) {
        responsePayload.errors = [];
      }

      if (melhorEnvioError) {
        responsePayload.errors.push({
          service: "Melhor Envio",
          serviceCode: null,
          message: melhorEnvioError.message || "Não foi possível consultar o Melhor Envio",
          code: melhorEnvioError.code || melhorEnvioError.status || null,
        });
      }

      return res.status(200).json(responsePayload);
    }

    if (!Array.isArray(responsePayload.errors)) {
      responsePayload.errors = [];
    }

    if (melhorEnvioError) {
      responsePayload.errors.push({
        service: "Melhor Envio",
        serviceCode: null,
        message: melhorEnvioError.message || "Ocorreram problemas ao consultar o Melhor Envio",
        code: melhorEnvioError.code || melhorEnvioError.status || null,
      });
    }

    return res.status(200).json(responsePayload);
  } catch (err) {
    const status = err?.status && Number.isInteger(err.status) ? err.status : 502;
    console.error("Erro ao consultar frete dos Correios:", err);
    const message =
      err?.message || "Não foi possível calcular o frete com os Correios neste momento.";
    return res.status(status).json({ error: message });
  }
};
