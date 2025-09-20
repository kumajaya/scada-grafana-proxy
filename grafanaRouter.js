const express = require('express');
const compression = require('compression');
const axios = require('axios');
const router = express.Router();
const config = require('./config');
const { getSessionCookies, ensureLogin, forceLogin } = require('./scadaClient');

// Terapkan compression untuk seluruh route di router ini
router.use(compression());

router.get('/Api/Main/GetHistData', async (req, res) => {
  const applyTotalizerTransform = req.query.transform === 'true'; // Hanya jika string "true" yang masuk

  if (!req.query || !req.query.cnlNums || !req.query.startTime || !req.query.endTime) {
    return res.status(400).json({ message: '[ROUTER] Missing required query parameters' });
  }

  if (!req.query.archiveBit) {
    // Set archiveBit berdasarkan startTime dan endTime
    const timeDiff = new Date(req.query.endTime) - new Date(req.query.startTime);
    const hoursDiff = timeDiff / (1000 * 60 * 60);
    req.query.archiveBit = hoursDiff <= config.scada.archiveBit ? 1 : 2;
  }

  if (!req.query.endInclusive) {
    // Defaultkan endInclusive ke true jika tidak ada
    req.query.endInclusive = true;
  }

  // Rekontruksi query object dengan archiveBit di index 0
  const { startTime, endTime, endInclusive, cnlNums } = req.query;
  const reorderedQuery = { archiveBit: req.query.archiveBit, startTime, endTime, endInclusive, cnlNums };

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
      params: reorderedQuery,
    });

    console.log('[ROUTER] Fetching data from SCADA with params:', reorderedQuery);
    try {
      let transformed = transformSCADAResponse(response);
      // Terapkan transformasi flowrate jika diminta
      if (applyTotalizerTransform) {
        transformed = transformTotalizer(transformed);
      }
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
          params: reorderedQuery,
        });

        let transformed = transformSCADAResponse(retryResponse);
        // Terapkan transformasi flowrate jika diminta
        if (applyTotalizerTransform) {
          transformed = transformTotalizer(transformed);
        }
        return res.json(transformed);
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

  const applyTotalizerTransform = req.body.transform === true; // Hanya jika boolean true yang masuk

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

    // Terapkan transformasi totalizer jika diminta
    if (applyTotalizerTransform) {
      console.log('[ROUTER] Applying totalizer transformation');
      data = transformTotalizer(data);
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

// Fungsi transformasi totalizer ke flowrate
function transformTotalizer(data) {
  if (!Array.isArray(data) || data.length === 0) {
    console.warn("[ROUTER] Invalid input data for totalizer transformation");
    return [];
  }

  // Kelompokkan data berdasarkan 'channel'
  const groupedByChannel = {};
  const channelOrder = []; // Array untuk melacak urutan channel
  data.forEach(item => {
    // Pastikan item dan channel-nya valid sebelum dikelompokkan
    if (item && item.channel !== undefined && item.channel !== null) {
      if (!groupedByChannel[item.channel]) {
        groupedByChannel[item.channel] = [];
        channelOrder.push(item.channel); // Tambahkan channel ke urutan
      }
      groupedByChannel[item.channel].push(item);
    }
  });

  let allTransformedResults = [];

  // Iterasi setiap kelompok channel dan terapkan logika totalizer
  for (const channelKey of channelOrder) {
    const channelData = groupedByChannel[channelKey];

    // Pastikan data dalam channel terurut berdasarkan timestamp
    channelData.sort((a, b) => a.timestamp - b.timestamp);

    const transformedChannelData = channelData.map((currentItem, index, array) => {
      // Lewati elemen pertama karena tidak ada nilai sebelumnya sebagai pengurang
      if (index === 0) {
        return null; // Akan difilter nanti
      }

      const previousItem = array[index - 1];

      // Pemeriksaan untuk null/undefined pada properti
      if (currentItem.value === null || currentItem.value === undefined ||
          previousItem.value === null || previousItem.value === undefined) {
        return null;
      }

      const timestampDiffMs = currentItem.timestamp - previousItem.timestamp;
      // 3600000 milidetik = 1 jam
      const timestampDiffHours = timestampDiffMs / 3600000;

      let valueDiff;

      // Jika salah satu nilai nol, valueDiff menjadi nol
      if (currentItem.value === 0 || previousItem.value === 0) {
        valueDiff = 0;
      } else {
        valueDiff = currentItem.value - previousItem.value;
        // Pastikan valueDiff tidak negatif
        if (valueDiff < 0) {
          valueDiff = 0;
        }
      }

      // Pastikan timestampDiffMs tidak nol untuk menghindari pembagian dengan nol
      let calculatedValue = 0;
      if (timestampDiffHours !== 0) {
        calculatedValue = valueDiff / timestampDiffHours;
      }
      // Jika timestampDiffHours adalah 0 (misalnya, dua entri data memiliki timestamp yang sama),
      // atau jika timestampDiffHours adalah NaN (karena timestamp asli null/undefined),
      // maka calculatedValue akan tetap 0.

      return {
        timestamp: currentItem.timestamp,
        channel: currentItem.channel,
        value: calculatedValue
      };
    }).filter(item => item !== null); // Filter elemen null dari hasil map setiap channel

    // Gabungkan hasil transformasi dari channel ini ke dalam array hasil keseluruhan
    allTransformedResults = allTransformedResults.concat(transformedChannelData);
  }

  // Kembalikan semua hasil yang sudah digabungkan dari semua channel
  return allTransformedResults;
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
        target: target,
        channel: target // Untuk kompatibilitas dengan transformTotalizer
      });
    }
  }
  return transformed;
}

module.exports = router;
