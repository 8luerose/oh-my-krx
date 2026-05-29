package com.krbrief.ai;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;

@Entity
@Table(name = "ai_after_market_reports")
public class AiAfterMarketReport {
  @Id
  @Column(name = "report_date", nullable = false)
  private LocalDate reportDate;

  @Column(name = "response_mode", length = 80)
  private String responseMode;

  @Column(name = "provider", length = 80)
  private String provider;

  @Column(name = "model", length = 160)
  private String model;

  @Column(name = "mood", length = 80)
  private String mood;

  @Column(name = "market_bias", length = 80)
  private String marketBias;

  @Column(name = "response_json", nullable = false, columnDefinition = "MEDIUMTEXT")
  private String responseJson;

  @Column(name = "generated_trigger", length = 80)
  private String generatedTrigger;

  @Column(name = "audit_interaction_id")
  private Long auditInteractionId;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  protected AiAfterMarketReport() {}

  AiAfterMarketReport(
      LocalDate reportDate,
      String responseMode,
      String provider,
      String model,
      String mood,
      String marketBias,
      String responseJson,
      String generatedTrigger,
      Long auditInteractionId) {
    this.reportDate = reportDate;
    this.responseMode = responseMode;
    this.provider = provider;
    this.model = model;
    this.mood = mood;
    this.marketBias = marketBias;
    this.responseJson = responseJson;
    this.generatedTrigger = generatedTrigger;
    this.auditInteractionId = auditInteractionId;
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

  public LocalDate getReportDate() {
    return reportDate;
  }

  public String getResponseMode() {
    return responseMode;
  }

  public String getProvider() {
    return provider;
  }

  public String getModel() {
    return model;
  }

  public String getMood() {
    return mood;
  }

  public String getMarketBias() {
    return marketBias;
  }

  public String getResponseJson() {
    return responseJson;
  }

  public String getGeneratedTrigger() {
    return generatedTrigger;
  }

  public Long getAuditInteractionId() {
    return auditInteractionId;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public Instant getUpdatedAt() {
    return updatedAt;
  }
}
