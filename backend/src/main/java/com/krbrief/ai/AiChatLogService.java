package com.krbrief.ai;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AiChatLogService {
  private final AiChatInteractionRepository repository;
  private final ObjectMapper objectMapper;

  public AiChatLogService(AiChatInteractionRepository repository, ObjectMapper objectMapper) {
    this.repository = repository;
    this.objectMapper = objectMapper;
  }

  @Transactional
  public Map<String, Object> save(Map<String, Object> request, Map<String, Object> response) {
    try {
      Map<String, Object> context = map(request.get("context"));
      Map<String, Object> retrieval = map(response.get("retrieval"));
      Map<String, Object> llm = map(retrieval.get("llm"));
      String answer = text(response.get("answer"));
      AiChatInteraction saved =
          repository.save(
              new AiChatInteraction(
                  firstNonBlank(text(request.get("stockCode")), text(context.get("stockCode")), text(context.get("code"))),
                  firstNonBlank(text(request.get("stockName")), text(context.get("stockName"))),
                  text(request.get("question")),
                  text(response.get("mode")),
                  text(llm.get("provider")),
                  text(llm.get("model")),
                  text(response.get("confidence")),
                  text(response.get("basisDate")),
                  preview(answer),
                  answer,
                  json(response.get("sources")),
                  json(response.get("limitations")),
                  json(response)));
      return Map.of(
          "saved",
          true,
          "id",
          saved.getId(),
          "table",
          "ai_chat_interactions",
          "note",
          "AI 응답은 생성 직후 DB에 감사 로그로 저장됩니다. 기업 선택 자체와 차트 데이터는 저장하지 않습니다.");
    } catch (RuntimeException e) {
      return Map.of(
          "saved",
          false,
          "table",
          "ai_chat_interactions",
          "note",
          "AI 응답 저장에 실패했지만 화면 응답은 유지했습니다.");
    }
  }

  @Transactional(readOnly = true)
  public List<AiChatInteractionDto> history(String stockCode) {
    String safeCode = text(stockCode);
    if (safeCode.matches("^\\d{6}$")) {
      return repository.findTop20ByStockCodeOrderByCreatedAtDesc(safeCode).stream()
          .map(AiChatInteractionDto::from)
          .toList();
    }
    return repository.findTop20ByOrderByCreatedAtDesc().stream().map(AiChatInteractionDto::from).toList();
  }

  @Transactional(readOnly = true)
  public Optional<Map<String, Object>> latestOllamaInsight(String stockCode) {
    String safeCode = text(stockCode);
    if (!safeCode.matches("^\\d{6}$")) {
      return Optional.empty();
    }
    return repository
        .findFirstByStockCodeAndResponseModeInOrderByCreatedAtDesc(
            safeCode, List.of("ollama_llm", "ollama_fallback_rule_based"))
        .flatMap(this::storedOllamaResponse);
  }

  private Optional<Map<String, Object>> storedOllamaResponse(AiChatInteraction item) {
    String responseJson = text(item.getResponseJson());
    if (responseJson.isBlank()) {
      return Optional.empty();
    }
    Map<String, Object> stored = readJson(responseJson);
    if (stored.isEmpty()) {
      return Optional.empty();
    }
    LinkedHashMap<String, Object> response = new LinkedHashMap<>(stored);
    LinkedHashMap<String, Object> storage = new LinkedHashMap<>();
    storage.put("saved", true);
    storage.put("cached", true);
    storage.put("id", item.getId());
    storage.put("table", "ai_chat_interactions");
    storage.put("stockCode", item.getStockCode());
    storage.put("responseMode", item.getResponseMode());
    storage.put("provider", item.getProvider());
    storage.put("model", item.getModel());
    storage.put("basisDate", item.getBasisDate());
    storage.put("createdAt", item.getCreatedAt());
    storage.put("note", "저장된 Ollama 상담 응답을 먼저 재사용했습니다. 새 계산 결과가 도착하면 화면이 갱신됩니다.");
    response.put("storage", storage);
    return Optional.of(response);
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> map(Object value) {
    if (value instanceof Map<?, ?> raw) {
      LinkedHashMap<String, Object> out = new LinkedHashMap<>();
      raw.forEach((key, item) -> out.put(String.valueOf(key), item));
      return out;
    }
    return Map.of();
  }

  private String json(Object value) {
    try {
      return objectMapper.writeValueAsString(value == null ? List.of() : value);
    } catch (JsonProcessingException e) {
      return "[]";
    }
  }

  private Map<String, Object> readJson(String value) {
    try {
      return objectMapper.readValue(value, new TypeReference<Map<String, Object>>() {});
    } catch (JsonProcessingException e) {
      return Map.of();
    }
  }

  private String preview(String answer) {
    String compact = answer.replaceAll("\\s+", " ").trim();
    return compact.length() <= 500 ? compact : compact.substring(0, 497) + "...";
  }

  private String firstNonBlank(String... values) {
    for (String value : values) {
      if (value != null && !value.isBlank()) return value;
    }
    return "";
  }

  private String text(Object value) {
    return value == null ? "" : String.valueOf(value).trim();
  }
}
