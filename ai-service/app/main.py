from __future__ import annotations

from datetime import date
import json
import os
from typing import Any
from urllib import error, request

from fastapi import FastAPI
from pydantic import BaseModel, Field


app = FastAPI(title="kr-stock-daily-brief ai-service", version="0.1.0")


class ChatRequest(BaseModel):
    question: str = ""
    contextDate: str | None = None
    stockCode: str | None = None
    stockName: str | None = None
    topicType: str | None = None
    topicTitle: str | None = None
    searchResult: dict[str, Any] | None = None
    focus: str | None = None
    summary: dict[str, Any] | None = None
    chart: dict[str, Any] | None = None
    indicatorSnapshot: dict[str, Any] | None = None
    tradeZones: dict[str, Any] | None = None
    currentDecisionSummary: dict[str, Any] | None = None
    portfolioContext: dict[str, Any] | None = None
    events: list[dict[str, Any]] = Field(default_factory=list)
    newsHeadlines: list[dict[str, Any]] = Field(default_factory=list)
    terms: list[dict[str, Any]] = Field(default_factory=list)


def _clean(value: Any, fallback: str = "-") -> str:
    text = str(value or "").strip()
    return text if text else fallback


def _label(value: Any) -> str:
    return {
        "above": "20일선 위",
        "below": "20일선 아래",
        "near": "20일선 근처",
        "positive": "좋게 볼 수 있는 이유",
        "negative": "주의할 이유",
        "neutral": "판단 보류",
        "mixed": "좋은 점과 주의할 점이 함께 있음",
        "buy_review": "매수 검토 구간",
        "sell_review": "매도 검토 구간",
        "risk_management": "리스크 관리 구간",
        "watch": "관망 구간",
        "uptrend_extension": "상승 흐름이 이어지는 구간",
        "uptrend_pullback": "상승 흐름 안에서 눌림을 확인하는 구간",
        "downtrend": "하락 흐름을 조심할 구간",
        "downtrend_rebound": "하락 후 반등을 확인하는 구간",
        "sideways": "방향을 더 확인해야 하는 횡보 구간",
        "strong": "평소보다 강한 거래량",
        "normal": "평균 수준",
        "weak": "평소보다 약한 편",
        "rising": "상승 중",
        "falling": "하락 중",
        "flat": "큰 변화 없음",
    }.get(str(value or "").strip().lower(), _clean(value, "확인 필요"))


def _compact(value: Any, limit: int = 420) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        text = value
    else:
        text = json.dumps(value, ensure_ascii=False, default=str)
    text = " ".join(text.split())
    return text[:limit]


def _event_lines(events: list[dict[str, Any]]) -> list[str]:
    lines: list[str] = []
    for event in events[:5]:
        sentiment = _label(event.get("sentimentForPrice") or event.get("sentiment"))
        positive = event.get("positiveReasons") or []
        negative = event.get("negativeReasons") or []
        positive_text = f" 좋게 볼 이유: {_clean(positive[0], '')}" if isinstance(positive, list) and positive else ""
        negative_text = f" 주의할 이유: {_clean(negative[0], '')}" if isinstance(negative, list) and negative else ""
        lines.append(
            f"- {event.get('date', '-')}: {event.get('title', '이벤트')} "
            f"({event.get('severity', 'unknown')}, {sentiment}) - {event.get('explanation', '설명 없음')}"
            f"{positive_text}{negative_text}"
        )
    return lines


def _term_lines(terms: list[dict[str, Any]]) -> list[str]:
    lines: list[str] = []
    for term in terms[:5]:
        name = term.get("term") or term.get("id") or "용어"
        definition = term.get("plainDefinition") or term.get("definition") or ""
        if definition:
            lines.append(f"- {name}: {definition}")
    return lines


def _search_context_lines(search_result: dict[str, Any] | None) -> list[str]:
    if not search_result:
        return []
    tags = search_result.get("tags") or []
    if isinstance(tags, list):
        tag_text = ", ".join(str(tag) for tag in tags[:5] if str(tag).strip())
    else:
        tag_text = str(tags)
    lines = [
        f"- 분류: {_clean(search_result.get('market') or search_result.get('type'))}",
        f"- 요약: {_clean(search_result.get('summary'))}",
    ]
    if tag_text:
        lines.append(f"- 연결 키워드: {tag_text}")
    source = _clean(search_result.get("source"), "")
    if source:
        lines.append(f"- 검색 출처: {source}")
    return lines


def _build_retrieval_documents(req: ChatRequest, subject: str, code: str, topic_type: str, basis_date: str) -> list[dict[str, str]]:
    documents: list[dict[str, str]] = []

    if req.searchResult:
        documents.append({
            "id": "search-result",
            "type": _clean(req.searchResult.get("type"), topic_type),
            "title": _clean(req.searchResult.get("title"), subject),
            "text": _compact(req.searchResult),
            "basisDate": basis_date,
        })

    if req.summary:
        documents.append({
            "id": "daily-summary",
            "type": "daily_summary",
            "title": f"{basis_date} 저장 브리프",
            "text": _compact(req.summary),
            "basisDate": basis_date,
        })

    if req.chart:
        documents.append({
            "id": "chart-snapshot",
            "type": "chart",
            "title": f"{subject}{f'({code})' if code else ''} 차트 스냅샷",
            "text": _compact(req.chart),
            "basisDate": _clean(req.chart.get("asOf"), basis_date) if isinstance(req.chart, dict) else basis_date,
        })

    if req.indicatorSnapshot:
        documents.append({
            "id": "indicator-snapshot",
            "type": "indicator_snapshot",
            "title": f"{subject} 이동평균선과 지지/저항 분석",
            "text": _compact(req.indicatorSnapshot),
            "basisDate": _clean(req.indicatorSnapshot.get("basisDate"), basis_date),
        })

    if req.tradeZones:
        documents.append({
            "id": "trade-zones",
            "type": "trade_zones",
            "title": f"{subject} 조건형 매수/매도 검토 구간",
            "text": _compact(req.tradeZones),
            "basisDate": _clean(req.tradeZones.get("basisDate"), basis_date),
        })

    if req.currentDecisionSummary:
        documents.append({
            "id": "current-decision-summary",
            "type": "decision_summary",
            "title": f"{subject} 현재 검토 조건 요약",
            "text": _compact(req.currentDecisionSummary),
            "basisDate": basis_date,
        })

    if req.portfolioContext:
        documents.append({
            "id": "portfolio-context",
            "type": "portfolio_context",
            "title": f"{subject} 포트폴리오 샌드박스 맥락",
            "text": _compact(req.portfolioContext),
            "basisDate": basis_date,
        })

    for index, event in enumerate((req.events or [])[:6], start=1):
        event_date = _clean(event.get("date"), basis_date)
        event_title = _clean(event.get("title"), "이벤트")
        documents.append({
            "id": f"event-{index}",
            "type": _clean(event.get("type"), "event"),
            "title": event_title,
            "text": _compact(event),
            "basisDate": event_date,
        })
        for source_index, source in enumerate((event.get("evidenceSources") or [])[:4], start=1):
            if not isinstance(source, dict):
                continue
            source_type = _clean(source.get("type"), "event_evidence")
            documents.append({
                "id": f"event-{index}-evidence-{source_index}",
                "type": source_type,
                "title": _clean(source.get("title"), f"{event_title} 근거"),
                "text": _compact({
                    "eventTitle": event_title,
                    "description": source.get("description"),
                    "url": source.get("url"),
                }),
                "basisDate": event_date,
            })
        for score_index, score in enumerate((event.get("causalScores") or [])[:4], start=1):
            if not isinstance(score, dict):
                continue
            source_type = _clean(score.get("sourceType"), "causal_score")
            documents.append({
                "id": f"event-{index}-causal-{score_index}",
                "type": f"causal_{source_type}",
                "title": _clean(score.get("label"), f"{event_title} 원인 후보"),
                "text": _compact({
                    "eventTitle": event_title,
                    "score": score.get("score"),
                    "confidence": score.get("confidence"),
                    "basis": score.get("basis"),
                    "interpretation": score.get("interpretation"),
                    "signalSummary": score.get("signalSummary"),
                    "causalFactors": score.get("causalFactors"),
                    "causalDirection": score.get("causalDirection"),
                    "evidenceLevel": score.get("evidenceLevel"),
                    "signalOrigins": score.get("signalOrigins"),
                    "signalUrls": score.get("signalUrls"),
                }),
                "basisDate": event_date,
            })

    for index, headline in enumerate((req.newsHeadlines or [])[:8], start=1):
        if not isinstance(headline, dict):
            continue
        title = _clean(headline.get("title") or headline.get("summary"), "뉴스 헤드라인")
        documents.append({
            "id": f"news-headline-{index}",
            "type": _clean(headline.get("sourceType"), "news"),
            "title": title,
            "text": _compact({
                "title": title,
                "summary": headline.get("summary"),
                "sentiment": headline.get("sentiment"),
                "matchedKeywords": headline.get("matchedKeywords"),
                "causalFactors": headline.get("causalFactors"),
                "evidenceLevel": headline.get("evidenceLevel"),
                "url": headline.get("url"),
            }),
            "basisDate": basis_date,
        })

    for index, term in enumerate((req.terms or [])[:6], start=1):
        documents.append({
            "id": f"term-{index}",
            "type": "learning_term",
            "title": _clean(term.get("term") or term.get("id"), "용어"),
            "text": _compact(term),
            "basisDate": basis_date,
        })

    return documents


def _count_documents_by_type(documents: list[dict[str, str]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for doc in documents:
        doc_type = _clean(doc.get("type"), "unknown")
        counts[doc_type] = counts.get(doc_type, 0) + 1
    return counts


def _build_grounding_report(
    req: ChatRequest,
    documents: list[dict[str, str]],
    basis_date: str,
    used_llm: bool,
    llm_meta: dict[str, Any],
) -> dict[str, Any]:
    ids = {doc["id"] for doc in documents}
    supported_claims: list[dict[str, Any]] = []

    def add_claim(claim: str, candidates: list[str]) -> None:
        matched = [doc_id for doc_id in candidates if doc_id in ids]
        if matched:
            supported_claims.append({"claim": claim, "documentIds": matched})

    add_claim("검색 결과 요약을 근거로 사용", ["search-result"])
    add_claim("저장 브리프 요약을 근거로 사용", ["daily-summary"])
    add_claim("차트 최근값을 근거로 사용", ["chart-snapshot"])
    add_claim("이동평균선 지표를 근거로 사용", ["indicator-snapshot"])
    add_claim("조건형 매수/매도 검토 구간을 근거로 사용", ["trade-zones", "current-decision-summary"])
    add_claim("포트폴리오 샌드박스 가상 비중을 근거로 사용", ["portfolio-context"])
    event_ids = sorted(doc_id for doc_id in ids if doc_id.startswith("event-") and "-evidence-" not in doc_id and "-causal-" not in doc_id)
    evidence_ids = sorted(doc_id for doc_id in ids if "-evidence-" in doc_id)
    causal_ids = sorted(doc_id for doc_id in ids if "-causal-" in doc_id)
    news_ids = sorted(doc_id for doc_id in ids if doc_id.startswith("news-headline-"))
    term_ids = sorted(doc_id for doc_id in ids if doc_id.startswith("term-"))
    add_claim("차트 이벤트를 근거로 사용", event_ids[:6])
    add_claim("뉴스/공시/DART/토론 evidence 후보를 근거로 사용", evidence_ids[:8])
    add_claim("출처별 원인 점수와 텍스트 신호를 근거로 사용", causal_ids[:8])
    add_claim("국내 뉴스 헤드라인을 근거로 사용", news_ids[:8])
    add_claim("초보자 용어 사전을 근거로 사용", term_ids[:6])

    missing: list[str] = []
    if not documents:
        missing.append("근거 문서가 없어 답변 근거가 제한적입니다.")
    if req.stockCode and "chart-snapshot" not in ids:
        missing.append("차트 최근값이 요청에 포함되지 않았습니다.")
    if req.stockCode and "indicator-snapshot" not in ids:
        missing.append("이동평균선 지표가 요청에 포함되지 않았습니다.")
    if req.stockCode and "trade-zones" not in ids:
        missing.append("조건형 매수/매도 검토 구간이 요청에 포함되지 않았습니다.")
    if req.stockCode and not event_ids:
        missing.append("차트 이벤트 후보가 요청에 포함되지 않았습니다.")
    if req.events and not evidence_ids and not causal_ids:
        missing.append("이벤트 원인 후보의 뉴스/공시/DART evidence가 요청에 포함되지 않았습니다.")
    if req.stockCode and not news_ids:
        missing.append("국내 뉴스 헤드라인 후보가 요청에 포함되지 않았습니다.")
    if not used_llm:
        reason = _clean(llm_meta.get("fallbackReason"), "LLM 설정 또는 호출 실패")
        missing.append(f"실시간 LLM 생성 미사용: {reason}")

    return {
        "policy": "provided_evidence_only_with_explicit_limitations",
        "basisDate": basis_date,
        "sourceCoverage": _count_documents_by_type(documents),
        "supportedClaims": supported_claims,
        "missingEvidence": missing,
        "confidence": "medium" if supported_claims else "low",
        "llmUsed": used_llm,
    }


def _build_llm_prompt(req: ChatRequest, subject: str, code: str, topic_type: str, basis_date: str, documents: list[dict[str, str]]) -> list[dict[str, str]]:
    context = "\n".join(
        f"[{doc['id']}] {doc['type']} | {doc['title']} | 기준일 {doc['basisDate']}\n{doc['text']}"
        for doc in documents
    )
    system = (
        "너는 한국 주식 초보자를 위한 AI 리서치 보조자다. "
        "반드시 제공된 검색/브리프/차트/이벤트/뉴스/용어 근거 안에서만 답하고, "
        "매수 또는 매도를 지시하지 말고 조건/검토/시나리오 표현만 사용한다. "
        "출처가 부족하면 부족하다고 말한다. "
        "근거 문장에는 반드시 최소 2개의 근거 문서 id를 대괄호 형식으로 함께 언급한다. "
        "답변 구조는 한 줄 결론, 이동평균선 해석, 매수 검토 조건, 관망 조건, 매도 검토 조건, 리스크 관리, "
        "좋게 볼 이유와 주의할 이유, 반대 신호, 초보자 체크리스트, 포트폴리오 맥락, 다음 확인 순서로 작성한다."
    )
    user = (
        f"질문: {_clean(req.question, '시장과 차트 해석')}\n"
        f"대상: {subject}{f'({code})' if code else ''}\n"
        f"분석 범위: {topic_type}\n"
        f"기준일: {basis_date}\n\n"
        f"검색된 근거:\n{context or '제공된 근거가 없습니다.'}"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _moving_average_explanation(indicator: dict[str, Any] | None) -> str:
    if not indicator:
        return "이동평균선 근거가 부족합니다. 5일선은 단기, 20일선은 약 한 달, 60일선은 중기 흐름을 보는 기준입니다."
    moving = indicator.get("movingAverages") or {}
    price_vs = indicator.get("priceVsMa20") or {}
    position = _label(price_vs.get("position"))
    return (
        f"5일선은 단기 흐름({ _clean(moving.get('ma5')) }), "
        f"20일선은 약 한 달 평균 흐름({ _clean(moving.get('ma20')) }), "
        f"60일선은 중기 흐름({ _clean(moving.get('ma60')) })입니다. "
        f"현재가는 {position}이고 "
        f"거리는 { _clean(price_vs.get('distanceRate'), '-') }%입니다. "
        "이동평균선 위라고 무조건 좋거나 아래라고 무조건 나쁜 것은 아니며 거래량, 지지선, 저항선, 이벤트를 함께 봐야 합니다."
    )


def _decision_field(decision: dict[str, Any] | None, key: str, fallback: str) -> str:
    if isinstance(decision, dict):
        value = decision.get(key)
        if value:
            return str(value)
    return fallback


def _trade_zones(req: ChatRequest) -> list[dict[str, Any]]:
    if not isinstance(req.tradeZones, dict):
        return []
    zones = req.tradeZones.get("zones") or []
    return [zone for zone in zones if isinstance(zone, dict)]


def _zone_by_type(zones: list[dict[str, Any]], *types: str) -> dict[str, Any]:
    wanted = set(types)
    for zone in zones:
        if zone.get("type") in wanted:
            return zone
    return {}


def _zone_condition(zone: dict[str, Any], fallback: str) -> str:
    return _clean(zone.get("condition") or zone.get("summary"), fallback)


def _event_factors(events: list[dict[str, Any]], key: str, fallback: str) -> list[str]:
    values: list[str] = []
    for event in events[:5]:
        raw = event.get(key) or []
        if isinstance(raw, str):
            raw = [raw]
        if isinstance(raw, list):
            for item in raw[:3]:
                text = _clean(item, "")
                if text and text not in values:
                    values.append(text)
    return values or [fallback]


def _portfolio_guidance(portfolio: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(portfolio, dict):
        return {
            "saved": False,
            "summary": "포트폴리오 샌드박스 맥락이 없어 개인 비중은 반영하지 않았습니다.",
            "checklist": [
                "이 종목을 샌드박스에 담으면 가상 비중 기준 리스크를 더 구체적으로 볼 수 있습니다.",
                "평균단가, 보유기간, 손실 허용 범위는 아직 별도로 입력해야 합니다.",
            ],
        }
    saved = bool(portfolio.get("saved"))
    weight = portfolio.get("weight")
    weight_text = f"{weight}%" if weight is not None else "확인 필요"
    guidance = portfolio.get("guidance") or []
    if isinstance(guidance, str):
        guidance = [guidance]
    checklist = [str(item) for item in guidance[:3] if str(item).strip()]
    if saved:
        summary = f"포트폴리오 샌드박스에 저장된 가상 비중 {weight_text}을 참고했습니다."
        checklist.append("비중이 높다면 새 매수보다 리스크 관리 가격과 반대 신호를 먼저 확인하세요.")
    else:
        summary = "기업 선택은 저장되지 않았고, 포트폴리오 샌드박스에 담긴 개인 비중도 아직 없습니다."
        checklist.append("저장하려면 포트폴리오 샌드박스에 담고 비중을 입력하세요.")
    return {
        "saved": saved,
        "summary": summary,
        "weight": weight,
        "checklist": checklist[:4],
    }


def _beginner_checklist(zones: list[dict[str, Any]], decision: dict[str, Any] | None) -> list[str]:
    checklist: list[str] = []
    if isinstance(decision, dict):
        why = decision.get("why") or []
        if isinstance(why, list):
            checklist.extend(str(item) for item in why[:4] if str(item).strip())
    for zone in zones[:5]:
        raw = zone.get("beginnerChecklist") or []
        if isinstance(raw, list):
            checklist.extend(str(item) for item in raw[:2] if str(item).strip())
    fallback = [
        "20일선 위/아래 위치를 먼저 확인합니다.",
        "거래량이 20일 평균보다 많은지 봅니다.",
        "지지선과 저항선을 가격 기준으로 적어 둡니다.",
        "호재/악재 뉴스가 실제 가격 반응으로 이어졌는지 확인합니다.",
    ]
    seen: set[str] = set()
    result = []
    for item in checklist + fallback:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result[:8]


def _build_structured_answer(
    req: ChatRequest,
    subject: str,
    code: str,
    basis_date: str,
    confidence: str,
    sources: list[dict[str, str]],
    limitations: list[str],
) -> dict[str, Any]:
    events = req.events or []
    news_headlines = req.newsHeadlines or []
    indicator = req.indicatorSnapshot if isinstance(req.indicatorSnapshot, dict) else None
    decision = req.currentDecisionSummary if isinstance(req.currentDecisionSummary, dict) else None
    portfolio = _portfolio_guidance(req.portfolioContext if isinstance(req.portfolioContext, dict) else None)
    zones = _trade_zones(req)
    buy_zone = _zone_by_type(zones, "buy_review", "buy")
    split_zone = _zone_by_type(zones, "split_buy", "split")
    watch_zone = _zone_by_type(zones, "watch")
    sell_zone = _zone_by_type(zones, "sell_review", "sell")
    risk_zone = _zone_by_type(zones, "risk_management", "risk")
    evidence: list[str] = []

    if req.searchResult:
        evidence.append(f"검색 맥락: {_clean(req.searchResult.get('summary'), '검색 결과 요약 없음')}")

    if req.summary:
        summary_bits = [
            f"최대 상승 {req.summary.get('topGainer')}" if req.summary.get("topGainer") else "",
            f"최대 하락 {req.summary.get('topLoser')}" if req.summary.get("topLoser") else "",
            f"최다 언급 {req.summary.get('mostMentioned')}" if req.summary.get("mostMentioned") else "",
        ]
        evidence.append("브리프: " + ", ".join(bit for bit in summary_bits if bit))

    if req.chart and isinstance(req.chart, dict):
        latest = req.chart.get("latest") or {}
        latest_close = latest.get("close") if isinstance(latest, dict) else None
        evidence.append(
            f"차트: {req.chart.get('interval', 'daily')} {req.chart.get('range', '-')}, "
            f"기준일 {req.chart.get('asOf') or basis_date}, 최근 종가 {_clean(latest_close)}"
        )

    for event in events[:3]:
        evidence.append(
            f"이벤트: {event.get('date', basis_date)} {event.get('title', '이벤트')} "
            f"등락률 {_clean(event.get('priceChangeRate'))}%, 거래량 {_clean(event.get('volumeChangeRate'))}%, "
            f"해석 {_label(event.get('sentimentForPrice'))}"
        )

    for headline in news_headlines[:3]:
        if isinstance(headline, dict):
            evidence.append(
                f"뉴스: {_clean(headline.get('title') or headline.get('summary'), '뉴스 제목 확인 필요')} "
                f"해석 {_label(headline.get('sentiment'))}"
            )

    if indicator:
        evidence.append("지표: " + _clean(indicator.get("beginnerSummary"), "이동평균선 근거가 전달되었습니다."))
    if portfolio:
        evidence.append("포트폴리오: " + portfolio["summary"])

    if not evidence:
        evidence.append("제공된 검색, 브리프, 차트, 이벤트 근거가 제한적입니다.")

    if code and decision:
        conclusion = f"{subject}({code})은(는) {basis_date} 기준 {_clean(decision.get('summary'), '조건부 검토가 필요합니다.')}"
    elif code and events:
        conclusion = f"{subject}({code})은(는) {basis_date} 기준 차트 이벤트가 있어 가격과 거래량을 함께 확인해야 합니다."
    elif code:
        conclusion = f"{subject}({code})은(는) {basis_date} 기준 차트/검색 근거로 조건부 검토가 필요합니다."
    else:
        conclusion = f"{subject}은(는) {basis_date} 기준 검색/브리프 근거로 시장 맥락을 먼저 확인해야 합니다."

    buy_review = _decision_field(
        decision,
        "buyReviewCondition",
        _zone_condition(buy_zone, "가격 회복, 거래량 증가, 주요 지지선 방어가 함께 나올 때만 매수 검토합니다."),
    )
    sell_review = _decision_field(
        decision,
        "sellReviewCondition",
        _zone_condition(sell_zone, "급등 후 거래량 둔화, 긴 윗꼬리, 직전 고점 돌파 실패가 겹치면 매도 검토합니다."),
    )
    watch_review = _decision_field(
        decision,
        "watchCondition",
        _zone_condition(watch_zone, "가격과 거래량 신호가 엇갈리거나 근거 링크가 부족하면 새 데이터가 쌓일 때까지 기다립니다."),
    )
    risk_management = _decision_field(
        decision,
        "riskCondition",
        _zone_condition(risk_zone, "전저점 이탈이나 하락일 거래량 급증 시 손실 허용 기준을 다시 세웁니다."),
    )
    positive_factors = _event_factors(events, "positiveReasons", "가격/거래량 조합상 호재 후보가 있으면 공시와 뉴스 원문으로 확인합니다.")
    negative_factors = _event_factors(events, "negativeReasons", "하락 거래량, 저항선 실패, 출처 부족은 악재 또는 리스크 후보입니다.")
    opposing_signals = _event_factors(events, "oppositeSignals", _decision_field(decision, "oppositeSignal", "거래량 없는 상승, 20일선 재이탈, 출처 부족을 반대 신호로 봅니다."))
    beginner_checklist = _beginner_checklist(zones, decision)
    beginner_explanation = _clean(
        (indicator or {}).get("beginnerExplanation") or (decision or {}).get("beginnerExplanation"),
        "초보자는 5일선, 20일선, 60일선의 역할을 나누어 보고 거래량, 지지선, 저항선, 이벤트를 함께 확인해야 합니다.",
    )

    return {
        "conclusion": conclusion,
        "movingAverageExplanation": _moving_average_explanation(indicator),
        "chartState": {
            "state": _clean((decision or {}).get("state"), "watch"),
            "summary": _clean((decision or {}).get("summary"), conclusion),
            "indicatorSnapshot": indicator or {},
        },
        "buyReview": buy_review,
        "sellReview": sell_review,
        "watchReview": watch_review,
        "riskManagement": risk_management,
        "buyCondition": buy_review,
        "sellCondition": sell_review,
        "waitCondition": watch_review,
        "riskCondition": risk_management,
        "positiveFactors": positive_factors,
        "negativeFactors": negative_factors,
        "positives": positive_factors,
        "negatives": negative_factors,
        "opposingSignals": opposing_signals,
        "beginnerExplanation": beginner_explanation,
        "beginnerChecklist": beginner_checklist,
        "nextChecklist": beginner_checklist,
        "portfolioGuidance": portfolio,
        "tradeZones": zones,
        "evidence": evidence[:5],
        "risks": [
            "포트폴리오 샌드박스 가상 비중 외 평균단가와 투자 기간은 반영하지 않습니다.",
            "차트 이벤트는 원인 후보이며 확정 원인이 아닙니다.",
            "투자 지시가 아니라 교육용 분석 보조입니다.",
        ],
        "sources": sources,
        "confidence": confidence,
        "basisDate": basis_date,
        "limitations": limitations,
    }


def _first_env(*keys: str) -> str:
    for key in keys:
        value = os.getenv(key, "").strip()
        if value:
            return value
    return ""


def _join_api_path(base_url: str, path: str) -> str:
    base = base_url.rstrip("/")
    suffix = path.lstrip("/")
    if base.endswith("/v1") and suffix.startswith("v1/"):
        suffix = suffix[3:]
    return f"{base}/{suffix}"


def _openai_compatible_api_key(base_url: str) -> str:
    if "api.z.ai" in base_url:
        return _first_env("LLM_API_KEY", "ZAI_API_KEY")
    return _first_env("LLM_API_KEY", "ZAI_API_KEY", "OPENAI_API_KEY")


def _call_openai_compatible_llm(messages: list[dict[str, str]]) -> tuple[str | None, dict[str, Any]]:
    model = os.getenv("LLM_MODEL", "").strip()
    base_url = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    api_key = _openai_compatible_api_key(base_url)
    timeout = float(os.getenv("LLM_TIMEOUT_SECONDS", "20"))

    if not api_key or not model:
        return None, {
            "enabled": False,
            "provider": "openai_compatible",
            "model": model or "",
            "fallbackReason": "LLM_API_KEY/OPENAI_API_KEY 또는 LLM_MODEL이 설정되지 않았습니다.",
            "timeoutSeconds": timeout,
        }

    payload = json.dumps({
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": int(os.getenv("LLM_MAX_TOKENS", "650")),
    }).encode("utf-8")
    req = request.Request(
        f"{base_url}/chat/completions",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=timeout) as res:
            data = json.loads(res.read().decode("utf-8"))
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        if not content:
            return None, {
                "enabled": True,
                "provider": "openai_compatible",
                "model": model,
                "fallbackReason": "LLM 응답에 content가 없습니다.",
                "timeoutSeconds": timeout,
            }
        return content, {
            "enabled": True,
            "provider": "openai_compatible",
            "model": model,
            "fallbackReason": "",
            "timeoutSeconds": timeout,
        }
    except (error.URLError, TimeoutError, json.JSONDecodeError, KeyError) as exc:
        return None, {
            "enabled": True,
            "provider": "openai_compatible",
            "model": model,
            "fallbackReason": f"LLM 호출 실패: {type(exc).__name__}",
            "timeoutSeconds": timeout,
        }


def _anthropic_messages(messages: list[dict[str, str]]) -> tuple[str, list[dict[str, str]]]:
    system_parts: list[str] = []
    chat_messages: list[dict[str, str]] = []
    for message in messages:
        role = _clean(message.get("role"), "user")
        content = _clean(message.get("content"), "")
        if role == "system":
            system_parts.append(content)
            continue
        chat_messages.append({
            "role": "assistant" if role == "assistant" else "user",
            "content": content,
        })
    if not chat_messages:
        chat_messages.append({"role": "user", "content": "제공된 근거를 바탕으로 한국 주식 분석을 요약해줘."})
    return "\n\n".join(system_parts), chat_messages


def _extract_anthropic_text(data: dict[str, Any]) -> str:
    content = data.get("content")
    if isinstance(content, str):
        return content.strip()
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text":
            text = _clean(block.get("text"), "")
            if text:
                parts.append(text)
    return "\n".join(parts).strip()


def _call_anthropic_compatible_llm(messages: list[dict[str, str]]) -> tuple[str | None, dict[str, Any]]:
    api_key = _first_env("ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY")
    model = _first_env(
        "ANTHROPIC_MODEL",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    )
    base_url = os.getenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com").rstrip("/")
    version = os.getenv("ANTHROPIC_VERSION", "2023-06-01").strip()
    timeout = float(os.getenv("LLM_TIMEOUT_SECONDS", os.getenv("ANTHROPIC_TIMEOUT_SECONDS", "20")))

    if not api_key or not model:
        return None, {
            "enabled": False,
            "provider": "anthropic_compatible",
            "model": model or "",
            "fallbackReason": "ANTHROPIC_AUTH_TOKEN/ANTHROPIC_API_KEY 또는 ANTHROPIC_MODEL이 설정되지 않았습니다.",
            "timeoutSeconds": timeout,
        }

    system, chat_messages = _anthropic_messages(messages)
    payload_data: dict[str, Any] = {
        "model": model,
        "messages": chat_messages,
        "temperature": 0.2,
        "max_tokens": int(os.getenv("LLM_MAX_TOKENS", "650")),
    }
    if system:
        payload_data["system"] = system

    payload = json.dumps(payload_data).encode("utf-8")
    req = request.Request(
        _join_api_path(base_url, "/v1/messages"),
        data=payload,
        headers={
            "x-api-key": api_key,
            "anthropic-version": version,
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=timeout) as res:
            data = json.loads(res.read().decode("utf-8"))
        content = _extract_anthropic_text(data)
        if not content:
            return None, {
                "enabled": True,
                "provider": "anthropic_compatible",
                "model": model,
                "fallbackReason": "LLM 응답에 text content가 없습니다.",
                "timeoutSeconds": timeout,
            }
        return content, {
            "enabled": True,
            "provider": "anthropic_compatible",
            "model": model,
            "fallbackReason": "",
            "timeoutSeconds": timeout,
        }
    except (error.URLError, TimeoutError, json.JSONDecodeError, KeyError) as exc:
        return None, {
            "enabled": True,
            "provider": "anthropic_compatible",
            "model": model,
            "fallbackReason": f"LLM 호출 실패: {type(exc).__name__}",
            "timeoutSeconds": timeout,
        }


def _ollama_model() -> str:
    preferred = os.getenv("LLM_PROVIDER", "").strip().lower()
    model = os.getenv("OLLAMA_MODEL", "").strip()
    if model:
        return model
    if preferred == "ollama":
        return os.getenv("LLM_MODEL", "").strip()
    return ""


def _call_ollama_llm(messages: list[dict[str, str]], *, json_mode: bool = False) -> tuple[str | None, dict[str, Any]]:
    model = _ollama_model()
    base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
    timeout = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", os.getenv("LLM_TIMEOUT_SECONDS", "20")))

    if not model:
        return None, {
            "enabled": False,
            "provider": "ollama",
            "model": "",
            "baseUrl": base_url,
            "fallbackReason": "OLLAMA_MODEL이 설정되지 않았습니다.",
            "timeoutSeconds": timeout,
        }

    payload_data = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {
            "temperature": 0.2,
            "num_predict": int(os.getenv("OLLAMA_NUM_PREDICT", os.getenv("LLM_MAX_TOKENS", "650"))),
        },
    }
    if json_mode:
        payload_data["format"] = "json"
    payload = json.dumps(payload_data).encode("utf-8")
    req = request.Request(
        _join_api_path(base_url, "/api/chat"),
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=timeout) as res:
            data = json.loads(res.read().decode("utf-8"))
        content = _clean((data.get("message") or {}).get("content") or data.get("response"), "")
        if not content:
            return None, {
                "enabled": True,
                "provider": "ollama",
                "model": model,
                "baseUrl": base_url,
                "fallbackReason": "Ollama 응답에 content가 없습니다.",
                "timeoutSeconds": timeout,
            }
        return content, {
            "enabled": True,
            "provider": "ollama",
            "model": model,
            "baseUrl": base_url,
            "fallbackReason": "",
            "timeoutSeconds": timeout,
        }
    except (error.URLError, TimeoutError, json.JSONDecodeError, KeyError) as exc:
        return None, {
            "enabled": True,
            "provider": "ollama",
            "model": model,
            "baseUrl": base_url,
            "fallbackReason": f"Ollama 호출 실패: {type(exc).__name__}",
            "timeoutSeconds": timeout,
        }


def _llm_status() -> dict[str, Any]:
    openai_model = os.getenv("LLM_MODEL", "").strip()
    openai_base_url = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    openai_key_set = bool(_openai_compatible_api_key(openai_base_url))
    llm_timeout = float(os.getenv("LLM_TIMEOUT_SECONDS", "20"))
    anthropic_key_set = bool(_first_env("ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"))
    anthropic_model = _first_env(
        "ANTHROPIC_MODEL",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    )
    anthropic_base_url = os.getenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com").rstrip("/")
    ollama_model = _ollama_model()
    ollama_base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
    ollama_timeout = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", os.getenv("LLM_TIMEOUT_SECONDS", "20")))
    preferred = os.getenv("LLM_PROVIDER", "").strip().lower()

    openai_configured = openai_key_set and bool(openai_model)
    anthropic_configured = anthropic_key_set and bool(anthropic_model)
    ollama_configured = bool(ollama_model)
    if preferred == "ollama":
        provider = "ollama"
    elif preferred in {"anthropic", "anthropic_compatible"} and anthropic_configured:
        provider = "anthropic_compatible"
    elif preferred in {"openai", "openai_compatible"} and openai_configured:
        provider = "openai_compatible"
    elif preferred in {"", "auto", "local_first"} and ollama_configured:
        provider = "ollama"
    elif openai_configured:
        provider = "openai_compatible"
    elif anthropic_configured:
        provider = "anthropic_compatible"
    elif preferred in {"anthropic", "anthropic_compatible"}:
        provider = "anthropic_compatible"
    else:
        provider = "openai_compatible"

    if provider == "ollama":
        api_key_set = False
        model = ollama_model
        base_url = ollama_base_url
        configured = ollama_configured
    elif provider == "anthropic_compatible":
        api_key_set = anthropic_key_set
        model = anthropic_model
        base_url = anthropic_base_url
        configured = api_key_set and bool(model)
    else:
        api_key_set = openai_key_set
        model = openai_model
        base_url = openai_base_url
        configured = api_key_set and bool(model)

    return {
        "provider": provider,
        "configured": configured,
        "apiKeySet": api_key_set,
        "modelConfigured": bool(model),
        "model": model,
        "baseUrl": base_url,
        "availableProviders": {
            "openaiCompatible": {
                "apiKeySet": openai_key_set,
                "modelConfigured": bool(openai_model),
                "configured": openai_configured,
            },
            "anthropicCompatible": {
                "apiKeySet": anthropic_key_set,
                "modelConfigured": bool(anthropic_model),
                "configured": anthropic_configured,
            },
            "ollama": {
                "apiKeySet": False,
                "modelConfigured": bool(ollama_model),
                "configured": ollama_configured,
                "baseUrl": ollama_base_url,
                "timeoutSeconds": ollama_timeout,
            },
        },
        "fallbackMode": "rag_fallback_rule_based",
        "timeoutSeconds": ollama_timeout if provider == "ollama" else llm_timeout,
        "maxTokens": int(os.getenv("LLM_MAX_TOKENS", "650")),
    }


def _call_configured_llm(messages: list[dict[str, str]]) -> tuple[str | None, dict[str, Any]]:
    status = _llm_status()
    if status["provider"] == "ollama":
        return _call_ollama_llm(messages, json_mode=False)
    if status["provider"] == "anthropic_compatible":
        return _call_anthropic_compatible_llm(messages)
    return _call_openai_compatible_llm(messages)


def _json_object_from_text(text: str) -> dict[str, Any] | None:
    raw = _clean(text, "")
    if not raw:
        return None
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            data = json.loads(raw[start:end + 1])
            return data if isinstance(data, dict) else None
        except json.JSONDecodeError:
            return None


def _number(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
        return number if number == number else fallback
    except (TypeError, ValueError):
        return fallback


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _event_sentiment_score(events: list[dict[str, Any]]) -> int:
    score = 0.0
    for event in events[:8]:
        sentiment = _clean(event.get("sentimentForPrice") or event.get("sentiment") or event.get("type"), "").lower()
        if sentiment == "positive":
            score += 18
        elif sentiment == "negative":
            score -= 18
        elif sentiment == "mixed":
            score += 2
        price_change = _number(event.get("priceChangeRate"), 0)
        volume_change = _number(event.get("volumeChangeRate"), 0)
        if price_change:
            score += _clamp(price_change * 1.4, -12, 12)
        if volume_change > 50 and price_change < 0:
            score -= 6
        elif volume_change > 50 and price_change > 0:
            score += 6
        for causal in (event.get("causalScores") or [])[:3]:
            if isinstance(causal, dict):
                score += _clamp(_number(causal.get("score"), 0) * 0.18, -8, 8)
    return round(_clamp(score, -100, 100))


def _headline_sentiment_score(headlines: list[dict[str, Any]]) -> int:
    score = 0.0
    for headline in headlines[:8]:
        if not isinstance(headline, dict):
            continue
        sentiment = _clean(headline.get("sentiment"), "").lower()
        if sentiment == "positive":
            score += 10
        elif sentiment == "negative":
            score -= 10
        elif sentiment == "mixed":
            score += 1
        factors = headline.get("causalFactors") or headline.get("matchedKeywords") or []
        if isinstance(factors, str):
            factors = [factors]
        factor_text = " ".join(str(item) for item in factors[:8]).lower()
        if any(word in factor_text for word in ["실적", "수주", "개선", "증가", "호재", "성장", "흑자"]):
            score += 3
        if any(word in factor_text for word in ["적자", "감소", "우려", "리스크", "소송", "규제", "악재"]):
            score -= 3
    return round(_clamp(score, -60, 60))


def _news_evidence_profile(headlines: list[dict[str, Any]]) -> dict[str, Any]:
    positive = 0
    negative = 0
    mixed = 0
    factor_count = 0
    title_count = 0
    for headline in headlines[:8]:
        if not isinstance(headline, dict):
            continue
        if _clean(headline.get("title") or headline.get("summary"), ""):
            title_count += 1
        sentiment = _clean(headline.get("sentiment"), "").lower()
        if sentiment == "positive":
            positive += 1
        elif sentiment == "negative":
            negative += 1
        elif sentiment == "mixed":
            mixed += 1
        factors = headline.get("causalFactors") or headline.get("matchedKeywords") or []
        if isinstance(factors, str):
            factors = [factors]
        factor_count += len([item for item in factors if _clean(item, "")])

    if title_count >= 5 and factor_count >= 4:
        quality = "보통"
    elif title_count >= 3:
        quality = "제한적"
    else:
        quality = "낮음"

    cautions: list[str] = []
    if title_count < 3:
        cautions.append("뉴스 후보가 적어 가격·거래량 확인 비중을 높였습니다.")
    if mixed >= max(2, positive + negative):
        cautions.append("복합 해석 뉴스가 많아 상승·하락 확률을 보수적으로 계산했습니다.")
    if factor_count < 3:
        cautions.append("뉴스 제목의 원인 키워드가 부족해 원문 확인이 필요합니다.")

    return {
        "headlineCount": title_count,
        "positiveCount": positive,
        "negativeCount": negative,
        "mixedCount": mixed,
        "factorCount": factor_count,
        "quality": quality,
        "cautions": cautions or ["뉴스 제목만으로 확정하지 말고 다음 거래일 거래량 반응을 확인해야 합니다."],
    }


def _calibrated_sentiment_score(events: list[dict[str, Any]], headlines: list[dict[str, Any]], profile: dict[str, Any]) -> int:
    event_score = _event_sentiment_score(events)
    headline_score = _headline_sentiment_score(headlines)
    score = event_score * 0.55 + headline_score * 0.75
    if profile.get("headlineCount", 0) < 3:
        score *= 0.72
    if profile.get("mixedCount", 0) >= max(2, profile.get("positiveCount", 0) + profile.get("negativeCount", 0)):
        score *= 0.78
    if profile.get("factorCount", 0) < 3:
        score *= 0.82
    return round(_clamp(score, -70, 70))


def _probabilities_from_score(score: int) -> dict[str, int]:
    direction = _clamp(score, -70, 70)
    flat = round(_clamp(18 - abs(direction) * 0.1, 10, 22))
    directional_pool = 100 - flat
    up = _clamp(directional_pool * (0.5 + direction / 320), 18, 65)
    down = _clamp(directional_pool - up, 18, 65)
    total = up + down + flat
    up_value = round(up / total * 100)
    down_value = round(down / total * 100)
    return {
        "up": up_value,
        "down": down_value,
        "flat": max(0, 100 - up_value - down_value),
    }


def _price_text(value: Any) -> str:
    number = _number(value, None)
    if number is None:
        return "확인 필요"
    return f"{round(number):,}원"


def _percent_text(value: Any) -> str:
    number = _number(value, None)
    if number is None:
        return "확인 필요"
    return f"{number:+.1f}%"


def _latest_chart_row(req: ChatRequest) -> dict[str, Any]:
    chart = req.chart if isinstance(req.chart, dict) else {}
    latest = chart.get("latest") if isinstance(chart.get("latest"), dict) else {}
    rows = chart.get("recentRows") if isinstance(chart.get("recentRows"), list) else []
    if latest:
        return latest
    return rows[-1] if rows and isinstance(rows[-1], dict) else {}


def _ma20_context(req: ChatRequest) -> dict[str, str]:
    latest = _latest_chart_row(req)
    indicator = req.indicatorSnapshot if isinstance(req.indicatorSnapshot, dict) else {}
    moving = indicator.get("movingAverages") if isinstance(indicator.get("movingAverages"), dict) else {}
    price_vs = indicator.get("priceVsMa20") if isinstance(indicator.get("priceVsMa20"), dict) else {}
    close = latest.get("close")
    ma20 = moving.get("ma20") or latest.get("ma20")
    position = _clean(price_vs.get("position"), "")
    distance = price_vs.get("distanceRate")
    if not position and _number(close, None) is not None and _number(ma20, None) is not None:
        position = "above" if _number(close, 0) >= _number(ma20, 0) else "below"
    return {
        "close": _price_text(close),
        "ma20": _price_text(ma20),
        "position": position,
        "positionLabel": _label(position),
        "distance": _percent_text(distance),
    }


def _decision_from_inputs(score: int, position: str) -> str:
    if score >= 24 and position in {"above", "near"}:
        return "매수 검토"
    if score <= -24 and position == "below":
        return "매도 검토"
    if position == "below" and score < 10:
        return "관망"
    if score <= -35:
        return "매도 검토"
    return "관망"


def _decision_reason(decision: str, score: int, ma20: dict[str, str]) -> str:
    if decision == "매수 검토":
        return (
            f"현재가는 {ma20['ma20']} 기준 {ma20['positionLabel']}이고 뉴스/이벤트 점수는 {score}점입니다. "
            "추격 매수보다 20일선 위 종가 유지, 거래량 증가, 저항선 돌파가 같이 확인될 때만 매수 검토가 맞습니다."
        )
    if decision == "매도 검토":
        return (
            f"현재가는 {ma20['ma20']} 기준 {ma20['positionLabel']}이고 뉴스/이벤트 점수는 {score}점입니다. "
            "20일선 재이탈, 악재성 이벤트, 하락 거래량 증가가 겹치면 비중 축소나 손절 기준을 먼저 확인해야 합니다."
        )
    return (
        f"현재가는 {ma20['ma20']} 기준 {ma20['positionLabel']}이고 뉴스/이벤트 점수는 {score}점입니다. "
        "좋은 신호와 주의 신호가 섞여 있으므로 새 진입보다 다음 종가와 거래량 확인이 우선입니다."
    )


def _after_market_comment(subject: str, decision: str, score: int, probabilities: dict[str, int], summary_points: list[str]) -> str:
    subject_label = f"{subject} 종목"
    market_line = summary_points[0] if summary_points else "저장 브리프의 시장 대표 신호가 제한적입니다."
    if decision == "매수 검토":
        return (
            f"{subject_label}은 장후 기준 관심 후보로 올려둘 수 있습니다. {market_line} "
            f"다음 거래일 상승 확률은 {probabilities['up']}%로 계산되지만, 시초가 급등 추격보다 눌림과 거래량 유지 확인이 필요합니다."
        )
    if decision == "매도 검토":
        return (
            f"{subject_label}은 장후 기준 방어적으로 봐야 합니다. {market_line} "
            f"다음 거래일 하락 확률은 {probabilities['down']}%로 계산되며, 지지선 이탈과 악재성 뉴스 확산 여부를 먼저 확인해야 합니다."
        )
    return (
        f"{subject_label}은 장후 기준 관망 후보입니다. {market_line} "
        f"상승 {probabilities['up']}%, 하락 {probabilities['down']}%로 한쪽 우위가 강하지 않아 가격 반응 확인 전 결론을 미루는 편이 낫습니다."
    )


def _headlines_from_context(events: list[dict[str, Any]], news_headlines: list[dict[str, Any]]) -> list[str]:
    headlines: list[str] = []
    for headline in news_headlines[:8]:
        if not isinstance(headline, dict):
            continue
        title = _clean(headline.get("title") or headline.get("summary"), "")
        sentiment = _label(headline.get("sentiment"))
        if title:
            line = f"{title} ({sentiment})"
            if line not in headlines:
                headlines.append(line)
    for event in events[:6]:
        title = _clean(event.get("title"), "")
        if title and title not in headlines:
            headlines.append(title)
        for source in (event.get("evidenceSources") or [])[:2]:
            if isinstance(source, dict):
                source_title = _clean(source.get("title") or source.get("description"), "")
                if source_title and source_title not in headlines:
                    headlines.append(source_title)
    return headlines[:6]


def _headline_factor_text(headline: dict[str, Any]) -> str:
    factors = headline.get("causalFactors") or headline.get("matchedKeywords") or []
    if isinstance(factors, str):
        factors = [factors]
    cleaned = [_clean(item, "") for item in factors if _clean(item, "")]
    return ", ".join(cleaned[:3]) if cleaned else "근거 키워드 확인 필요"


def _headline_reason_lists(headlines: list[dict[str, Any]]) -> tuple[list[str], list[str]]:
    up_reasons: list[str] = []
    down_risks: list[str] = []
    for headline in headlines[:8]:
        if not isinstance(headline, dict):
            continue
        title = _clean(headline.get("title") or headline.get("summary"), "")
        if not title:
            continue
        factor_text = _headline_factor_text(headline)
        sentiment = _clean(headline.get("sentiment"), "").lower()
        line = f"{title} · 근거: {factor_text}"
        if sentiment == "positive" and len(up_reasons) < 3:
            up_reasons.append(line)
        elif sentiment == "negative" and len(down_risks) < 3:
            down_risks.append(line)
        elif sentiment == "mixed":
            if len(up_reasons) < 3:
                up_reasons.append(f"{title} · 좋게 볼 부분과 확인할 부분이 함께 있음")
            if len(down_risks) < 3:
                down_risks.append(f"{title} · 단정 금지: {factor_text}")
    return up_reasons[:3], down_risks[:3]


def _summary_points(summary: dict[str, Any] | None) -> list[str]:
    if not isinstance(summary, dict):
        return ["저장된 장후 브리프가 부족해 종목 차트와 이벤트 중심으로 요약합니다."]
    points: list[str] = []
    ai_report = summary.get("afterMarketAiReport") if isinstance(summary.get("afterMarketAiReport"), dict) else {}
    report_points = ai_report.get("keyPoints") if isinstance(ai_report, dict) else []
    if isinstance(report_points, list):
        points.extend(_clean(point, "") for point in report_points[:4] if _clean(point, ""))
    if summary.get("topGainer"):
        points.append(f"시장 최대 상승 후보는 {summary.get('topGainer')}입니다.")
    if summary.get("topLoser"):
        points.append(f"시장 최대 하락 후보는 {summary.get('topLoser')}입니다.")
    if summary.get("mostMentioned"):
        points.append(f"토론/언급 관심은 {summary.get('mostMentioned')}에 집중되었습니다.")
    if summary.get("effectiveDate"):
        points.append(f"브리프 기준 거래일은 {summary.get('effectiveDate')}입니다.")
    return list(dict.fromkeys(points)) or ["저장 브리프의 핵심 지표가 제한적입니다."]


def _fallback_ollama_insights(
    req: ChatRequest,
    subject: str,
    code: str,
    basis_date: str,
    documents: list[dict[str, str]],
    llm_meta: dict[str, Any],
) -> dict[str, Any]:
    events = req.events or []
    news_headlines = req.newsHeadlines or []
    news_profile = _news_evidence_profile(news_headlines)
    score = _calibrated_sentiment_score(events, news_headlines, news_profile)
    probabilities = _probabilities_from_score(score)
    ma20 = _ma20_context(req)
    position = ma20["position"]
    decision = _decision_from_inputs(score, position)
    decision_summary = req.currentDecisionSummary if isinstance(req.currentDecisionSummary, dict) else {}
    headlines = _headlines_from_context(events, news_headlines)
    up_reasons, down_risks = _headline_reason_lists(news_headlines)
    portfolio = _portfolio_guidance(req.portfolioContext if isinstance(req.portfolioContext, dict) else None)
    summary_points = _summary_points(req.summary)
    fallback_reason = _clean(llm_meta.get("fallbackReason"), "")
    decision_reason = _decision_reason(decision, score, ma20)
    report_comment = _after_market_comment(subject, decision, score, probabilities, summary_points)

    return {
        "mode": "ollama_fallback_rule_based",
        "provider": "ollama",
        "model": _clean(llm_meta.get("model"), ""),
        "basisDate": basis_date,
        "answer": (
            f"{subject}{f'({code})' if code else ''}은(는) 현재 {decision} 의견입니다. "
            f"{ma20['positionLabel']} 상태이고 뉴스/이벤트 점수는 {score}점입니다. 다음 거래일 확률은 상승 {probabilities['up']}%, "
            f"하락 {probabilities['down']}%, 횡보 {probabilities['flat']}%입니다. "
            "이 응답은 제공된 차트, 뉴스, 이벤트 근거를 바탕으로 한 조건형 참고입니다."
        ),
        "stockAdvice": {
            "title": "이 종목 지금 사도 되나요?",
            "decision": decision,
            "summary": _clean(
                decision_summary.get("summary") if isinstance(decision_summary, dict) else "",
                decision_reason,
            ),
            "buyConditions": [
                _clean(decision_summary.get("buyReviewCondition") if isinstance(decision_summary, dict) else "", f"현재가 {ma20['close']}가 20일선 {ma20['ma20']} 위에서 마감하고 거래량이 늘어야 합니다."),
                "호재 후보가 가격 반응과 거래량으로 확인될 때만 검토합니다.",
                "저항선 근처라면 돌파 후 눌림 확인 전까지 한 번에 크게 들어가지 않습니다.",
            ],
            "watchConditions": [
                _clean(decision_summary.get("watchCondition") if isinstance(decision_summary, dict) else "", "근거가 엇갈리면 다음 종가와 거래량을 기다립니다."),
                f"다음 거래일 확률이 상승 {probabilities['up']}%, 하락 {probabilities['down']}%로 갈리면 관망이 우선입니다.",
            ],
            "sellConditions": [
                _clean(decision_summary.get("sellReviewCondition") if isinstance(decision_summary, dict) else "", "20일선 재이탈, 하락 거래량 증가, 저항선 실패가 겹치면 매도 검토입니다."),
                "악재 후보가 늘고 반등 거래량이 약하면 손실 확대를 막는 기준을 먼저 세웁니다.",
            ],
            "riskNotes": [
                portfolio["summary"],
                "평균단가와 실제 보유 수량은 아직 입력되지 않았으므로 투자 지시로 쓰면 안 됩니다.",
            ],
        },
        "newsSentiment": {
            "title": "뉴스 감성 기반 단기 방향 예측",
            "score": score,
            "label": "긍정 우위" if score > 20 else "부정 우위" if score < -20 else "중립",
            "confidence": news_profile["quality"],
            "evidenceQuality": (
                f"뉴스 {news_profile['headlineCount']}건, 긍정 {news_profile['positiveCount']}건, "
                f"부정 {news_profile['negativeCount']}건, 복합 {news_profile['mixedCount']}건 기준"
            ),
            "nextTradingDay": probabilities,
            "summary": (
                f"최근 이벤트와 뉴스 후보를 보수적으로 보정하면 {score}점입니다. "
                f"상승 {probabilities['up']}%, 하락 {probabilities['down']}%, 횡보 {probabilities['flat']}%로 보고, "
                f"근거 품질은 {news_profile['quality']}입니다. 뉴스 원문과 장중 거래량으로 다시 검증해야 합니다."
            ),
            "headlineSignals": headlines or ["뉴스/공시 원문 후보가 부족합니다."],
            "upReasons": up_reasons or ["상승 쪽 근거는 차트와 거래량 반응으로 추가 확인이 필요합니다."],
            "downRisks": down_risks or ["하락 쪽 반대 근거가 부족해도 지지선 이탈 여부는 확인해야 합니다."],
            "caution": news_profile["cautions"][0],
        },
        "afterMarketReport": {
            "title": "매일 장후 시장 요약 리포트",
            "mood": "위험 관리 우선" if score < -20 else "선별 접근" if score < 25 else "관심 확대",
            "keyPoints": summary_points,
            "llmComment": report_comment,
            "nextWatch": [
                f"다음 거래일 현재가가 20일선 {ma20['ma20']}을 지키는지 확인",
                "호재/악재 후보의 뉴스 원문과 공시 확인",
                "거래량이 평균 대비 유지되는지 확인",
            ],
        },
        "beginnerNotes": [
            "매수/관망/매도는 지시가 아니라 조건형 의견입니다.",
            "확률은 예측 보조이며 실제 수익을 보장하지 않습니다.",
            "뉴스 제목만으로 판단하지 말고 가격과 거래량 반응을 같이 봅니다.",
        ],
        "limitations": [
            *([fallback_reason] if fallback_reason else []),
            "국내 뉴스 헤드라인은 이벤트 evidence 후보를 사용하며, 원문 수집 품질에 따라 정확도가 달라집니다.",
            "재무 데이터는 현재 검색/브리프/학습 용어 수준의 제한된 맥락만 반영합니다.",
        ],
        "retrieval": {
            "documents": documents,
            "sourceCount": len(documents),
            "llm": {**llm_meta, "used": False},
        },
        "confidence": "medium" if documents else "low",
    }


PLACEHOLDER_TEXTS = (
    "3개 기능을 한 문단으로 요약",
    "조건형 의견을 한 문단으로 요약",
    "차트, 재무/브리프, 뉴스/센티먼트를 합친 조건형 의견",
    "매수 검토|관망|매도 검토",
    "긍정 우위|중립|부정 우위",
    "다음 거래일 방향 예측 설명",
    "뉴스 헤드라인 또는 이벤트 신호",
    "핵심 뉴스 신호",
    "시장 분위기",
    "장후 리포트용 LLM 코멘트",
    "내일 확인할 것",
    "초보자가 이해할 쉬운 설명",
)


def _is_placeholder_text(value: Any) -> bool:
    text = _clean(value, "")
    if not text:
        return True
    return any(marker in text for marker in PLACEHOLDER_TEXTS)


def _merge_text_value(current: Any, generated: Any) -> Any:
    if isinstance(generated, str) and not _is_placeholder_text(generated):
        return _clean(generated, current)
    return current


def _clean_generated_list_item(item: Any) -> str:
    if isinstance(item, dict):
        for key in ("title", "summary", "signal", "reason", "comment", "description", "text"):
            text = _clean(item.get(key), "")
            if text and not _is_placeholder_text(text):
                return text
        return _compact(item, 220)
    return _clean(item, "")


def _merge_list_value(current: Any, generated: Any) -> Any:
    if not isinstance(generated, list):
        return current
    values = [_clean_generated_list_item(item) for item in generated if not _is_placeholder_text(item)]
    return values[:3] if values else current


def _merge_insight_dict(base: dict[str, Any], generated: dict[str, Any] | None) -> dict[str, Any]:
    if not generated:
        return base
    merged = {**base}
    for key in ["stockAdvice", "newsSentiment", "afterMarketReport"]:
        if isinstance(generated.get(key), dict):
            current = merged.get(key) if isinstance(merged.get(key), dict) else {}
            next_value = {**current}
            for field, value in generated[key].items():
                if key == "newsSentiment" and field in {"score", "label", "nextTradingDay"}:
                    continue
                if key == "stockAdvice" and field == "decision" and value not in {"매수 검토", "관망", "매도 검토"}:
                    continue
                if isinstance(value, str):
                    next_value[field] = _merge_text_value(current.get(field), value)
                elif isinstance(value, list):
                    next_value[field] = _merge_list_value(current.get(field), value)
                elif value not in (None, "", []):
                    next_value[field] = value
            merged[key] = next_value
    for key in ["beginnerNotes", "limitations"]:
        if isinstance(generated.get(key), list):
            merged[key] = _merge_list_value(merged.get(key), generated[key])
    if generated.get("answer") and not _is_placeholder_text(generated.get("answer")):
        merged["answer"] = _clean(generated.get("answer"), merged["answer"])
    return merged


def _ollama_prompt_documents(documents: list[dict[str, str]]) -> list[dict[str, str]]:
    selected: list[dict[str, str]] = []
    seen: set[str] = set()

    def add(doc: dict[str, str]) -> None:
        doc_id = _clean(doc.get("id"), "")
        if not doc_id or doc_id in seen:
            return
        selected.append(doc)
        seen.add(doc_id)

    priority_ids = {
        "search-result",
        "daily-summary",
        "chart-snapshot",
        "indicator-snapshot",
        "trade-zones",
        "current-decision-summary",
        "portfolio-context",
    }
    for doc in documents:
        if doc.get("id") in priority_ids:
            add(doc)

    limits = {
        "news-headline-": 5,
        "event-": 3,
        "event-evidence": 3,
        "event-causal": 3,
        "term-": 2,
    }
    counts = {key: 0 for key in limits}
    for doc in documents:
        doc_id = _clean(doc.get("id"), "")
        key = ""
        if doc_id.startswith("news-headline-"):
            key = "news-headline-"
        elif "-evidence-" in doc_id:
            key = "event-evidence"
        elif "-causal-" in doc_id:
            key = "event-causal"
        elif doc_id.startswith("event-"):
            key = "event-"
        elif doc_id.startswith("term-"):
            key = "term-"
        if key and counts[key] < limits[key]:
            add(doc)
            counts[key] += 1

    return selected[:24]


def _compose_ollama_answer(subject: str, code: str, response: dict[str, Any]) -> str:
    advice = response.get("stockAdvice") if isinstance(response.get("stockAdvice"), dict) else {}
    sentiment = response.get("newsSentiment") if isinstance(response.get("newsSentiment"), dict) else {}
    report = response.get("afterMarketReport") if isinstance(response.get("afterMarketReport"), dict) else {}
    probabilities = sentiment.get("nextTradingDay") if isinstance(sentiment.get("nextTradingDay"), dict) else {}
    decision = _clean(advice.get("decision"), "관망")
    summary = _clean(advice.get("summary"), "조건 확인이 필요합니다.")
    score = _clean(sentiment.get("score"), "0")
    up = _clean(probabilities.get("up"), "확인 필요")
    down = _clean(probabilities.get("down"), "확인 필요")
    mood = _clean(report.get("mood"), "선별 접근")
    return (
        f"{subject}{f'({code})' if code else ''}은(는) 현재 {decision} 의견입니다. "
        f"{summary} 뉴스/이벤트 점수는 {score}점이고 다음 거래일 참고 확률은 상승 {up}%, 하락 {down}%입니다. "
        f"장후 분위기는 {mood}이며, 투자 지시가 아니라 조건 확인용 분석입니다."
    )


def _build_ollama_insights_prompt(
    req: ChatRequest,
    subject: str,
    code: str,
    basis_date: str,
    documents: list[dict[str, str]],
) -> list[dict[str, str]]:
    prompt_documents = _ollama_prompt_documents(documents)
    context = "\n".join(
        f"[{doc['id']}] {doc['type']} | {doc['title']} | 기준일 {doc['basisDate']}\n{doc['text']}"
        for doc in prompt_documents
    )
    system = (
        "너는 한국 주식 초보자를 위한 로컬 Ollama 투자 학습 보조자다. "
        "반드시 제공된 근거 안에서만 답하고 투자 지시, 수익 보장, 확정 표현을 금지한다. "
        "결론은 매수 검토, 관망, 매도 검토 중 하나의 조건형 의견으로만 쓴다. "
        "반드시 한국어 JSON 객체 하나만 반환하고, 각 배열은 최대 2개 항목으로 짧게 쓴다. "
        "마크다운, 코드블록, JSON 밖 설명은 쓰지 않는다."
    )
    user = f"""
대상: {subject}{f"({code})" if code else ""}
기준일: {basis_date}

근거:
{context or "제공된 근거가 없습니다."}

다음 JSON 스키마를 지켜서 반환해라.
{{
  "answer": "",
  "stockAdvice": {{
    "decision": "매수 검토|관망|매도 검토",
    "summary": ""
  }},
  "newsSentiment": {{
    "score": 0,
    "label": "긍정 우위|중립|부정 우위",
    "summary": "",
    "headlineSignals": [],
    "upReasons": [],
    "downRisks": [],
    "caution": ""
  }},
  "afterMarketReport": {{
    "mood": "",
    "llmComment": "",
    "nextWatch": []
  }},
  "beginnerNotes": [],
  "limitations": []
}}
빈 값에는 반드시 위 근거를 읽고 실제 한국어 문장을 채워라. 스키마 설명 문구를 복사하지 마라.
"""
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _market_rate_text(entry: Any) -> str:
    if not isinstance(entry, dict):
        return _clean(entry, "")
    name = _clean(entry.get("name"), "")
    rate = entry.get("rate")
    if _number(rate, None) is None:
        return name
    return f"{name} {_number(rate):+.2f}%"


def _leader_list(summary: dict[str, Any], key: str, fallback_key: str) -> list[str]:
    rows = summary.get(key) if isinstance(summary.get(key), list) else []
    values = [_market_rate_text(row) for row in rows[:3] if _market_rate_text(row)]
    if values:
        return values
    fallback = _clean(summary.get(fallback_key), "")
    return [fallback] if fallback else []


def _after_market_report_fallback(
    summary: dict[str, Any],
    basis_date: str,
    llm_meta: dict[str, Any],
) -> dict[str, Any]:
    ai_report = summary.get("afterMarketAiReport") if isinstance(summary.get("afterMarketAiReport"), dict) else {}
    top_gainers = _leader_list(summary, "topGainers", "topGainer")
    top_losers = _leader_list(summary, "topLosers", "topLoser")
    kospi_gainers = _leader_list(summary, "kospiTopGainers", "kospiTopGainer")
    kosdaq_gainers = _leader_list(summary, "kosdaqTopGainers", "kosdaqTopGainer")
    points = _summary_points(summary)
    mood = _clean(ai_report.get("mood"), "선별 접근")
    comment = _clean(ai_report.get("llmComment"), "장후 브리프를 기준으로 다음 거래일 확인 포인트를 정리했습니다.")
    next_watch = ai_report.get("nextWatch") if isinstance(ai_report.get("nextWatch"), list) else []
    if not next_watch:
        next_watch = [
            "다음 거래일 시초가와 전일 종가 대비 갭 확인",
            "상승·하락 1위 종목의 뉴스 원문 확인",
            "관심 종목의 20일선과 거래량 유지 여부 확인",
        ]

    market_bias = "중립"
    if "위험" in mood:
        market_bias = "방어 우선"
    elif "관심" in mood:
        market_bias = "관심 확대"

    fallback_reason = _clean(llm_meta.get("fallbackReason"), "")

    return {
        "mode": "ollama_fallback_rule_based",
        "provider": "ollama",
        "model": _clean(llm_meta.get("model"), ""),
        "basisDate": basis_date,
        "title": "매일 장후 시장 요약 리포트",
        "mood": mood,
        "marketBias": market_bias,
        "keyPoints": points[:4],
        "llmComment": comment,
        "nextWatch": [_clean(item, "") for item in next_watch[:4] if _clean(item, "")],
        "beginnerNotes": [
            "장후 리포트는 오늘 시장에서 무엇을 먼저 볼지 정리하는 기능입니다.",
            "상승률 1위는 바로 매수 대상이 아니라 다음 거래일 거래량과 눌림을 확인할 후보입니다.",
            "하락률 1위는 악재성 원인과 지지선 이탈 여부를 먼저 확인해야 합니다.",
        ],
        "marketLeaders": {
            "topGainers": top_gainers,
            "topLosers": top_losers,
            "kospiTopGainers": kospi_gainers,
            "kosdaqTopGainers": kosdaq_gainers,
            "mostMentioned": _clean(summary.get("mostMentioned"), ""),
        },
        "limitations": [
            *([fallback_reason] if fallback_reason else []),
            "리포트는 저장된 장후 브리프와 제공된 시장 데이터 기준이며 실시간 장중 데이터는 아닙니다.",
        ],
        "retrieval": {
            "documents": [
                {
                    "id": "latest-daily-summary",
                    "type": "daily_summary",
                    "title": "최신 저장 브리프",
                    "basisDate": basis_date,
                    "text": _compact(summary, 1400),
                }
            ],
            "sourceCount": 1,
            "llm": {**llm_meta, "used": False},
        },
        "confidence": "medium" if summary else "low",
    }


def _build_after_market_report_prompt(summary: dict[str, Any], basis_date: str) -> list[dict[str, str]]:
    system = (
        "너는 한국 주식 초보자를 위한 장후 시장 요약 리포트 작성자다. "
        "반드시 제공된 저장 브리프만 근거로 쓰고 투자 지시, 수익 보장, 확정 표현을 금지한다. "
        "한국어 JSON 객체 하나만 반환한다. 문장은 친근하지만 과장 없이 짧게 쓴다."
    )
    user = f"""
기준일: {basis_date}

저장 브리프:
{json.dumps(summary, ensure_ascii=False, default=str)[:5000]}

다음 JSON 스키마를 지켜서 반환해라.
{{
  "mood": "관심 확대|선별 접근|방어 우선|휴장",
  "marketBias": "관심 확대|중립|방어 우선",
  "keyPoints": [],
  "llmComment": "",
  "nextWatch": [],
  "beginnerNotes": []
}}
빈 값에는 브리프를 읽고 실제 한국어 문장을 채워라. 배열은 최대 3개 항목만 쓴다.
"""
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _merge_after_market_report(base: dict[str, Any], generated: dict[str, Any] | None) -> dict[str, Any]:
    if not generated:
        return base
    merged = {**base}
    for field in ["llmComment"]:
        if isinstance(generated.get(field), str):
            merged[field] = _merge_text_value(merged.get(field), generated[field])
    for field in ["keyPoints", "nextWatch", "beginnerNotes", "limitations"]:
        if isinstance(generated.get(field), list):
            merged[field] = _merge_list_value(merged.get(field), generated[field])
    return merged


def _build_ollama_chat_prompt(
    req: ChatRequest,
    subject: str,
    code: str,
    topic_type: str,
    basis_date: str,
    documents: list[dict[str, str]],
) -> list[dict[str, str]]:
    prompt_documents = _ollama_prompt_documents(documents)[:12]
    context = "\n".join(
        f"[{doc['id']}] {doc['type']} | {doc['title']} | {doc['text'][:260]}"
        for doc in prompt_documents
    )
    system = (
        "너는 한국 주식 초보자를 위한 로컬 Ollama 상담 보조자다. "
        "제공된 근거만 사용하고 수익 보장이나 매수/매도 지시는 금지한다. "
        "답변은 900자 이내의 쉬운 한국어로 쓴다. "
        "결론은 매수 검토, 관망, 매도 검토 중 하나로 조건형으로 말한다."
    )
    user = f"""
질문: {_clean(req.question, "이 종목 지금 사도 되나요?")}
대상: {subject}{f"({code})" if code else ""}
분석 범위: {topic_type}
기준일: {basis_date}

근거:
{context or "제공된 근거가 없습니다."}

다음 순서로 짧게 답해라.
1. 결론
2. 20일선과 거래량 해석
3. 매수 검토 조건
4. 관망 또는 매도 검토 조건
5. 뉴스/이벤트가 좋게 볼 이유인지 주의할 이유인지
6. 초보자가 다음 거래일 확인할 것
"""
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


@app.get("/health")
def health():
    return {"status": "UP"}


@app.get("/llm/status")
def llm_status():
    return _llm_status()


@app.post("/ollama/insights")
def ollama_insights(req: ChatRequest):
    subject = _clean(req.stockName or req.topicTitle, "선택한 종목")
    code = _clean(req.stockCode, "")
    basis_date = _clean(req.contextDate, date.today().isoformat())
    documents = _build_retrieval_documents(req, subject, code, _clean(req.topicType, "stock"), basis_date)
    llm_answer, llm_meta = _call_ollama_llm(
        _build_ollama_insights_prompt(req, subject, code, basis_date, documents),
        json_mode=True,
    )
    fallback = _fallback_ollama_insights(req, subject, code, basis_date, documents, llm_meta)
    generated = _json_object_from_text(llm_answer or "")
    response = _merge_insight_dict(fallback, generated)
    used_llm = bool(llm_answer)
    if used_llm and not generated:
        raw_answer = _compact(llm_answer, 900)
        if raw_answer.lstrip().startswith("{"):
            response["answer"] = (
                f"{fallback['answer']} 로컬 Ollama 호출은 성공했지만 응답 JSON이 불완전해 "
                "화면 카드에는 계산된 근거값을 유지했습니다."
            )
        else:
            response["answer"] = raw_answer
        response["limitations"] = [
            "Ollama 로컬 LLM 응답은 받았지만 JSON 구조가 불완전해 카드 세부값은 규칙형 계산을 함께 사용했습니다.",
            *[item for item in response.get("limitations", []) if item],
        ][:5]
    response["answer"] = _compose_ollama_answer(subject, code, response)
    response["mode"] = "ollama_llm" if used_llm else "ollama_fallback_rule_based"
    response["retrieval"]["llm"] = {**llm_meta, "used": used_llm}
    if used_llm:
        response["limitations"] = [
            "Ollama 로컬 LLM이 제공된 근거 안에서 생성한 조건형 의견입니다.",
            *[item for item in response.get("limitations", []) if item],
        ][:5]
    return response


@app.post("/ollama/after-market-report")
def ollama_after_market_report(req: ChatRequest):
    summary = req.summary if isinstance(req.summary, dict) else {}
    basis_date = _clean(
        req.contextDate
        or summary.get("effectiveDate")
        or summary.get("date"),
        date.today().isoformat(),
    )
    llm_answer, llm_meta = _call_ollama_llm(
        _build_after_market_report_prompt(summary, basis_date),
        json_mode=True,
    )
    fallback = _after_market_report_fallback(summary, basis_date, llm_meta)
    generated = _json_object_from_text(llm_answer or "")
    response = _merge_after_market_report(fallback, generated)
    used_llm = bool(llm_answer)
    response["mode"] = "ollama_llm" if used_llm else "ollama_fallback_rule_based"
    response["retrieval"]["llm"] = {**llm_meta, "used": used_llm}
    if used_llm:
        response["limitations"] = [
            "Ollama 로컬 LLM이 최신 저장 브리프를 읽고 생성한 장후 코멘트입니다.",
            *[item for item in response.get("limitations", []) if item],
        ][:5]
    return response


@app.post("/chat")
def chat(req: ChatRequest):
    subject = _clean(req.stockName or req.topicTitle, "선택한 주제")
    code = _clean(req.stockCode, "")
    topic_type = _clean(req.topicType, "market")
    basis_date = _clean(req.contextDate, date.today().isoformat())
    events = req.events or []
    terms = req.terms or []

    event_lines = _event_lines(events)
    term_lines = _term_lines(terms)
    search_context_lines = _search_context_lines(req.searchResult)
    retrieval_documents = _build_retrieval_documents(req, subject, code, topic_type, basis_date)
    answer_parts = [
        f"기준일: {basis_date}",
        f"대상: {subject}{f'({code})' if code else ''}",
        f"분석 범위: {topic_type}",
        "",
        "핵심 해석",
        f"- 질문은 '{_clean(req.question, '차트와 이벤트 해석')}'입니다.",
        "- 이 응답은 현재 저장된 브리프, 차트 이벤트, 용어 사전 연결을 바탕으로 한 교육용 분석입니다.",
    ]

    if search_context_lines:
        answer_parts += ["", "검색 맥락", *search_context_lines]

    if code and event_lines:
        answer_parts += ["", "차트 이벤트 근거", *event_lines]
    elif code:
        answer_parts += ["", "차트 이벤트 근거", "- 확인된 급등/급락/거래량 급증 이벤트가 없거나 아직 전달되지 않았습니다."]
    else:
        answer_parts += ["", "시장/테마 근거", "- 개별 종목 차트가 아닌 검색 맥락과 저장된 브리프를 우선 근거로 사용했습니다."]

    if req.indicatorSnapshot:
        answer_parts += ["", "이동평균선 해석", f"- {_moving_average_explanation(req.indicatorSnapshot)}"]

    if term_lines:
        answer_parts += ["", "초보자 용어 연결", *term_lines]

    portfolio = _portfolio_guidance(req.portfolioContext if isinstance(req.portfolioContext, dict) else None)
    answer_parts += [
        "",
        "포트폴리오 맥락",
        f"- {portfolio['summary']}",
        *[f"- {item}" for item in portfolio["checklist"][:3]],
    ]

    answer_parts += [
        "",
        "검토 조건",
        "- 매수 검토: 가격 회복, 거래량 증가, 주요 지지선 방어가 함께 나올 때만 검토합니다.",
        "- 분할매수 검토: 조건이 일부만 충족되면 한 번에 진입하지 않고 작은 비중으로 나누어 확인합니다.",
        "- 관망: 가격과 거래량 신호가 엇갈리거나 근거 링크가 부족하면 새 데이터가 쌓일 때까지 기다립니다.",
        "- 매도 검토: 급등 후 거래량 둔화, 긴 윗꼬리 반복, 직전 고점 돌파 실패가 겹치면 검토합니다.",
        "- 리스크 관리: 전저점 이탈이나 하락일 거래량 급증 시 손실 허용 기준을 다시 세웁니다.",
        "",
        "반대 신호",
        "- 가격은 오르지만 거래량이 줄면 추세 신뢰도를 낮춰야 합니다.",
        "- 이벤트 제목만 보고 판단하지 말고 공시, 뉴스, 재무 상황을 함께 확인해야 합니다.",
    ]

    sources = [
        {"title": "앱 저장 일간 브리프", "type": "daily_summary", "url": "/api/summaries/latest"},
        {"title": "통합 검색 API", "type": "search", "url": "/api/search"},
        {"title": "초보자 용어 사전", "type": "internal_glossary", "url": "/api/learning/terms"},
        {"title": "포트폴리오 샌드박스", "type": "portfolio_context", "url": "/api/portfolio"},
    ]
    if code:
        sources.insert(1, {"title": "종목 차트 API", "type": "ohlcv", "url": f"/api/stocks/{code}/chart"})
        sources.insert(2, {"title": "종목 이벤트 API", "type": "events", "url": f"/api/stocks/{code}/events"})
        sources.insert(3, {"title": "종목 뉴스 헤드라인 API", "type": "news", "url": f"/api/stocks/{code}/news"})
        sources.insert(4, {"title": "조건형 거래 구간 API", "type": "trade_zones", "url": f"/api/stocks/{code}/trade-zones"})

    prompt = (
        _build_ollama_chat_prompt(req, subject, code, topic_type, basis_date, retrieval_documents)
        if _llm_status()["provider"] == "ollama"
        else _build_llm_prompt(req, subject, code, topic_type, basis_date, retrieval_documents)
    )
    llm_answer, llm_meta = _call_configured_llm(prompt)
    used_llm = bool(llm_answer)

    limitations = [
        "투자 지시가 아니라 교육용 분석 보조입니다.",
        "평균단가, 실제 보유 수량, 투자 기간, 손실 허용 범위는 아직 반영하지 않습니다.",
    ]
    if not used_llm:
        limitations.insert(0, "LLM 설정 또는 호출 실패로 규칙형 근거 기반 응답을 제공합니다.")
    else:
        limitations.insert(0, "LLM 응답은 제공된 근거 안에서만 생성되도록 제한했습니다.")

    confidence = "medium" if retrieval_documents else "low-medium"
    structured = _build_structured_answer(req, subject, code, basis_date, confidence, sources, limitations)
    grounding = _build_grounding_report(req, retrieval_documents, basis_date, used_llm, llm_meta)

    return {
        "mode": "rag_llm" if used_llm else "rag_fallback_rule_based",
        "answer": llm_answer or "\n".join(answer_parts),
        "basisDate": basis_date,
        "confidence": confidence,
        "sources": sources,
        "structured": structured,
        "grounding": grounding,
        "retrieval": {
            "documents": retrieval_documents,
            "sourceCount": len(retrieval_documents),
            "llm": {
                **llm_meta,
                "used": used_llm,
            },
        },
        "limitations": limitations,
        "oppositeSignals": [
            "거래량 없는 상승",
            "하락일 거래량 급증",
            "직전 저점 이탈",
            "공시/뉴스 근거 부족",
        ],
        "nextQuestions": [
            "이 이벤트가 거래량과 같이 나온 건 왜 중요해?",
            "보수형 시나리오에서는 어떤 조건을 기다려야 해?",
            "반대 신호가 나오면 어떤 데이터를 먼저 봐야 해?",
        ],
    }
