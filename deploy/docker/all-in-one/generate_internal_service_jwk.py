#!/usr/bin/env python3
import base64
import json
import subprocess
import sys


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def run_openssl(args: list[str]) -> bytes:
    result = subprocess.run(
        ["openssl", *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode("utf-8", errors="replace").strip())
    return result.stdout


def load_ec_components(private_key_path: str) -> tuple[bytes, bytes, bytes]:
    output = run_openssl(["ec", "-in", private_key_path, "-text", "-noout"]).decode(
        "utf-8",
        errors="replace",
    )
    lines = output.splitlines()

    section_labels = {
        "priv:",
        "pub:",
        "ASN1 OID:",
        "NIST CURVE:",
        "Private-Key:",
        "read EC key",
    }

    def collect_hex_block(start_label: str) -> str:
        collecting = False
        chunks: list[str] = []
        for line in lines:
            stripped = line.strip()
            if stripped.startswith(start_label):
                collecting = True
                tail = stripped[len(start_label) :].strip()
                if tail:
                    chunks.append(tail.replace(":", ""))
                continue
            if collecting:
                if stripped in section_labels or any(
                    stripped.startswith(label)
                    for label in section_labels
                    if label != start_label
                ):
                    break
                chunks.append(stripped.replace(":", ""))
        return "".join(chunks)

    priv_hex = collect_hex_block("priv:")
    pub_hex = collect_hex_block("pub:")
    if pub_hex.startswith("04"):
        pub_hex = pub_hex[2:]

    if not priv_hex or len(pub_hex) != 128:
        raise RuntimeError("unable to parse EC key material from openssl output")

    x_hex = pub_hex[:64]
    y_hex = pub_hex[64:]
    return bytes.fromhex(priv_hex), bytes.fromhex(x_hex), bytes.fromhex(y_hex)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: generate_internal_service_jwk.py <ec-private-pem>", file=sys.stderr)
        return 1

    private_key_path = sys.argv[1]
    d_bytes, x_bytes, y_bytes = load_ec_components(private_key_path)

    jwk = {
        "kty": "EC",
        "kid": "internal-service-1",
        "use": "sig",
        "alg": "ES256",
        "crv": "P-256",
        "x": b64url(x_bytes),
        "y": b64url(y_bytes),
        "d": b64url(d_bytes),
    }

    print("INTERNAL_SERVICE_JWT_PRIVATE_JWK=" + json.dumps(jwk, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
