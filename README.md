# 国补协作库

GitHub 仓库：<https://github.com/yasi666999/guobu-web>

一个可自托管的多人在线协作平台，用于采集政府公开的国补政策、保存原始证据、自动抽取结构化字段、校验和去重，并经过审核后发布为规范数据。

## 已实现

- 官方站点 / 开放 API 地址登记和低频采集；
- 公开 URL 抓取、内网地址阻断、限速、超时和文件大小限制；
- HTML、PDF、Word、CSV、JSON、TXT 解析；
- PaddleOCR / Tesseract / HTTP OCR 可插拔适配；
- 比例、固定金额、上限、地区、品类、文号、日期和申领条件候选抽取；
- 字段校验、内容哈希去重和政策去重键；
- 贡献者、审核员、管理员、只读用户四种角色；
- 草案、待审核、审核中、需修改、已发布、已驳回工作流；
- 评论、事件时间线、原始文件快照和发布证据；
- JSON / CSV 批量导入；
- SQLite 主库，零 npm 依赖即可运行。

## 环境要求

- Node.js 22.5+，推荐 Node.js 24；
- 可选：PaddleOCR、Tesseract 或兼容的 OCR HTTP 服务；
- 可选：Poppler，用于扫描版 PDF 转图片。

当前 Codex 工作区可直接使用内置 Node：

```powershell
$node = 'C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $node src/server.js
```

默认访问地址：<http://127.0.0.1:8787>

## 快速开始

```powershell
# 可选：复制配置模板
Copy-Item .env.example .env

# 导入官方站点种子（不会自动抓取）
$node = 'C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $node scripts/seed.js

# 导入已核验的 2026 年国家级政策与公开执行统计
& $node scripts/seed_official_data.js

# 或使用独立数据包导入器（推荐，可校验、可重复执行）
& $node scripts/import_data_pack.js data-packs/consumer-tradein-2025-2026 --dry-run
& $node scripts/import_data_pack.js data-packs/consumer-tradein-2025-2026

# 启动
& $node src/server.js
```

第一个注册账号会自动成为管理员。后续账号默认为贡献者，由管理员在“用户与导入”页面分配审核员角色。

当前官方数据种子包含：

- 2026 年家电以旧换新补贴标准；
- 2026 年数码和智能产品购新补贴标准；
- 2026 年汽车报废更新和置换更新补贴标准；
- 财政下达资金、带动销售额和受益人次等官方公开统计。

## 独立数据包

`data-packs/` 用于把外部数据与主数据库解耦。每个数据包包含：

```text
manifest.json    数据包版本和文件清单
sources.json     官网来源台账
policies.json    政策规则和字段级原文引文
aggregates.json  官方公开的执行统计
```

导入器会执行以下校验：

- 来源必须是 `gov.cn` 政府官网域名；
- 政策层级、金额类型、比例、金额、日期格式合法；
- 每条政策至少绑定一条原文引文；
- 同一政策按去重键幂等导入；
- 每次导入写入 `import_runs` 审计记录。

新增省级、市级或区县数据时，应建立独立数据包，不要把未核验数据直接写入主库。格式说明见 [docs/DATA_PACK_FORMAT.md](docs/DATA_PACK_FORMAT.md)。

## 核心配置

```text
PORT=8787
HOST=127.0.0.1
DATA_DIR=./data
ALLOW_REGISTRATION=1
AUTO_COLLECT=0
FETCH_MIN_INTERVAL_SECONDS=5
FETCH_TIMEOUT_SECONDS=25
MAX_DOWNLOAD_MB=25
PYTHON_BIN=
OCR_COMMAND=
OCR_HTTP_ENDPOINT=
OCR_LANGUAGES=chi_sim+eng
```

`AUTO_COLLECT=1` 时，服务每 10 分钟检查一次到期的低频数据源，每轮最多处理 3 个来源。

## 上线部署

生产部署文件位于 `deploy/`，包含 Docker、Caddy HTTPS 和持久化数据卷：

```bash
cp deploy/.env.production.example deploy/.env
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
```

详细步骤见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)，多人协作规范见 [docs/COLLABORATION.md](docs/COLLABORATION.md)。

免费上线方案见 [docs/FREE_DEPLOYMENT.md](docs/FREE_DEPLOYMENT.md)。
使用自己电脑做服务器见 [docs/HOME_SERVER_DEPLOYMENT.md](docs/HOME_SERVER_DEPLOYMENT.md)。

Windows 家用服务器使用 Nginx 作为唯一入口：

```text
https://<tailscale-domain>/guobu/
```

## OCR 接入方式

### 方式一：PaddleOCR

```powershell
$python = 'C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
& $python -m pip install -r python/requirements-ocr.txt
```

解析器会自动尝试导入 PaddleOCR。

### 方式二：自定义命令

设置 `OCR_COMMAND`，支持 `{input}` 和 `{output}` 占位符：

```powershell
$env:OCR_COMMAND = 'my-ocr --input {input} --output {output}'
```

### 方式三：HTTP OCR 服务

设置 `OCR_HTTP_ENDPOINT`。请求体格式：

```json
{
  "image_base64": "...",
  "languages": "chi_sim+eng"
}
```

响应格式：

```json
{ "text": "识别出的文本" }
```

## 操作流程

1. **数据源**：登记官方栏目、层级、地区、频率和合规说明。
2. **采集录入**：粘贴公开 URL 或人工上传文件，系统保存快照并自动解析。
3. **我的贡献**：校对自动抽取的字段，补充金额和申领条件，保存草稿或提交审核。
4. **审核队列**：审核员要求修改、驳回，或通过并发布。
5. **原始文档**：查看文件哈希、解析状态和抽取警告。
6. **用户与导入**：管理员分配角色，批量导入开放平台 JSON / CSV。

## 数据目录

运行时数据全部位于 `DATA_DIR`：

```text
data/guobu.sqlite       主数据库
data/raw/YYYY/MM/...    原始文件快照
```

备份时建议同时备份 SQLite 和 `data/raw`。正式部署请启用 HTTPS，并把 `HOST`、反向代理和访问控制配置在生产环境。

上线前检查：

```powershell
npm run preflight
```

## 查看数据库

最简单的方式是双击项目根目录的 `查看数据库.cmd`。脚本会把数据库导出为中文 CSV，并自动打开导出目录：

```text
exports/latest/
  01_数据源.csv
  02_政策明细.csv
  03_原文证据.csv
  04_官方执行统计.csv
  05_贡献与审核.csv
  06_原始文档.csv
  07_数据包导入记录.csv
  08_用户.csv
  09_邀请码.csv
```

也可以使用 DB Browser for SQLite 等工具直接打开 `data/guobu.sqlite`。

## 重要边界

- 平台只处理互联网公开的政府政策信息，不接入政务内网；
- 不采集个人申领记录和个人隐私；
- 当前自动抽取是候选结果，必须人工审核后才能发布；
- 金额展示表示政策规则，不代表所有消费者实际可领取金额；
- “已发放金额”必须来自官方公开统计，不能由政策上限推算。

## 测试

```powershell
$node = 'C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $node --test tests/*.test.js
```
