#!/usr/bin/env python3
import glob
import os
import sqlite3
import sys
from datetime import datetime


def clean(value, limit=80):
    text = "" if value is None else str(value)
    text = " ".join(text.replace("\t", " ").replace("\r", " ").replace("\n", " ").split())
    if len(text) > limit:
        text = text[: limit - 1] + "..."
    return text


def main():
    home = os.environ.get("CODEX_HOME", "/root/.codex")
    paths = glob.glob(os.path.join(home, "state_*.sqlite"))
    if not paths:
        return 1

    path = max(paths, key=os.path.getmtime)
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row

    rows = conn.execute(
        """
        SELECT id, title, name, first_user_message, preview, archived,
               COALESCE(recency_at_ms, updated_at_ms, updated_at * 1000) AS sort_time,
               COALESCE(updated_at_ms, updated_at * 1000) AS updated_time
        FROM threads
        ORDER BY sort_time DESC
        LIMIT 200
        """
    )

    for row in rows:
        title = row["title"] or row["name"] or row["first_user_message"] or row["preview"] or row["id"]
        timestamp = row["updated_time"] or row["sort_time"] or 0
        updated = datetime.fromtimestamp(timestamp / 1000).strftime("%Y-%m-%d %H:%M")
        sys.stdout.write(
            "\t".join(
                [
                    row["id"],
                    str(row["archived"]),
                    updated,
                    clean(title),
                ]
            )
            + "\n"
        )

    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
