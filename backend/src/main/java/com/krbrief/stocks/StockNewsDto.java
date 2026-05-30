package com.krbrief.stocks;

import java.util.List;

public record StockNewsDto(
    String code,
    String name,
    String asOf,
    String source,
    String queryUrl,
    List<NewsHeadlineDto> headlines,
    List<String> limitations) {

  public record NewsHeadlineDto(
      String title,
      String url,
      String sourceType,
      String sentiment,
      List<String> matchedKeywords,
      List<String> causalFactors,
      String evidenceLevel,
      String summary,
      String sourceLabel,
      String impactPath,
      String beginnerExplanation,
      String priceCheck,
      String whyItMatters) {}
}
