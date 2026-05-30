package com.krbrief.portfolio;

import com.krbrief.stocks.StockEventsDto;
import com.krbrief.stocks.StockResearchClient;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class PortfolioService {
  private static final Pattern CODE = Pattern.compile("^\\d{6}$");
  private static final ZoneId KST = ZoneId.of("Asia/Seoul");

  private final PortfolioItemRepository repository;
  private final StockResearchClient stockResearchClient;

  public PortfolioService(PortfolioItemRepository repository, StockResearchClient stockResearchClient) {
    this.repository = repository;
    this.stockResearchClient = stockResearchClient;
  }

  public PortfolioResponse get() {
    List<PortfolioItem> items = repository.findAll(Sort.by(Sort.Direction.ASC, "createdAt"));
    List<PortfolioItemDto> dtos = items.stream().map(this::toDto).toList();
    return new PortfolioResponse(dtos, summary(dtos), "server_mysql_portfolio_sandbox", Instant.now());
  }

  public PortfolioResponse upsert(PortfolioItemRequest request) {
    String code = validateCode(request == null ? null : request.code());
    PortfolioItem item = repository.findById(code).orElseGet(() -> new PortfolioItem(code));
    item.setName(clean(request.name(), code));
    item.setGroup(clean(request.group(), "관심 종목"));
    item.setRate(request.rate());
    item.setCount(request.count());
    item.setWeight(clampWeight(request.weight()));
    item.setAveragePrice(cleanAveragePrice(request.averagePrice()));
    item.setHoldingPeriod(cleanChoice(request.holdingPeriod(), "미입력"));
    item.setRiskTolerance(cleanChoice(request.riskTolerance(), "미입력"));
    repository.save(item);
    return get();
  }

  public PortfolioResponse updateWeight(String code, PortfolioItemRequest request) {
    String safeCode = validateCode(code);
    PortfolioItem item =
        repository
            .findById(safeCode)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "portfolio_item_not_found"));
    if (request != null) {
      item.setWeight(clampWeight(request.weight()));
      item.setAveragePrice(cleanAveragePrice(request.averagePrice()));
      item.setHoldingPeriod(cleanChoice(request.holdingPeriod(), item.getHoldingPeriod()));
      item.setRiskTolerance(cleanChoice(request.riskTolerance(), item.getRiskTolerance()));
    }
    repository.save(item);
    return get();
  }

  public PortfolioResponse delete(String code) {
    String safeCode = validateCode(code);
    repository.deleteById(safeCode);
    return get();
  }

  private PortfolioItemDto toDto(PortfolioItem item) {
    List<PortfolioItemDto.RecentEventDto> events = recentEvents(item.getCode());
    return new PortfolioItemDto(
        item.getCode(),
        item.getName(),
        item.getGroup(),
        item.getRate(),
        item.getCount(),
        item.getWeight(),
        item.getAveragePrice(),
        item.getHoldingPeriod(),
        item.getRiskTolerance(),
        riskNotes(item, events),
        nextChecklist(item, events),
        events);
  }

  private List<PortfolioItemDto.RecentEventDto> recentEvents(String code) {
    LocalDate to = LocalDate.now(KST);
    LocalDate from = to.minusDays(120);
    try {
      StockEventsDto response = stockResearchClient.events(code, from, to);
      return Optional.ofNullable(response.events()).orElse(List.of()).stream()
          .sorted(Comparator.comparing(StockEventsDto.StockEventDto::date).reversed())
          .limit(3)
          .map(event -> new PortfolioItemDto.RecentEventDto(
              event.date(),
              event.type(),
              event.severity(),
              event.title(),
              event.explanation()))
          .toList();
    } catch (RuntimeException e) {
      return List.of();
    }
  }

  private List<String> riskNotes(PortfolioItem item, List<PortfolioItemDto.RecentEventDto> events) {
    double weight = value(item.getWeight());
    double rate = value(item.getRate());
    return List.of(
        weight >= 35
            ? "가상 비중이 높은 편입니다. 이벤트가 생기면 전체 포트폴리오 변동성이 커질 수 있습니다."
            : "가상 비중이 과도하게 높지는 않지만, 동일 섹터 집중 여부를 함께 확인해야 합니다.",
        item.getAveragePrice() != null
            ? "평균단가 " + Math.round(item.getAveragePrice()) + "원 기준으로 현재가와 손익분기점을 함께 봐야 합니다."
            : "평균단가가 비어 있어 실제 손익 기준 매도 판단은 아직 제한됩니다.",
        riskToleranceText(item),
        Math.abs(rate) >= 10
            ? "최근 등락률이 큰 종목입니다. 가격보다 거래량과 이벤트 근거를 먼저 확인하세요."
            : "최근 등락률만으로 판단하기보다 추세, 거래량, 공시 여부를 함께 봅니다.",
        events.isEmpty()
            ? "최근 이벤트 근거가 부족합니다. 새 공시, 뉴스, 거래량 변화를 추가로 확인하세요."
            : "최근 이벤트 " + events.size() + "건이 감지되었습니다. 이벤트 원인과 반대 신호를 함께 확인하세요.");
  }

  private List<String> nextChecklist(PortfolioItem item, List<PortfolioItemDto.RecentEventDto> events) {
    return List.of(
        item.getName() + "의 최근 이벤트와 거래량 급증 여부 확인",
        "가상 비중 " + Math.round(value(item.getWeight())) + "%가 본인 손실 허용 범위에 맞는지 점검",
        item.getAveragePrice() != null
            ? "평균단가 대비 현재가가 손실 허용 범위를 넘었는지 확인"
            : "평균단가를 입력하면 AI가 손익 기준 리스크를 더 구체적으로 설명",
        "보유기간 " + clean(item.getHoldingPeriod(), "미입력") + " 기준으로 단기 대응인지 장기 점검인지 구분",
        events.isEmpty() ? "근거가 부족하면 관망 시나리오를 먼저 작성" : "가장 최근 이벤트의 공시/뉴스 근거 재확인",
        "매수/매도 단정 대신 매수 검토, 관망, 리스크 관리 기준을 문장으로 정리");
  }

  private PortfolioRiskSummaryDto summary(List<PortfolioItemDto> items) {
    double totalWeight = items.stream().mapToDouble(item -> value(item.weight())).sum();
    PortfolioItemDto maxItem =
        items.stream().max(Comparator.comparingDouble(item -> value(item.weight()))).orElse(null);
    long volatileCount = items.stream().filter(item -> Math.abs(value(item.rate())) >= 10).count();
    return new PortfolioRiskSummaryDto(
        totalWeight,
        maxItem == null ? "-" : maxItem.name(),
        maxItem == null ? 0 : maxItem.weight(),
        maxItem != null && value(maxItem.weight()) >= 50
            ? "한 종목 비중이 50% 이상입니다. 초보자는 손실 허용 기준을 먼저 정해야 합니다."
            : "비중이 한 종목에 과도하게 몰리지는 않았습니다.",
        volatileCount > 0
            ? volatileCount + "개 종목이 큰 변동률 구간입니다. 최근 이벤트와 반대 신호를 먼저 확인하세요."
            : "큰 변동률 종목은 아직 적지만, 이벤트 발생 시 비중을 다시 점검하세요.",
        List.of(
            "비중이 가장 큰 종목의 최근 이벤트 확인",
            "동일 섹터 종목이 과도하게 몰렸는지 확인",
            "하락 시 리스크 관리 가격과 재검토 기준 작성"));
  }

  private String validateCode(String code) {
    if (code == null || !CODE.matcher(code).matches()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid_stock_code");
    }
    return code;
  }

  private double clampWeight(Double value) {
    if (value == null || !Double.isFinite(value)) return 10;
    return Math.max(0, Math.min(100, value));
  }

  private Double cleanAveragePrice(Double value) {
    if (value == null || !Double.isFinite(value) || value <= 0) return null;
    return Math.min(10_000_000, value);
  }

  private String cleanChoice(String value, String fallback) {
    String clean = clean(value, fallback);
    if (clean == null) return null;
    if (clean.length() > 40) return clean.substring(0, 40);
    return clean;
  }

  private String riskToleranceText(PortfolioItem item) {
    String tolerance = clean(item.getRiskTolerance(), "미입력");
    return switch (tolerance) {
      case "낮음" -> "손실 허용 범위가 낮으므로 지지선 이탈 시 관망 또는 비중 축소 기준을 먼저 봅니다.";
      case "높음" -> "손실 허용 범위가 높아도 하락 거래량이 커지면 추가 매수보다 리스크 관리가 우선입니다.";
      case "중간" -> "손실 허용 범위가 중간이면 분할매수와 손절 기준을 동시에 정해야 합니다.";
      default -> "손실 허용 범위가 비어 있어 AI는 보수적인 리스크 관리 기준을 우선 적용합니다.";
    };
  }

  private static String clean(String value, String fallback) {
    return value == null || value.isBlank() ? fallback : value.trim();
  }

  private static double value(Double value) {
    return value == null || !Double.isFinite(value) ? 0 : value;
  }
}
