#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse


def toml_string(value):
    return json.dumps(str(value))


def read_toml_string(text, key):
    match = re.search(rf'^{re.escape(key)}\s*=\s*("(?:\\.|[^"])*")', text, re.M)
    if not match:
        return ""
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return ""


def set_top_level(text, key, value):
    pattern = re.compile(rf'^{re.escape(key)}\s*=\s*.*$', re.M)
    line = f"{key} = {toml_string(value)}"
    return pattern.sub(line, text, count=1) if pattern.search(text) else f"{line}\n{text}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--wire-api", choices=["responses", "chat"], default="responses")
    parser.add_argument("--api-key-stdin", action="store_true")
    parser.add_argument("--api-key-env", default="CODEX_NEW_API_KEY")
    args = parser.parse_args()

    parsed = urlparse(args.base_url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username or parsed.password:
        raise SystemExit("API 地址必须是有效的 HTTP/HTTPS URL")
    model = args.model.strip()
    if not model or any(char in model for char in '"\r\n'):
        raise SystemExit("模型名称无效")

    home = Path(os.environ.get("CODEX_HOME", "/root/.codex"))
    home.mkdir(parents=True, exist_ok=True)
    config_path = home / "config.toml"
    auth_path = home / "auth.json"
    text = config_path.read_text() if config_path.exists() else ""
    provider_id = read_toml_string(text, "model_provider") or "custom"

    text = set_top_level(text, "model_provider", provider_id)
    text = set_top_level(text, "model", model)
    section = "\n".join(
        [
            f"[model_providers.{provider_id}]",
            'name = "Managed API"',
            f"base_url = {toml_string(args.base_url.rstrip('/'))}",
            f"wire_api = {toml_string(args.wire_api)}",
            "requires_openai_auth = true",
            "",
        ]
    )
    section_pattern = re.compile(
        rf'^\[model_providers\.{re.escape(provider_id)}\]\s*$[\s\S]*?(?=^\[|\s*$)',
        re.M,
    )
    text = section_pattern.sub(section, text, count=1) if section_pattern.search(text) else f"{text.rstrip()}\n\n{section}"
    config_path.write_text(text.rstrip() + "\n")
    os.chmod(config_path, 0o600)

    api_key = sys.stdin.read().strip() if args.api_key_stdin else os.environ.get(args.api_key_env, "").strip()
    if api_key:
        auth_path.write_text(json.dumps({"OPENAI_API_KEY": api_key}) + "\n")
        os.chmod(auth_path, 0o600)

    saved_key = ""
    if auth_path.exists():
        try:
            saved_key = json.loads(auth_path.read_text()).get("OPENAI_API_KEY", "")
        except (json.JSONDecodeError, OSError):
            saved_key = ""

    print(
        json.dumps(
            {
                "providerId": provider_id,
                "model": model,
                "baseUrl": args.base_url.rstrip("/"),
                "wireApi": args.wire_api,
                "hasApiKey": bool(saved_key),
                "apiKeySuffix": saved_key[-4:] if saved_key else "",
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
