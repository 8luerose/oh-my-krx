package com.krbrief.portfolio;

public record PortfolioItemRequest(
    String code,
    String name,
    String group,
    Double rate,
    Long count,
    Double weight,
    Double averagePrice,
    String holdingPeriod,
    String riskTolerance) {}
