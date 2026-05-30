package com.krbrief.stocks;

import java.util.List;

public record StockFundamentalsDto(
    String code,
    String name,
    String asOf,
    String source,
    ValuationDto valuation,
    MarketDto market,
    List<String> interpretation,
    List<String> limitations) {
  public record ValuationDto(
      Double per,
      Double pbr,
      Double roe,
      Double eps,
      Double bps,
      Double dividendYield,
      Double dps) {}

  public record MarketDto(
      Long marketCap,
      Long shares,
      Long volume,
      Long tradingValue) {}
}
