from __future__ import annotations

from datetime import date
import hashlib
import json
import os
from typing import Any
import uuid
from urllib import error, request

from fastapi import FastAPI
from pydantic import BaseModel, Field


app = FastAPI(title="kr-stock-daily-brief ai-service", version="0.1.0")

_QDRANT_READY_COLLECTIONS: set[str] = set()
_QDRANT_EMBEDDING_CACHE: dict[str, list[float]] = {}


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
    fundamentalSnapshot: dict[str, Any] | None = None
    tradeZones: dict[str, Any] | None = None
    currentDecisionSummary: dict[str, Any] | None = None
    portfolioContext: dict[str, Any] | None = None
    events: list[dict[str, Any]] = Field(default_factory=list)
    newsHeadlines: list[dict[str, Any]] = Field(default_factory=list)
    terms: list[dict[str, Any]] = Field(default_factory=list)


def _clean(value: Any, fallback: str = "-") -> str:
    text = str(value or "").strip()
    return text if text else fallback


def _friendly_llm_fallback_reason(value: Any) -> str:
    reason = _clean(value, "")
    if not reason:
        return ""
    if "TimeoutError" in reason or "timed out" in reason.lower():
        return "Ollama 응답이 기준 시간 안에 끝나지 않아 계산된 근거를 먼저 보여줍니다."
    if "content" in reason:
        return "Ollama 응답 본문이 비어 있어 계산된 근거를 먼저 보여줍니다."
    if "설정" in reason or "MODEL" in reason or "model" in reason:
        return "Ollama 모델 설정을 확인하면 로컬 LLM 답변을 사용할 수 있습니다."
    if "호출 실패" in reason:
        return "Ollama 호출이 안정적으로 끝나지 않아 계산된 근거를 먼저 보여줍니다."
    return reason


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

    if req.fundamentalSnapshot:
        documents.append({
            "id": "fundamental-snapshot",
            "type": "fundamental_snapshot",
            "title": f"{subject} 재무 스냅샷",
            "text": _compact(req.fundamentalSnapshot),
            "basisDate": _clean(req.fundamentalSnapshot.get("asOf"), basis_date),
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


def _qdrant_enabled() -> bool:
    return os.getenv("QDRANT_ENABLED", "true").strip().lower() not in {"0", "false", "no", "off"}


def _qdrant_url() -> str:
    return os.getenv("QDRANT_URL", "http://qdrant:6333").rstrip("/")


def _qdrant_collection() -> str:
    return os.getenv("QDRANT_COLLECTION", "kr_stock_ai_memory_ollama").strip() or "kr_stock_ai_memory_ollama"


def _qdrant_vector_provider() -> str:
    provider = os.getenv("QDRANT_VECTOR_PROVIDER", "ollama").strip().lower()
    return provider if provider in {"ollama", "hash", "auto"} else "ollama"


def _qdrant_embedding_model() -> str:
    return (
        os.getenv("QDRANT_EMBEDDING_MODEL", "").strip()
        or os.getenv("OLLAMA_EMBEDDING_MODEL", "").strip()
        or os.getenv("OLLAMA_MODEL", "").strip()
        or os.getenv("LLM_MODEL", "").strip()
        or "llama3.1:latest"
    )


def _qdrant_vector_size() -> int:
    default_size = "64" if _qdrant_vector_provider() == "hash" else "4096"
    try:
        return max(16, min(8192, int(os.getenv("QDRANT_VECTOR_SIZE", default_size))))
    except ValueError:
        return int(default_size)


def _qdrant_max_documents() -> int:
    try:
        return max(4, min(36, int(os.getenv("QDRANT_MAX_DOCUMENTS", "16"))))
    except ValueError:
        return 16


def _qdrant_timeout() -> float:
    try:
        return max(0.5, min(10.0, float(os.getenv("QDRANT_TIMEOUT_SECONDS", "2.5"))))
    except ValueError:
        return 2.5


def _qdrant_embedding_timeout() -> float:
    try:
        return max(1.0, min(30.0, float(os.getenv("QDRANT_EMBEDDING_TIMEOUT_SECONDS", "20"))))
    except ValueError:
        return 20.0


def _qdrant_meta_base() -> dict[str, Any]:
    return {
        "enabled": _qdrant_enabled(),
        "collection": _qdrant_collection(),
        "baseUrl": _qdrant_url(),
        "vectorSize": _qdrant_vector_size(),
        "vectorProvider": _qdrant_vector_provider(),
        "embeddingModel": _qdrant_embedding_model() if _qdrant_vector_provider() != "hash" else "",
        "embeddingUsed": False,
        "fallbackReason": "",
        "maxDocuments": _qdrant_max_documents(),
        "storedCount": 0,
        "retrievedCount": 0,
        "error": "",
    }


def _qdrant_json(method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8") if payload is not None else None
    req = request.Request(
        f"{_qdrant_url()}/{path.lstrip('/')}",
        data=data,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    with request.urlopen(req, timeout=_qdrant_timeout()) as res:
        body = res.read().decode("utf-8")
    return json.loads(body) if body else {}


def _qdrant_collection_vector_size(response: dict[str, Any]) -> int | None:
    vectors = (
        response.get("result", {})
        .get("config", {})
        .get("params", {})
        .get("vectors")
    )
    if isinstance(vectors, dict) and isinstance(vectors.get("size"), int):
        return vectors.get("size")
    return None


def _ensure_qdrant_collection(vector_size: int | None = None) -> None:
    collection = _qdrant_collection()
    if collection in _QDRANT_READY_COLLECTIONS:
        return
    path = f"collections/{collection}"
    expected_size = vector_size or _qdrant_vector_size()
    try:
        response = _qdrant_json("GET", path)
        current_size = _qdrant_collection_vector_size(response)
        if current_size and current_size != expected_size:
            raise ValueError(f"Qdrant collection vector size mismatch: current={current_size}, expected={expected_size}")
    except error.HTTPError as exc:
        if exc.code != 404:
            raise
        _qdrant_json("PUT", path, {
            "vectors": {
                "size": expected_size,
                "distance": "Cosine",
            }
        })
    _QDRANT_READY_COLLECTIONS.add(collection)


def _hash_vector(text: str, size: int) -> list[float]:
    values = [0.0] * size
    compact = "".join(str(text or "").lower().split())[:1200]
    tokens = [token for token in str(text or "").lower().split() if token]
    if len(compact) >= 2:
        tokens.extend(compact[index:index + 2] for index in range(min(len(compact) - 1, 360)))
    if not tokens:
        tokens = ["empty"]
    for token in tokens:
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        index = int.from_bytes(digest[:4], "big") % size
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        weight = 1.0 + (digest[5] % 7) / 10.0
        values[index] += sign * weight
    norm = sum(value * value for value in values) ** 0.5 or 1.0
    return [round(value / norm, 6) for value in values]


def _normalize_vector(vector: list[Any]) -> list[float]:
    out = [float(value) for value in vector]
    norm = sum(value * value for value in out) ** 0.5 or 1.0
    return [round(value / norm, 8) for value in out]


def _ollama_embedding_vectors(texts: list[str]) -> list[list[float]]:
    model = _qdrant_embedding_model()
    if not model:
        raise ValueError("QDRANT_EMBEDDING_MODEL이 설정되지 않았습니다.")
    normalized_texts = [_compact(text, 2000) for text in texts]
    cache_keys = [
        hashlib.sha256(f"{model}|{text}".encode("utf-8")).hexdigest()
        for text in normalized_texts
    ]
    output: list[list[float] | None] = []
    missing_texts: list[str] = []
    missing_indexes: list[int] = []
    for index, key in enumerate(cache_keys):
        cached = _QDRANT_EMBEDDING_CACHE.get(key)
        output.append(cached)
        if cached is None:
            missing_indexes.append(index)
            missing_texts.append(normalized_texts[index])
    if not missing_texts:
        return [vector for vector in output if vector is not None]

    base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
    payload = {
        "model": model,
        "input": missing_texts,
    }
    data = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
    req = request.Request(
        f"{base_url}/api/embed",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with request.urlopen(req, timeout=_qdrant_embedding_timeout()) as res:
        body = json.loads(res.read().decode("utf-8"))
    embeddings = body.get("embeddings")
    if not isinstance(embeddings, list) or len(embeddings) != len(missing_texts):
        raise ValueError("Ollama embedding 응답이 비어 있습니다.")
    vectors = [_normalize_vector(vector) for vector in embeddings if isinstance(vector, list) and vector]
    if len(vectors) != len(missing_texts):
        raise ValueError("Ollama embedding 응답 개수가 맞지 않습니다.")
    for index, vector in zip(missing_indexes, vectors):
        output[index] = vector
        _QDRANT_EMBEDDING_CACHE[cache_keys[index]] = vector
    if len(_QDRANT_EMBEDDING_CACHE) > 512:
        for key in list(_QDRANT_EMBEDDING_CACHE.keys())[:128]:
            _QDRANT_EMBEDDING_CACHE.pop(key, None)
    return [vector for vector in output if vector is not None]


def _ollama_embedding_vector(text: str) -> list[float]:
    vectors = _ollama_embedding_vectors([text])
    if not vectors:
        raise ValueError("Ollama embedding 응답이 비어 있습니다.")
    return vectors[0]


def _qdrant_vector_for_text(text: str) -> tuple[list[float], dict[str, Any]]:
    provider = _qdrant_vector_provider()
    meta = {
        "vectorProvider": provider,
        "embeddingModel": _qdrant_embedding_model() if provider != "hash" else "",
        "embeddingUsed": False,
        "fallbackReason": "",
    }
    if provider != "hash":
        try:
            vector = _ollama_embedding_vector(text)
            meta["vectorProvider"] = "ollama"
            meta["embeddingUsed"] = True
            return vector, meta
        except (error.URLError, TimeoutError, json.JSONDecodeError, KeyError, ValueError) as exc:
            meta["fallbackReason"] = f"Ollama embedding 실패: {type(exc).__name__}"
            if provider == "ollama":
                # Keep the app usable; the meta makes the quality downgrade visible.
                return _hash_vector(text, _qdrant_vector_size()), meta
    meta["vectorProvider"] = "hash"
    return _hash_vector(text, _qdrant_vector_size()), meta


def _qdrant_vectors_for_texts(texts: list[str]) -> tuple[list[list[float]], dict[str, Any]]:
    provider = _qdrant_vector_provider()
    meta = {
        "vectorProvider": provider,
        "embeddingModel": _qdrant_embedding_model() if provider != "hash" else "",
        "embeddingUsed": False,
        "fallbackReason": "",
    }
    if provider != "hash":
        try:
            vectors = _ollama_embedding_vectors(texts)
            if len(vectors) == len(texts):
                meta["vectorProvider"] = "ollama"
                meta["embeddingUsed"] = True
                return vectors, meta
        except (error.URLError, TimeoutError, json.JSONDecodeError, KeyError, ValueError) as exc:
            meta["fallbackReason"] = f"Ollama embedding 실패: {type(exc).__name__}"
            if provider == "ollama":
                return [_hash_vector(text, _qdrant_vector_size()) for text in texts], meta
    meta["vectorProvider"] = "hash"
    return [_hash_vector(text, _qdrant_vector_size()) for text in texts], meta


def _qdrant_point_id(doc: dict[str, str], code: str, basis_date: str) -> str:
    source = "|".join([
        _clean(code, "market"),
        _clean(basis_date, ""),
        _clean(doc.get("id"), ""),
        hashlib.sha1(_clean(doc.get("text"), "").encode("utf-8")).hexdigest(),
    ])
    return str(uuid.uuid5(uuid.NAMESPACE_URL, source))


def _qdrant_upsert_documents(
    documents: list[dict[str, str]],
    subject: str,
    code: str,
    topic_type: str,
    basis_date: str,
) -> tuple[int, dict[str, Any]]:
    if not documents:
        return 0, {}
    points = []
    limited_documents = documents[:_qdrant_max_documents()]
    texts = []
    for doc in limited_documents:
        texts.append(" ".join([
            _clean(doc.get("title"), ""),
            _clean(doc.get("type"), ""),
            _clean(doc.get("text"), ""),
        ]))
    vectors, aggregate_meta = _qdrant_vectors_for_texts(texts)
    if not vectors:
        return 0, aggregate_meta
    aggregate_meta["vectorSize"] = len(vectors[0])
    _ensure_qdrant_collection(len(vectors[0]))
    for doc, text, vector in zip(limited_documents, texts, vectors):
        points.append({
            "id": _qdrant_point_id(doc, code, basis_date),
            "vector": vector,
            "payload": {
                "docId": _clean(doc.get("id"), ""),
                "type": _clean(doc.get("type"), ""),
                "title": _compact(doc.get("title"), 160),
                "text": _compact(doc.get("text"), 1200),
                "basisDate": _clean(doc.get("basisDate"), basis_date),
                "stockCode": _clean(code, ""),
                "subject": _clean(subject, ""),
                "topicType": _clean(topic_type, ""),
                "vectorProvider": aggregate_meta.get("vectorProvider", _qdrant_vector_provider()),
                "embeddingModel": aggregate_meta.get("embeddingModel", ""),
                "embeddingUsed": bool(aggregate_meta.get("embeddingUsed")),
                "source": "ai-service-retrieval-document",
            },
        })
    _qdrant_json("PUT", f"collections/{_qdrant_collection()}/points?wait=true", {"points": points})
    return len(points), aggregate_meta


def _qdrant_search(query: str, limit: int = 4) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    vector, vector_meta = _qdrant_vector_for_text(query)
    _ensure_qdrant_collection(len(vector))
    payload = {
        "vector": vector,
        "limit": max(1, min(8, limit)),
        "with_payload": True,
    }
    data = _qdrant_json("POST", f"collections/{_qdrant_collection()}/points/search", payload)
    result = data.get("result")
    vector_meta["vectorSize"] = len(vector)
    return result if isinstance(result, list) else [], vector_meta


def _qdrant_hits_to_documents(hits: list[dict[str, Any]], basis_date: str) -> list[dict[str, str]]:
    documents: list[dict[str, str]] = []
    for index, hit in enumerate(hits[:4], start=1):
        payload = hit.get("payload") if isinstance(hit.get("payload"), dict) else {}
        score = hit.get("score")
        score_text = f"{float(score):.3f}" if isinstance(score, (int, float)) else "확인 필요"
        title = _clean(payload.get("title"), "Qdrant 검색 근거")
        text = _clean(payload.get("text"), "")
        documents.append({
            "id": f"qdrant-memory-{index}",
            "type": "qdrant_memory",
            "title": f"Qdrant 검색 근거: {title}",
            "text": _compact({
                "similarity": score_text,
                "originalType": payload.get("type"),
                "originalDocId": payload.get("docId"),
                "text": text,
            }, 620),
            "basisDate": _clean(payload.get("basisDate"), basis_date),
        })
    return documents


def _augment_with_qdrant_documents(
    req: ChatRequest,
    documents: list[dict[str, str]],
    subject: str,
    code: str,
    topic_type: str,
    basis_date: str,
    query_text: str | None = None,
) -> tuple[list[dict[str, str]], dict[str, Any]]:
    meta = _qdrant_meta_base()
    if not meta["enabled"]:
        meta["error"] = "QDRANT_ENABLED=false"
        return documents, meta
    try:
        stored_count, stored_vector_meta = _qdrant_upsert_documents(documents, subject, code, topic_type, basis_date)
        meta["storedCount"] = stored_count
        query = query_text or " ".join([
            _clean(req.question, ""),
            _clean(subject, ""),
            _clean(code, ""),
            _compact(req.currentDecisionSummary, 220),
            _compact(req.indicatorSnapshot, 220),
            _compact(req.newsHeadlines[:3], 360),
        ])
        hits, query_vector_meta = _qdrant_search(query, limit=4)
        meta["vectorProvider"] = query_vector_meta.get("vectorProvider") or stored_vector_meta.get("vectorProvider") or meta["vectorProvider"]
        meta["embeddingModel"] = query_vector_meta.get("embeddingModel") or stored_vector_meta.get("embeddingModel") or meta["embeddingModel"]
        meta["embeddingUsed"] = bool(stored_vector_meta.get("embeddingUsed")) and bool(query_vector_meta.get("embeddingUsed"))
        meta["fallbackReason"] = stored_vector_meta.get("fallbackReason") or query_vector_meta.get("fallbackReason") or ""
        meta["vectorSize"] = query_vector_meta.get("vectorSize") or stored_vector_meta.get("vectorSize") or meta["vectorSize"]
        qdrant_docs = _qdrant_hits_to_documents(hits, basis_date)
        meta["retrievedCount"] = len(qdrant_docs)
        return [*documents, *qdrant_docs], meta
    except (error.URLError, TimeoutError, json.JSONDecodeError, KeyError, ValueError) as exc:
        meta["error"] = f"{type(exc).__name__}: {_compact(exc, 120)}"
        return documents, meta


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
    qdrant_ids = sorted(doc_id for doc_id in ids if doc_id.startswith("qdrant-memory-"))
    add_claim("차트 이벤트를 근거로 사용", event_ids[:6])
    add_claim("뉴스/공시/DART/토론 evidence 후보를 근거로 사용", evidence_ids[:8])
    add_claim("출처별 원인 점수와 텍스트 신호를 근거로 사용", causal_ids[:8])
    add_claim("국내 뉴스 헤드라인을 근거로 사용", news_ids[:8])
    add_claim("초보자 용어 사전을 근거로 사용", term_ids[:6])
    add_claim("Qdrant 벡터 검색으로 찾은 유사 근거를 사용", qdrant_ids[:4])

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
    average_price = _number(portfolio.get("averagePrice"), 0)
    average_text = f"{average_price:,.0f}원" if average_price > 0 else "미입력"
    holding_period = _clean(portfolio.get("holdingPeriod"), "미입력")
    risk_tolerance = _clean(portfolio.get("riskTolerance"), "미입력")
    guidance = portfolio.get("guidance") or []
    if isinstance(guidance, str):
        guidance = [guidance]
    checklist = [str(item) for item in guidance[:3] if str(item).strip()]
    if saved:
        summary = (
            f"포트폴리오 샌드박스에 저장된 가상 비중 {weight_text}, 평균단가 {average_text}, "
            f"보유기간 {holding_period}, 손실허용 {risk_tolerance}을 참고했습니다."
        )
        if average_price > 0:
            checklist.append("현재가가 평균단가 대비 손실 허용 범위를 넘는지 먼저 확인하세요.")
        if risk_tolerance == "낮음":
            checklist.append("손실 허용이 낮으므로 지지선 이탈 시 신규 매수보다 비중 축소 기준을 먼저 봅니다.")
        elif risk_tolerance == "높음":
            checklist.append("손실 허용이 높아도 악재와 하락 거래량이 겹치면 물타기보다 리스크 관리가 우선입니다.")
        checklist.append("비중이 높다면 새 매수보다 리스크 관리 가격과 반대 신호를 먼저 확인하세요.")
    else:
        summary = "기업 선택은 저장되지 않았고, 포트폴리오 샌드박스에 담긴 개인 비중도 아직 없습니다."
        checklist.append("저장하려면 포트폴리오 샌드박스에 담고 비중을 입력하세요.")
    return {
        "saved": saved,
        "summary": summary,
        "weight": weight,
        "averagePrice": average_price if average_price > 0 else None,
        "holdingPeriod": holding_period,
        "riskTolerance": risk_tolerance,
        "checklist": checklist[:4],
    }


def _fundamental_guidance(snapshot: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(snapshot, dict):
        return {
            "summary": "재무 스냅샷이 없어 PER/PBR/ROE는 판단 근거에 직접 반영하지 못했습니다.",
            "points": ["재무가 비어 있으면 차트, 뉴스, 거래량 근거를 더 보수적으로 봅니다."],
        }
    valuation = snapshot.get("valuation") if isinstance(snapshot.get("valuation"), dict) else {}
    market = snapshot.get("market") if isinstance(snapshot.get("market"), dict) else {}
    per = valuation.get("per")
    pbr = valuation.get("pbr")
    roe = valuation.get("roe")
    market_cap = market.get("marketCap")
    points: list[str] = []
    if per is not None:
        points.append(f"PER {per}배는 이익 대비 가격 부담을 보는 보조 지표입니다.")
    if pbr is not None:
        points.append(f"PBR {pbr}배는 장부가치 대비 가격 수준을 보는 보조 지표입니다.")
    if roe is not None:
        points.append(f"ROE {roe}%는 수익성이 유지되는지 확인할 때 씁니다.")
    if market_cap:
        points.append(f"시가총액 {int(market_cap):,}원 규모를 감안해 변동성 해석을 조정해야 합니다.")
    interpretations = snapshot.get("interpretation") if isinstance(snapshot.get("interpretation"), list) else []
    for item in interpretations:
        text = _clean(item, "")
        if text and text not in points:
            points.append(text)
    summary = " ".join(points[:2]) if points else "재무 지표가 비어 있어 현재는 차트와 뉴스 근거를 우선합니다."
    return {
        "summary": summary,
        "points": points[:4] or ["재무 지표 원천과 최신 공시를 별도로 확인해야 합니다."],
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
    portfolio_context = req.portfolioContext if isinstance(req.portfolioContext, dict) else None
    portfolio = _portfolio_guidance(portfolio_context)
    personal_diagnostics = _personal_position_diagnostics(req, portfolio_context)
    portfolio["positionDiagnostics"] = personal_diagnostics
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
    fundamentals = _fundamental_guidance(req.fundamentalSnapshot if isinstance(req.fundamentalSnapshot, dict) else None)

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
        "fundamentalGuidance": fundamentals,
        "tradeZones": zones,
        "evidence": evidence[:5],
        "risks": [
            personal_diagnostics["actionLine"],
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
    num_predict = int(
        os.getenv("OLLAMA_JSON_NUM_PREDICT", "180")
        if json_mode
        else os.getenv("OLLAMA_NUM_PREDICT", os.getenv("LLM_MAX_TOKENS", "650"))
    )

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
            "num_predict": num_predict,
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
            "numPredict": payload_data["options"]["num_predict"],
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


def _ollama_config_meta() -> dict[str, Any]:
    model = _ollama_model()
    return {
        "enabled": bool(model),
        "provider": "ollama",
        "model": model,
        "baseUrl": os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/"),
        "fallbackReason": "",
        "timeoutSeconds": float(os.getenv("OLLAMA_TIMEOUT_SECONDS", os.getenv("LLM_TIMEOUT_SECONDS", "20"))),
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
        "qdrant": {
            "enabled": _qdrant_enabled(),
            "collection": _qdrant_collection(),
            "baseUrl": _qdrant_url(),
            "vectorSize": _qdrant_vector_size(),
            "vectorProvider": _qdrant_vector_provider(),
            "embeddingModel": _qdrant_embedding_model() if _qdrant_vector_provider() != "hash" else "",
            "maxDocuments": _qdrant_max_documents(),
            "timeoutSeconds": _qdrant_timeout(),
            "embeddingTimeoutSeconds": _qdrant_embedding_timeout(),
        },
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


def _sentiment_score_breakdown(events: list[dict[str, Any]], headlines: list[dict[str, Any]], profile: dict[str, Any]) -> dict[str, Any]:
    event_score = _event_sentiment_score(events)
    headline_score = _headline_sentiment_score(headlines)
    raw_score = event_score * 0.55 + headline_score * 0.75
    adjusted_score = raw_score
    adjustments: list[str] = []
    if profile.get("headlineCount", 0) < 3:
        adjusted_score *= 0.72
        adjustments.append("뉴스 후보가 3건 미만이라 확률을 보수적으로 낮췄습니다.")
    if profile.get("mixedCount", 0) >= max(2, profile.get("positiveCount", 0) + profile.get("negativeCount", 0)):
        adjusted_score *= 0.78
        adjustments.append("복합 해석 뉴스가 많아 한쪽 방향 확률을 낮췄습니다.")
    if profile.get("factorCount", 0) < 3:
        adjusted_score *= 0.82
        adjustments.append("원인 키워드가 부족해 뉴스 점수 영향도를 낮췄습니다.")
    return {
        "eventScore": round(event_score),
        "headlineScore": round(headline_score),
        "rawScore": round(_clamp(raw_score, -100, 100)),
        "adjustedScore": round(_clamp(adjusted_score, -70, 70)),
        "adjustments": adjustments or ["뉴스·이벤트 근거 수와 원인 키워드가 기본 기준을 충족했습니다."],
    }


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


def _risk_band_percent(risk_tolerance: str) -> float:
    if risk_tolerance == "낮음":
        return 3.0
    if risk_tolerance == "높음":
        return 12.0
    if risk_tolerance == "중간":
        return 7.0
    return 5.0


def _personal_position_diagnostics(req: ChatRequest, portfolio: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(portfolio, dict) or not bool(portfolio.get("saved")):
        return {
            "status": "not_saved",
            "statusLabel": "샌드박스 미저장",
            "summary": "이 종목을 포트폴리오 샌드박스에 담으면 평균단가와 손실허용 기준을 함께 계산합니다.",
            "actionLine": "기업 선택만으로는 DB에 저장되지 않으므로, 개인 조건 반영이 필요하면 샌드박스에 먼저 담아야 합니다.",
            "checklist": [
                "가상 비중을 정합니다.",
                "평균단가를 입력합니다.",
                "보유기간과 손실허용 범위를 고릅니다.",
            ],
        }

    latest = _latest_chart_row(req)
    close = _number(latest.get("close"), None)
    average_price = _number(portfolio.get("averagePrice"), None)
    risk_tolerance = _clean(portfolio.get("riskTolerance"), "미입력")
    holding_period = _clean(portfolio.get("holdingPeriod"), "미입력")
    weight = _number(portfolio.get("weight"), None)
    band = _risk_band_percent(risk_tolerance)

    base = {
        "status": "saved",
        "statusLabel": "개인 조건 반영",
        "currentPrice": close,
        "currentPriceText": _price_text(close),
        "averagePrice": average_price,
        "averagePriceText": _price_text(average_price),
        "holdingPeriod": holding_period,
        "riskTolerance": risk_tolerance,
        "riskBandPercent": band,
        "weight": weight,
    }

    if close is None or average_price is None or average_price <= 0:
        return {
            **base,
            "status": "missing_average_price",
            "statusLabel": "평균단가 필요",
            "summary": "평균단가가 없어 현재 손익률과 손실허용 기준을 계산하지 못했습니다.",
            "actionLine": "평균단가를 저장하면 AI가 매수 검토보다 리스크 관리 기준을 먼저 계산합니다.",
            "checklist": [
                "평균단가를 입력합니다.",
                "현재가와 20일선 위치를 함께 봅니다.",
                "손실허용 범위를 낮음·중간·높음 중 하나로 고릅니다.",
            ],
        }

    profit_loss_rate = (close - average_price) / average_price * 100
    stop_loss_price = average_price * (1 - band / 100)
    distance_to_stop = (close - stop_loss_price) / stop_loss_price * 100 if stop_loss_price > 0 else 0

    if profit_loss_rate <= -band:
        status = "loss_limit_exceeded"
        status_label = "손실허용 초과"
        action = "새 매수보다 손실 확대를 막는 기준과 비중 축소 조건을 먼저 확인합니다."
    elif profit_loss_rate < 0:
        status = "loss_zone"
        status_label = "손실 구간"
        action = "물타기보다 20일선 회복, 거래량 안정, 악재 해소가 동시에 나오는지 확인합니다."
    elif profit_loss_rate >= band:
        status = "profit_zone"
        status_label = "수익 구간"
        action = "추가 매수보다 일부 수익 보호 기준과 저항선 돌파 유지 여부를 먼저 확인합니다."
    else:
        status = "near_average"
        status_label = "평단 근처"
        action = "평균단가 근처에서는 방향을 단정하지 말고 다음 종가와 거래량을 확인합니다."

    weight_note = (
        "가상 비중이 높아 한 번의 판단보다 분할 대응 기준이 필요합니다."
        if weight is not None and weight >= 35
        else "가상 비중은 과도하지 않지만 동일 섹터 집중 여부를 함께 확인합니다."
    )

    return {
        **base,
        "status": status,
        "statusLabel": status_label,
        "profitLossRate": round(profit_loss_rate, 2),
        "profitLossText": _percent_text(profit_loss_rate),
        "stopLossPrice": round(stop_loss_price),
        "stopLossPriceText": _price_text(stop_loss_price),
        "distanceToStopRate": round(distance_to_stop, 2),
        "summary": (
            f"현재가 {_price_text(close)}은 평균단가 {_price_text(average_price)} 대비 "
            f"{_percent_text(profit_loss_rate)}입니다. 손실허용 {risk_tolerance} 기준({band:.0f}%)에서는 {status_label}입니다."
        ),
        "actionLine": action,
        "checklist": [
            f"손실허용 기준 가격 {_price_text(stop_loss_price)}을 먼저 적어 둡니다.",
            f"보유기간 {holding_period} 기준으로 장중 대응인지 종가 확인인지 구분합니다.",
            weight_note,
        ],
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


def _adjust_decision_for_personal_context(decision: str, personal: dict[str, Any] | None) -> tuple[str, dict[str, Any]]:
    if not isinstance(personal, dict):
        return decision, {}

    status = _clean(personal.get("status"), "")
    status_label = _clean(personal.get("statusLabel"), "개인 조건")
    action_line = _clean(personal.get("actionLine"), "")
    profit_loss = _clean(personal.get("profitLossText"), "")
    average_price = _clean(personal.get("averagePriceText"), "")
    current_price = _clean(personal.get("currentPriceText"), "")

    if status in {"not_saved", ""}:
        return decision, {
            "applied": False,
            "sourceDecision": decision,
            "finalDecision": decision,
            "statusLabel": status_label,
            "summary": "포트폴리오 샌드박스에 담기 전이라 개인 평균단가와 손실허용 기준은 아직 반영되지 않았습니다.",
            "actionLine": action_line or "개인 조건 반영이 필요하면 샌드박스에 평균단가와 손실허용을 저장합니다.",
            "tone": "neutral",
        }

    if status == "loss_limit_exceeded":
        final_decision = "매도 검토"
        summary = (
            f"개인 조건상 {status_label}입니다. 현재 {current_price}, 평균단가 {average_price}, 손익 {profit_loss}라서 "
            "새 매수보다 손실 확대 방지 기준을 먼저 적용했습니다."
        )
        return final_decision, {
            "applied": decision != final_decision,
            "sourceDecision": decision,
            "finalDecision": final_decision,
            "statusLabel": status_label,
            "summary": summary,
            "actionLine": action_line,
            "tone": "negative",
        }

    if status == "loss_zone" and decision == "매수 검토":
        final_decision = "관망"
        summary = (
            f"개인 조건상 {status_label}입니다. 현재 손익 {profit_loss}라서 추가 매수보다 "
            "20일선 회복과 악재 해소 확인을 우선했습니다."
        )
        return final_decision, {
            "applied": True,
            "sourceDecision": decision,
            "finalDecision": final_decision,
            "statusLabel": status_label,
            "summary": summary,
            "actionLine": action_line,
            "tone": "negative",
        }

    if status == "profit_zone" and decision == "매수 검토":
        final_decision = "관망"
        summary = (
            f"개인 조건상 {status_label}입니다. 수익 구간에서는 새 매수보다 일부 수익 보호와 "
            "저항선 돌파 유지 여부를 먼저 보도록 조정했습니다."
        )
        return final_decision, {
            "applied": True,
            "sourceDecision": decision,
            "finalDecision": final_decision,
            "statusLabel": status_label,
            "summary": summary,
            "actionLine": action_line,
            "tone": "positive",
        }

    if status == "missing_average_price":
        summary = "평균단가가 없어 실제 손익 기준 조정은 제한됩니다. 차트와 뉴스 판단을 유지하되 리스크 문구를 보수적으로 표시합니다."
        return decision, {
            "applied": False,
            "sourceDecision": decision,
            "finalDecision": decision,
            "statusLabel": status_label,
            "summary": summary,
            "actionLine": action_line,
            "tone": "neutral",
        }

    return decision, {
        "applied": False,
        "sourceDecision": decision,
        "finalDecision": decision,
        "statusLabel": status_label,
        "summary": _clean(personal.get("summary"), "개인 조건은 확인됐지만 최종 판단을 바꿀 정도의 손익 신호는 아닙니다."),
        "actionLine": action_line,
        "tone": "neutral",
    }


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


def _decision_factor_breakdown(
    decision: str,
    score: int,
    ma20: dict[str, str],
    probabilities: dict[str, int],
    fundamentals: dict[str, Any],
    personal: dict[str, Any] | None = None,
) -> list[dict[str, str]]:
    position = _clean(ma20.get("position"), "")
    if position in {"above", "near"}:
        chart_state, chart_tone = "우호", "positive"
    elif position == "below":
        chart_state, chart_tone = "주의", "negative"
    else:
        chart_state, chart_tone = "보류", "neutral"

    if score >= 20:
        news_state, news_tone = "우호", "positive"
    elif score <= -20:
        news_state, news_tone = "주의", "negative"
    else:
        news_state, news_tone = "혼재", "neutral"

    up = _number(probabilities.get("up"), None)
    down = _number(probabilities.get("down"), None)
    if up is not None and down is not None and up >= down + 8:
        sentiment_state, sentiment_tone = "상승 우위", "positive"
    elif up is not None and down is not None and down >= up + 8:
        sentiment_state, sentiment_tone = "하락 주의", "negative"
    else:
        sentiment_state, sentiment_tone = "확인 필요", "neutral"

    finance_summary = _clean(fundamentals.get("summary"), "")
    if not finance_summary or any(token in finance_summary for token in ["없어", "비어", "확인"]):
        finance_state, finance_tone = "제한", "neutral"
    else:
        finance_state, finance_tone = "반영", "positive"

    factors = [
        {
            "label": "차트",
            "state": chart_state,
            "tone": chart_tone,
            "summary": f"현재가가 20일선 {ma20['ma20']} 기준 {ma20['positionLabel']}입니다.",
        },
        {
            "label": "재무",
            "state": finance_state,
            "tone": finance_tone,
            "summary": finance_summary or "재무 스냅샷이 제한적이라 차트와 뉴스 근거를 더 보수적으로 봅니다.",
        },
        {
            "label": "뉴스",
            "state": news_state,
            "tone": news_tone,
            "summary": f"뉴스/이벤트 점수는 {score}점입니다.",
        },
        {
            "label": "센티멘트",
            "state": sentiment_state,
            "tone": sentiment_tone,
            "summary": f"다음 거래일 참고 확률은 상승 {probabilities['up']}%, 하락 {probabilities['down']}%입니다.",
        },
    ]
    if isinstance(personal, dict):
        status = _clean(personal.get("status"), "")
        status_label = _clean(personal.get("statusLabel"), "개인 조건")
        if status in {"loss_limit_exceeded", "loss_zone"}:
            personal_tone = "negative"
        elif status == "profit_zone":
            personal_tone = "positive"
        else:
            personal_tone = "neutral"
        factors.append(
            {
                "label": "개인 조건",
                "state": status_label,
                "tone": personal_tone,
                "summary": _compact(personal.get("summary"), 110),
            }
        )
    return factors


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


def _headline_analysis_items(headlines: list[dict[str, Any]]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for headline in headlines[:6]:
        if not isinstance(headline, dict):
            continue
        title = _clean(headline.get("title") or headline.get("summary"), "")
        if not title:
            continue
        sentiment = _clean(headline.get("sentiment"), "").lower()
        if sentiment == "positive":
            effect = "상승에 우호적"
        elif sentiment == "negative":
            effect = "하락 위험"
        elif sentiment == "mixed":
            effect = "혼재"
        else:
            effect = "중립"
        rows.append(
            {
                "title": title,
                "sentiment": _label(sentiment),
                "effect": effect,
                "reason": _headline_factor_text(headline),
                "evidenceLevel": _clean(headline.get("evidenceLevel"), "제한적"),
            }
        )
    return rows[:4]


def _direction_scenarios(probabilities: dict[str, int], score: int, ma20: dict[str, str]) -> list[str]:
    up = probabilities.get("up", 0)
    down = probabilities.get("down", 0)
    flat = probabilities.get("flat", 0)
    if up >= down + 8:
        first = f"상승 우위 시나리오: 시초가 급등보다 20일선 {ma20['ma20']} 위에서 거래량이 붙는지 확인합니다."
    elif down >= up + 8:
        first = f"하락 우위 시나리오: 20일선 {ma20['ma20']} 재이탈과 악재성 뉴스 확산 여부를 먼저 봅니다."
    else:
        first = "중립 시나리오: 상승·하락 확률 차이가 작아 첫 30분 가격 반응을 확인한 뒤 판단합니다."
    return [
        first,
        f"확률 분포: 상승 {up}%, 하락 {down}%, 횡보 {flat}%로 계산했습니다.",
        f"뉴스·이벤트 보정 점수는 {score}점이며, 절대값이 작을수록 관망 비중이 커집니다.",
    ]


def _sentiment_action_guide(decision: str, probabilities: dict[str, int]) -> list[str]:
    up = probabilities.get("up", 0)
    down = probabilities.get("down", 0)
    if decision == "매수 검토":
        return [
            "바로 추격하지 말고 전일 고점 돌파 후 거래량 유지 여부를 확인합니다.",
            "상승 확률이 높아도 악재 헤드라인이 남아 있으면 분할 접근만 검토합니다.",
        ]
    if decision == "매도 검토":
        return [
            "보유 중이면 지지선 이탈 기준을 먼저 정하고 비중 축소 조건을 확인합니다.",
            "하락 확률이 높을 때는 반등보다 거래량 동반 하락 여부를 먼저 봅니다.",
        ]
    return [
        f"상승 {up}%·하락 {down}%처럼 한쪽 우위가 약하면 새 매수보다 관망이 우선입니다.",
        "뉴스 원문과 장중 거래량이 같은 방향으로 확인될 때만 다음 판단으로 넘어갑니다.",
    ]


def _beginner_coach_card(
    decision: str,
    score: int,
    ma20: dict[str, str],
    probabilities: dict[str, int],
    up_reasons: list[str],
    down_risks: list[str],
    personal_diagnostics: dict[str, str],
    fundamentals: dict[str, Any],
) -> dict[str, Any]:
    up = probabilities.get("up", 0)
    down = probabilities.get("down", 0)
    good_reason = _clean(
        up_reasons[0] if up_reasons else "",
        f"현재가는 {ma20['positionLabel']}이고 상승 참고 확률은 {up}%입니다. 거래량이 붙는지 확인해야 합니다.",
    )
    caution_reason = _clean(
        down_risks[0] if down_risks else "",
        f"하락 참고 확률은 {down}%입니다. 20일선 {ma20['ma20']} 이탈 여부를 먼저 확인해야 합니다.",
    )
    if decision == "매수 검토":
        next_action = f"관심 후보로 두되, 현재가가 20일선 {ma20['ma20']} 위에서 버티고 거래량이 늘 때만 분할 검토합니다."
        avoid_action = "시초가 급등이나 뉴스 제목만 보고 한 번에 크게 매수하지 않습니다."
    elif decision == "매도 검토":
        next_action = "보유 중이면 손절·비중 축소 기준을 먼저 정하고 지지선 이탈 여부를 확인합니다."
        avoid_action = "하락 확률이 높을 때 물타기로 평균단가만 낮추는 행동은 피합니다."
    else:
        next_action = "새 매수보다 다음 종가, 거래량, 뉴스 원문이 같은 방향인지 확인합니다."
        avoid_action = "근거가 엇갈릴 때 빨리 결론을 내리거나 확률만 보고 매수하지 않습니다."
    plain_summary = (
        f"초보자 기준 결론은 '{decision}'입니다. "
        f"뉴스·이벤트 점수 {score}점, 상승 {up}%·하락 {down}%라서 가격 반응 확인이 필요합니다."
    )
    checklist = [
        f"현재가가 20일선 {ma20['ma20']} 위에서 마감하는지 확인",
        "뉴스 원문과 공시가 실제 호재인지 확인",
        _clean(personal_diagnostics.get("actionLine"), "평균단가와 손실 허용선을 먼저 정합니다."),
    ]
    fundamental_point = _clean((fundamentals.get("points") or [""])[0], "")
    if fundamental_point:
        checklist.append(fundamental_point)
    return {
        "title": "초보자 AI 코치",
        "plainSummary": plain_summary,
        "goodReason": good_reason,
        "cautionReason": caution_reason,
        "nextAction": next_action,
        "avoidAction": avoid_action,
        "checklist": list(dict.fromkeys(checklist))[:3],
    }


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
    score_breakdown = _sentiment_score_breakdown(events, news_headlines, news_profile)
    score = score_breakdown["adjustedScore"]
    probabilities = _probabilities_from_score(score)
    ma20 = _ma20_context(req)
    position = ma20["position"]
    base_decision = _decision_from_inputs(score, position)
    decision_summary = req.currentDecisionSummary if isinstance(req.currentDecisionSummary, dict) else {}
    headlines = _headlines_from_context(events, news_headlines)
    headline_analysis = _headline_analysis_items(news_headlines)
    up_reasons, down_risks = _headline_reason_lists(news_headlines)
    portfolio_context = req.portfolioContext if isinstance(req.portfolioContext, dict) else None
    portfolio = _portfolio_guidance(portfolio_context)
    personal_diagnostics = _personal_position_diagnostics(req, portfolio_context)
    decision, personal_adjustment = _adjust_decision_for_personal_context(base_decision, personal_diagnostics)
    fundamentals = _fundamental_guidance(req.fundamentalSnapshot if isinstance(req.fundamentalSnapshot, dict) else None)
    summary_points = _summary_points(req.summary)
    fallback_reason = _friendly_llm_fallback_reason(llm_meta.get("fallbackReason"))
    decision_reason = _decision_reason(decision, score, ma20)
    report_comment = _after_market_comment(subject, decision, score, probabilities, summary_points)
    beginner_coach = _beginner_coach_card(
        decision,
        score,
        ma20,
        probabilities,
        up_reasons,
        down_risks,
        personal_diagnostics,
        fundamentals,
    )
    advice_summary = _clean(
        decision_summary.get("summary") if isinstance(decision_summary, dict) else "",
        decision_reason,
    )
    if personal_adjustment.get("applied"):
        advice_summary = f"{personal_adjustment['summary']} {advice_summary}"

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
            "summary": advice_summary,
            "personalRisk": personal_diagnostics,
            "personalAdjustment": personal_adjustment,
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
                personal_adjustment.get("summary", ""),
                personal_diagnostics["summary"],
                personal_diagnostics["actionLine"],
                portfolio["summary"],
                fundamentals["summary"],
            ][:4],
        },
        "decisionFactors": _decision_factor_breakdown(decision, score, ma20, probabilities, fundamentals, personal_diagnostics),
        "newsSentiment": {
            "title": "뉴스 감성 기반 단기 방향 예측",
            "score": score,
            "label": "긍정 우위" if score > 20 else "부정 우위" if score < -20 else "중립",
            "confidence": news_profile["quality"],
            "confidenceReason": (
                f"헤드라인 {news_profile['headlineCount']}건 중 원인 키워드가 {news_profile['factorCount']}개 확인됐고, "
                f"긍정 {news_profile['positiveCount']}건·부정 {news_profile['negativeCount']}건·복합 {news_profile['mixedCount']}건으로 분류했습니다."
            ),
            "evidenceQuality": (
                f"뉴스 {news_profile['headlineCount']}건, 긍정 {news_profile['positiveCount']}건, "
                f"부정 {news_profile['negativeCount']}건, 복합 {news_profile['mixedCount']}건 기준"
            ),
            "scoreBreakdown": score_breakdown,
            "nextTradingDay": probabilities,
            "summary": (
                f"최근 이벤트와 뉴스 후보를 보수적으로 보정하면 {score}점입니다. "
                f"상승 {probabilities['up']}%, 하락 {probabilities['down']}%, 횡보 {probabilities['flat']}%로 보고, "
                f"근거 품질은 {news_profile['quality']}입니다. 뉴스 원문과 장중 거래량으로 다시 검증해야 합니다."
            ),
            "headlineSignals": headlines or ["뉴스/공시 원문 후보가 부족합니다."],
            "headlineAnalyses": headline_analysis,
            "tradingScenarios": _direction_scenarios(probabilities, score, ma20),
            "actionGuide": _sentiment_action_guide(decision, probabilities),
            "upReasons": up_reasons or ["상승 쪽 근거는 차트와 거래량 반응으로 추가 확인이 필요합니다."],
            "downRisks": down_risks or ["하락 쪽 반대 근거가 부족해도 지지선 이탈 여부는 확인해야 합니다."],
            "llmContextLabel": "규칙형 점수 우선",
            "llmContextReason": fallback_reason or "Ollama 문맥 판단 전에는 이벤트 점수와 헤드라인 분류를 먼저 보여줍니다.",
            "llmContextEvidence": (headlines or news_profile["cautions"])[:2],
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
        "beginnerCoach": beginner_coach,
        "beginnerNotes": [
            "매수/관망/매도는 지시가 아니라 조건형 의견입니다.",
            "확률은 예측 보조이며 실제 수익을 보장하지 않습니다.",
            fundamentals["points"][0],
            "뉴스 제목만으로 판단하지 말고 가격과 거래량 반응을 같이 봅니다.",
        ],
        "limitations": [
            *([fallback_reason] if fallback_reason else []),
            "국내 뉴스 헤드라인은 이벤트 evidence 후보를 사용하며, 원문 수집 품질에 따라 정확도가 달라집니다.",
            "재무 데이터는 최신 공시와 데이터 제공 시점에 따라 달라질 수 있습니다.",
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
    "상승에 우호적|하락 위험|혼재|근거 약함",
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
    for key in ["stockAdvice", "newsSentiment", "afterMarketReport", "beginnerCoach"]:
        if isinstance(generated.get(key), dict):
            current = merged.get(key) if isinstance(merged.get(key), dict) else {}
            personal_applied = bool(
                key == "stockAdvice"
                and isinstance(current.get("personalAdjustment"), dict)
                and current.get("personalAdjustment", {}).get("applied")
            )
            next_value = {**current}
            for field, value in generated[key].items():
                if key == "newsSentiment" and field in {"score", "label", "nextTradingDay"}:
                    continue
                if key == "stockAdvice" and field == "personalRisk":
                    continue
                if key == "stockAdvice" and field == "personalAdjustment":
                    continue
                if key == "stockAdvice" and field == "decision" and personal_applied:
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


def _apply_ollama_context_fields(response: dict[str, Any], used_llm: bool) -> dict[str, Any]:
    sentiment = response.get("newsSentiment") if isinstance(response.get("newsSentiment"), dict) else {}
    if not sentiment:
        return response
    if used_llm:
        label = _clean(sentiment.get("llmContextLabel"), "")
        if not label or "규칙형" in label:
            score = _number(sentiment.get("score"), 0)
            label = "상승 문맥 우위" if score > 20 else "하락 문맥 주의" if score < -20 else "혼재 문맥"
            sentiment["llmContextLabel"] = label
        reason = _clean(sentiment.get("llmContextReason"), "")
        if not reason or "문맥 판단 전" in reason:
            reason = (
                _clean(sentiment.get("summary"), "")
                or _clean((sentiment.get("upReasons") or [""])[0], "")
                or _clean((sentiment.get("downRisks") or [""])[0], "")
                or "Ollama가 헤드라인과 이벤트 문장을 함께 읽어 문맥 판단을 보강했습니다."
            )
            sentiment["llmContextReason"] = _compact(reason, 160)
    elif not sentiment.get("llmContextLabel"):
        sentiment["llmContextLabel"] = "규칙형 점수 우선"
    if not sentiment.get("llmContextEvidence"):
        evidence = sentiment.get("headlineSignals") or sentiment.get("upReasons") or sentiment.get("downRisks") or []
        sentiment["llmContextEvidence"] = [_clean(item, "") for item in evidence[:2] if _clean(item, "")]
    response["newsSentiment"] = sentiment
    return response


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
        "fundamental-snapshot",
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
    seed: dict[str, Any] | None = None,
) -> list[dict[str, str]]:
    prompt_documents = _ollama_prompt_documents(documents)[:6]
    context = "\n".join(
        f"[{doc['id']}] {doc['type']} | {doc['title']} | {_compact(doc.get('text'), 140)}"
        for doc in prompt_documents
    )
    seed = seed if isinstance(seed, dict) else {}
    seed_advice = seed.get("stockAdvice") if isinstance(seed.get("stockAdvice"), dict) else {}
    seed_sentiment = seed.get("newsSentiment") if isinstance(seed.get("newsSentiment"), dict) else {}
    seed_report = seed.get("afterMarketReport") if isinstance(seed.get("afterMarketReport"), dict) else {}
    seed_coach = seed.get("beginnerCoach") if isinstance(seed.get("beginnerCoach"), dict) else {}
    seed_personal = seed_advice.get("personalAdjustment") if isinstance(seed_advice.get("personalAdjustment"), dict) else {}
    seed_probabilities = seed_sentiment.get("nextTradingDay") if isinstance(seed_sentiment.get("nextTradingDay"), dict) else {}
    seed_summary = "\n".join([
        f"초안 결정: {_clean(seed_advice.get('decision'), '관망')}",
        f"초안 이유: {_compact(seed_advice.get('summary'), 120)}",
        f"개인 조건 조정: {_clean(seed_personal.get('statusLabel'), '미적용')} / {_compact(seed_personal.get('summary'), 120)}",
        f"뉴스 점수/확률: {_clean(seed_sentiment.get('score'), '0')}점, 상승 {_clean(seed_probabilities.get('up'), '확인')}%, 하락 {_clean(seed_probabilities.get('down'), '확인')}%, 횡보 {_clean(seed_probabilities.get('flat'), '확인')}%",
        f"장후 분위기: {_clean(seed_report.get('mood'), '확인 필요')}",
        f"초보자 코치 초안: {_compact(seed_coach.get('plainSummary'), 120)}",
    ])
    system = (
        "너는 한국 주식 초보자를 위한 로컬 Ollama 투자 학습 보조자다. "
        "반드시 제공된 근거 안에서만 답하고 투자 지시, 수익 보장, 확정 표현을 금지한다. "
        "점수와 확률은 시스템 초안을 그대로 유지하고, 문장만 더 자연스럽게 다듬는다. "
        "'호재', '악재', '20일선' 같은 단어는 초보자가 이해할 수 있게 이유와 행동으로 풀어 쓴다. "
        "반드시 한국어 JSON 객체 하나만 반환하고, 각 배열은 최대 2개 항목으로 짧게 쓴다. "
        "마크다운, 코드블록, JSON 밖 설명은 쓰지 않는다."
    )
    user = f"""
대상: {subject}{f"({code})" if code else ""}
기준일: {basis_date}

시스템 초안:
{seed_summary}

근거:
{context or "제공된 근거가 없습니다."}

다음 JSON 스키마만 반환해라. score와 nextTradingDay는 초안 숫자를 그대로 써라.
{{
  "answer": "",
  "stockAdvice": {{
    "decision": "매수 검토|관망|매도 검토",
    "summary": "",
    "buyConditions": [],
    "watchConditions": [],
    "sellConditions": []
  }},
  "newsSentiment": {{
    "summary": "",
    "llmContextLabel": "상승에 우호적|하락 위험|혼재|근거 약함",
    "llmContextReason": "",
    "llmContextEvidence": [],
    "upReasons": [],
    "downRisks": [],
    "caution": "",
    "actionGuide": []
  }},
  "afterMarketReport": {{
    "llmComment": "",
    "nextWatch": []
  }},
  "beginnerCoach": {{
    "title": "초보자 AI 코치",
    "plainSummary": "",
    "goodReason": "",
    "cautionReason": "",
    "nextAction": "",
    "avoidAction": "",
    "checklist": []
  }},
  "beginnerNotes": [],
  "limitations": []
}}
빈 값에는 반드시 위 근거를 읽고 실제 한국어 문장을 채워라. 한 문장은 70자 이내로 써라.
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


def _first_leader(summary: dict[str, Any], key: str, fallback_key: str) -> dict[str, Any]:
    rows = summary.get(key) if isinstance(summary.get(key), list) else []
    for row in rows:
        if isinstance(row, dict) and _clean(row.get("name"), ""):
            return {
                "code": _clean(row.get("code"), ""),
                "name": _clean(row.get("name"), ""),
                "rate": _number(row.get("rate"), None),
            }
    fallback = _clean(summary.get(fallback_key), "")
    return {"code": "", "name": fallback, "rate": None} if fallback and fallback != "-" else {}


def _market_dashboard(summary: dict[str, Any], mood: str, market_bias: str) -> dict[str, Any]:
    top_gainer = _first_leader(summary, "topGainers", "topGainer")
    top_loser = _first_leader(summary, "topLosers", "topLoser")
    kospi_top = _first_leader(summary, "kospiTopGainers", "kospiTopGainer")
    kosdaq_top = _first_leader(summary, "kosdaqTopGainers", "kosdaqTopGainer")
    kospi_drop = _first_leader(summary, "kospiTopLosers", "kospiTopLoser")
    kosdaq_drop = _first_leader(summary, "kosdaqTopLosers", "kosdaqTopLoser")
    return {
        "basisDate": _clean(summary.get("effectiveDate") or summary.get("date"), ""),
        "mood": mood,
        "marketBias": market_bias,
        "topGainer": top_gainer,
        "topLoser": top_loser,
        "kospiTopGainer": kospi_top,
        "kospiTopLoser": kospi_drop,
        "kosdaqTopGainer": kosdaq_top,
        "kosdaqTopLoser": kosdaq_drop,
        "mostMentioned": _clean(summary.get("mostMentioned"), ""),
        "dataNote": _clean(summary.get("rankingWarning"), "") or _clean(summary.get("verification", {}).get("verificationLimitations") if isinstance(summary.get("verification"), dict) else "", ""),
    }


def _leader_summary_items(summary: dict[str, Any]) -> list[dict[str, Any]]:
    explanations = summary.get("leaderExplanations") if isinstance(summary.get("leaderExplanations"), dict) else {}
    top_gainer = _first_leader(summary, "topGainers", "topGainer")
    top_loser = _first_leader(summary, "topLosers", "topLoser")
    rows: list[dict[str, Any]] = []
    if top_gainer:
        explanation = explanations.get("topGainer") if isinstance(explanations.get("topGainer"), dict) else {}
        rows.append(
            {
                "type": "상승 리더",
                "name": top_gainer.get("name", ""),
                "rate": top_gainer.get("rate"),
                "summary": _clean(explanation.get("summary"), "상승률 1위는 다음 거래일 거래량 유지 여부를 먼저 확인해야 합니다."),
                "watch": "급등 후 바로 추격하지 말고 눌림과 거래대금 유지 여부를 확인합니다.",
            }
        )
    if top_loser:
        explanation = explanations.get("topLoser") if isinstance(explanations.get("topLoser"), dict) else {}
        rows.append(
            {
                "type": "하락 리더",
                "name": top_loser.get("name", ""),
                "rate": top_loser.get("rate"),
                "summary": _clean(explanation.get("summary"), "하락률 1위는 악재 원인과 지지선 이탈 여부를 먼저 확인해야 합니다."),
                "watch": "반등 기대보다 하락 원인, 공시, 거래량 급증 여부를 먼저 확인합니다.",
            }
        )
    return rows[:2]


def _after_market_action_plan(mood: str, market_bias: str, dashboard: dict[str, Any]) -> list[str]:
    top_gainer = dashboard.get("topGainer", {}) if isinstance(dashboard.get("topGainer"), dict) else {}
    top_loser = dashboard.get("topLoser", {}) if isinstance(dashboard.get("topLoser"), dict) else {}
    gainer_name = _clean(top_gainer.get("name"), "상승 1위")
    loser_name = _clean(top_loser.get("name"), "하락 1위")
    if "위험" in mood or "방어" in market_bias:
        return [
            f"{loser_name}처럼 급락한 종목의 공시·뉴스 원인을 먼저 확인합니다.",
            "보유 종목은 20일선과 전저점 이탈 기준을 장 시작 전에 정합니다.",
            f"{gainer_name} 같은 급등 후보는 추격보다 거래대금 유지와 눌림을 기다립니다.",
        ]
    if "관심" in mood or "확대" in market_bias:
        return [
            f"{gainer_name}의 상승 원인이 시장 전체로 확산되는지 확인합니다.",
            "관심 종목은 전일 고점 돌파와 거래량 증가가 같이 나올 때만 검토합니다.",
            f"{loser_name} 같은 약세 후보가 지수에 부담을 주는지 함께 봅니다.",
        ]
    return [
        "시초가 방향이 엇갈리면 첫 30분 거래대금 상위 종목부터 확인합니다.",
        f"{gainer_name}과 {loser_name}의 원인을 비교해 시장이 테마장인지 개별 이슈장인지 구분합니다.",
        "관심 종목은 20일선 위 종가 유지와 거래량 회복을 동시에 확인합니다.",
    ]


def _session_brief(mood: str, dashboard: dict[str, Any]) -> str:
    top_gainer = dashboard.get("topGainer", {}) if isinstance(dashboard.get("topGainer"), dict) else {}
    top_loser = dashboard.get("topLoser", {}) if isinstance(dashboard.get("topLoser"), dict) else {}
    gainer = _clean(top_gainer.get("name"), "상승 후보")
    loser = _clean(top_loser.get("name"), "하락 후보")
    gainer_rate = _percent_text(top_gainer.get("rate"))
    loser_rate = _percent_text(top_loser.get("rate"))
    return f"장후 분위기는 {mood}입니다. 상승 쪽은 {gainer}({gainer_rate}), 하락 쪽은 {loser}({loser_rate})를 기준으로 다음 거래일 강약을 비교합니다."


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

    fallback_reason = _friendly_llm_fallback_reason(llm_meta.get("fallbackReason"))
    dashboard = _market_dashboard(summary, mood, market_bias)
    action_plan = _after_market_action_plan(mood, market_bias, dashboard)
    leader_summaries = _leader_summary_items(summary)
    session_brief = _session_brief(mood, dashboard)

    return {
        "mode": "ollama_fallback_rule_based",
        "schemaVersion": 2,
        "provider": "ollama",
        "model": _clean(llm_meta.get("model"), ""),
        "basisDate": basis_date,
        "title": "매일 장후 시장 요약 리포트",
        "mood": mood,
        "marketBias": market_bias,
        "sessionBrief": session_brief,
        "marketDashboard": dashboard,
        "leaderSummaries": leader_summaries,
        "keyPoints": points[:4],
        "llmComment": comment,
        "nextWatch": [_clean(item, "") for item in next_watch[:4] if _clean(item, "")],
        "actionPlan": action_plan,
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


def _build_after_market_report_prompt(
    summary: dict[str, Any],
    basis_date: str,
    memory_documents: list[dict[str, str]] | None = None,
) -> list[dict[str, str]]:
    memory_context = "\n".join(
        f"[{doc['id']}] {doc['title']} | {_compact(doc.get('text'), 220)}"
        for doc in (memory_documents or [])
        if str(doc.get("id", "")).startswith("qdrant-memory-")
    )
    system = (
        "너는 한국 주식 초보자를 위한 장후 시장 요약 리포트 작성자다. "
        "반드시 제공된 저장 브리프만 근거로 쓰고 투자 지시, 수익 보장, 확정 표현을 금지한다. "
        "한국어 JSON 객체 하나만 반환한다. 문장은 친근하지만 과장 없이 짧게 쓴다."
    )
    user = f"""
기준일: {basis_date}

저장 브리프:
{json.dumps(summary, ensure_ascii=False, default=str)[:5000]}

Qdrant 유사 근거:
{memory_context or "아직 누적된 유사 근거가 없습니다."}

다음 JSON 스키마를 지켜서 반환해라.
{{
  "mood": "관심 확대|선별 접근|방어 우선|휴장",
  "marketBias": "관심 확대|중립|방어 우선",
  "keyPoints": [],
  "llmComment": "",
  "nextWatch": [],
  "actionPlan": [],
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
    for field in ["keyPoints", "nextWatch", "actionPlan", "beginnerNotes", "limitations"]:
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
    seed: dict[str, Any] | None = None,
) -> list[dict[str, str]]:
    prompt_documents = _ollama_prompt_documents(documents)[:8]
    context = "\n".join(
        f"[{doc['id']}] {doc['type']} | {doc['title']} | {_compact(doc.get('text'), 180)}"
        for doc in prompt_documents
    )
    seed = seed if isinstance(seed, dict) else {}
    seed_advice = seed.get("stockAdvice") if isinstance(seed.get("stockAdvice"), dict) else {}
    seed_sentiment = seed.get("newsSentiment") if isinstance(seed.get("newsSentiment"), dict) else {}
    seed_report = seed.get("afterMarketReport") if isinstance(seed.get("afterMarketReport"), dict) else {}
    seed_probabilities = seed_sentiment.get("nextTradingDay") if isinstance(seed_sentiment.get("nextTradingDay"), dict) else {}
    seed_lines = "\n".join([
        f"초안 결론: {_clean(seed_advice.get('decision'), '관망')}",
        f"초안 이유: {_compact(seed_advice.get('summary'), 140)}",
        f"뉴스 점수와 확률: {_clean(seed_sentiment.get('score'), '0')}점, 상승 {_clean(seed_probabilities.get('up'), '확인')}%, 하락 {_clean(seed_probabilities.get('down'), '확인')}%",
        f"장후 분위기: {_clean(seed_report.get('mood'), '확인 필요')}",
    ])
    system = (
        "너는 한국 주식 초보자를 위한 로컬 Ollama 상담 보조자다. "
        "제공된 근거만 사용하고 수익 보장이나 매수/매도 지시는 금지한다. "
        "답변은 750자 이내의 쉬운 한국어로 쓴다. "
        "첫 문장은 반드시 초안 결론을 사용해 '결론: 매수 검토/관망/매도 검토입니다.'처럼 구체적으로 시작한다. "
        "마크다운 제목이나 굵게 표시는 쓰지 않는다."
    )
    user = f"""
질문: {_clean(req.question, "이 종목 지금 사도 되나요?")}
대상: {subject}{f"({code})" if code else ""}
분석 범위: {topic_type}
기준일: {basis_date}

시스템 초안:
{seed_lines}

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
    documents, qdrant_meta = _augment_with_qdrant_documents(
        req,
        documents,
        subject,
        code,
        _clean(req.topicType, "stock"),
        basis_date,
    )
    seed = _fallback_ollama_insights(req, subject, code, basis_date, documents, _ollama_config_meta())
    llm_answer, llm_meta = _call_ollama_llm(
        _build_ollama_insights_prompt(req, subject, code, basis_date, documents, seed),
        json_mode=True,
    )
    fallback = _fallback_ollama_insights(req, subject, code, basis_date, documents, llm_meta)
    generated = _json_object_from_text(llm_answer or "")
    response = _merge_insight_dict(fallback, generated)
    used_llm = bool(llm_answer)
    response = _apply_ollama_context_fields(response, used_llm)
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
    response["retrieval"]["qdrant"] = qdrant_meta
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
    subject = "장후 시장 요약 리포트"
    retrieval_documents = [{
        "id": "latest-daily-summary",
        "type": "daily_summary",
        "title": "최신 저장 브리프",
        "basisDate": basis_date,
        "text": _compact(summary, 1400),
    }]
    retrieval_documents, qdrant_meta = _augment_with_qdrant_documents(
        req,
        retrieval_documents,
        subject,
        "",
        "after_market_report",
        basis_date,
        query_text=f"{basis_date} 장후 시장 요약 {summary.get('topGainer', '')} {summary.get('topLoser', '')} {summary.get('mostMentioned', '')}",
    )
    llm_answer, llm_meta = _call_ollama_llm(
        _build_after_market_report_prompt(summary, basis_date, retrieval_documents),
        json_mode=True,
    )
    fallback = _after_market_report_fallback(summary, basis_date, llm_meta)
    generated = _json_object_from_text(llm_answer or "")
    response = _merge_after_market_report(fallback, generated)
    used_llm = bool(llm_answer)
    response["mode"] = "ollama_llm" if used_llm else "ollama_fallback_rule_based"
    response["retrieval"]["llm"] = {**llm_meta, "used": used_llm}
    response["retrieval"]["documents"] = retrieval_documents
    response["retrieval"]["sourceCount"] = len(retrieval_documents)
    response["retrieval"]["qdrant"] = qdrant_meta
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
    retrieval_documents, qdrant_meta = _augment_with_qdrant_documents(
        req,
        retrieval_documents,
        subject,
        code,
        topic_type,
        basis_date,
    )
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

    portfolio_context = req.portfolioContext if isinstance(req.portfolioContext, dict) else None
    portfolio = _portfolio_guidance(portfolio_context)
    personal_diagnostics = _personal_position_diagnostics(req, portfolio_context)
    answer_parts += [
        "",
        "포트폴리오 맥락",
        f"- {portfolio['summary']}",
        f"- {personal_diagnostics['summary']}",
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
    if qdrant_meta.get("retrievedCount"):
        sources.append({"title": "Qdrant 벡터 검색 근거", "type": "qdrant_memory", "url": "/collections/kr_stock_ai_memory"})

    status = _llm_status()
    ollama_seed = (
        _fallback_ollama_insights(req, subject, code, basis_date, retrieval_documents, _ollama_config_meta())
        if status["provider"] == "ollama"
        else None
    )
    prompt = (
        _build_ollama_chat_prompt(req, subject, code, topic_type, basis_date, retrieval_documents, ollama_seed)
        if status["provider"] == "ollama"
        else _build_llm_prompt(req, subject, code, topic_type, basis_date, retrieval_documents)
    )
    llm_answer, llm_meta = _call_configured_llm(prompt)
    used_llm = bool(llm_answer)

    limitations = [
        "투자 지시가 아니라 교육용 분석 보조입니다.",
        "평균단가, 보유기간, 손실 허용 범위는 포트폴리오 샌드박스에 저장된 값이 있을 때만 반영합니다.",
        "실제 보유 수량과 계좌 정보는 저장하거나 반영하지 않습니다.",
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
            "qdrant": qdrant_meta,
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
