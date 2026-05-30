ALTER TABLE portfolio_items
  ADD COLUMN average_price DOUBLE NULL,
  ADD COLUMN holding_period VARCHAR(40) NULL,
  ADD COLUMN risk_tolerance VARCHAR(40) NULL;
