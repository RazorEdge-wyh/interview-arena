#!/usr/bin/env python3
"""Generate an RSA key pair for Interview Arena report encryption.

- Public key  -> public_key.json  (JWK, RSA-OAEP/SHA-256, safe to commit)
- Private key -> a path you choose OUTSIDE the repo (PEM, never commit)

Usage:
  python tools/gen_keys.py --out-public public_key.json --out-private ../_keys/interview_report_private.pem
"""
from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


def b64u(n: int) -> str:
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate RSA key pair for report encryption")
    ap.add_argument("--out-public", default="public_key.json")
    ap.add_argument("--out-private", required=True)
    ap.add_argument("--bits", type=int, default=2048)
    args = ap.parse_args()

    key = rsa.generate_private_key(public_exponent=65537, key_size=args.bits)
    pub = key.public_key().public_numbers()

    jwk = {
        "kty": "RSA",
        "n": b64u(pub.n),
        "e": b64u(pub.e),
        "alg": "RSA-OAEP-256",
        "ext": True,
        "key_ops": ["encrypt"],
    }
    pub_path = Path(args.out_public)
    pub_path.write_text(json.dumps(jwk, indent=2) + "\n", encoding="utf-8")

    priv_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    priv_path = Path(args.out_private)
    priv_path.parent.mkdir(parents=True, exist_ok=True)
    priv_path.write_bytes(priv_pem)
    try:
        os.chmod(priv_path, 0o600)
    except Exception:
        pass

    print(f"public  -> {pub_path.resolve()}")
    print(f"private -> {priv_path.resolve()}  (keep secret, never commit)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
