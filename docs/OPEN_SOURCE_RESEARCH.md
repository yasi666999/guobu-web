# GitHub 开源项目调研与选型

调研时间：2026-09-28。以下仓库均通过 GitHub API 核验公开元数据。本平台不直接复制它们的代码，而是采用其成熟模式或保留适配接口。

## 重点候选

| 项目 | 许可证 | 本项目用途 | 结论 |
|---|---|---|---|
| [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | Apache-2.0 | 中文扫描件 OCR | 作为首选可选后端，通过 `OCR_COMMAND` 或 Python 环境接入 |
| [MinerU](https://github.com/opendatalab/MinerU) | 自定义，需复核 | 复杂 PDF 版面、表格和公式解析 | 暂不直接嵌入；后续增加独立解析服务适配器 |
| [Docling](https://github.com/docling-project/docling) | MIT | PDF / Office 统一解析 | 保留为下一阶段 PDF 版面解析候选 |
| [Unstructured](https://github.com/Unstructured-IO/unstructured) | Apache-2.0 | HTML / PDF / Office 分块 | 当前使用 pdfplumber + python-docx + lxml，避免过早引入重依赖 |
| [changedetection.io](https://github.com/dgtlmoon/changedetection.io) | Apache-2.0 | 网页低频监测、内容哈希、变化检测 | 采用其“快照 + 哈希 + 低频检查”模式，项目内自建轻量采集器 |
| [Label Studio](https://github.com/HumanSignal/label-studio) | Apache-2.0 | 人工标注和复核 | 当前自建审核队列；大规模字段标注时再接入 |
| [doccano](https://github.com/doccano/doccano) | MIT | 文本标注 | 作为未来字段级标注和训练数据生产候选 |
| [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx) | GPL-3.0 | 文档归档、索引、元数据 | GPL 不适合直接嵌入闭源产品，仅参考其文档工作流 |
| [trafilatura](https://github.com/adbar/trafilatura) | Apache-2.0 | 新闻 / 政府网页正文抽取 | 当前用 lxml 基础解析，复杂网页再接入 |
| [PyMuPDF](https://github.com/pymupdf/PyMuPDF) | AGPL-3.0 | PDF 解析和渲染 | 商业使用需评估许可证；当前优先 pdfplumber + Poppler |
| [pdfplumber](https://github.com/jsvine/pdfplumber) | MIT | PDF 文本与表格提取 | 直接使用，适合政策文本型 PDF |

## 选型原则

1. 主数据只采信官方来源；开源工具只负责采集、解析和协作，不负责判断政策权威性。
2. 核心依赖尽量少。当前服务使用 Node.js 24 内置 SQLite，可直接启动，不依赖 npm 包。
3. 文档解析与采集解耦。以后可以把 MinerU、Docling 或 PaddleOCR 换成独立服务，不影响主数据库。
4. 审核动作和证据必须长期留痕。外部标注平台只能作为队列来源，不能替代发布库。

## 可扩展方向

- **复杂 PDF**：部署 MinerU 或 Docling，输出 Markdown/JSON，再映射为本项目字段。
- **中文 OCR**：部署 PaddleOCR，配置 `OCR_COMMAND` 或在 Python 环境中安装 `python/requirements-ocr.txt`。
- **网页变化监测**：需要更强正文抽取时接入 trafilatura；需要可视化监测规则时单独部署 changedetection.io。
- **大规模标注**：把待复核字段导出到 Label Studio/doccano，审核完成后回写本系统 API。
