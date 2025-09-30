const fetch = require('node-fetch');
const { URLSearchParams } = require('url');

let cachedToken = null;
let tokenExpiresAt = 0;

const TOKEN_ENDPOINT = 'https://sandbox.melhorenvio.com.br/oauth/token';
const EXPIRATION_BUFFER_SECONDS = 60; // refresh a little earlier than actual expiry

async function requestNewToken() {
  const clientId = process.env.MELHOR_ENVIO_CLIENT_ID;
  const clientSecret = process.env.MELHOR_ENVIO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    const missing = [
      !clientId ? 'MELHOR_ENVIO_CLIENT_ID' : null,
      !clientSecret ? 'MELHOR_ENVIO_CLIENT_SECRET' : null,
    ]
      .filter(Boolean)
      .join(', ');

    const error = new Error(
      `Variáveis de ambiente ausentes para autenticação do Melhor Envio: ${missing}`
    );
    console.error(error.message);
    throw error;
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });

    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Falha ao solicitar token do Melhor Envio:', response.status, errorText);
      throw new Error('Não foi possível autenticar com o Melhor Envio.');
    }

    const data = await response.json();

    if (!data.access_token) {
      console.error('Resposta inesperada do Melhor Envio:', data);
      throw new Error('Resposta inválida ao solicitar token do Melhor Envio.');
    }

    cachedToken = data.access_token;

    if (typeof data.expires_in === 'number') {
      const expiresInMs = Math.max(data.expires_in - EXPIRATION_BUFFER_SECONDS, 0) * 1000;
      tokenExpiresAt = Date.now() + expiresInMs;
    } else {
      // Assume default validity of 1 hour if not informed.
      tokenExpiresAt = Date.now() + (3600 - EXPIRATION_BUFFER_SECONDS) * 1000;
    }

    return cachedToken;
  } catch (error) {
    console.error('Erro ao obter token de acesso do Melhor Envio:', error);
    throw error;
  }
}

async function getAccessToken() {
  if (cachedToken && tokenExpiresAt && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  return requestNewToken();
}

module.exports = {
  getAccessToken,
};
