# 生产部署与上线

## 推荐架构

```text
用户浏览器
    ↓ HTTPS
Caddy 反向代理
    ↓
Node.js 应用
    ↓
SQLite + 原始文件快照
```

适合一个组织、几十名维护者和单实例部署。SQLite 使用 WAL 模式，可以支持日常多人审核和编辑。

如果后续需要多台应用服务器、大规模并发写入或高可用，应迁移到 PostgreSQL，并将原始文件放到对象存储。

## 服务器要求

- Linux VPS；
- 一个已解析到服务器公网 IP 的域名；
- 开放 80 和 443 端口；
- 安装 Docker 和 Docker Compose；
- 建议至少 2 核 CPU、4 GB 内存、40 GB 磁盘。

## 首次上线

1. 把项目上传或克隆到服务器，例如：

```bash
cd /opt/guobu-hub
```

2. 创建生产环境变量：

```bash
cp deploy/.env.production.example deploy/.env
```

编辑 `deploy/.env`：

```text
DOMAIN=guobu.example.com
```

3. 构建并启动：

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
```

上线前可先在服务器上运行：

```bash
node scripts/preflight.js
```

检查管理员、邀请码、政策数据、数据源和备份配置。

4. 查看状态：

```bash
docker compose -f deploy/docker-compose.yml ps
docker compose -f deploy/docker-compose.yml logs -f app
```

5. 打开域名：

```text
https://guobu.example.com
```

## 首次创建管理员

生产环境已设置：

```text
ALLOW_REGISTRATION=0
```

系统仍允许在数据库中没有任何用户时创建第一个管理员。创建完成后，后续成员必须通过管理员生成的邀请码注册。

## 上线后的多人维护

管理员在“用户与导入”页面：

1. 生成邀请码；
2. 选择角色：贡献者、审核员、只读或管理员；
3. 设置有效期；
4. 将邀请码发送给成员；
5. 成员在注册页面填写邀请码。

详细流程见 [COLLABORATION.md](COLLABORATION.md)。

## 备份

应用容器内执行：

```bash
docker compose -f deploy/docker-compose.yml exec app node scripts/backup_db.js
```

备份会写入容器的 `/app/data/backups/<时间>/`，该目录挂载在 Docker volume 中。

建议每天至少执行一次备份，并定期把备份复制到另一台服务器或对象存储。

## 更新版本

```bash
git pull
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
```

数据库迁移会在应用启动时自动完成。

## 安全配置

- 使用 HTTPS；
- 设置 `COOKIE_SECURE=1`；
- 设置 `ALLOW_REGISTRATION=0`；
- 不把 8787 端口直接暴露到公网；
- 管理员定期检查用户和邀请码；
- 对重要数据变更保留审核记录；
- 不采集个人申领信息。

## 当前限制

- 单实例 SQLite 是当前默认方案；
- 如果要横向扩容，需要先迁移到 PostgreSQL；
- 自动 OCR 依赖服务器上的 Tesseract 或 PaddleOCR；
- 自动抓取只适用于公开政府页面，不绕过登录、验证码或访问控制。
