---
title: "Set Up Prometheus and Grafana Monitoring in 10 Minutes"
description: "A practical guide to setting up Prometheus and Grafana for Kubernetes monitoring. Includes Docker Compose configs, alert rules, and a pre-built dashboard you can deploy immediately."
date: 2026-04-02
keywords: "Prometheus, Grafana, monitoring, Kubernetes, DevOps, observability, Docker Compose, alerting"
ogTitle: "Set Up Prometheus and Grafana Monitoring in 10 Minutes"
ogDescription: "Deploy Prometheus and Grafana with Docker Compose. Includes pre-configured alert rules and dashboards."
badges: ["Monitoring", "Prometheus", "Grafana", "DevOps"]
related: ["why-i-run-nixos", "kubernetes-bare-metal", "freebsd-pf-router"]
---
## Why Every Team Needs Real Monitoring

If your idea of "monitoring" is SSHing into a server and running `top`, this post is for you. **Prometheus** and **Grafana** give you real-time visibility into your infrastructure, CPU, memory, disk, network, service health, all in one dashboard.

The best part? You can have it running in under 10 minutes with Docker Compose.

## The Stack

-   **Prometheus**: Collects and stores time-series metrics
-   **Grafana**: Beautiful dashboards and alerting
-   **Node Exporter**: Host-level metrics (CPU, RAM, disk, network)
-   **Alertmanager**: Routes alerts to Slack, email, PagerDuty
-   **cAdvisor**: Container-level metrics

## Quick Start

Create a `docker-compose.yml` with the full monitoring stack:

```
services:
  prometheus:
    image: prom/prometheus:v2.51.0
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    ports:
      - "9090:9090"
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=15d'

  grafana:
    image: grafana/grafana:10.4.0
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=changeme
    volumes:
      - grafana_data:/var/lib/grafana

  node-exporter:
    image: prom/node-exporter:v1.7.0
    ports:
      - "9100:9100"
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro

volumes:
  prometheus_data:
  grafana_data:
```

Run it:

```
$ docker compose up -d
$ open http://localhost:3000  # Grafana (admin/changeme)
$ open http://localhost:9090  # Prometheus
```

## Prometheus Configuration

Save this as `prometheus.yml`:

```
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'node-exporter'
    static_configs:
      - targets: ['node-exporter:9100']

  - job_name: 'cadvisor'
    static_configs:
      - targets: ['cadvisor:8080']
```

## Alert Rules

Don't just collect metrics, act on them. Here are four essential alerts:

```
groups:
  - name: node_alerts
    rules:
      - alert: HighMemoryUsage
        expr: (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) > 0.85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Memory above 85% for 5 minutes"

      - alert: HighCpuUsage
        expr: 100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80
        for: 10m
        labels:
          severity: warning

      - alert: DiskSpaceLow
        expr: (node_filesystem_avail_bytes / node_filesystem_size_bytes) < 0.10
        for: 5m
        labels:
          severity: critical

      - alert: ServiceDown
        expr: up == 0
        for: 1m
        labels:
          severity: critical
```

## Grafana Dashboard

Once Grafana is running, add Prometheus as a data source (`http://prometheus:9090`) and create a dashboard with these panels:

-   **CPU Usage**: `100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)`
-   **Memory Usage**: `1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)`
-   **Disk Usage**: `1 - (node_filesystem_avail_bytes / node_filesystem_size_bytes)`
-   **Network I/O**: `rate(node_network_receive_bytes_total[5m])`

<div style="background: var(--bg-surface); padding: 1rem; border: 1px solid var(--border-accent); border-left: 3px solid var(--accent-primary); margin: 1.5rem 0;"><p style="margin: 0;"><strong>Shortcut:</strong> Don't want to configure all this manually? I packaged the entire monitoring stack, Docker Compose, Prometheus config, alert rules, Grafana provisioning, and a pre-built dashboard, as a ready-to-deploy toolkit. Just <code>docker compose up -d</code> and you're monitoring.</p></div>

## Going to Production

The Docker Compose setup is great for dev/small deployments. For production:

-   **Persistent storage**: Use named volumes or cloud block storage
-   **TLS**: Put Grafana behind a reverse proxy with HTTPS
-   **Alertmanager**: Route alerts to Slack, PagerDuty, or email
-   **Remote write**: Send metrics to Thanos or Cortex for long-term storage
-   **Kubernetes**: Use the Prometheus Operator for managed deployments

## What to Monitor

Start with these, then expand:

-   **The Four Golden Signals**: Latency, Traffic, Errors, Saturation
-   **Infrastructure**: CPU, memory, disk, network
-   **Application**: Request rate, error rate, response time
-   **Business**: User signups, revenue, conversion rate

## Conclusion

Monitoring isn't optional. It's the difference between finding out about a problem from your users or from your alerts. Prometheus and Grafana give you production-grade monitoring with minimal setup.

Start with the Docker Compose setup, get comfortable with the basics, then scale up as your needs grow. Your future self (and your on-call rotation) will thank you.

Questions? [Get in touch](../contact).
