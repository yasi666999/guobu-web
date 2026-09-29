# 数据包格式

数据包用于把外部采集结果与主数据库解耦。一个数据包发布前必须通过校验，之后才能导入数据库。

## 目录结构

```text
data-packs/<pack-id>/
  manifest.json
  sources.json
  policies.json
  aggregates.json
  README.md
```

## manifest.json

```json
{
  "packId": "consumer-tradein-2025-2026",
  "version": "1.0.0",
  "title": "数据包标题",
  "description": "数据包说明",
  "generatedAt": "2026-09-28",
  "sourcePolicy": "official-only",
  "files": {
    "sources": "sources.json",
    "policies": "policies.json",
    "aggregates": "aggregates.json"
  }
}
```

## policies.json

每条政策至少包含：

```json
{
  "externalId": "national-2026-home-appliance",
  "title": "2026年家电以旧换新补贴",
  "program": "消费品以旧换新",
  "level": "national",
  "issuer": "商务部办公厅等5部门",
  "jurisdictionName": "全国",
  "category": "家电",
  "amountType": "percent",
  "rate": 15,
  "capAmount": 1500,
  "effectiveFrom": "2026-01-01",
  "effectiveTo": null,
  "sourceUrl": "https://www.gov.cn/...",
  "notes": "适用条件",
  "evidence": [
    {
      "fieldName": "rate",
      "quote": "原文引文",
      "confidence": 0.99
    }
  ]
}
```

## aggregates.json

用于公开的执行统计，不能把销售额当作已发放补贴金额：

```json
{
  "jurisdictionName": "全国",
  "program": "消费品以旧换新",
  "metricType": "driven_sales",
  "amountYuan": 1540000000000,
  "asOfDate": "2026-08-30",
  "sourceUrl": "https://www.gov.cn/...",
  "quote": "截至8月30日，2026年消费品以旧换新累计带动相关商品销售超1.54万亿元"
}
```

`metricType` 支持：

- `allocated_funds`：已下达资金；
- `disbursed_funds`：已发放补贴；
- `driven_sales`：带动销售额；
- `beneficiary_count`：受益人数；
- `other`：其他官方统计。

## 导入与校验

```powershell
$node = 'C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'

# 只校验，不写数据库
& $node scripts/import_data_pack.js data-packs/consumer-tradein-2025-2026 --dry-run

# 正式导入
& $node scripts/import_data_pack.js data-packs/consumer-tradein-2025-2026
```

校验内容包括：

- 文件结构和版本；
- `gov.cn` 政府官网来源；
- 政策层级、金额类型、比例、金额和日期；
- 每条政策至少有一条字段级引文；
- 同一政策去重；
- 导入结果写入 `import_runs` 审计表。
