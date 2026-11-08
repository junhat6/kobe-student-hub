#!/usr/bin/env python3
"""One local generated-data workflow comparison; never contacts a database server."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import platform
import sqlite3
import statistics
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

DUCKDB_VERSION = "2.0.0"
QUERY = """SELECT period, category, COUNT(*) AS rows, SUM(amount_cents) AS amount_cents
FROM events GROUP BY period, category ORDER BY period, category"""
COLUMNS = ["period", "category", "amount_cents"]


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, separators=(",", ":")).encode()).hexdigest()


def make_csv(path: Path, rows: int) -> list[list[object]]:
    expected: dict[tuple[int, str], list[int]] = {}
    with path.open("x", newline="", encoding="utf-8") as output:
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(COLUMNS)
        for index in range(rows):
            period = index % 12 + 1
            category = f"category-{(index // 12) % 8}"
            amount = index * 37 % 10_000
            writer.writerow((period, category, amount))
            total = expected.setdefault((period, category), [0, 0])
            total[0] += 1
            total[1] += amount
    return [[period, category, *totals] for (period, category), totals in sorted(expected.items())]


def sqlite_rows(path: Path):
    with path.open(newline="", encoding="utf-8") as source:
        reader = csv.reader(source)
        if next(reader) != COLUMNS:
            raise ValueError("Unexpected CSV schema")
        for period, category, amount in reader:
            yield int(period), category, int(amount)


def worker(engine: str, path: Path) -> dict:
    # Module import and process startup are outside the reported intervals.
    if engine == "duckdb":
        import duckdb

        if duckdb.__version__ != DUCKDB_VERSION:
            raise ValueError("Use the pinned DuckDB version")
    start = time.perf_counter()
    if engine == "sqlite":
        connection = sqlite3.connect(":memory:")
        connection.execute("PRAGMA threads = 0")
        connection.execute("CREATE TABLE events (period INTEGER NOT NULL, category TEXT NOT NULL, amount_cents INTEGER NOT NULL) STRICT")
        with connection:
            connection.executemany("INSERT INTO events VALUES (?, ?, ?)", sqlite_rows(path))
        first = connection.execute(QUERY).fetchall()
        first_seconds = time.perf_counter() - start
        # The same parsed in-memory table is already available for the second interval.
        materialization_seconds = None
    else:
        connection = duckdb.connect(":memory:")
        connection.execute("SET threads = 1")
        connection.read_csv(
            str(path), header=True, auto_detect=False,
            columns={"period": "INTEGER", "category": "VARCHAR", "amount_cents": "BIGINT"},
        ).create_view("events")
        first = connection.execute(QUERY).fetchall()
        first_seconds = time.perf_counter() - start
        # This is a separate scenario: a typed table already exists before its query timer.
        materialize_start = time.perf_counter()
        connection.execute("CREATE TABLE imported_events AS SELECT * FROM events")
        connection.execute("DROP VIEW events")
        connection.execute("ALTER TABLE imported_events RENAME TO events")
        materialization_seconds = time.perf_counter() - materialize_start
    query_start = time.perf_counter()
    loaded = connection.execute(QUERY).fetchall()
    loaded_seconds = time.perf_counter() - query_start
    connection.close()
    if first != loaded:
        raise ValueError("Fresh-file and loaded-table results disagree")
    return {
        "engine": engine,
        "csv_to_first_result_seconds": first_seconds,
        "loaded_table_query_seconds": loaded_seconds,
        "duckdb_table_materialization_seconds_excluded_from_query": materialization_seconds,
        "result": first,
    }


def hardware() -> dict:
    result = {
        "os": platform.system(), "os_release": platform.release(),
        "architecture": platform.machine(), "logical_cpus": os.cpu_count(),
        "python": platform.python_version(), "sqlite": sqlite3.sqlite_version,
        "duckdb": DUCKDB_VERSION,
    }
    if platform.system() == "Darwin":
        for name, key in [("machdep.cpu.brand_string", "cpu_model"), ("hw.memsize", "physical_memory_bytes")]:
            item = subprocess.run(["sysctl", "-n", name], capture_output=True, text=True, timeout=5)
            if item.returncode == 0:
                value = item.stdout.strip()
                result[key] = int(value) if key.endswith("bytes") else value
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rows", type=int, default=1_000_000)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("results.json"))
    parser.add_argument("--worker", choices=["sqlite", "duckdb"], help=argparse.SUPPRESS)
    parser.add_argument("--csv", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker:
        if not args.csv:
            parser.error("Worker needs CSV")
        print(json.dumps(worker(args.worker, args.csv)))
        return
    if not 1_000_000 <= args.rows <= 2_000_000 or not 1 <= args.repeats <= 3:
        parser.error("Use 1–2 million rows and 1–3 repetitions")
    if args.output.exists():
        parser.error("Output exists; choose a new --output rather than overwriting evidence")
    measured_start = time.perf_counter()
    runs = []
    with tempfile.TemporaryDirectory(prefix="ksh-db-choice-") as temporary:
        work = Path(temporary)
        data = work / "events.csv"
        expected = make_csv(data, args.rows)
        expected_digest = digest(expected)
        csv_bytes = data.stat().st_size
        file_hash = hashlib.sha256(data.read_bytes()).hexdigest()
        for repetition in range(args.repeats):
            order = ["duckdb", "sqlite"] if repetition % 2 == 0 else ["sqlite", "duckdb"]
            for engine in order:
                completed = subprocess.run(
                    [sys.executable, str(Path(__file__).resolve()), "--worker", engine, "--csv", str(data)],
                    capture_output=True, text=True, timeout=45,
                )
                if completed.returncode:
                    raise RuntimeError(f"{engine} measurement failed: {completed.stderr}")
                item = json.loads(completed.stdout)
                actual = item.pop("result")
                if actual != expected:
                    raise ValueError(f"{engine} result disagrees with the generated-data oracle")
                item.update(repetition=repetition + 1, all_groups_match=True, result_sha256=digest(actual))
                runs.append(item)
        if sum(row[2] for row in expected) != args.rows:
            raise ValueError("Independent group counts do not sum to the input row count")
    if work.exists():
        raise RuntimeError("Temporary data cleanup failed")
    by_engine = {}
    for engine in ["duckdb", "sqlite"]:
        selected = [item for item in runs if item["engine"] == engine]
        by_engine[engine] = {
            metric: {
                "median_seconds": statistics.median(item[metric] for item in selected),
                "min_seconds": min(item[metric] for item in selected),
                "max_seconds": max(item[metric] for item in selected),
            }
            for metric in ["csv_to_first_result_seconds", "loaded_table_query_seconds"]
        }
    record = {
        "version": 1, "measured_at_utc": datetime.now(timezone.utc).isoformat(),
        "environment": hardware(),
        "fixture": {
            "kind": "deterministically generated fictional data; no real records",
            "rows": args.rows, "csv_bytes": csv_bytes, "csv_sha256": file_hash,
            "columns": COLUMNS, "result_groups": len(expected),
            "expected_total_amount_cents": sum(row[3] for row in expected),
            "expected_result_sha256": expected_digest,
        },
        "query": QUERY, "repetitions_per_engine": args.repeats,
        "timing": {
            "csv_to_first_result": "after imports, connect -> typed CSV workflow -> complete aggregate result",
            "sqlite_csv_workflow": "stdlib csv parsing and integer conversion + executemany in one transaction + query",
            "duckdb_csv_workflow": "typed read_csv view + query; no imported table",
            "loaded_table_query": "query only against a parsed in-memory table; initial import/materialization excluded",
            "csv_generation_process_startup_and_imports": "excluded",
            "duckdb_threads": 1, "sqlite_auxiliary_worker_threads": 0,
            "os_file_cache": "uncontrolled; generated file and repeated reads may be cached; not a cold-cache benchmark",
            "indexes": "none", "memory_peak_measured": False, "concurrency_measured": False,
            "durability_measured": False, "both_databases": "in-memory; not persistent database durability comparison",
        },
        "runs": runs, "summary": by_engine,
        "all_results_match_python_oracle": True, "temporary_data_cleaned": True,
        "benchmark_wall_seconds": time.perf_counter() - measured_start,
        "limits": [
            "This compares these Python workflows and one aggregate, not universal database performance.",
            "No remote server, LLM, real user data, memory-peak or concurrent-writer test.",
            "Different loaders, schemas, distributions, indexes, queries and hardware may change the result.",
        ],
    }
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(record, output, ensure_ascii=False, indent=2)
        output.write("\n")
    print(json.dumps({"rows": args.rows, "csv_bytes": csv_bytes, "all_results_match": True, "temporary_data_cleaned": True, "summary": by_engine}))


if __name__ == "__main__":
    main()
