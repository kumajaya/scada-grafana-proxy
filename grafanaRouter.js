const express = require('express');
const axios = require('axios');
const router = express.Router();
const config = require('./config');
const { getSessionCookies, ensureLogin, forceLogin } = require('./scadaClient');

router.get('/Api/Main/GetHistData', async (req, res) => {
  if (!req.query || !req.query.cnlNums || !req.query.startTime || !req.query.endTime) {
    return res.status(400).json({ message: '[ROUTER] Missing required query parameters' });
  }

  const url = `${config.scada.baseUrl}/Api/Main/GetHistData`;

  try {
    await ensureLogin();
    const cookies = getSessionCookies();

    const response = await axios.get(url, {
      headers: {
        Accept: 'application/json;charset=utf-8',
        Cookie: cookies.join('; '),
        'User-Agent': 'Mozilla/5.0',
      },
      params: req.query,
    });

    console.log('[ROUTER] Fetching data from SCADA with params:', req.query);
    try {
      const transformed = transformSCADAResponse(response);
      return res.json(transformed);
    } catch (transformError) {
      return res.status(500).json({
        message: '[ROUTER] Error transforming SCADA response',
        details: transformError.message,
      });
    }
  } catch (error) {
    if (error.response?.status === 401) {
      console.warn(`[ROUTER] Session expired. Re-authenticating...`);
      await forceLogin();
      const cookies = getSessionCookies();

      try {
        const retryResponse = await axios.get(url, {
          headers: {
            Accept: 'application/json;charset=utf-8',
            Cookie: cookies.join('; '),
            'User-Agent': 'Mozilla/5.0',
          },
          params: req.query,
        });

        return res.json(transformSCADAResponse(retryResponse));
      } catch (retryError) {
        return res.status(retryError.response?.status || 500).json({
          message: '[ROUTER] Error after retrying login',
          details: retryError.response?.data || retryError.message,
        });
      }
    }

    res.status(error.response?.status || 500).json({
      message: '[ROUTER] Error forwarding request to SCADA',
      details: error.response?.data || error.message,
    });
  }
});

router.post('/api/trends/query', async (req, res) => {
  // Body dari Grafana langsung diteruskan ke plugin
  const url = `${config.scada5.baseUrl}/api/trends/query`;

  try {
    const response = await axios.post(url, req.body, {
      headers: {
        Accept: 'application/json;charset=utf-8',
        'User-Agent': 'Mozilla/5.0',
      }
    });

    let data = response.data;

    if (isTimeSeriesFormat(data)) {
      data = transformToFlat(data);
    } else if (!isFlatFormat(data)) {
      return res.status(400).json({ error: '[ROUTER] Unknown data format from upstream' });
    }

    return res.json(data);

  } catch (error) {
    res.status((error && error.response && error.response.status) || 500).json({
      message: '[ROUTER] Error forwarding request to SCADA 5',
      details: (error && error.response && error.response.data) || error.message,
    });
  }
});

router.get('/health', (req, res) => res.send('SCADA Grafana Proxy is running'));

function transformSCADAResponse(response) {
  const { data } = response;
  if (!data?.data?.timestamps || !data?.data?.trends || !data?.data?.cnlNums) {
    console.error('[ROUTER] SCADA response format invalid:', data);
    throw new Error('[ROUTER] Invalid SCADA response format');
  }

  const timestamps = data.data.timestamps.map(ts => ts.ms);

  return (data.data.trends || []).flatMap((trendValues, index) => {
    const channel = data.data.cnlNums?.[index] ?? null;
    return (trendValues || []).map((item, i) => ({
      timestamp: timestamps?.[i] ?? null,
      channel,
      value: item?.d?.val ?? null,
    }));
  });
}

// Fungsi deteksi dan transformasi format
function isTimeSeriesFormat(data) {
  return Array.isArray(data) && data.length > 0 && data[0].datapoints;
}

function isFlatFormat(data) {
  return Array.isArray(data) && typeof data[0] === 'object' && 'timestamp' in data[0] && 'value' in data[0] && 'target' in data[0];
}

function transformToFlat(data) {
  // Transformasi dari timeseries ke flat array of objects
  const transformed = [];
  for (let i = 0; i < data.length; i++) {
    const series = data[i];
    if (!series.datapoints) continue;
    const target = series.target;
    const datapoints = series.datapoints;
    for (let j = 0; j < datapoints.length; j++) {
      const dp = datapoints[j];
      transformed.push({
        timestamp: dp[1],
        value: dp[0],
        target: target
      });
    }
  }
  return transformed;
}

module.exports = router;
