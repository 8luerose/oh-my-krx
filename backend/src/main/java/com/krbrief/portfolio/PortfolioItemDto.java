package com.krbrief.portfolio;

import java.util.List;

public record PortfolioItemDto(
    String code,
    String name,
    String group,
    Double rate,
    Long count,
    Double weight,
    Double averagePrice,
    String holdingPeriod,
    String riskTolerance,
    List<String> riskNotes,
    List<String> nextChecklist,
    List<RecentEventDto> recentEvents) {
  public record RecentEventDto(
      String date,
      String type,
      String severity,
      String title,
      String explanation) {}
}
