const MELHOR_ENVIO_SERVICES_URL = "https://sandbox.melhorenvio.com.br/api/v2/me/shipment/services";

/**
 * Como usar este endpoint no Vercel:
 * 1. Cadastre a variável MELHOR_ENVIO_ACCESS_TOKEN com o token real no projeto.
 * 2. Faça o redeploy da aplicação para carregar a nova variável de ambiente.
 * 3. Acesse /api/melhorenvio-services para listar os serviços e obter os IDs de PAC e SEDEX.
 * 4. Configure MELHOR_ENVIO_SERVICE_PAC e MELHOR_ENVIO_SERVICE_SEDEX com os IDs retornados.
 */
function getFetch() {
  if (typeof fetch === "function") {
    return fetch.bind(globalThis);
  }
  // eslint-disable-next-line global-require
  const fetchModule = require("node-fetch");
  return (fetchModule && fetchModule.default) || fetchModule;
}

module.exports = async (req, res) => {
  if (req.method && req.method.toUpperCase() !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const token = process.env.MELHOR_ENVIO_ACCESS_TOKEN;

  if (!token) {
    console.error("Variável de ambiente MELHOR_ENVIO_ACCESS_TOKEN não configurada.");
    return res.status(500).json({ error: "Falha ao listar serviços" });
  }

  const fetch = getFetch();

  try {
    const response = await fetch(MELHOR_ENVIO_SERVICES_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      const error = new Error(`Melhor Envio retornou status ${response.status}`);
      error.status = response.status;
      error.body = errorBody;
      throw error;
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error("Falha ao listar serviços do Melhor Envio:", err);
    return res.status(500).json({ error: "Falha ao listar serviços" });
  }
};
