package com.krbrief.summaries;

import com.krbrief.ai.AiAfterMarketReportService;
import java.time.LocalDate;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class SummaryScheduler {
  private static final Logger log = LoggerFactory.getLogger(SummaryScheduler.class);

  private final DailySummaryService service;
  private final AiAfterMarketReportService afterMarketReportService;
  private final RestClient marketDataHttp;

  public SummaryScheduler(
      DailySummaryService service,
      AiAfterMarketReportService afterMarketReportService,
      @Value("${marketdata.baseUrl:http://marketdata:8000}") String marketDataBaseUrl) {
    this.service = service;
    this.afterMarketReportService = afterMarketReportService;
    this.marketDataHttp = RestClient.builder().baseUrl(marketDataBaseUrl).build();
  }

  // Weekdays 15:40 Asia/Seoul — skip if market is closed (holiday, etc.)
  @Scheduled(cron = "0 40 15 * * MON-FRI", zone = "Asia/Seoul")
  public void generateWeekdaySummary() {
    LocalDate today = service.todaySeoul();
    if (!isBusinessDay(today)) {
      log.info("Skipping scheduled summary for {} — market closed", today);
      return;
    }
    log.info("Scheduled summary triggered for business day {}", today);
    DailySummary saved = service.generate(today);
    try {
      afterMarketReportService.savedOrGenerate(SummaryDto.from(saved), "scheduled_after_close");
      log.info("Scheduled Ollama after-market report prepared for {}", today);
    } catch (Exception e) {
      log.warn("Scheduled Ollama after-market report failed for {}: {}", today, e.getMessage());
    }
  }

  private boolean isBusinessDay(LocalDate date) {
    try {
      Map<String, Object> status =
          marketDataHttp
              .get()
              .uri(uriBuilder -> uriBuilder.path("/market-status").queryParam("date", date).build())
              .accept(MediaType.APPLICATION_JSON)
              .retrieve()
              .body(new ParameterizedTypeReference<>() {});
      if (status == null) {
        log.warn("market-status returned null for {}; assuming closed", date);
        return false;
      }
      boolean isBusinessDay = Boolean.TRUE.equals(status.get("isBusinessDay"));
      String reason = String.valueOf(status.getOrDefault("reason", ""));
      if (!isBusinessDay) {
        log.info("market-status: date={}, isBusinessDay=false, reason={}", date, reason);
      }
      return isBusinessDay;
    } catch (Exception e) {
      log.warn("Failed to check market-status for {}; skipping generation: {}", date, e.getMessage());
      return false;
    }
  }
}
