# 生成CSVを集計する、技術選定ノート用の実測例

一人がローカルで週1回CSVを集計する想定。「起動・import後、CSVから初回結果まで10秒以内」を測定前の目標とした。これは運営が生成データで実行した参考実験で、実際の学生・利用者の経験やアプリの実アクセスログではない。

100万行という行数だけで選定せず、ファイル容量、問い合わせ方、実行手順と結果を合わせて記録する。今回は約18.1 MBのデータがメモリに収まる小さな集計である。

## 実行

既存の `results.json` は上書きしない。再確認する場合は別の出力先を指定する。

```sh
uv run --no-project --isolated --python 3.12.12 --with duckdb==2.0.0 \
  python experiments/learning-notes-db-choice/benchmark.py \
  --output /tmp/ksh-db-choice-recheck.json
```

生成CSVは `TemporaryDirectory` 内だけに置き、成功・通常例外時に削除する。各測定は独立した子プロセスで45秒の上限を設ける。サーバー、リモートDB、LLMは呼び出さない。DuckDBの実行依存を外部から取得するが、第三者のコード・binary・venv・生成CSV・DBはこのdirectoryへ同梱しない。[DuckDB Python package](https://pypi.org/project/duckdb/2.0.0/)・[DuckDB license](https://github.com/duckdb/duckdb/blob/v2.0.0/LICENSE)。

## データと確認

- CSV: 1,000,000行、18,139,028 bytes。列は `period`（1〜12）、`category`（8種類）、`amount_cents`（整数）。型推測は使わない。
- 同一SQLで月×カテゴリの件数と金額合計を求め、96 groupの全結果を生成時のPython集計と比較した。全6 run・両測定phaseで一致。総件数1,000,000、総額4,999,500,000 cents。
- CSV SHA-256: `f54a34d7d4bb768973b635c21ba1b3a01cd9847ad363d720735c390edb303cf8`
- 全group結果 SHA-256: `9959ffa74a3a632890c277c1b3d16043f7f944337c23f414a0d520bd5003dedf`

```sql
SELECT period, category, COUNT(*) AS rows, SUM(amount_cents) AS amount_cents
FROM events GROUP BY period, category ORDER BY period, category
```

## 2026-11-08の結果

Apple M4、16 GiB、macOS/Darwin 25.1.0、Python 3.12.12、DuckDB 2.0.0、SQLite 3.50.4。各3回の中央値。個々の測定値と環境は [results.json](results.json) に保存した。

| 計測範囲 | DuckDB | SQLite |
| --- | ---: | ---: |
| CSVから初回集計結果まで | 0.065秒 | 0.741秒 |
| 取込済みin-memory tableの集計queryのみ（別の範囲） | 0.011秒 | 0.283秒 |

初回は、DuckDBの型指定 `read_csv` viewからの直接集計と、SQLiteのPython `csv` 読込・整数変換・`executemany` 一括transaction・集計を比べている。**DBエンジン単体の速度比較ではない。** 取込済みtableの測定では両方とも取込・materializationをタイマーから除外した。DuckDBはthreads=1、SQLiteは補助worker threads=0。indexは作成していない。

どちらも事前目標の10秒以内なので、この結果だけでSQLiteを性能不足として外す理由にはならない。今回DuckDBを試す理由は、届いたCSVを直接SQLで集計できる手順と、読み中心の用途との適合に置ける。SQLiteへの取込が既に済んでいる、個別更新も行う、といった条件なら同じ判断を流用しない。

## 未測定と限界

process起動・module import・CSV生成は時間に含めない。OSのfile cacheは制御しておらず、cold-cache試験ではない。両DBはin-memoryで、永続化の耐久性、メモリのピーク、同時更新、別のSQL・データ分布・loader・index・端末は検証していない。ほかの条件での優劣やDB全般の順位に一般化しない。

最初の実行はDuckDB 2.0のCSV指定が `columns` を要求したため測定前に停止した。明示列指定へ修正後、上記の1実験を完了した。データ規模・SQL・事前目標は変更せず、順位を変えるための最適化は行っていない。
