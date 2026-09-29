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

注意：Tailscale Funnel 当前仍是 beta，适合低流量网站。它只能公开 443、8443 和 10000 端口，但可以直接把公网 HTTPS 转发到本机 8787。

### 1. 启动应用

在项目目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\run-server.ps1
```

浏览器打开：

```text
http://127.0.0.1:8787
```

### 2. 安装并开启 Funnel

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\setup-tailscale-funnel.ps1
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

### 3. 设置开机启动

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\install-startup.ps1
```

Windows 登录后会自动隐藏启动平台。

### 4. 设置每日备份

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\install-backup-task.ps1
```

每天 03:00 自动备份 SQLite 和原始文件。

## 方案二：Cloudflare 临时隧道

适合先免费演示：

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\setup-cloudflare-quick-tunnel.ps1
```

控制台会输出：

```text
https://随机名称.trycloudflare.com
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
