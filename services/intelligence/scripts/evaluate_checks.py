# ruff: noqa: E402
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import UTC, datetime, timedelta
from json import JSONDecodeError
from pathlib import Path
from urllib import request
from urllib.error import HTTPError, URLError
from uuid import uuid4

import jwt

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DEFAULT_CASES_PATH = Path("evaluation/npm_sanity_cases.json")
DEFAULT_BEARER_TOKEN_ENV = "INTELLIGENCE_BEARER_TOKEN"
DEFAULT_TOKEN_AUDIENCE = "customs-intelligence-rpc"
DEFAULT_TOKEN_SERVICE = "api"
DEFAULT_TOKEN_SUBJECT = "api:intelligence-evaluate-checks"
DEFAULT_TOKEN_TYPE = "api_connector"
DEFAULT_TOKEN_TTL_SECONDS = 900
DEFAULT_TOKEN_TENANT_ID = "00000000-0000-0000-0000-000000000000"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run /check evaluation cases.")
    parser.add_argument(
        "--base-url",
        required=True,
        help=(
            "Base URL for the intelligence service, for example "
            "'http://localhost:8001' or 'http://intelligence:8001'."
        ),
    )
    parser.add_argument("--cases-path", default=str(DEFAULT_CASES_PATH))
    parser.add_argument("--output-json", default="")
    parser.add_argument(
        "--bearer-token-env",
        default=DEFAULT_BEARER_TOKEN_ENV,
        help=(
            "Environment variable that contains the bearer token used for "
            "authenticated /check calls."
        ),
    )
    parser.add_argument(
        "--allow-auto-mint",
        action=argparse.BooleanOptionalAction,
        default=True,
        help=(
            "If the bearer token env var is absent, mint a test token from "
            "environment config instead of failing immediately."
        ),
    )
    return parser


def load_cases(path: Path) -> list[dict[str, str]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("evaluation cases must be a JSON array")
    return [dict(item) for item in payload]


def resolve_bearer_token(
    *,
    bearer_token_env: str,
    allow_auto_mint: bool,
) -> str:
    existing = os.getenv(bearer_token_env, "").strip()
    if existing:
        return existing

    if not allow_auto_mint:
        raise RuntimeError(
            "missing bearer token environment variable "
            f"{bearer_token_env}"
        )

    return mint_test_token_from_env()


def mint_test_token_from_env() -> str:
    required_env = {
        "INTERNAL_SERVICE_JWT_PRIVATE_JWK": os.getenv(
            "INTERNAL_SERVICE_JWT_PRIVATE_JWK", ""
        ).strip(),
    }
    missing = [name for name, value in required_env.items() if not value]
    if missing:
        raise RuntimeError(
            "auto-mint requested but required env vars are missing: "
            + ", ".join(missing)
        )

    try:
        raw_jwk = json.loads(required_env["INTERNAL_SERVICE_JWT_PRIVATE_JWK"])
    except JSONDecodeError as exc:
        raise RuntimeError(
            "INTERNAL_SERVICE_JWT_PRIVATE_JWK is not valid JSON; "
            "set it to a single JSON object string"
        ) from exc
    private_jwk = select_signing_jwk(raw_jwk)
    algorithm = resolve_jwk_algorithm(private_jwk)
    signing_key = jwt.algorithms.get_default_algorithms()[algorithm].from_jwk(
        json.dumps(private_jwk)
    )
    now = datetime.now(tz=UTC)
    ttl_seconds = int(
        os.getenv(
            "INTELLIGENCE_TEST_TOKEN_TTL_SECONDS",
            str(DEFAULT_TOKEN_TTL_SECONDS),
        )
    )
    expires_at = now + timedelta(seconds=ttl_seconds)
    audience = os.getenv(
        "INTELLIGENCE_TEST_TOKEN_AUDIENCE",
        DEFAULT_TOKEN_AUDIENCE,
    ).strip()
    subject = os.getenv(
        "INTELLIGENCE_TEST_TOKEN_SUBJECT",
        DEFAULT_TOKEN_SUBJECT,
    ).strip()
    service = os.getenv(
        "INTELLIGENCE_TEST_TOKEN_SERVICE",
        DEFAULT_TOKEN_SERVICE,
    ).strip()
    token_type = os.getenv(
        "INTELLIGENCE_TEST_TOKEN_TYPE",
        DEFAULT_TOKEN_TYPE,
    ).strip()
    tenant_id = os.getenv(
        "INTELLIGENCE_TEST_TOKEN_TENANT_ID",
        DEFAULT_TOKEN_TENANT_ID,
    ).strip()
    key_id = os.getenv("INTERNAL_SERVICE_JWT_KEY_ID", "internal-service-1").strip()

    payload = {
        "iss": "customs-control-plane",
        "sub": subject,
        "aud": audience,
        "service": service,
        "token_type": token_type,
        "tenant_id": tenant_id,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": str(uuid4()),
    }
    project_id = os.getenv("INTELLIGENCE_TEST_TOKEN_PROJECT_ID", "").strip()
    if project_id:
        payload["project_id"] = project_id

    token = jwt.encode(
        payload,
        key=signing_key,
        algorithm=algorithm,
        headers={"kid": key_id},
    )
    print(
        "info: minted intelligence test bearer token from environment config",
        file=sys.stderr,
    )
    return token


def resolve_jwk_algorithm(jwk: dict[str, object]) -> str:
    algorithm = jwk.get("alg")
    if isinstance(algorithm, str) and algorithm:
        return algorithm
    key_type = jwk.get("kty")
    if key_type == "RSA":
        return "RS256"
    if key_type == "EC":
        return "ES256"
    if key_type == "OKP":
        return "EdDSA"
    raise RuntimeError("unsupported INTERNAL_SERVICE_JWT_PRIVATE_JWK key type")


def select_signing_jwk(raw_jwk: object) -> dict[str, object]:
    if isinstance(raw_jwk, dict):
        return raw_jwk
    if isinstance(raw_jwk, list):
        for item in raw_jwk:
            if not isinstance(item, dict):
                continue
            if item.get("use") not in (None, "sig"):
                continue
            key_ops = item.get("key_ops")
            if isinstance(key_ops, list) and "sign" not in key_ops:
                continue
            if "d" in item or item.get("kty") == "oct":
                return item
        raise RuntimeError(
            "INTERNAL_SERVICE_JWT_PRIVATE_JWK JSON array does not contain "
            "a usable signing key"
        )
    raise RuntimeError(
        "INTERNAL_SERVICE_JWT_PRIVATE_JWK must be a JSON object or array of JWKs"
    )


def run_case(
    base_url: str,
    bearer_token: str,
    case: dict[str, str],
) -> dict[str, object]:
    body = json.dumps(
        {
            "ecosystem": case["ecosystem"],
            "package": case["package"],
            "description": case.get("description"),
        }
    ).encode("utf-8")
    req = request.Request(
        f"{base_url}/check",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {bearer_token}",
        },
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=30.0) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"/check request failed with HTTP {exc.code}: {detail}"
        ) from exc
    except URLError as exc:
        raise RuntimeError(
            f"failed to reach intelligence service at {base_url}: {exc.reason}"
        ) from exc
    metadata = result.get("metadata") or {}
    stage_timings = metadata.get("stage_timings_ms") or {}
    return {
        "label": case["label"],
        "package": case["package"],
        "expected": case.get("expected"),
        "nearest_match": result.get("nearest_match"),
        "match_quality": result.get("match_quality"),
        "recommended_action": result.get("recommended_action"),
        "semantic_score": metadata.get("similarity_score"),
        "lexical_score": metadata.get("lexical_similarity_score"),
        "candidate_source_rank": metadata.get("candidate_source_rank"),
        "candidate_score_final": metadata.get("candidate_score_final"),
        "candidate_trust": metadata.get("candidate_trust"),
        "adjacent_name_found_in_corpus": metadata.get(
            "adjacent_name_found_in_corpus"
        ),
        "exact_match_lookup_ms": stage_timings.get("exact_match_lookup"),
        "embed_query_ms": stage_timings.get("embed_query"),
        "candidate_search_ms": stage_timings.get("candidate_search"),
        "judge_ms": stage_timings.get("judge"),
        "judge_cache_hit": metadata.get("judge_cache_hit"),
        "is_suspicious": result.get("is_suspicious"),
        "confidence": result.get("confidence"),
        "source": result.get("source"),
        "latency_ms": result.get("latency_ms"),
    }


def print_table(rows: list[dict[str, object]]) -> None:
    headers = [
        "label",
        "expected",
        "package",
        "nearest_match",
        "match_quality",
        "recommended_action",
        "semantic_score",
        "lexical_score",
        "candidate_source_rank",
        "candidate_score_final",
        "candidate_trust",
        "adjacent_name_found_in_corpus",
        "exact_match_lookup_ms",
        "embed_query_ms",
        "candidate_search_ms",
        "judge_ms",
        "judge_cache_hit",
        "is_suspicious",
        "confidence",
        "source",
        "latency_ms",
    ]
    print("| " + " | ".join(headers) + " |")
    print("|" + "|".join("---" for _ in headers) + "|")
    for row in rows:
        values = []
        for header in headers:
            value = row.get(header)
            if isinstance(value, float):
                values.append(f"{value:.6f}")
            else:
                values.append(str(value))
        print("| " + " | ".join(values) + " |")


def main() -> int:
    args = build_parser().parse_args()
    try:
        bearer_token = resolve_bearer_token(
            bearer_token_env=args.bearer_token_env,
            allow_auto_mint=args.allow_auto_mint,
        )
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        print(
            "hint: either export "
            f"{args.bearer_token_env}=<token> or set "
            "INTERNAL_SERVICE_JWT_PRIVATE_JWK for auto-minting",
            file=sys.stderr,
        )
        return 2
    cases = load_cases(Path(args.cases_path))
    rows = [run_case(args.base_url, bearer_token, case) for case in cases]
    print_table(rows)
    if args.output_json:
        Path(args.output_json).write_text(
            json.dumps(rows, indent=2),
            encoding="utf-8",
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
