from __future__ import annotations

import html as html_lib
import re
import time


def _is_normal_ticker(code: str) -> bool:
    """Return True if code is a standard 6-digit Korean stock code."""
    return bool(re.match(r'^[0-9]{6}$', str(code)))
import urllib.request
from urllib.parse import quote, urlencode
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError, as_completed
from datetime import datetime, timedelta
from functools import lru_cache
from io import StringIO

import os

from fastapi import FastAPI, HTTPException, Query
from pykrx import stock
import pandas as pd

# --- KRX access hardening ---
# pykrx >= 1.2.5 supports KRX login session via KRX_ID/KRX_PW env vars.
# When set, pykrx handles login automatically. When not set, fall back to
# the monkey-patch below (persistent session + browser headers) so that
# unauthenticated requests still work as well as possible.

NAVER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

KNOWN_STOCK_NAMES = {
    "005930": "삼성전자",
    "000660": "SK하이닉스",
    "005380": "현대차",
    "035420": "NAVER",
    "035720": "카카오",
    "000100": "유한양행",
}

BASELINE_STOCK_UNIVERSE = (
    {"code": "005930", "name": "삼성전자", "market": "KOSPI"},
    {"code": "000660", "name": "SK하이닉스", "market": "KOSPI"},
    {"code": "005380", "name": "현대차", "market": "KOSPI"},
    {"code": "035420", "name": "NAVER", "market": "KOSPI"},
    {"code": "035720", "name": "카카오", "market": "KOSPI"},
    {"code": "000100", "name": "유한양행", "market": "KOSPI"},
    {"code": "207940", "name": "삼성바이오로직스", "market": "KOSPI"},
    {"code": "068270", "name": "셀트리온", "market": "KOSPI"},
    {"code": "196170", "name": "알테오젠", "market": "KOSDAQ"},
    {"code": "247540", "name": "에코프로비엠", "market": "KOSDAQ"},
    {"code": "105560", "name": "KB금융", "market": "KOSPI"},
    {"code": "055550", "name": "신한지주", "market": "KOSPI"},
)

BASELINE_SECTOR_TAXONOMY = (
    {
        "name": "의료·정밀기기",
        "type": "industry",
        "market": "KRX",
        "markets": ["KOSPI", "KOSDAQ"],
        "memberCount": 3,
        "rate": 0.0,
        "topStocks": [
            {"code": "000100", "name": "유한양행", "market": "KOSPI", "marketCap": 0, "rate": 0.0},
            {"code": "207940", "name": "삼성바이오로직스", "market": "KOSPI", "marketCap": 0, "rate": 0.0},
            {"code": "196170", "name": "알테오젠", "market": "KOSDAQ", "marketCap": 0, "rate": 0.0},
        ],
        "summary": "KRX 업종 taxonomy fallback입니다. pykrx 업종 분류가 비어도 대표 의료·정밀기기 종목 검색을 보존합니다.",
    },
    {
        "name": "증권/금융",
        "type": "industry",
        "market": "KRX",
        "markets": ["KOSPI"],
        "memberCount": 3,
        "rate": 0.0,
        "topStocks": [
            {"code": "105560", "name": "KB금융", "market": "KOSPI", "marketCap": 0, "rate": 0.0},
            {"code": "055550", "name": "신한지주", "market": "KOSPI", "marketCap": 0, "rate": 0.0},
            {"code": "086790", "name": "하나금융지주", "market": "KOSPI", "marketCap": 0, "rate": 0.0},
        ],
        "summary": "KRX 금융 업종 fallback입니다. 은행·금융 대표 종목 검색을 보존합니다.",
    },
)

if not os.getenv("KRX_ID"):
    # No KRX credentials → use monkey-patch fallback
    try:
        import requests
        from pykrx.website.comm import webio as _webio

        _KRX_HDRS = {
            "User-Agent": NAVER_UA,
            "Referer": "https://data.krx.co.kr/",
            "Origin": "https://data.krx.co.kr",
        }

        _krx_session = requests.Session()
        _krx_session.headers.update(_KRX_HDRS)
        # Warm up cookies
        try:
            _krx_session.get(
                "https://data.krx.co.kr/contents/MDC/MDI/outerLoader/index.cmd?menuId=MDC0201020101",
                timeout=10,
            )
        except Exception:
            pass

        # Make webio use our session (has .get/.post).
        _webio.requests = _krx_session  # type: ignore

        _orig_get_init = _webio.Get.__init__
        _orig_post_init = _webio.Post.__init__

        def _get_init(self):
            _orig_get_init(self)
            self.headers.update(_KRX_HDRS)

        def _post_init(self, headers=None):
            _orig_post_init(self, headers=headers)
            self.headers.update(_KRX_HDRS)

        _webio.Get.__init__ = _get_init  # type: ignore
        _webio.Post.__init__ = _post_init  # type: ignore
    except Exception:
        pass

app = FastAPI(title="kr-stock-daily-brief marketdata", version="0.6.3")



def _parse_date(date_str: str) -> str:
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        return dt.strftime("%Y%m%d")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"invalid_date: {date_str}") from e


def _format_ymd_dot(ymd: str) -> str:
    return f"{ymd[0:4]}.{ymd[4:6]}.{ymd[6:8]}"


def _previous_business_day(ymd: str) -> str:
    """Best-effort previous business day.

    Prefer pykrx calendar, but fall back to a simple weekday-only rule if pykrx
    calendar lookup fails (e.g., upstream KRX calendar returns empty).
    """
    d = datetime.strptime(ymd, "%Y%m%d").date() - timedelta(days=1)
    try:
        # prev=True: if holiday/weekend, go to previous business day
        return stock.get_nearest_business_day_in_a_week(d.strftime("%Y%m%d"), prev=True)
    except Exception:
        # Fallback: skip weekends only.
        while d.weekday() >= 5:  # 5=Sat, 6=Sun
            d -= timedelta(days=1)
        return d.strftime("%Y%m%d")


def _effective_business_day_or_previous(ymd: str) -> tuple[str, str]:
    """Return (effective_ymd, note).

    정책(2안): 요청 날짜는 유지하되, 실제 계산은 직전 영업일로 보정.

    We prefer pykrx calendar, but if that fails we fall back to a simple
    weekday-only rule to keep the API responsive.
    """
    try:
        # If ymd is a trading day, prev=True returns itself.
        nearest_prev = stock.get_nearest_business_day_in_a_week(ymd, prev=True)
        if nearest_prev == ymd:
            return ymd, ""

        effective = nearest_prev
        return effective, f"adjusted_to_previous_business_day: requested={ymd}, effective={effective}"
    except Exception as e:
        effective = _previous_business_day(ymd)
        return effective, (
            f"adjusted_fallback: requested={ymd}, effective={effective}, reason=pykrx_calendar_error({type(e).__name__})"
        )


def _name(ticker: str) -> str:
    try:
        value = stock.get_market_ticker_name(ticker)
        if isinstance(value, str) and value.strip():
            return value
    except Exception:
        pass
    return KNOWN_STOCK_NAMES.get(ticker, ticker)


def _normalize_query(value: str | None) -> str:
    return (value or "").strip().lower()


def _safe_float(value) -> float:
    try:
        return float(value)
    except Exception:
        return 0.0


def _safe_int(value) -> int:
    try:
        return int(value)
    except Exception:
        return 0


def _naver_fetch(url: str, timeout: int = 5) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": NAVER_UA})
    with urllib.request.urlopen(req, timeout=timeout) as f:
        raw = f.read()
        charset = f.headers.get_content_charset()

    candidates = [charset] if charset else []
    candidates.extend(["utf-8", "euc-kr", "cp949"])
    for encoding in candidates:
        if not encoding:
            continue
        try:
            return raw.decode(encoding)
        except Exception:
            continue
    return raw.decode("utf-8", "ignore")


_BOARD_DATE_RE = re.compile(r'<span class="tah p10 gray03">(\d{4}\.\d{2}\.\d{2})')


_SISE_TR_RE = re.compile(r"<tr[^>]*>.*?</tr>", re.IGNORECASE | re.DOTALL)


@lru_cache(maxsize=50000)
def _naver_sise_day_rate(code: str, ymd: str, max_pages: int = 3) -> float | None:
    """Compute daily rate (%) from Naver item/sise_day for given date (ymd=YYYYMMDD)."""
    target = _format_ymd_dot(ymd)
    last_html = ""

    for page in range(1, max_pages + 1):
        url = f"https://finance.naver.com/item/sise_day.naver?code={code}&page={page}"
        try:
            html = _naver_fetch(url)
            last_html = html
        except Exception:
            continue

        for tr in _SISE_TR_RE.findall(html):
            if target not in tr:
                continue

            # direction (상승/하락/보합/상한가/하한가)
            direction = "flat"
            m_dir = re.search(r'class="blind"\s*>\s*([^<\s]+)\s*</span>', tr)
            if m_dir:
                t = m_dir.group(1)
                if ("하락" in t) or ("하한" in t):
                    direction = "down"
                elif ("상승" in t) or ("상한" in t):
                    direction = "up"

            # numeric spans after date: close, diff, open, high, low, volume
            idx = tr.find(target)
            tail = tr[idx:] if idx >= 0 else tr
            nums = re.findall(r"<span[^>]*>\s*([0-9][0-9,]*)\s*</span>", tail)
            if len(nums) < 2:
                continue

            close = int(nums[0].replace(",", ""))
            diff_abs = int(nums[1].replace(",", ""))

            if direction == "up":
                prev_close = close - diff_abs
            elif direction == "down":
                prev_close = close + diff_abs
            else:
                prev_close = close

            if prev_close <= 0:
                return None
            return (close - prev_close) / prev_close * 100.0

    return None


@lru_cache(maxsize=20000)
def _naver_board_posts_on_date(ticker: str, ymd: str, max_pages: int = 3) -> int:
    """Count posts on Naver item board for the given ticker and date.

    Cap pages for latency/abuse control. In very hot tickers, this may undercount,
    but we're using this as a ranking heuristic (top3) among traded-value top universe.
    """
    target = _format_ymd_dot(ymd)
    count = 0

    seen_target = False
    for page in range(1, max_pages + 1):
        url = f"https://finance.naver.com/item/board.naver?code={ticker}&page={page}"
        html = _naver_fetch(url)
        dates = _BOARD_DATE_RE.findall(html)
        if not dates:
            break

        for d in dates:
            if d == target:
                count += 1
                seen_target = True

        last = dates[-1]
        if last < target and seen_target:
            break

        first = dates[0]
        if first < target and not seen_target:
            break

    return count


def _naver_today_movers(sosok: int) -> tuple[list[dict], list[dict]]:
    """Best-effort top movers for *today* from Naver sise pages.

    Returns (gainers, losers) lists with fields: code, name, rate, volume.
    """

    def _parse_table(url: str) -> list[dict]:
        html = _naver_fetch(url)
        # Try to locate the first HTML table that contains 종목명.
        tables = pd.read_html(html)
        target = None
        for t in tables:
            if "종목명" in t.columns:
                target = t
                break
        if target is None:
            return []

        out = []
        for _, row in target.iterrows():
            name = str(row.get("종목명", "")).strip()
            if not name or name == "nan":
                continue

            # 등락률 may be like "+29.96%" or 29.96
            rate_raw = row.get("등락률")
            rate = None
            try:
                rate = float(str(rate_raw).replace("%", "").replace(",", "").replace("+", ""))
            except Exception:
                rate = 0.0

            vol_raw = row.get("거래량")
            vol = 0
            try:
                vol = int(str(vol_raw).replace(",", ""))
            except Exception:
                vol = 0

            out.append({"name": name, "rate": round(rate, 2), "volume": vol})
        return out

    rise_url = f"https://finance.naver.com/sise/sise_rise.nhn?sosok={sosok}"
    fall_url = f"https://finance.naver.com/sise/sise_fall.nhn?sosok={sosok}"

    rise = _parse_table(rise_url)
    fall = _parse_table(fall_url)

    # Naver pages are already sorted, but keep deterministic sorting.
    rise.sort(key=lambda x: (x.get("rate", 0), x.get("volume", 0), x.get("name", "")), reverse=True)
    fall.sort(key=lambda x: (x.get("rate", 0), -x.get("volume", 0), x.get("name", "")))

    # code is not easily available from read_html output; keep blank.
    gainers = [{"code": "", "name": x["name"], "rate": x["rate"], "volume": x["volume"]} for x in rise[:3]]
    losers = [{"code": "", "name": x["name"], "rate": x["rate"], "volume": x["volume"]} for x in fall[:3]]
    return gainers, losers


def _top_rate_lists_from_rates(rates: dict, universe: set[str] | None = None, n: int = 3) -> tuple[list[dict], list[dict]]:
    """Build top gainers/losers from a pre-calculated {ticker: rate} dict."""
    filtered = {t: r for t, r in rates.items() if universe is None or t in universe}
    if not filtered:
        return [], []
    sorted_items = sorted(filtered.items(), key=lambda x: x[1], reverse=True)
    gainers = [{"code": t, "name": _name(t), "rate": r} for t, r in sorted_items[:n]]
    losers = [{"code": t, "name": _name(t), "rate": r} for t, r in sorted_items[-n:]][::-1]
    return gainers, losers


def _calc_prev_close_rate(eff_ymd: str, prev_ymd: str) -> dict:
    """eff_ymd의 전일대비 등락률을 모든 종목에 대해 계산.
    OHLCV에서 전일종가와 당일종가를 읽어서 직접 계산.
    returns: {ticker: rate} dict
    """
    rates = {}
    for market in ("KOSPI", "KOSDAQ"):
        market_tickers = stock.get_market_ticker_list(eff_ymd, market=market)
        if not market_tickers:
            continue
        try:
            df = stock.get_market_ohlcv_by_ticker(eff_ymd, market=market)
            df_prev = stock.get_market_ohlcv_by_ticker(prev_ymd, market=market)
            if df is not None and df_prev is not None:
                for ticker in market_tickers:
                    if _is_normal_ticker(ticker) and ticker in df.index and ticker in df_prev.index:
                        curr_close = df.loc[ticker, "종가"]
                        prev_close_val = df_prev.loc[ticker, "종가"]
                        if prev_close_val and prev_close_val > 0:
                            prev_vol = df_prev.loc[ticker, "거래량"] if "거래량" in df_prev.columns else 0
                            curr_vol = df.loc[ticker, "거래량"] if "거래량" in df.columns else 0
                            if prev_vol > 0 and curr_vol > 0:
                                rates[ticker] = round((curr_close - prev_close_val) / prev_close_val * 100, 2)
        except Exception:
            pass
    return rates


def _normalize_stock_code(code: str) -> str:
    code = str(code or "").strip()
    if not _is_normal_ticker(code):
        raise HTTPException(status_code=400, detail=f"invalid_stock_code: {code}")
    return code


def _range_start_ymd(range_value: str, end_ymd: str) -> str:
    value = (range_value or "6M").upper()
    end = datetime.strptime(end_ymd, "%Y%m%d").date()
    days = {
        "1M": 45,
        "3M": 110,
        "6M": 210,
        "1Y": 400,
        "3Y": 1120,
    }.get(value)
    if days is None:
        raise HTTPException(status_code=400, detail=f"invalid_range: {range_value}")
    return (end - timedelta(days=days)).strftime("%Y%m%d")


def _parse_date_to_ymd(date_str: str, field: str) -> str:
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        return dt.strftime("%Y%m%d")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"invalid_{field}: {date_str}") from e


def _normalize_ohlcv_frame(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or len(df.index) == 0:
        raise ValueError("ohlcv_empty")

    out = df.rename(
        columns={
            "시가": "open",
            "고가": "high",
            "저가": "low",
            "종가": "close",
            "거래량": "volume",
        }
    ).copy()
    required = ["open", "high", "low", "close", "volume"]
    missing = [c for c in required if c not in out.columns]
    if missing:
        raise ValueError(f"ohlcv_missing_columns:{','.join(missing)}")

    out = out[required]
    out.index = pd.to_datetime(out.index)
    out = out.sort_index()
    out = out.dropna(subset=["open", "high", "low", "close"])
    if len(out.index) == 0:
        raise ValueError("ohlcv_empty_after_normalize")
    return out


@lru_cache(maxsize=4096)
def _load_naver_ohlcv_frame(code: str, from_ymd: str, to_ymd: str) -> pd.DataFrame:
    start = datetime.strptime(from_ymd, "%Y%m%d").date()
    end = datetime.strptime(to_ymd, "%Y%m%d").date()
    max_pages = min(260, max(15, ((end - start).days // 6) + 8))
    rows: list[dict] = []
    seen_dates: set[str] = set()

    for page in range(1, max_pages + 1):
        url = f"https://finance.naver.com/item/sise_day.naver?code={code}&page={page}"
        html = _naver_fetch(url)
        page_dates: list[str] = []

        for tr in _SISE_TR_RE.findall(html):
            m_date = _BOARD_DATE_RE.search(tr)
            if not m_date:
                continue
            ymd = m_date.group(1).replace(".", "")
            page_dates.append(ymd)
            if ymd < from_ymd or ymd > to_ymd or ymd in seen_dates:
                continue

            nums = re.findall(r"<span[^>]*>\s*([0-9][0-9,]*)\s*</span>", tr)
            if len(nums) < 6:
                continue
            try:
                rows.append(
                    {
                        "date": datetime.strptime(ymd, "%Y%m%d"),
                        "open": int(nums[2].replace(",", "")),
                        "high": int(nums[3].replace(",", "")),
                        "low": int(nums[4].replace(",", "")),
                        "close": int(nums[0].replace(",", "")),
                        "volume": int(nums[5].replace(",", "")),
                    }
                )
                seen_dates.add(ymd)
            except Exception:
                continue

        if page_dates and min(page_dates) < from_ymd:
            break

    if not rows:
        raise ValueError("naver_ohlcv_empty")

    frame = pd.DataFrame(rows).set_index("date")
    return _normalize_ohlcv_frame(frame)


def _load_ohlcv_frame(code: str, from_ymd: str, to_ymd: str) -> pd.DataFrame:
    pykrx_error = ""
    try:
        try:
            df = stock.get_market_ohlcv_by_date(from_ymd, to_ymd, code, adjusted=False)
        except TypeError:
            df = stock.get_market_ohlcv_by_date(from_ymd, to_ymd, code)
        return _normalize_ohlcv_frame(df)
    except Exception as e:
        pykrx_error = f"{type(e).__name__}:{str(e)[:120]}"

    try:
        return _load_naver_ohlcv_frame(code, from_ymd, to_ymd)
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"ohlcv_unavailable: pykrx={pykrx_error}; naver={type(e).__name__}:{str(e)[:120]}",
        ) from e


def _aggregate_ohlcv(df: pd.DataFrame, interval: str) -> pd.DataFrame:
    value = (interval or "daily").lower()
    if value == "daily":
        out = df.copy()
        out["date"] = out.index
        return out

    if value not in {"weekly", "monthly"}:
        raise HTTPException(status_code=400, detail=f"invalid_interval: {interval}")

    rule = "W-FRI" if value == "weekly" else "M"
    with_dates = df.copy()
    with_dates["date"] = with_dates.index
    grouped = with_dates.resample(rule).agg(
        {
            "open": "first",
            "high": "max",
            "low": "min",
            "close": "last",
            "volume": "sum",
            "date": "max",
        }
    )
    grouped = grouped.dropna(subset=["open", "high", "low", "close", "date"])
    return grouped


def _ohlcv_records(df: pd.DataFrame) -> list[dict]:
    records: list[dict] = []
    for _, row in df.iterrows():
        date_value = row["date"]
        if hasattr(date_value, "strftime"):
            date_str = date_value.strftime("%Y-%m-%d")
        else:
            date_str = str(date_value)[:10]
        records.append(
            {
                "date": date_str,
                "open": int(row["open"]),
                "high": int(row["high"]),
                "low": int(row["low"]),
                "close": int(row["close"]),
                "volume": int(row["volume"]),
            }
        )
    return records


def _event_evidence_sources(code: str, name: str) -> list[dict[str, str]]:
    query = quote(f"{name} {code} 주가 거래량 공시")
    return [
        {
            "type": "price_history",
            "title": "네이버 일별 시세",
            "url": f"https://finance.naver.com/item/sise_day.naver?code={code}",
            "description": "이벤트 날짜 전후의 일별 가격 흐름을 확인합니다.",
        },
        {
            "type": "finance_summary",
            "title": "네이버 종목 종합",
            "url": f"https://finance.naver.com/item/main.naver?code={code}",
            "description": "종목 기본 정보와 시세 요약을 확인합니다.",
        },
        {
            "type": "news",
            "title": "네이버 뉴스 검색",
            "url": f"https://search.naver.com/search.naver?where=news&query={query}",
            "description": "가격/거래량 변화와 같은 시점의 뉴스 후보를 확인합니다.",
        },
        {
            "type": "disclosure",
            "title": "DART 공시 검색",
            "url": "https://dart.fss.or.kr/",
            "description": "확정 원인 판단 전 공식 공시 여부를 별도로 확인합니다.",
        },
        {
            "type": "discussion",
            "title": "네이버 종목토론",
            "url": f"https://finance.naver.com/item/board.naver?code={code}&page=1",
            "description": "개인투자자 관심 변화와 언급 후보를 참고합니다.",
        },
    ]


def _event_evidence_links(sources: list[dict[str, str]]) -> list[str]:
    return [source["url"] for source in sources if source.get("url")]


def _clean_html_text(value: str) -> str:
    text = re.sub(r"<script.*?</script>", " ", value, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<style.*?</style>", " ", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html_lib.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


CAUSAL_FACTOR_RULES = (
    {
        "label": "수주/공급 계약",
        "keywords": ("계약", "수주", "공급", "납품", "공급계약"),
        "direction": "positive",
        "weight": 8,
    },
    {
        "label": "실적/이익 개선",
        "keywords": ("실적", "영업이익", "매출", "흑자", "이익", "어닝"),
        "direction": "positive",
        "weight": 7,
    },
    {
        "label": "주주환원",
        "keywords": ("배당", "자사주", "소각", "주주환원"),
        "direction": "positive",
        "weight": 7,
    },
    {
        "label": "투자/증설",
        "keywords": ("투자", "증설", "설비", "CAPEX", "생산능력", "센터"),
        "direction": "positive",
        "weight": 6,
    },
    {
        "label": "자본조달/지분 변동",
        "keywords": ("증자", "유상증자", "전환사채", "CB", "BW", "출자"),
        "direction": "mixed",
        "weight": 6,
    },
    {
        "label": "업종/테마 모멘텀",
        "keywords": ("반도체", "2차전지", "바이오", "금융", "AI", "전선", "테마"),
        "direction": "positive",
        "weight": 5,
    },
    {
        "label": "수급/거래량",
        "keywords": ("거래량", "외국인", "기관", "순매수", "수급"),
        "direction": "mixed",
        "weight": 4,
    },
    {
        "label": "리스크/감익",
        "keywords": ("하락", "감산", "적자", "손실", "부진", "소송", "제재", "리콜"),
        "direction": "negative",
        "weight": 8,
    },
)


def _signal_keywords(text: str) -> list[str]:
    keywords = [
        "공시",
        "계약",
        "수주",
        "공급",
        "실적",
        "영업이익",
        "매출",
        "자사주",
        "배당",
        "증자",
        "감산",
        "투자",
        "반도체",
        "거래량",
        "주가",
        "상승",
        "하락",
    ]
    return [keyword for keyword in keywords if keyword in text]


def _signal_causal_profile(text: str) -> dict:
    factors: list[str] = []
    positive = 0
    negative = 0
    weight = 0
    for rule in CAUSAL_FACTOR_RULES:
        if not any(keyword in text for keyword in rule["keywords"]):
            continue
        factors.append(str(rule["label"]))
        weight += int(rule["weight"])
        rule_direction = str(rule["direction"])
        if rule_direction == "positive":
            positive += 1
        elif rule_direction == "negative":
            negative += 1
        else:
            positive += 1
            negative += 1

    if positive and negative:
        direction = "mixed"
    elif positive:
        direction = "positive"
    elif negative:
        direction = "negative"
    else:
        direction = "neutral"

    return {
        "causalFactors": factors[:6],
        "causalDirection": direction,
        "causalWeight": min(weight, 24),
    }


def _dedupe_signals(signals: list[dict], limit: int) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for signal in signals:
        key = re.sub(r"\W+", "", signal.get("text", ""))[:80]
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(signal)
        if len(out) >= limit:
            break
    return out


def _snippet_around_keywords(text: str, keywords: list[str], width: int = 260) -> str:
    positions = [text.find(keyword) for keyword in keywords if keyword and text.find(keyword) >= 0]
    start = max(0, (min(positions) if positions else 0) - 60)
    snippet = text[start : start + width]
    return snippet.strip(" .·-_")


@lru_cache(maxsize=8192)
def _news_article_body_signal(url: str, code: str, name: str) -> dict | None:
    if not url.startswith(("http://", "https://")):
        return None
    try:
        body = _clean_html_text(_naver_fetch(url, timeout=3))
    except Exception:
        return None
    if name not in body and code not in body:
        return None
    keywords = _signal_keywords(body)
    if not keywords:
        return None
    profile = _signal_causal_profile(body)
    return {
        "sourceType": "news",
        "label": "뉴스 본문 텍스트",
        "url": url,
        "text": _snippet_around_keywords(body, [name, code, *keywords], 260),
        "matchedKeywords": keywords[:8],
        **profile,
        "signalOrigin": "article_body",
    }


@lru_cache(maxsize=4096)
def _naver_news_text_signals(code: str, name: str) -> tuple[dict, ...]:
    query = quote(f"{name} {code} 주가 거래량 공시")
    url = f"https://search.naver.com/search.naver?where=news&query={query}"
    try:
        html = _naver_fetch(url, timeout=4)
    except Exception:
        return tuple()

    signals: list[dict] = []
    for match in re.finditer(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', html, re.IGNORECASE | re.DOTALL):
        href = html_lib.unescape(match.group(1))
        text = _clean_html_text(match.group(2))
        if len(text) < 24:
            continue
        if name not in text and code not in text:
            continue
        keywords = _signal_keywords(text)
        if not keywords:
            continue
        profile = _signal_causal_profile(text)
        signals.append(
            {
                "sourceType": "news",
                "label": "네이버 뉴스 텍스트",
                "url": href,
                "text": text[:220],
                "matchedKeywords": keywords[:6],
                **profile,
                "signalOrigin": "search_result",
            }
        )
    seed_signals = _dedupe_signals(signals, 5)
    body_signals: list[dict] = []
    for signal in seed_signals[:3]:
        body_signal = _news_article_body_signal(signal.get("url", ""), code, name)
        if body_signal:
            body_signals.append(body_signal)
    return tuple(_dedupe_signals([*body_signals, *seed_signals], 8))


@lru_cache(maxsize=4096)
def _dart_disclosure_text_signals(name: str, from_ymd: str, to_ymd: str) -> tuple[dict, ...]:
    search_url = "https://dart.fss.or.kr/dsab007/detailSearch.ax"
    params = {
        "currentPage": "1",
        "maxResults": "15",
        "maxLinks": "10",
        "sort": "date",
        "series": "desc",
        "textCrpCik": "",
        "lateKeyword": "",
        "keyword": "",
        "reportNamePopYn": "",
        "textkeyword": "",
        "businessCode": "all",
        "autoSearch": "Y",
        "option": "corp",
        "textCrpNm": name,
        "textCrpNm2": name,
        "textPresenterNm": "",
        "startDate": from_ymd,
        "endDate": to_ymd,
        "finalReport": "recent",
        "reportName": "",
        "reportName2": "",
        "tocSrch": "",
        "tocSrch2": "",
    }
    try:
        req = urllib.request.Request(
            search_url,
            data=urlencode(params).encode(),
            headers={
                "User-Agent": NAVER_UA,
                "Referer": "https://dart.fss.or.kr/dsab007/main.do?option=corp",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
            },
        )
        with urllib.request.urlopen(req, timeout=4) as f:
            raw = f.read()
            charset = f.headers.get_content_charset() or "utf-8"
        html = raw.decode(charset, "ignore")
    except Exception:
        return tuple()

    signals: list[dict] = []
    detail_fetch_count = 0
    for row in re.findall(r"<tr[^>]*>.*?</tr>", html, flags=re.IGNORECASE | re.DOTALL):
        text = _clean_html_text(row)
        if len(text) < 12 or "조회 결과가 없습니다" in text:
            continue
        keywords = _signal_keywords(text)
        rcp_no_match = re.search(r"rcpNo=([0-9]+)", row)
        rcp_no = rcp_no_match.group(1) if rcp_no_match else ""
        if not rcp_no:
            continue
        title_match = re.search(r'title="([^"]+)"', row)
        title = html_lib.unescape(title_match.group(1)).replace(" 공시뷰어 새창", "").strip() if title_match else "DART 공시"
        detail_url = f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcp_no}"
        if detail_fetch_count < 5:
            detail_fetch_count += 1
            detail_signal = _dart_filing_detail_signal(rcp_no, name, title)
            if detail_signal:
                signals.append(detail_signal)
        if keywords:
            profile = _signal_causal_profile(text)
            signals.append(
                {
                    "sourceType": "disclosure",
                    "label": "DART 공시 텍스트",
                    "url": detail_url,
                    "text": f"{title}: {text}"[:220],
                    "matchedKeywords": keywords[:6],
                    **profile,
                    "signalOrigin": "dart_search_row",
                }
            )
    return tuple(_dedupe_signals(signals, 5))


@lru_cache(maxsize=4096)
def _dart_filing_detail_signal(rcp_no: str, name: str, title: str) -> dict | None:
    if not rcp_no:
        return None
    main_url = f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcp_no}"
    try:
        main_html = _naver_fetch(main_url, timeout=3)
    except Exception:
        return None

    m = re.search(r'viewDoc\("([0-9]+)",\s*"([0-9]+)",\s*"([^"]*)",\s*"([^"]*)",\s*"([^"]*)",\s*"([^"]*)"', main_html)
    if not m:
        return None
    _, dcm_no, ele_id, offset, length, dtd = m.groups()
    viewer_url = (
        "https://dart.fss.or.kr/report/viewer.do"
        f"?rcpNo={rcp_no}&dcmNo={dcm_no}&eleId={ele_id}&offset={offset}&length={length}&dtd={dtd}"
    )
    try:
        body = _clean_html_text(_naver_fetch(viewer_url, timeout=3))
    except Exception:
        return None
    if name not in body and title not in body:
        return None
    keywords = _signal_keywords(body)
    if not keywords:
        return None
    profile = _signal_causal_profile(body)
    return {
        "sourceType": "disclosure",
        "label": "DART 공시 본문",
        "url": main_url,
        "text": _snippet_around_keywords(body, [name, title, *keywords], 260),
        "matchedKeywords": keywords[:8],
        **profile,
        "signalOrigin": "dart_filing_detail",
    }


def _event_text_signals(code: str, name: str, from_ymd: str, to_ymd: str) -> list[dict]:
    signals = list(_naver_news_text_signals(code, name))
    signals.extend(_dart_disclosure_text_signals(name, from_ymd, to_ymd))
    return signals


def _clean_news_headline_title(text: str) -> str:
    cleaned = " ".join(str(text or "").split())
    for marker in ("주요서비스 바로가기", "본문 바로가기", "매체정보 바로가기", "잠깐! 현재 Internet Explorer"):
        if marker in cleaned:
            cleaned = cleaned.split(marker, 1)[0].strip()
    for match in re.finditer(r"(다\.|밝혔다\.|전했다\.|나왔다\.)", cleaned):
        if match.end() >= 28:
            cleaned = cleaned[: match.end()].strip()
            break
    if len(cleaned) > 84:
        cleaned = cleaned[:82].rstrip() + "..."
    return cleaned if cleaned else "뉴스 제목 확인 필요"


def _news_headline_items(code: str, name: str, limit: int = 8) -> list[dict]:
    items: list[dict] = []
    raw_signals = list(_naver_news_text_signals(code, name))
    search_signals = [signal for signal in raw_signals if signal.get("signalOrigin") == "search_result"]
    fallback_signals = [signal for signal in raw_signals if signal.get("signalOrigin") != "search_result"]
    seen_titles: set[str] = set()
    for signal in [*search_signals, *fallback_signals]:
        text = str(signal.get("text") or "").strip()
        if not text:
            continue
        title = _clean_news_headline_title(text)
        dedupe_key = re.sub(r"\W+", "", title)[:80]
        if not dedupe_key or dedupe_key in seen_titles:
            continue
        seen_titles.add(dedupe_key)
        direction = str(signal.get("causalDirection") or "neutral")
        if direction not in {"positive", "negative", "mixed", "neutral"}:
            direction = "neutral"
        items.append(
            {
                "title": title,
                "url": signal.get("url", ""),
                "sourceType": signal.get("sourceType", "news"),
                "sentiment": direction,
                "matchedKeywords": signal.get("matchedKeywords", [])[:8],
                "causalFactors": signal.get("causalFactors", [])[:6],
                "evidenceLevel": signal.get("signalOrigin", "search_result"),
                "summary": signal.get("signalSummary") or text[:220],
            }
        )
        if len(items) >= limit:
            break
    return items


def _event_severity(abs_price_rate: float, volume_rate: float) -> str:
    if abs_price_rate >= 12 or volume_rate >= 450:
        return "high"
    if abs_price_rate >= 6 or volume_rate >= 220:
        return "medium"
    return "low"


def _causal_confidence(score: int, source_type: str) -> str:
    if source_type in {"news", "disclosure", "discussion"}:
        if score >= 62:
            return "medium"
        return "low"
    if score >= 75:
        return "high"
    if score >= 50:
        return "medium"
    return "low"


def _clamp_score(value: float, low: int, high: int) -> int:
    return max(low, min(high, int(round(value))))


def _unique_signal_values(signals: list[dict], key: str) -> list[str]:
    out: list[str] = []
    for signal in signals:
        for value in signal.get(key, []) or []:
            if value and value not in out:
                out.append(value)
    return out


def _aggregate_signal_direction(signals: list[dict], price_rate: float, source_type: str) -> str:
    if not signals:
        if source_type == "price_history":
            if price_rate > 0:
                return "positive"
            if price_rate < 0:
                return "negative"
        return "neutral"

    directions = [signal.get("causalDirection", "neutral") for signal in signals]
    if "mixed" in directions:
        return "mixed"
    has_positive = "positive" in directions
    has_negative = "negative" in directions
    if has_positive and has_negative:
        return "mixed"
    if has_positive:
        return "positive"
    if has_negative:
        return "negative"
    return "neutral"


def _causal_evidence_level(source_type: str, signal_origins: list[str]) -> str:
    if source_type == "price_history":
        return "market_data"
    if any(origin in {"article_body", "dart_filing_detail"} for origin in signal_origins):
        return "body"
    if any(origin in {"search_result", "dart_search_row"} for origin in signal_origins):
        return "search"
    return "none"


def _event_causal_scores(
    sources: list[dict[str, str]],
    event_type: str,
    price_rate: float,
    volume_rate: float,
    text_signals: list[dict],
) -> list[dict]:
    abs_price = abs(price_rate)
    direction = "상승" if price_rate > 0 else "하락" if price_rate < 0 else "변동"
    basis = f"등락률 {price_rate:+.2f}%, 20일 평균 대비 거래량 {volume_rate:.0f}%"
    scores: list[dict] = []

    for source in sources:
        source_type = source.get("type", "source")
        source_signals = [signal for signal in text_signals if signal.get("sourceType") == source_type]
        signal_count = len(source_signals)
        signal_keywords = sorted({keyword for signal in source_signals for keyword in signal.get("matchedKeywords", [])})
        signal_origins = sorted({signal.get("signalOrigin", "unknown") for signal in source_signals})
        causal_factors = _unique_signal_values(source_signals, "causalFactors")[:6]
        causal_direction = _aggregate_signal_direction(source_signals, price_rate, source_type)
        evidence_level = _causal_evidence_level(source_type, signal_origins)
        signal_urls = []
        for signal in source_signals:
            url = signal.get("url", "")
            if url and url not in signal_urls:
                signal_urls.append(url)
        origin_boost = 6 if evidence_level == "body" else 2 if evidence_level == "search" else 0
        factor_weight = sum(int(signal.get("causalWeight", 0) or 0) for signal in source_signals)
        factor_boost = min(len(causal_factors) * 3 + factor_weight / 4, 14)
        signal_boost = min(signal_count * 4 + len(signal_keywords) * 1.5 + factor_boost + origin_boost, 26)
        signal_summary = source_signals[0]["text"] if source_signals else "텍스트 근거 미확인"
        factor_phrase = f" 주요 요인: {', '.join(causal_factors[:3])}." if causal_factors else ""
        if source_type == "price_history":
            score = _clamp_score(
                58 + min(abs_price * 2.2, 24) + min(max(volume_rate - 100, 0) / 12, 16) + (8 if event_type == "volume_spike" else 0),
                45,
                96,
            )
            interpretation = "가격/거래량 원자료에서 이벤트 자체가 확인됩니다."
        elif source_type == "news":
            score = _clamp_score(
                34 + min(abs_price * 1.4, 18) + min(max(volume_rate - 120, 0) / 22, 14) + signal_boost,
                20,
                82,
            )
            interpretation = f"검색된 뉴스 텍스트가 가격/거래량 이벤트의 원인 후보를 보강합니다.{factor_phrase}" if signal_count else "같은 시점 뉴스가 원인 후보일 수 있으나 원문 확인 전에는 확정하지 않습니다."
        elif source_type == "disclosure":
            score = _clamp_score(
                30 + min(abs_price * 1.1, 14) + min(max(volume_rate - 180, 0) / 28, 12) + signal_boost,
                18,
                78,
            )
            interpretation = f"DART 검색/공시 본문 텍스트가 이벤트 원인 후보를 보강합니다.{factor_phrase}" if signal_count else "공식 공시는 강한 원인 후보지만 DART 원문 확인이 필요합니다."
        elif source_type == "discussion":
            score = _clamp_score(
                24 + min(max(volume_rate - 120, 0) / 18, 18) + min(abs_price, 8),
                15,
                58,
            )
            interpretation = "토론방 언급은 관심도 후보이며 가격 원인으로 단정하지 않습니다."
        elif source_type == "finance_summary":
            score = _clamp_score(22 + min(abs_price * 1.2, 14) + min(max(volume_rate - 150, 0) / 35, 8), 15, 52)
            interpretation = "종목 요약은 배경 정보이며 직접 원인 증거로는 약합니다."
        else:
            score = _clamp_score(18 + min(abs_price, 10), 10, 45)
            interpretation = "보조 근거이며 직접 원인 여부는 추가 확인이 필요합니다."

        scores.append(
            {
                "sourceType": source_type,
                "label": source.get("title", source_type),
                "score": score,
                "confidence": _causal_confidence(score, source_type),
                "basis": basis,
                "interpretation": f"{direction} 이벤트 기준. {interpretation}",
                "signalCount": signal_count,
                "matchedSignals": signal_keywords[:6],
                "causalFactors": causal_factors,
                "causalDirection": causal_direction,
                "evidenceLevel": evidence_level,
                "signalSummary": signal_summary,
                "signalOrigins": signal_origins[:4],
                "signalUrls": signal_urls[:3],
            }
        )

    return sorted(scores, key=lambda item: item["score"], reverse=True)


def _detect_chart_events(code: str, name: str, df: pd.DataFrame, from_ymd: str, to_ymd: str) -> list[dict]:
    events: list[dict] = []
    daily = df.copy().sort_index()
    daily["prev_close"] = daily["close"].shift(1)
    daily["price_rate"] = ((daily["close"] - daily["prev_close"]) / daily["prev_close"] * 100).fillna(0)
    daily["vol_avg20"] = daily["volume"].shift(1).rolling(20, min_periods=5).mean()
    daily["volume_rate"] = (daily["volume"] / daily["vol_avg20"] * 100).replace([float("inf"), -float("inf")], 0).fillna(0)

    start = pd.to_datetime(from_ymd)
    end = pd.to_datetime(to_ymd)
    target = daily[(daily.index >= start) & (daily.index <= end)]
    evidence_sources = _event_evidence_sources(code, name)
    evidence_links = _event_evidence_links(evidence_sources)
    text_signals = _event_text_signals(code, name, from_ymd, to_ymd)

    for idx, row in target.iterrows():
        price_rate = round(float(row["price_rate"]), 2)
        volume_rate = round(float(row["volume_rate"]), 2)
        abs_price = abs(price_rate)
        day_events: list[tuple[str, str, str]] = []

        if price_rate >= 5:
            day_events.append(
                (
                    "price_surge",
                    "가격 급등",
                    "전일 종가 대비 상승폭이 큽니다. 공시, 뉴스, 거래량 증가가 함께 있었는지 확인해야 합니다.",
                )
            )
        elif price_rate <= -5:
            day_events.append(
                (
                    "price_drop",
                    "가격 급락",
                    "전일 종가 대비 하락폭이 큽니다. 일시적 충격인지 추세 훼손인지 구분해야 합니다.",
                )
            )

        if volume_rate >= 180:
            day_events.append(
                (
                    "volume_spike",
                    "거래량 급증",
                    "최근 20거래일 평균 대비 거래량이 크게 늘었습니다. 관심 변화나 수급 이벤트 가능성을 점검합니다.",
                )
            )

        for event_type, title, explanation in day_events:
            events.append(
                {
                    "date": idx.strftime("%Y-%m-%d"),
                    "type": event_type,
                    "severity": _event_severity(abs_price, volume_rate),
                    "priceChangeRate": price_rate,
                    "volumeChangeRate": volume_rate,
                    "title": title,
                    "explanation": explanation,
                    "evidenceLinks": evidence_links,
                    "evidenceSources": evidence_sources,
                    "causalScores": _event_causal_scores(evidence_sources, event_type, price_rate, volume_rate, text_signals),
                }
            )

    return events[:80]


def _top_traded_value_universe(ymd: str, n: int = 200) -> list[str]:
    ohlcv = stock.get_market_ohlcv_by_ticker(ymd, market="ALL")
    if ohlcv is None or len(ohlcv.index) == 0:
        return []

    if "거래대금" in ohlcv.columns:
        s = ohlcv["거래대금"]
    else:
        close = ohlcv["종가"] if "종가" in ohlcv.columns else 0
        vol = ohlcv["거래량"] if "거래량" in ohlcv.columns else 0
        s = close * vol

    s = s.dropna()
    return s.nlargest(n).index.tolist()


def _most_mentioned_by_board_posts(
    tickers: list[str],
    ymd: str,
    topk: int = 3,
    max_pages: int = 3,
    timeout_seconds: float = 15.0,
) -> list[dict]:
    if not tickers:
        return []

    started = time.time()
    results: list[dict] = []

    max_workers = min(64, len(tickers))
    ex = ThreadPoolExecutor(max_workers=max_workers)
    fut_map = {ex.submit(_naver_board_posts_on_date, t, ymd, max_pages): t for t in tickers}
    try:
        try:
            for fut in as_completed(fut_map, timeout=timeout_seconds):
                t = fut_map[fut]
                if time.time() - started > timeout_seconds:
                    break
                try:
                    c = int(fut.result() or 0)
                except Exception:
                    c = 0
                results.append({"code": t, "name": _name(t), "count": c})
        except FuturesTimeoutError:
            pass
    finally:
        for fut in fut_map:
            fut.cancel()
        ex.shutdown(wait=False, cancel_futures=True)

    results.sort(key=lambda x: (x.get("count", 0), x.get("code", "")), reverse=True)
    return results[:topk]


@app.get("/health")
def health():
    return {"status": "UP"}


@lru_cache(maxsize=8)
def _stock_universe_for_day(ymd: str) -> tuple[dict, ...]:
    items: list[dict] = []
    seen: set[str] = set()
    try:
        for market in ("KOSPI", "KOSDAQ"):
            tickers = stock.get_market_ticker_list(ymd, market=market)
            for ticker in tickers:
                if not _is_normal_ticker(ticker) or ticker in seen:
                    continue
                seen.add(ticker)
                name = _name(ticker)
                items.append({"code": ticker, "name": name, "market": market})
    except Exception:
        pass

    for item in BASELINE_STOCK_UNIVERSE:
        if item["code"] not in seen:
            seen.add(item["code"])
            items.append(dict(item))

    items.sort(key=lambda item: (item["market"], item["code"]))
    return tuple(items)


@lru_cache(maxsize=8)
def _sector_taxonomy_for_day(ymd: str) -> tuple[dict, ...]:
    sectors: dict[str, dict] = {}
    try:
        for market in ("KOSPI", "KOSDAQ"):
            df = stock.get_market_sector_classifications(ymd, market=market)
            if df is None or len(df.index) == 0:
                continue

            for ticker, row in df.iterrows():
                code = str(ticker).strip()
                if code.isdigit():
                    code = code.zfill(6)
                if not _is_normal_ticker(code):
                    continue

                sector_name = str(row.get("업종명", "")).strip()
                stock_name = str(row.get("종목명", "")).strip()
                if not sector_name or sector_name == "nan":
                    continue
                if not stock_name or stock_name == "nan":
                    stock_name = _name(code)

                item = {
                    "code": code,
                    "name": stock_name,
                    "market": market,
                    "marketCap": _safe_int(row.get("시가총액", 0)),
                    "rate": round(_safe_float(row.get("등락률", 0)), 2),
                }
                bucket = sectors.setdefault(
                    sector_name,
                    {"name": sector_name, "markets": set(), "stocks": [], "rateSum": 0.0},
                )
                bucket["markets"].add(market)
                bucket["stocks"].append(item)
                bucket["rateSum"] += item["rate"]
    except Exception:
        pass

    out: list[dict] = []
    for sector_name, bucket in sectors.items():
        stocks = sorted(bucket["stocks"], key=lambda item: (item["marketCap"], item["code"]), reverse=True)
        member_count = len(stocks)
        top_stocks = stocks[:5]
        markets = sorted(bucket["markets"])
        avg_rate = round(bucket["rateSum"] / member_count, 2) if member_count else 0.0
        out.append(
            {
                "name": sector_name,
                "type": "industry",
                "market": "KRX",
                "markets": markets,
                "memberCount": member_count,
                "rate": avg_rate,
                "topStocks": top_stocks,
                "summary": (
                    f"KRX 업종 분류 기준 {member_count}개 상장 종목이 포함됩니다. "
                    f"대표 종목: {', '.join(stock_item['name'] for stock_item in top_stocks[:3])}."
                ),
            }
        )

    existing_names = {item["name"] for item in out}
    for item in BASELINE_SECTOR_TAXONOMY:
        if item["name"] not in existing_names:
            out.append(dict(item))

    out.sort(key=lambda item: (-item["memberCount"], item["name"]))
    return tuple(out)


def _clean_text(value) -> str:
    text = str(value or "").strip()
    return "" if text == "nan" else text


@lru_cache(maxsize=4)
def _theme_taxonomy_from_naver(max_pages: int = 10) -> tuple[dict, ...]:
    first_html = _naver_fetch("https://finance.naver.com/sise/theme.naver")
    page_numbers = [int(v) for v in re.findall(r"theme\.naver\?&(?:amp;)?page=(\d+)", first_html)]
    total_pages = max(page_numbers) if page_numbers else 1
    total_pages = max(1, min(total_pages, max_pages))

    items: list[dict] = []
    seen: set[str] = set()
    for page in range(1, total_pages + 1):
        html = first_html if page == 1 else _naver_fetch(f"https://finance.naver.com/sise/theme.naver?&page={page}")
        try:
            tables = pd.read_html(StringIO(html))
        except Exception:
            continue
        if not tables:
            continue
        table = tables[0]
        for _, row in table.iterrows():
            if len(row) < 8:
                continue
            name = _clean_text(row.iloc[0])
            if not name or name in seen:
                continue
            seen.add(name)

            leader_names = [_clean_text(row.iloc[6]), _clean_text(row.iloc[7])]
            leaders = [value for value in leader_names if value]
            rising = _safe_int(row.iloc[3])
            flat = _safe_int(row.iloc[4])
            falling = _safe_int(row.iloc[5])
            rate = _clean_text(row.iloc[1])
            three_day_rate = _clean_text(row.iloc[2])
            items.append(
                {
                    "name": name,
                    "type": "theme",
                    "market": "테마",
                    "rate": rate,
                    "threeDayRate": three_day_rate,
                    "risingCount": rising,
                    "flatCount": flat,
                    "fallingCount": falling,
                    "leaders": leaders,
                    "summary": (
                        f"Naver Finance 테마 시세 기준입니다. "
                        f"상승 {rising}개, 보합 {flat}개, 하락 {falling}개. "
                        f"주도주: {', '.join(leaders) if leaders else '확인 필요'}."
                    ),
                }
            )

    return tuple(items)


@app.get("/stocks/universe")
def stock_universe(query: str | None = None, limit: int = 5000):
    today_ymd = datetime.now().strftime("%Y%m%d")
    as_of_ymd, adjust_note = _effective_business_day_or_previous(today_ymd)
    safe_limit = max(1, min(int(limit or 5000), 5000))
    try:
        universe = list(_stock_universe_for_day(as_of_ymd))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"pykrx_stock_universe_error: {type(e).__name__}") from e

    q = _normalize_query(query)
    if q:
        filtered = [
            item
            for item in universe
            if q in item["code"].lower()
            or q in item["name"].lower()
            or q in item["market"].lower()
        ]
    else:
        filtered = universe

    return {
        "asOf": f"{as_of_ymd[0:4]}-{as_of_ymd[4:6]}-{as_of_ymd[6:8]}",
        "source": "pykrx_market_ticker_list",
        "totalCount": len(universe),
        "count": min(len(filtered), safe_limit),
        "adjustmentNote": adjust_note,
        "stocks": filtered[:safe_limit],
    }


@app.get("/stocks/sectors")
def stock_sectors(query: str | None = None, limit: int = 200):
    today_ymd = datetime.now().strftime("%Y%m%d")
    as_of_ymd, adjust_note = _effective_business_day_or_previous(today_ymd)
    safe_limit = max(1, min(int(limit or 200), 500))
    try:
        sectors = list(_sector_taxonomy_for_day(as_of_ymd))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"pykrx_sector_classification_error: {type(e).__name__}") from e

    q = _normalize_query(query)
    if q:
        filtered = []
        for sector in sectors:
            top_stock_text = " ".join(
                f"{item['code']} {item['name']} {item['market']}" for item in sector.get("topStocks", [])
            )
            text = " ".join(
                [
                    sector.get("name", ""),
                    sector.get("market", ""),
                    " ".join(sector.get("markets", [])),
                    sector.get("summary", ""),
                    top_stock_text,
                ]
            ).lower()
            if q in text:
                filtered.append(sector)
    else:
        filtered = sectors

    return {
        "asOf": f"{as_of_ymd[0:4]}-{as_of_ymd[4:6]}-{as_of_ymd[6:8]}",
        "source": "pykrx_market_sector_classifications",
        "totalCount": len(sectors),
        "count": min(len(filtered), safe_limit),
        "adjustmentNote": adjust_note,
        "sectors": filtered[:safe_limit],
    }


@app.get("/stocks/themes")
def stock_themes(query: str | None = None, limit: int = 300):
    safe_limit = max(1, min(int(limit or 300), 500))
    try:
        themes = list(_theme_taxonomy_from_naver())
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"naver_theme_taxonomy_error: {type(e).__name__}") from e

    q = _normalize_query(query)
    if q:
        filtered = [
            item
            for item in themes
            if q in " ".join(
                [
                    item.get("name", ""),
                    item.get("market", ""),
                    item.get("summary", ""),
                    " ".join(item.get("leaders", [])),
                ]
            ).lower()
        ]
    else:
        filtered = themes

    return {
        "asOf": datetime.now().strftime("%Y-%m-%d"),
        "source": "naver_finance_theme",
        "totalCount": len(themes),
        "count": min(len(filtered), safe_limit),
        "themes": filtered[:safe_limit],
    }


@app.get("/market-status")
def market_status(date: str):
    """Check if a given date is a Korean stock market business day.

    Returns {"isBusinessDay": true/false, "reason": "..."}.
    """
    requested_ymd = _parse_date(date)
    d = datetime.strptime(requested_ymd, "%Y%m%d").date()

    # Weekend check
    if d.weekday() >= 5:
        day_name = "토요일" if d.weekday() == 5 else "일요일"
        return {"isBusinessDay": False, "reason": f"weekend ({day_name})"}

    # Use OHLCV data to determine if it's a business day
    # If 삼성전자(005930) has no data for this date, it's a holiday
    try:
        df = stock.get_market_ohlcv(requested_ymd, requested_ymd, "005930")
        if df is None or len(df) == 0:
            return {"isBusinessDay": False, "reason": "holiday"}
    except Exception:
        try:
            # Fallback: try OHLCV by ticker
            df2 = stock.get_market_ohlcv_by_ticker(requested_ymd, market="KOSPI")
            if df2 is None or len(df2.index) == 0:
                return {"isBusinessDay": False, "reason": "holiday"}
        except Exception:
            return {"isBusinessDay": False, "reason": "unknown (pykrx unavailable)"}

    return {"isBusinessDay": True, "reason": "business_day"}


@app.get("/stocks/{code}/chart")
def stock_chart(code: str, range: str = "6M", interval: str = "daily"):
    ticker = _normalize_stock_code(code)
    today_ymd = datetime.now().strftime("%Y%m%d")
    as_of_ymd, _ = _effective_business_day_or_previous(today_ymd)
    from_ymd = _range_start_ymd(range, as_of_ymd)
    raw = _load_ohlcv_frame(ticker, from_ymd, as_of_ymd)
    aggregated = _aggregate_ohlcv(raw, interval)

    return {
        "code": ticker,
        "name": _name(ticker),
        "interval": (interval or "daily").lower(),
        "range": (range or "6M").upper(),
        "priceBasis": "close",
        "adjusted": False,
        "asOf": f"{as_of_ymd[0:4]}-{as_of_ymd[4:6]}-{as_of_ymd[6:8]}",
        "data": _ohlcv_records(aggregated),
    }


@app.get("/stocks/{code}/events")
def stock_events(code: str, from_date: str | None = Query(default=None, alias="from"), to: str | None = None):
    if not from_date or not to:
        raise HTTPException(status_code=400, detail="from_and_to_required")

    ticker = _normalize_stock_code(code)
    from_ymd = _parse_date_to_ymd(from_date, "from")
    to_ymd = _parse_date_to_ymd(to, "to")
    if from_ymd > to_ymd:
        raise HTTPException(status_code=400, detail="from_must_be_on_or_before_to")

    lookback_from = (datetime.strptime(from_ymd, "%Y%m%d").date() - timedelta(days=90)).strftime("%Y%m%d")
    raw = _load_ohlcv_frame(ticker, lookback_from, to_ymd)

    name = _name(ticker)

    return {
        "code": ticker,
        "name": name,
        "from": f"{from_ymd[0:4]}-{from_ymd[4:6]}-{from_ymd[6:8]}",
        "to": f"{to_ymd[0:4]}-{to_ymd[4:6]}-{to_ymd[6:8]}",
        "events": _detect_chart_events(ticker, name, raw, from_ymd, to_ymd),
    }


@app.get("/stocks/{code}/news")
def stock_news(code: str, limit: int = 8):
    ticker = _normalize_stock_code(code)
    safe_limit = max(1, min(int(limit or 8), 12))
    name = _name(ticker)
    query = quote(f"{name} {ticker} 주가 거래량 공시")
    return {
        "code": ticker,
        "name": name,
        "asOf": datetime.now().strftime("%Y-%m-%d"),
        "source": "naver_news_search_text",
        "queryUrl": f"https://search.naver.com/search.naver?where=news&query={query}",
        "headlines": _news_headline_items(ticker, name, safe_limit),
        "limitations": [
            "네이버 뉴스 검색 결과의 제목/요약 텍스트 후보입니다.",
            "언론사 원문과 공시 원문 확인 전에는 확정 원인으로 쓰면 안 됩니다.",
        ],
    }


@app.get("/leaders")
def leaders(
    date: str,
    mentionsUniverse: int = 200,
    mentionsMaxPages: int = 3,
    mentionsTimeoutSeconds: float = 15.0,
):
    requested_ymd = _parse_date(date)
    effective_ymd, adjust_note = _effective_business_day_or_previous(requested_ymd)

    kospi_top_gainer_ticker = ""
    kospi_top_loser_ticker = ""
    kosdaq_top_gainer_ticker = ""
    kosdaq_top_loser_ticker = ""
    kospi_top_gainers: list[dict] = []
    kospi_top_losers: list[dict] = []
    kosdaq_top_gainers: list[dict] = []
    kosdaq_top_losers: list[dict] = []
    top_gainers: list[dict] = []
    top_losers: list[dict] = []
    top_gainer_ticker = ""
    top_loser_ticker = ""
    kospi_top_gainer_rate = 0.0
    kospi_top_loser_rate = 0.0
    kosdaq_top_gainer_rate = 0.0
    kosdaq_top_loser_rate = 0.0
    df_change = None
    prev = ""

    try:
        prev = _previous_business_day(effective_ymd)

        # --- pykrx primary path ---
        # Use OHLCV-based previous-close rate instead of pykrx's "등락률"
        # (which uses KRX's "비교 기준가", not the actual previous close)
        rates = _calc_prev_close_rate(effective_ymd, prev)

        if not rates:
            raise ValueError("empty_rates")

        # Get ticker sets for each market
        kospi_tickers = set(stock.get_market_ticker_list(effective_ymd, market="KOSPI"))
        kosdaq_tickers = set(stock.get_market_ticker_list(effective_ymd, market="KOSDAQ"))

        kospi_top_gainers, kospi_top_losers = _top_rate_lists_from_rates(rates, kospi_tickers, n=3)
        kosdaq_top_gainers, kosdaq_top_losers = _top_rate_lists_from_rates(rates, kosdaq_tickers, n=3)
        top_gainers, top_losers = _top_rate_lists_from_rates(rates, n=3)

        if not kospi_top_gainers and not kosdaq_top_gainers and not top_gainers:
            raise ValueError("empty_dataframe")

        df_change = True  # sentinel: pykrx succeeded

    except Exception as e:
        today_ymd = datetime.now().strftime("%Y%m%d")
        if requested_ymd == today_ymd:
            # Fallback (today only): use Naver sise_rise/sise_fall pages.
            prev = _previous_business_day(effective_ymd)
            kospi_g, kospi_l = _naver_today_movers(0)
            kosdaq_g, kosdaq_l = _naver_today_movers(1)

            top_gainers = (kospi_g + kosdaq_g)[:3]
            top_losers = (kospi_l + kosdaq_l)[:3]
            kospi_top_gainers = kospi_g[:3]
            kospi_top_losers = kospi_l[:3]
            kosdaq_top_gainers = kosdaq_g[:3]
            kosdaq_top_losers = kosdaq_l[:3]
            df_change = None
        else:
            raise HTTPException(status_code=502, detail=f"pykrx_error: {e}") from e

    # Derive top1 tickers/rates from TOP3 lists (consistent by construction)
    kospi_top_gainer_ticker = kospi_top_gainers[0]["code"] if kospi_top_gainers else ""
    kospi_top_loser_ticker = kospi_top_losers[0]["code"] if kospi_top_losers else ""
    kosdaq_top_gainer_ticker = kosdaq_top_gainers[0]["code"] if kosdaq_top_gainers else ""
    kosdaq_top_loser_ticker = kosdaq_top_losers[0]["code"] if kosdaq_top_losers else ""
    top_gainer_ticker = top_gainers[0]["code"] if top_gainers else ""
    top_loser_ticker = top_losers[0]["code"] if top_losers else ""

    kospi_top_gainer_rate = kospi_top_gainers[0]["rate"] if kospi_top_gainers else 0.0
    kospi_top_loser_rate = kospi_top_losers[0]["rate"] if kospi_top_losers else 0.0
    kosdaq_top_gainer_rate = kosdaq_top_gainers[0]["rate"] if kosdaq_top_gainers else 0.0
    kosdaq_top_loser_rate = kosdaq_top_losers[0]["rate"] if kosdaq_top_losers else 0.0

    # Mentions universe (naver board posts — unchanged)
    try:
        universe = _top_traded_value_universe(effective_ymd, n=max(1, min(mentionsUniverse, 2000)))
    except Exception:
        universe = []

    most_mentioned_list = _most_mentioned_by_board_posts(
        universe,
        effective_ymd,
        topk=3,
        max_pages=max(1, min(mentionsMaxPages, 50)),
        timeout_seconds=max(1.0, min(mentionsTimeoutSeconds, 120.0)),
    )
    most_ticker = most_mentioned_list[0]["code"] if most_mentioned_list else ""

    kospi_top_gainer_name = _name(kospi_top_gainer_ticker) if kospi_top_gainer_ticker else "-"
    kospi_top_loser_name = _name(kospi_top_loser_ticker) if kospi_top_loser_ticker else "-"
    kosdaq_top_gainer_name = _name(kosdaq_top_gainer_ticker) if kosdaq_top_gainer_ticker else "-"
    kosdaq_top_loser_name = _name(kosdaq_top_loser_ticker) if kosdaq_top_loser_ticker else "-"
    top_gainer_name = top_gainers[0]["name"] if top_gainers else "-"
    top_loser_name = top_losers[0]["name"] if top_losers else "-"

    source = (
        "pykrx(KRX OHLCV 전일대비 계산) + naver(board posts)"
        if df_change is not None
        else "naver(sise_rise/sise_fall) + naver(board posts)"
    )

    notes_parts = [
        f"source={source}",
        f"effective_date={effective_ymd}",
        f"prev_date={prev}",
        "mostMentioned=naver_board_posts(universe=traded_value_topN)",
        f"mentions_universe_size={len(universe)}",
    ]
    if adjust_note:
        notes_parts.append(adjust_note)

    return {
        "date": date,
        "effectiveDate": effective_ymd,
        "rawTopGainer": top_gainer_name,
        "rawTopLoser": top_loser_name,
        "filteredTopGainer": top_gainer_name,
        "filteredTopLoser": top_loser_name,
        "topGainer": top_gainer_name,
        "topLoser": top_loser_name,
        "mostMentioned": _name(most_ticker) if most_ticker else "-",
        "kospiPick": kospi_top_gainer_name,
        "kosdaqPick": kosdaq_top_gainer_name,
        "topGainerCode": top_gainer_ticker,
        "topLoserCode": top_loser_ticker,
        "rawTopGainerCode": top_gainer_ticker,
        "rawTopLoserCode": top_loser_ticker,
        "filteredTopGainerCode": top_gainer_ticker,
        "filteredTopLoserCode": top_loser_ticker,
        "mostMentionedCode": most_ticker,
        "kospiPickCode": kospi_top_gainer_ticker,
        "kosdaqPickCode": kosdaq_top_gainer_ticker,
        "kospiTopGainer": kospi_top_gainer_name,
        "kosdaqTopGainer": kosdaq_top_gainer_name,
        "kospiTopLoser": kospi_top_loser_name,
        "kosdaqTopLoser": kosdaq_top_loser_name,
        "kospiTopGainerCode": kospi_top_gainer_ticker,
        "kosdaqTopGainerCode": kosdaq_top_gainer_ticker,
        "kospiTopLoserCode": kospi_top_loser_ticker,
        "kosdaqTopLoserCode": kosdaq_top_loser_ticker,
        "kospiTopGainerRate": kospi_top_gainer_rate,
        "kospiTopLoserRate": kospi_top_loser_rate,
        "kosdaqTopGainerRate": kosdaq_top_gainer_rate,
        "kosdaqTopLoserRate": kosdaq_top_loser_rate,
        "topGainers": top_gainers,
        "topLosers": top_losers,
        "kospiTopGainers": kospi_top_gainers,
        "kospiTopLosers": kospi_top_losers,
        "kosdaqTopGainers": kosdaq_top_gainers,
        "kosdaqTopLosers": kosdaq_top_losers,
        "mostMentionedTop": most_mentioned_list,
        "anomalies": [],
        "rankingWarning": "",
        "source": source,
        "notes": "\n".join(notes_parts),
    }
