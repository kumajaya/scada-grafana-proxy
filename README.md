# SCADA Grafana Proxy

A simple proxy server for accessing Rapid SCADA 6 data via REST API and serving it in a format compatible with Grafana's Infinity Datasource.

## Features

- Basic authentication for secure access
- Forwards requests to Rapid SCADA and transforms responses for Grafana
- Environment-based configuration
- Health check endpoint

## Usage

1. Configure environment variables in `.env` (see `env-example`).
2. Install dependencies:
   ```
   npm install
   ```
3. Start the server:
   ```
   npm start
   ```
4. Access the proxy at `http://localhost:3000` (or your configured port).

## Systemd Service

A sample `scada-grafana-proxy.service` file is provided for running as a Linux service.

## License

MIT