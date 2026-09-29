"""在 PyCharm 中查看国补协作库的 SQLite 数据库，无需安装第三方包。"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DEFAULT_DB = ROOT / "data" / "guobu.sqlite"

TABLE_LABELS = {
    "sources": "官方数据源",
    "policies": "已发布政策",
    "subsidy_rules": "补贴金额规则",
    "evidence": "原文证据",
    "disbursement_aggregates": "官方执行统计",
    "contributions": "贡献与审核",
    "documents": "原始文档",
    "import_runs": "数据包导入记录",
    "invites": "邀请码",
    "users": "用户",
    "events": "操作事件",
}


def display_width(value: object) -> int:
    text = "" if value is None else str(value)
    return sum(2 if ord(char) > 127 else 1 for char in text)


def truncate(value: object, width: int) -> str:
    text = "" if value is None else str(value).replace("\n", " ")
    result = ""
    used = 0
    for char in text:
        char_width = 2 if ord(char) > 127 else 1
        if used + char_width > width - 1:
            return result + "…"
        result += char
        used += char_width
    return result


def print_rows(columns: list[str], rows: list[sqlite3.Row], limit_width: int = 36) -> None:
    if not rows:
        print("没有查询结果。")
        return
    values = [[truncate(row[column], limit_width) for column in columns] for row in rows]
    widths = [display_width(column) for column in columns]
    for row in values:
        for index, value in enumerate(row):
            widths[index] = max(widths[index], display_width(value))
    separator = "+" + "+".join("-" * (width + 2) for width in widths) + "+"
    print(separator)
    print("| " + " | ".join(column.ljust(widths[index]) for index, column in enumerate(columns)) + " |")
    print(separator)
    for row in values:
        print("| " + " | ".join(value.ljust(widths[index]) for index, value in enumerate(row)) + " |")
    print(separator)
    print(f"共 {len(rows)} 行")


def list_tables(connection: sqlite3.Connection) -> None:
    rows = connection.execute(
        """
        SELECT name, type
        FROM sqlite_master
        WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
        ORDER BY name
        """
    ).fetchall()
    print("数据库中的表和视图：")
    for row in rows:
        table = row["name"]
        count = connection.execute(f'SELECT COUNT(*) AS count FROM "{table}"').fetchone()["count"]
        print(f"  {table:<28} {TABLE_LABELS.get(table, ''):<12} {count:>8} 行")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="查看国补协作库 SQLite 数据库")
    parser.add_argument("--db", default=str(DEFAULT_DB), help="数据库文件路径")
    parser.add_argument("--tables", action="store_true", help="列出所有表和行数")
    parser.add_argument("--table", help="查看指定表，例如 policies")
    parser.add_argument("--sql", help="执行自定义只读 SQL")
    parser.add_argument("--limit", type=int, default=50, help="最多显示多少行")
    args = parser.parse_args()

    database_path = Path(args.db).resolve()
    if not database_path.exists():
        print(f"数据库不存在：{database_path}")
        return 1

    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        if args.sql:
            statement = args.sql.strip()
            if not statement.lower().startswith(("select", "with", "pragma")):
                print("为了保证安全，此脚本只允许执行 SELECT、WITH 或 PRAGMA 查询。")
                return 2
            cursor = connection.execute(statement)
            columns = [item[0] for item in cursor.description]
            print_rows(columns, cursor.fetchmany(max(1, args.limit)))
            return 0

        if args.table:
            table = args.table.strip()
            allowed = {
                row["name"]
                for row in connection.execute("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")
            }
            if table not in allowed:
                print(f"表不存在：{table}")
                return 2
            cursor = connection.execute(f'SELECT * FROM "{table}" LIMIT ?', (max(1, args.limit),))
            columns = [item[0] for item in cursor.description]
            print_rows(columns, cursor.fetchall())
            return 0

        list_tables(connection)
        print()
        print("常用示例：")
        print("  python view_database.py --table policies")
        print("  python view_database.py --table subsidy_rules")
        print("  python view_database.py --sql \"SELECT title, jurisdiction_name, rate, cap_amount FROM policies p JOIN subsidy_rules r ON r.policy_id = p.id\"")
        return 0
    finally:
        connection.close()


if __name__ == "__main__":
    raise SystemExit(main())
