package com.krbrief.ai;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.krbrief.summaries.DailySummaryService;
import com.krbrief.summaries.SummaryDto;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Service;

@Service
public class AiAfterMarketReportService {
  private static final String REPORT_QUESTION = "최신 저장 브리프를 장후 시장 요약 리포트로 쉽게 설명해줘";

  private final AiChatClient client;
  private final AiChatLogService logService;
  private final AiAfterMarketReportRepository repository;
  private final DailySummaryService summaryService;
  private final ObjectMapper objectMapper;

  public AiAfterMarketReportService(
      AiChatClient client,
      AiChatLogService logService,
      AiAfterMarketReportRepository repository,
      DailySummaryService summaryService,
      ObjectMapper objectMapper) {
    this.client = client;
    this.logService = logService;
    this.repository = repository;
    this.summaryService = summaryService;
    this.objectMapper = objectMapper;
  }

  public Optional<Map<String, Object>> latestSavedOrGenerate() {
    return summaryService.latest().map(SummaryDto::from).map(summary -> savedOrGenerate(summary, "api_latest"));
  }

  public Map<String, Object> savedOrGenerate(SummaryDto summary, String trigger) {
    LocalDate reportDate = reportDate(summary);
    return repository.findById(reportDate)
        .map(report -> {
          Map<String, Object> response = readJson(report.getResponseJson());
          if (needsSchemaRefresh(response)) {
            return generateAndSave(summary, trigger + "_schema_refresh");
          }
          return toResponse(report, response);
        })
        .orElseGet(() -> generateAndSave(summary, trigger));
  }

  public Map<String, Object> generateAndSave(SummaryDto summary, String trigger) {
    LinkedHashMap<String, Object> request = buildRequest(summary);
    LinkedHashMap<String, Object> response = new LinkedHashMap<>(client.ollamaAfterMarketReport(request));
    Map<String, Object> auditStorage = logService.save(request, response);
    Long auditId = longValue(auditStorage.get("id"));
    LocalDate reportDate = reportDate(summary);
    String responseJson = writeJson(response);

    repository.save(
        new AiAfterMarketReport(
            reportDate,
            text(response.get("mode")),
            text(response.get("provider")),
            text(response.get("model")),
            text(response.get("mood")),
            text(response.get("marketBias")),
            responseJson,
            text(trigger),
            auditId));

    response.put("storage", storage(reportDate, trigger, auditStorage, false));
    return response;
  }

  private LinkedHashMap<String, Object> buildRequest(SummaryDto summary) {
    Map<String, Object> summaryMap = objectMapper.convertValue(summary, new TypeReference<Map<String, Object>>() {});
    LinkedHashMap<String, Object> request = new LinkedHashMap<>();
    request.put("question", REPORT_QUESTION);
    request.put("topicType", "after_market_report");
    request.put("topicTitle", "매일 장후 시장 요약 리포트");
    request.put("contextDate", summary.effectiveDate() == null ? String.valueOf(summary.date()) : summary.effectiveDate());
    request.put("summary", summaryMap);
    return request;
  }

  private Map<String, Object> toResponse(AiAfterMarketReport report, Map<String, Object> storedResponse) {
    LinkedHashMap<String, Object> response = new LinkedHashMap<>(storedResponse);
    LinkedHashMap<String, Object> storage =
        new LinkedHashMap<>(storage(report.getReportDate(), report.getGeneratedTrigger(), Map.of(), true));
    storage.put("responseMode", report.getResponseMode());
    storage.put("provider", report.getProvider());
    storage.put("model", report.getModel());
    storage.put("createdAt", report.getCreatedAt());
    storage.put("updatedAt", report.getUpdatedAt());
    if (report.getAuditInteractionId() != null) {
      storage.put("auditInteractionId", report.getAuditInteractionId());
    }
    response.put("storage", storage);
    return response;
  }

  private Map<String, Object> storage(
      LocalDate reportDate,
      String trigger,
      Map<String, Object> auditStorage,
      boolean cached) {
    LinkedHashMap<String, Object> out = new LinkedHashMap<>();
    out.put("saved", true);
    out.put("table", "ai_after_market_reports");
    out.put("date", String.valueOf(reportDate));
    out.put("trigger", trigger);
    out.put("cached", cached);
    out.put("note", cached
        ? "저장된 장후 AI 리포트를 재사용했습니다."
        : "장후 AI 리포트 전체 응답을 DB에 저장했습니다.");
    if (!auditStorage.isEmpty()) {
      out.put("audit", auditStorage);
    }
    return out;
  }

  private LocalDate reportDate(SummaryDto summary) {
    String effectiveDate = text(summary.effectiveDate());
    if (!effectiveDate.isBlank()) {
      try {
        return LocalDate.parse(effectiveDate);
      } catch (RuntimeException ignored) {
        // Fall back to summary row date below.
      }
    }
    return summary.date();
  }

  private Map<String, Object> readJson(String value) {
    try {
      return objectMapper.readValue(value, new TypeReference<Map<String, Object>>() {});
    } catch (JsonProcessingException e) {
      return Map.of(
          "mode", "stored_report_unreadable",
          "mood", "확인 필요",
          "llmComment", "저장된 장후 AI 리포트 JSON을 읽지 못했습니다.");
    }
  }

  private boolean needsSchemaRefresh(Map<String, Object> response) {
    if (response == null || response.isEmpty()) {
      return true;
    }
    return !(response.get("marketDashboard") instanceof Map<?, ?>)
        || !(response.get("leaderSummaries") instanceof java.util.List<?>)
        || !(response.get("actionPlan") instanceof java.util.List<?>)
        || !(response.get("tomorrowChecklist") instanceof java.util.List<?>)
        || !"3".equals(String.valueOf(response.get("schemaVersion")))
        || !response.containsKey("sessionBrief");
  }

  private String writeJson(Map<String, Object> value) {
    try {
      return objectMapper.writeValueAsString(value);
    } catch (JsonProcessingException e) {
      return "{}";
    }
  }

  private Long longValue(Object value) {
    if (value instanceof Number number) {
      return number.longValue();
    }
    try {
      String text = text(value);
      return text.isBlank() ? null : Long.parseLong(text);
    } catch (RuntimeException e) {
      return null;
    }
  }

  private String text(Object value) {
    return value == null ? "" : String.valueOf(value).trim();
  }
}
