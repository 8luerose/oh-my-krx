package com.krbrief.stocks;

import java.time.LocalDate;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.server.ResponseStatusException;

@Component
public class StockResearchClient {
  private static final long CACHE_TTL_MILLIS = 5 * 60 * 1000L;
  private final RestClient http;
  private final Map<String, CachedValue<StockChartDto>> chartCache = new ConcurrentHashMap<>();
  private final Map<String, CachedValue<StockEventsDto>> eventsCache = new ConcurrentHashMap<>();
  private final Map<String, CachedValue<StockNewsDto>> newsCache = new ConcurrentHashMap<>();
  private final Map<String, CachedValue<StockUniverseDto>> universeCache = new ConcurrentHashMap<>();
  private final Map<String, CachedValue<StockSectorUniverseDto>> sectorCache = new ConcurrentHashMap<>();
  private final Map<String, CachedValue<StockThemeUniverseDto>> themeCache = new ConcurrentHashMap<>();

  public StockResearchClient(@Value("${marketdata.baseUrl:http://marketdata:8000}") String baseUrl) {
    this.http = RestClient.builder().baseUrl(baseUrl).build();
  }

  public StockChartDto chart(String code, String range, String interval) {
    return cached(chartCache, "chart:" + code + ":" + range + ":" + interval, () -> fetchChart(code, range, interval));
  }

  private StockChartDto fetchChart(String code, String range, String interval) {
    try {
      StockChartDto res =
          http
              .get()
              .uri(
                  uriBuilder ->
                      uriBuilder
                          .path("/stocks/{code}/chart")
                          .queryParam("range", range)
                          .queryParam("interval", interval)
                          .build(code))
              .accept(MediaType.APPLICATION_JSON)
              .retrieve()
              .body(StockChartDto.class);
      if (res == null) {
        throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "marketdata_empty_chart_response");
      }
      return res;
    } catch (ResponseStatusException e) {
      throw e;
    } catch (RestClientException e) {
      throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "marketdata_chart_error", e);
    }
  }

  public StockEventsDto events(String code, LocalDate from, LocalDate to) {
    return cached(eventsCache, "events:" + code + ":" + from + ":" + to, () -> fetchEvents(code, from, to));
  }

  private StockEventsDto fetchEvents(String code, LocalDate from, LocalDate to) {
    try {
      StockEventsDto res =
          http
              .get()
              .uri(
                  uriBuilder ->
                      uriBuilder
                          .path("/stocks/{code}/events")
                          .queryParam("from", from)
                          .queryParam("to", to)
                          .build(code))
              .accept(MediaType.APPLICATION_JSON)
              .retrieve()
              .body(StockEventsDto.class);
      if (res == null) {
        throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "marketdata_empty_events_response");
      }
      return res;
    } catch (ResponseStatusException e) {
      throw e;
    } catch (RestClientException e) {
      throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "marketdata_events_error", e);
    }
  }

  public StockNewsDto news(String code, int limit) {
    int safeLimit = Math.max(1, Math.min(limit, 12));
    return cached(newsCache, "news:" + code + ":" + safeLimit, () -> fetchNews(code, safeLimit));
  }

  private StockNewsDto fetchNews(String code, int limit) {
    try {
      StockNewsDto res =
          http
              .get()
              .uri(
                  uriBuilder ->
                      uriBuilder
                          .path("/stocks/{code}/news")
                          .queryParam("limit", limit)
                          .build(code))
              .accept(MediaType.APPLICATION_JSON)
              .retrieve()
              .body(StockNewsDto.class);
      if (res == null) {
        throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "marketdata_empty_news_response");
      }
      return res;
    } catch (ResponseStatusException e) {
      throw e;
    } catch (RestClientException e) {
      throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "marketdata_news_error", e);
    }
  }

  public StockUniverseDto universe(String query, int limit) {
    String safeQuery = query == null ? "" : query.trim();
    return cached(universeCache, "universe:" + safeQuery + ":" + limit, () -> fetchUniverse(query, limit));
  }

  private StockUniverseDto fetchUniverse(String query, int limit) {
    try {
      StockUniverseDto res =
          http
              .get()
              .uri(
                  uriBuilder -> {
                    var builder = uriBuilder.path("/stocks/universe").queryParam("limit", limit);
                    if (query != null && !query.isBlank()) {
                      builder.queryParam("query", query);
                    }
                    return builder.build();
                  })
              .accept(MediaType.APPLICATION_JSON)
              .retrieve()
              .body(StockUniverseDto.class);
      if (res == null) {
        throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "marketdata_empty_universe_response");
      }
      return res;
    } catch (ResponseStatusException e) {
      throw e;
    } catch (RestClientException e) {
      throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "marketdata_universe_error", e);
    }
  }

  public StockSectorUniverseDto sectors(String query, int limit) {
    String safeQuery = query == null ? "" : query.trim();
    return cached(sectorCache, "sectors:" + safeQuery + ":" + limit, () -> fetchSectors(query, limit));
  }

  private StockSectorUniverseDto fetchSectors(String query, int limit) {
    try {
      StockSectorUniverseDto res =
          http
              .get()
              .uri(
                  uriBuilder -> {
                    var builder = uriBuilder.path("/stocks/sectors").queryParam("limit", limit);
                    if (query != null && !query.isBlank()) {
                      builder.queryParam("query", query);
                    }
                    return builder.build();
                  })
              .accept(MediaType.APPLICATION_JSON)
              .retrieve()
              .body(StockSectorUniverseDto.class);
      if (res == null) {
        throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "marketdata_empty_sectors_response");
      }
      return res;
    } catch (ResponseStatusException e) {
      throw e;
    } catch (RestClientException e) {
      throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "marketdata_sectors_error", e);
    }
  }

  public StockThemeUniverseDto themes(String query, int limit) {
    String safeQuery = query == null ? "" : query.trim();
    return cached(themeCache, "themes:" + safeQuery + ":" + limit, () -> fetchThemes(query, limit));
  }

  private StockThemeUniverseDto fetchThemes(String query, int limit) {
    try {
      StockThemeUniverseDto res =
          http
              .get()
              .uri(
                  uriBuilder -> {
                    var builder = uriBuilder.path("/stocks/themes").queryParam("limit", limit);
                    if (query != null && !query.isBlank()) {
                      builder.queryParam("query", query);
                    }
                    return builder.build();
                  })
              .accept(MediaType.APPLICATION_JSON)
              .retrieve()
              .body(StockThemeUniverseDto.class);
      if (res == null) {
        throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "marketdata_empty_themes_response");
      }
      return res;
    } catch (ResponseStatusException e) {
      throw e;
    } catch (RestClientException e) {
      throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "marketdata_themes_error", e);
    }
  }

  private <T> T cached(Map<String, CachedValue<T>> cache, String key, Supplier<T> loader) {
    long now = System.currentTimeMillis();
    CachedValue<T> found = cache.get(key);
    if (found != null && found.expiresAtMillis() > now) {
      return found.value();
    }
    T loaded = loader.get();
    cache.put(key, new CachedValue<>(loaded, now + CACHE_TTL_MILLIS));
    return loaded;
  }

  private record CachedValue<T>(T value, long expiresAtMillis) {}
}
