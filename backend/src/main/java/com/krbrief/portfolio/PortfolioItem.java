package com.krbrief.portfolio;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "portfolio_items")
public class PortfolioItem {
  @Id
  @Column(name = "stock_code", nullable = false, length = 6)
  private String code;

  @Column(name = "stock_name", nullable = false)
  private String name;

  @Column(name = "group_label")
  private String group;

  @Column(name = "rate")
  private Double rate;

  @Column(name = "mention_count")
  private Long count;

  @Column(name = "weight", nullable = false)
  private Double weight;

  @Column(name = "average_price")
  private Double averagePrice;

  @Column(name = "holding_period", length = 40)
  private String holdingPeriod;

  @Column(name = "risk_tolerance", length = 40)
  private String riskTolerance;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  protected PortfolioItem() {}

  public PortfolioItem(String code) {
    this.code = code;
  }

  @PrePersist
  void prePersist() {
    Instant now = Instant.now();
    createdAt = now;
    updatedAt = now;
  }

  @PreUpdate
  void preUpdate() {
    updatedAt = Instant.now();
  }

  public String getCode() {
    return code;
  }

  public String getName() {
    return name;
  }

  public void setName(String name) {
    this.name = name;
  }

  public String getGroup() {
    return group;
  }

  public void setGroup(String group) {
    this.group = group;
  }

  public Double getRate() {
    return rate;
  }

  public void setRate(Double rate) {
    this.rate = rate;
  }

  public Long getCount() {
    return count;
  }

  public void setCount(Long count) {
    this.count = count;
  }

  public Double getWeight() {
    return weight;
  }

  public void setWeight(Double weight) {
    this.weight = weight;
  }

  public Double getAveragePrice() {
    return averagePrice;
  }

  public void setAveragePrice(Double averagePrice) {
    this.averagePrice = averagePrice;
  }

  public String getHoldingPeriod() {
    return holdingPeriod;
  }

  public void setHoldingPeriod(String holdingPeriod) {
    this.holdingPeriod = holdingPeriod;
  }

  public String getRiskTolerance() {
    return riskTolerance;
  }

  public void setRiskTolerance(String riskTolerance) {
    this.riskTolerance = riskTolerance;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public Instant getUpdatedAt() {
    return updatedAt;
  }
}
