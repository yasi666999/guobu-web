# 免费上线方案

这个项目包含 Node.js 后端、SQLite 数据库、文件上传和采集任务，不适合 GitHub Pages、Vercel 或 Netlify 这类纯静态/无状态平台。

最现实、长期免费的方案是：

```text
Oracle Cloud Always Free Linux 虚拟机
+ DuckDNS 免费子域名
+ Docker
+ Caddy 自动 HTTPS
+ GitHub Container Registry 镜像
```

## 方案一：Oracle Cloud Always Free，推荐

### 免费资源

在符合 Oracle 当前免费额度规则的前提下，可以使用：

- ARM Ampere A1：最高 4 OCPU、24 GB 内存；
- 持久化块存储；
- 公网 IP；
- DuckDNS 免费子域名；
- Caddy + Let's Encrypt 免费 HTTPS；
- GitHub 公共仓库和 GitHub Actions 免费额度。

Oracle 注册通常需要信用卡或支付方式做身份验证。务必只创建标记为 Always Free 的实例，避免超出免费额度。

### 1. 创建免费服务器

创建 Ubuntu Linux 实例时优先选择：

```text
Shape: VM.Standard.A1.Flex
CPU: 1-4 OCPU
Memory: 6-24 GB
Boot volume: 50-100 GB
Public IPv4: 分配
```

ARM 实例适合本项目，因为 GitHub Actions 已经构建 `linux/arm64` 镜像。

### 2. 放行端口

在 Oracle VCN 安全列表中添加入站规则：

```text
TCP 22   来源 0.0.0.0/0
TCP 80   来源 0.0.0.0/0
TCP 443  来源 0.0.0.0/0
```

如果系统启用了 `ufw`、`firewalld` 或 `iptables`，也要放行 80 和 443。

### 3. 创建免费域名

登录 DuckDNS，创建一个子域名，例如：

```text
guobu-yourname.duckdns.org
```

把它解析到 Oracle 服务器的公网 IPv4。

### 4. 安装 Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

退出 SSH 后重新登录，然后确认：

```bash
docker version
docker compose version
```

### 5. 获取项目

```bash
git clone https://github.com/yasi666999/guobu-web.git
cd guobu-web
cp deploy/.env.production.example deploy/.env
```

编辑 `deploy/.env`：

```text
DOMAIN=guobu-yourname.duckdns.org
```

### 6. 启动

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml pull
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d
```

Caddy 会自动申请 HTTPS 证书。

检查：

```bash
docker compose -f deploy/docker-compose.yml ps
curl https://guobu-yourname.duckdns.org/api/health
```

然后打开：

```text
https://guobu-yourname.duckdns.org
```

首次注册的账号会成为管理员，后续成员必须使用邀请码。

### 7. 备份

```bash
docker compose -f deploy/docker-compose.yml exec app node scripts/backup_db.js
```

备份保存在服务器数据卷中。重要数据还应定期下载到本地或同步到对象存储。

## 方案二：家里电脑 + Cloudflare Tunnel

适合临时演示，不适合正式生产。

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

Cloudflare 会生成一个临时网址。电脑关机、休眠或断网后网站不可访问，网址也可能变化。

如果需要固定网址，需要一个接入 Cloudflare 的域名，并让电脑长期开机。

## 不建议的方案

### Render 免费实例

免费实例没有持久磁盘。重新部署、休眠或重启后，SQLite 数据库和上传文件可能丢失，因此不适合正式维护数据。

### GitHub Pages

只能托管静态文件，不能运行 Node.js、SQLite、OCR 和采集任务。

### Vercel / Netlify

适合前端和无状态 API，不适合本项目当前依赖的持久化 SQLite 和本地文件快照。

## 免费上线检查清单

- [ ] Oracle Always Free 实例运行
- [ ] 80 和 443 端口已放行
- [ ] DuckDNS 已解析到服务器
- [ ] Docker 和 Docker Compose 可用
- [ ] `DOMAIN` 已填写
- [ ] HTTPS 健康检查成功
- [ ] 第一个管理员已注册
- [ ] 已生成成员邀请码
- [ ] 已测试备份
