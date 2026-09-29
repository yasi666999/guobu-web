# 参与维护

## 代码协作

1. 从主分支创建功能分支；
2. 完成修改并运行 `npm test`；
3. 数据来源必须为政府官网；
4. 提交 Pull Request，说明数据来源、影响范围和验证方式；
5. 至少一名审核员合并。

## 数据协作

数据不直接修改数据库，应通过独立数据包提交：

```text
data-packs/<pack-id>/
```

提交前执行：

```powershell
node scripts/import_data_pack.js data-packs/<pack-id> --dry-run
```

## 安全要求

- 不提交 `.env`、密码、Token、个人申领信息；
- 不提交 `data/` 和 `exports/` 中的运行时数据；
- 不绕过政府网站的访问控制或验证码；
- 不把媒体、电商、自媒体作为主数据源。
