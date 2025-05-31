const axios = require('axios');
const config = require('./config');

let cookieJar = [];

async function login() {
  const url = `${config.scada.baseUrl}/Api/Auth/Login`;
  const payload = {
    Username: config.scada.username,
    Password: config.scada.password,
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        Accept: 'application/json;charset=utf-8',
        'Content-Type': 'application/json',
      },
      withCredentials: true,
    });

    console.log(`[CLIENT] Login status: ${response.status}`);
    const setCookieHeaders = response.headers['set-cookie'];
    if (!setCookieHeaders) {
      throw new Error('[CLIENT] No set-cookie header received from SCADA.');
    }

    if (response.data && response.data.success === false) {
      throw new Error('[CLIENT] SCADA login failed: ' + ((response.data && response.data.message) || 'Unknown error'));
    }

    cookieJar = setCookieHeaders.map(cookie => cookie.split(';')[0]);
  } catch (err) {
    console.error('[CLIENT] Login to SCADA failed:', err.message);
    throw err;
  }
}

function getSessionCookies() {
  return cookieJar;
}

async function ensureLogin() {
  if (!cookieJar.length) {
    await login();
  }
}

async function forceLogin() {
  cookieJar = [];
  await login();
}

module.exports = {
  login,
  getSessionCookies,
  ensureLogin,
  forceLogin,
};
