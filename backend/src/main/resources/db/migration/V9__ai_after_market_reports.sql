CREATE TABLE IF NOT EXISTS ai_after_market_reports (
  report_date DATE NOT NULL,
  response_mode VARCHAR(80) NULL,
  provider VARCHAR(80) NULL,
  model VARCHAR(160) NULL,
  mood VARCHAR(80) NULL,
  market_bias VARCHAR(80) NULL,
  response_json MEDIUMTEXT NOT NULL,
  generated_trigger VARCHAR(80) NULL,
  audit_interaction_id BIGINT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (report_date),
  INDEX idx_ai_after_market_reports_updated (updated_at),
  INDEX idx_ai_after_market_reports_audit (audit_interaction_id)
);
