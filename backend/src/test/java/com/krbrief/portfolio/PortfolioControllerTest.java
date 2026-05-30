package com.krbrief.portfolio;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(PortfolioController.class)
class PortfolioControllerTest {
  @Autowired MockMvc mvc;

  @MockBean PortfolioService service;

  @Test
  void get_returnsServerPortfolioSandbox() throws Exception {
    when(service.get()).thenReturn(response(10));

    mvc.perform(get("/api/portfolio"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.source").value("server_mysql_portfolio_sandbox"))
        .andExpect(jsonPath("$.items[0].code").value("005930"))
        .andExpect(jsonPath("$.items[0].riskNotes[0]").isNotEmpty())
        .andExpect(jsonPath("$.summary.totalWeight").value(10));
  }

  @Test
  void upsert_returnsRiskReviewResponse() throws Exception {
    when(service.upsert(any(PortfolioItemRequest.class))).thenReturn(response(15));

    mvc.perform(
            post("/api/portfolio/items")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {"code":"005930","name":"삼성전자","group":"반도체","rate":1.55,"weight":15,"averagePrice":72000,"holdingPeriod":"중기","riskTolerance":"중간"}
                    """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].name").value("삼성전자"))
        .andExpect(jsonPath("$.items[0].weight").value(15))
        .andExpect(jsonPath("$.items[0].averagePrice").value(72000))
        .andExpect(jsonPath("$.summary.maxWeightStock").value("삼성전자"));
  }

  @Test
  void updateWeight_andDelete_keepPortfolioContract() throws Exception {
    when(service.updateWeight(eq("005930"), any(PortfolioItemRequest.class))).thenReturn(response(25));
    when(service.delete(eq("005930"))).thenReturn(emptyResponse());

    mvc.perform(
            put("/api/portfolio/items/005930")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"weight\":25}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].weight").value(25));

    mvc.perform(delete("/api/portfolio/items/005930"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items").isArray())
        .andExpect(jsonPath("$.summary.totalWeight").value(0));
  }

  private PortfolioResponse response(double weight) {
    return new PortfolioResponse(
        List.of(
            new PortfolioItemDto(
                "005930",
                "삼성전자",
                "반도체",
                1.55,
                null,
                weight,
                72000.0,
                "중기",
                "중간",
                List.of("동일 섹터 집중 여부를 함께 확인해야 합니다."),
                List.of("최근 이벤트와 거래량 급증 여부 확인"),
                List.of(
                    new PortfolioItemDto.RecentEventDto(
                        "2026-05-05",
                        "volume_spike",
                        "medium",
                        "거래량 급증",
                        "최근 20거래일 평균 대비 거래량이 늘었습니다.")))),
        new PortfolioRiskSummaryDto(
            weight,
            "삼성전자",
            weight,
            "비중이 한 종목에 과도하게 몰리지는 않았습니다.",
            "큰 변동률 종목은 아직 적습니다.",
            List.of("비중이 가장 큰 종목의 최근 이벤트 확인")),
        "server_mysql_portfolio_sandbox",
        Instant.parse("2026-05-05T00:00:00Z"));
  }

  private PortfolioResponse emptyResponse() {
    return new PortfolioResponse(
        List.of(),
        new PortfolioRiskSummaryDto(
            0.0,
            "-",
            0.0,
            "비중이 한 종목에 과도하게 몰리지는 않았습니다.",
            "큰 변동률 종목은 아직 적습니다.",
            List.of("비중이 가장 큰 종목의 최근 이벤트 확인")),
        "server_mysql_portfolio_sandbox",
        Instant.parse("2026-05-05T00:00:00Z"));
  }
}
