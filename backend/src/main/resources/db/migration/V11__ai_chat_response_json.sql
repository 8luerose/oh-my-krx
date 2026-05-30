ALTER TABLE ai_chat_interactions
  ADD COLUMN response_json MEDIUMTEXT NULL AFTER limitations_json;
