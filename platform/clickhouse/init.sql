-- TITAN Gateway — ClickHouse analytics schema.
--
-- Ingestion path: gateway → Redpanda topic "audit_logs" (JSONEachRow) →
-- Kafka engine table → materialized view → MergeTree. No application code
-- is involved in the write path; ClickHouse consumes the topic natively
-- under its own consumer group ("clickhouse-audit"), independent of the
-- Go consumer that persists rows to CockroachDB/PostgreSQL.
--
-- Mounted into the container at /docker-entrypoint-initdb.d/ so it runs
-- exactly once on first start (empty data volume).

CREATE DATABASE IF NOT EXISTS titan;

-- Long-term analytics store. Partitioned by month, 90-day TTL.
CREATE TABLE IF NOT EXISTS titan.audit_events
(
    event_id    String,
    request_id  String,
    tenant_id   String,
    api_key_id  String,
    action      LowCardinality(String),
    risk_score  Float64,
    provider    LowCardinality(String),
    model       LowCardinality(String),
    prompt      String CODEC(ZSTD(3)),
    status_code Int32,
    latency_ms  Int64,
    path        String,
    reason      String,
    region      LowCardinality(String),
    timestamp   DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (tenant_id, timestamp)
TTL toDateTime(timestamp) + INTERVAL 90 DAY;

-- Kafka source table. The timestamp arrives as an RFC3339 string and is
-- parsed in the materialized view (JSONEachRow + DateTime64 parsing of
-- arbitrary ISO offsets is unreliable across versions).
CREATE TABLE IF NOT EXISTS titan.audit_events_kafka
(
    event_id    String,
    request_id  String,
    tenant_id   String,
    api_key_id  String,
    action      String,
    risk_score  Float64,
    provider    String,
    model       String,
    prompt      String,
    status_code Int32,
    latency_ms  Int64,
    path        String,
    reason      String,
    region      String,
    timestamp   String
)
ENGINE = Kafka
SETTINGS
    kafka_broker_list = 'redpanda:29092',
    kafka_topic_list = 'audit_logs',
    kafka_group_name = 'clickhouse-audit',
    kafka_format = 'JSONEachRow',
    kafka_num_consumers = 1,
    kafka_skip_broken_messages = 100;

CREATE MATERIALIZED VIEW IF NOT EXISTS titan.audit_events_mv
TO titan.audit_events
AS SELECT
    event_id,
    request_id,
    tenant_id,
    api_key_id,
    action,
    risk_score,
    provider,
    model,
    prompt,
    status_code,
    latency_ms,
    path,
    reason,
    region,
    parseDateTime64BestEffortOrZero(timestamp, 3, 'UTC') AS timestamp
FROM titan.audit_events_kafka;
