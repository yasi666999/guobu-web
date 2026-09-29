# 用自己电脑做服务器

电脑常开时，可以作为服务器，但推荐不要直接把家里公网 IP 和端口暴露出去。优先使用 Tailscale Funnel 或 Cloudflare Tunnel。

## 方案一：Tailscale Funnel，推荐

优点：

- 免费；
- 不需要买域名；
- 自带 HTTPS；
- 自动获得固定的 `*.ts.net` 地址；
- 不需要路由器端口映射；
- 不暴露家庭公网 IP。

注意：Tailscale Funnel 当前仍是 beta，适合低流量网站。它只能公开 443、8443 和 10000 端口，但可以把公网 HTTPS 转发到本机 Nginx 的 8080 端口。

如果 Tailscale Funnel 所在网络地区无法访问，可以直接使用下面推荐的 Cloudflare HTTP/2 快速隧道。它不需要公网 IP，也不需要域名，适合先让别人访问。

### 1. 启动应用

在项目目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\run-server.ps1
```

浏览器打开：

```text
http://127.0.0.1:8787
```

### 2. 安装 Nginx 单端口入口

应用本身只监听 `127.0.0.1:8787`。Nginx 只监听 `127.0.0.1:8080`，并通过 `/guobu/` 前缀访问应用：

```text
http://127.0.0.1:8080/guobu/
```

安装并启动 Nginx：

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\install-nginx.ps1
```

以后增加其他服务时，在 `deploy\windows\nginx.conf.template` 中增加新的 `location /服务名/`，仍然只需要公开 Nginx 的 8080 端口。

### 3. 安装并开启 Funnel

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\setup-tailscale-funnel.ps1
```

如果只想先安装 Tailscale，不立即登录和开启 Funnel：

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\setup-tailscale-funnel.ps1 -InstallOnly
```

脚本会：

1. 安装 Tailscale；
2. 打开浏览器要求你登录；
3. 开启 Funnel；
4. 输出类似下面的公网地址：

```text
https://your-pc.tailnet-name.ts.net
```

以后任何人无需安装 Tailscale，也可以访问这个地址。

应用地址：

```text
https://your-pc.tailnet-name.ts.net/guobu/
```

### 4. 设置开机启动

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\install-startup.ps1
```

Windows 登录后会自动隐藏启动平台。

### 5. 设置每日备份

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\install-backup-task.ps1
```

每天 03:00 自动备份 SQLite 和原始文件。

## 方案二：Cloudflare 临时隧道

适合先免费演示：

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\setup-cloudflare-quick-tunnel.ps1
```

脚本会在后台启动 HTTP/2 隧道，并把公开地址写入：

```text
data\public-url.txt
```

访问地址格式：

```text
https://随机名称.trycloudflare.com/guobu/
```

缺点：

- 每次重启隧道，网址都会变化；
- 不适合长期发给大量用户；
- 电脑或进程停止后网站不可访问。

如果需要固定网址，需要拥有一个接入 Cloudflare 的域名。

## 方案三：公网 IP + 路由器端口映射

只有运营商给你真正的公网 IPv4 时才能使用。很多家庭宽带的公网 IP 实际在运营商 NAT 后面，端口映射无效。

判断方法：

1. 在电脑上查询公网 IP；
2. 查看路由器 WAN 口 IP；
3. 两者一致才可能是公网 IPv4。

如果使用此方案：

- 路由器外部端口 80、443 转发到电脑内网 IP；
- Windows 防火墙放行 80、443；
- 使用 DuckDNS 处理动态 IP；
- 安装 Caddy for Windows 自动 HTTPS；
- 不要把 RDP、SMB、数据库端口暴露到公网。

风险：

- 家庭公网 IP 暴露；
- 路由器漏洞和 DDoS；
- 运营商可能封锁 80、443；
- IP 变化后需要 DDNS。

因此优先选择 Tailscale Funnel 或 Cloudflare Tunnel。

## 电脑作为服务器的注意事项

- 关闭自动睡眠和硬盘休眠；
- 设置来电自动开机；
- 保持 Windows 自动更新，但避免维护时段中断；
- 使用单独的低权限 Windows 用户；
- 开启防火墙；
- 定期检查 `data\logs\server.log`；
- 定期执行备份并复制到其他位置；
- 重要生产数据建议使用 UPS，避免突然断电损坏文件。
- 公网只开放 Tailscale Funnel 的 HTTPS 443，Funnel 转发到 Nginx 8080；应用 8787 只监听本机。
