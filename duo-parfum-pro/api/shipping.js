const { parseStringPromise } = require("xml2js");

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

async function calculateCorreiosShipping({ cep, items, subtotal }) {
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

  const metrics = computeCartMetrics(normalizedItems, Number(subtotal));
  const declaredValue = metrics.subtotal;

  const services = [];
  const errors = [];

  for (const service of CORREIOS_SERVICES) {
    try {
      const quote = await requestCorreiosQuoteForService({
        service,
        destinationCep,
        billedWeightKg: metrics.billedWeightKg,
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
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido" });
  }

  const payload = parseBody(req.body);
  const cep = sanitizeCep(payload?.cep || payload?.zip || "");
  const items = Array.isArray(payload?.items) ? payload.items.filter(Boolean) : [];
  const subtotal = Number(payload?.subtotal);

  try {
    const result = await calculateCorreiosShipping({
      cep,
      items,
      subtotal: Number.isFinite(subtotal) ? subtotal : undefined,
    });

    return res.status(200).json(result);
  } catch (err) {
    const status = err?.status && Number.isInteger(err.status) ? err.status : 502;
    console.error("Erro ao consultar frete dos Correios:", err);
    const message =
      err?.message || "Não foi possível calcular o frete com os Correios neste momento.";
    return res.status(status).json({ error: message });
  }
};
