package com.krbrief.stocks;

import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/stocks")
@Validated
public class StockController {
  private static final Pattern CODE = Pattern.compile("^\\d{6}$");
  private static final Set<String> RANGES = Set.of("1M", "3M", "6M", "1Y", "3Y");
  private static final Set<String> INTERVALS = Set.of("daily", "weekly", "monthly");
  private static final Set<String> RISK_MODES = Set.of("aggressive", "neutral", "conservative");

  private final StockResearchClient client;
  private final StockTradeZoneService tradeZoneService;

  public StockController(StockResearchClient client, StockTradeZoneService tradeZoneService) {
    this.client = client;
    this.tradeZoneService = tradeZoneService;
  }

  @GetMapping("/{code}/chart")
  public StockChartDto chart(
      @PathVariable String code,
      @RequestParam(name = "range", defaultValue = "6M") String range,
      @RequestParam(name = "interval", defaultValue = "daily") String interval) {
    String safeCode = validateCode(code);
    String safeRange = range.toUpperCase();
    String safeInterval = interval.toLowerCase();
    if (!RANGES.contains(safeRange)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid_range");
    }
    if (!INTERVALS.contains(safeInterval)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid_interval");
    }
    return client.chart(safeCode, safeRange, safeInterval);
  }

  @GetMapping("/universe")
  public StockUniverseDto universe(
      @RequestParam(value = "query", required = false) String query,
      @RequestParam(value = "limit", defaultValue = "80") Integer limit) {
    int safeLimit = limit == null ? 80 : Math.max(1, Math.min(limit, 5000));
    return client.universe(query, safeLimit);
  }

  @GetMapping("/sectors")
  public StockSectorUniverseDto sectors(
      @RequestParam(value = "query", required = false) String query,
      @RequestParam(value = "limit", defaultValue = "80") Integer limit) {
    int safeLimit = limit == null ? 80 : Math.max(1, Math.min(limit, 500));
    return client.sectors(query, safeLimit);
  }

  @GetMapping("/themes")
  public StockThemeUniverseDto themes(
      @RequestParam(value = "query", required = false) String query,
      @RequestParam(value = "limit", defaultValue = "80") Integer limit) {
    int safeLimit = limit == null ? 80 : Math.max(1, Math.min(limit, 500));
    return client.themes(query, safeLimit);
  }

  @GetMapping("/{code}/trade-zones")
  public StockTradeZonesDto tradeZones(
      @PathVariable String code,
      @RequestParam(name = "range", defaultValue = "6M") String range,
      @RequestParam(name = "interval", defaultValue = "daily") String interval,
      @RequestParam(name = "riskMode", defaultValue = "neutral") String riskMode) {
    String safeCode = validateCode(code);
    String safeRange = range.toUpperCase();
    String safeInterval = interval.toLowerCase();
    String safeRiskMode = riskMode.toLowerCase();
    if (!RANGES.contains(safeRange)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid_range");
    }
    if (!INTERVALS.contains(safeInterval)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid_interval");
    }
    if (!RISK_MODES.contains(safeRiskMode)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid_risk_mode");
    }
    return tradeZoneService.tradeZones(safeCode, safeRange, safeInterval, safeRiskMode);
  }

  @GetMapping("/{code}/events")
  public StockEventsDto events(
      @PathVariable String code,
      @RequestParam("from") @NotNull @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam("to") @NotNull @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
    String safeCode = validateCode(code);
    if (from.isAfter(to)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "from_must_be_on_or_before_to");
    }
    return client.events(safeCode, from, to).withDerivedNarratives();
  }

  @GetMapping("/{code}/news")
  public StockNewsDto news(
      @PathVariable String code,
      @RequestParam(name = "limit", defaultValue = "8") int limit) {
    String safeCode = validateCode(code);
    return client.news(safeCode, limit);
  }

  @GetMapping("/{code}/fundamentals")
  public StockFundamentalsDto fundamentals(@PathVariable String code) {
    String safeCode = validateCode(code);
    return client.fundamentals(safeCode);
  }

  private static String validateCode(String code) {
    if (code == null || !CODE.matcher(code).matches()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid_stock_code");
    }
    return code;
  }
}
