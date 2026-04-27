#!/usr/bin/env python3
import base64
import json
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def run_openssl(args: list[str], stdin: bytes | None = None) -> bytes:
    result = subprocess.run(
        ["openssl", *args],
        input=stdin,
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


def der_read_length(data: bytes, offset: int) -> tuple[int, int]:
    first = data[offset]
    offset += 1
    if first < 0x80:
        return first, offset
    count = first & 0x7F
    length = int.from_bytes(data[offset : offset + count], "big")
    return length, offset + count


def decode_dss_signature(der_sig: bytes) -> tuple[int, int]:
    offset = 0
    if der_sig[offset] != 0x30:
        raise RuntimeError("invalid DER signature sequence")
    offset += 1
    _, offset = der_read_length(der_sig, offset)

    if der_sig[offset] != 0x02:
        raise RuntimeError("invalid DER signature integer (r)")
    offset += 1
    r_len, offset = der_read_length(der_sig, offset)
    r = int.from_bytes(der_sig[offset : offset + r_len], "big")
    offset += r_len

    if der_sig[offset] != 0x02:
        raise RuntimeError("invalid DER signature integer (s)")
    offset += 1
    s_len, offset = der_read_length(der_sig, offset)
    s = int.from_bytes(der_sig[offset : offset + s_len], "big")
    return r, s


def sign_es256_jwt(private_key_path: str, kid: str, role: str) -> str:
    header = {"alg": "ES256", "typ": "JWT", "kid": kid}
    iat = int(time.time())
    exp = iat + 5 * 365 * 24 * 3600
    payload = {"role": role, "iss": "supabase", "iat": iat, "exp": exp}
    header_b64 = b64url(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")

    with tempfile.NamedTemporaryFile() as input_file, tempfile.NamedTemporaryFile() as sig_file:
        input_file.write(signing_input)
        input_file.flush()
        run_openssl(
            ["dgst", "-sha256", "-sign", private_key_path, "-out", sig_file.name, input_file.name]
        )
        der_sig = Path(sig_file.name).read_bytes()

    r, s = decode_dss_signature(der_sig)
    raw_sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return f"{header_b64}.{payload_b64}.{b64url(raw_sig)}"


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: generate_auth_keys.py <ec-private-pem> <jwt-secret>", file=sys.stderr)
        return 1

    private_key_path = sys.argv[1]
    jwt_secret = sys.argv[2]
    kid = str(uuid.uuid4())

    d_bytes, x_bytes, y_bytes = load_ec_components(private_key_path)

    jwt_keys = [
        {
            "kty": "EC",
            "kid": kid,
            "use": "sig",
            "key_ops": ["sign", "verify"],
            "alg": "ES256",
            "ext": True,
            "crv": "P-256",
            "x": b64url(x_bytes),
            "y": b64url(y_bytes),
            "d": b64url(d_bytes),
        },
        {
            "kty": "oct",
            "k": b64url(jwt_secret.encode("utf-8")),
            "alg": "HS256",
        },
    ]

    print("GOTRUE_JWT_KEYS=" + json.dumps(jwt_keys, separators=(",", ":")))
    print("GOTRUE_ANON_KEY=" + sign_es256_jwt(private_key_path, kid, "anon"))
    print("GOTRUE_SERVICE_ROLE_KEY=" + sign_es256_jwt(private_key_path, kid, "service_role"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
