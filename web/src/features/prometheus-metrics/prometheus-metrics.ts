import { env } from "@/src/env.mjs";
import { sharedPrometheusMetrics } from "@langfuse/shared/src/server/prometheus-metrics";

// Initialize metrics with environment configuration
sharedPrometheusMetrics.initialize(env.PROMETHEUS_METRICS_ENABLED === "true");

// Use the shared metrics service
export const prometheusMetrics = sharedPrometheusMetrics;
