require('dotenv').config();

module.exports = {
  proxy: {
    port: process.env.PROXY_PORT || 3000,
    username: process.env.PROXY_USER || 'admin',
    password: process.env.PROXY_PASS || 'secret',
  },
  scada: {
    baseUrl: process.env.SCADA_BASE_URL || 'http://localhost:10008',
    username: process.env.SCADA_USERNAME || 'scada',
    password: process.env.SCADA_PASSWORD || 'secret',
  },
  scada5: {
    baseUrl: process.env.SCADA5_BASE_URL || 'http://localhost/grafanadataprovider',
  },
};
