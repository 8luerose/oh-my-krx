package com.krbrief.ai;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "ai_chat_interactions")
public class AiChatInteraction {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "stock_code", length = 6)
  private String stockCode;

  @Column(name = "stock_name", length = 120)
  private String stockName;

  @Column(name = "question", columnDefinition = "TEXT")
  private String question;

  @Column(name = "response_mode", length = 80)
  private String responseMode;

  @Column(name = "provider", length = 80)
  private String provider;

  @Column(name = "model", length = 160)
  private String model;

  @Column(name = "confidence", length = 40)
  private String confidence;

  @Column(name = "basis_date", length = 24)
  private String basisDate;

  @Column(name = "answer_preview", length = 520)
  private String answerPreview;

  @Column(name = "answer_text", columnDefinition = "TEXT")
  private String answerText;

  @Column(name = "sources_json", columnDefinition = "TEXT")
  private String sourcesJson;

  @Column(name = "limitations_json", columnDefinition = "TEXT")
  private String limitationsJson;

  @Column(name = "response_json", columnDefinition = "MEDIUMTEXT")
  private String responseJson;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  protected AiChatInteraction() {}

  AiChatInteraction(
      String stockCode,
      String stockName,
      String question,
      String responseMode,
      String provider,
      String model,
      String confidence,
      String basisDate,
      String answerPreview,
      String answerText,
      String sourcesJson,
      String limitationsJson,
      String responseJson) {
    this.stockCode = stockCode;
    this.stockName = stockName;
    this.question = question;
    this.responseMode = responseMode;
    this.provider = provider;
    this.model = model;
    this.confidence = confidence;
    this.basisDate = basisDate;
    this.answerPreview = answerPreview;
    this.answerText = answerText;
    this.sourcesJson = sourcesJson;
    this.limitationsJson = limitationsJson;
    this.responseJson = responseJson;
  }

  @PrePersist
  void prePersist() {
    createdAt = Instant.now();
  }

  public Long getId() {
    return id;
  }

  public String getStockCode() {
    return stockCode;
  }

  public String getStockName() {
    return stockName;
  }

  public String getQuestion() {
    return question;
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

  public String getConfidence() {
    return confidence;
  }

  public String getBasisDate() {
    return basisDate;
  }

  public String getAnswerPreview() {
    return answerPreview;
  }

  public String getResponseJson() {
    return responseJson;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }
}
