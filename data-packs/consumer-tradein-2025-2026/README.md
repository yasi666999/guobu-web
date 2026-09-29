# 消费品以旧换新数据包

本数据包只包含中国政府网可追溯的国家级政策和官方公开统计。

数据文件：

- `sources.json`：建议登记的数据源；
- `policies.json`：政策规则和字段级原文引文；
- `aggregates.json`：公开的资金、销售额和受益人数统计；
- `manifest.json`：数据包版本和说明。

导入命令：

```powershell
$node = 'C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $node scripts/import_data_pack.js data-packs/consumer-tradein-2025-2026
```

导入器会校验来源域名、金额、日期、证据和版本，并按照去重键幂等导入。重复执行不会产生重复政策。
