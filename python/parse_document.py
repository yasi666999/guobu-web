#!/usr/bin/env python3
"""国补文档解析器：HTML/PDF/DOCX/CSV/JSON/TXT -> 文本、元数据和候选字段。"""

from __future__ import annotations

import argparse
import base64
import csv
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path
from typing import Any


PROVINCES = [
    "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏",
    "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西",
    "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏",
    "新疆", "台湾", "香港", "澳门",
]

CATEGORY_RULES = [
    ("汽车", ["汽车", "乘用车", "新能源车", "置换更新", "报废更新", "车辆"]),
    ("家电", ["家电", "冰箱", "洗衣机", "空调", "电视", "热水器", "油烟机", "灶具"]),
    ("数码", ["数码", "手机", "平板", "电脑", "笔记本", "智能手表", "耳机"]),
    ("农机", ["农机", "农业机械", "拖拉机", "收割机", "播种机"]),
    ("家装", ["家装", "厨卫", "适老化", "家具", "建材"]),
    ("设备更新", ["设备更新", "工业设备", "老旧电梯", "营运货车", "公交车"]),
]

PROGRAM_RULES = [
    ("消费品以旧换新", ["消费品以旧换新"]),
    ("汽车以旧换新", ["汽车以旧换新", "汽车置换更新", "汽车报废更新"]),
    ("家电以旧换新", ["家电以旧换新"]),
    ("数码产品购新", ["数码产品购新", "手机等数码产品", "数码产品"]),
    ("农机购置与应用补贴", ["农机购置", "农机补贴", "农业机械购置"]),
    ("大规模设备更新", ["大规模设备更新", "设备更新"]),
]


def clean_text(value: str) -> str:
    value = value.replace("\u3000", " ")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def decode_bytes(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "utf-16"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def compact(value: str, limit: int = 120) -> str:
    value = clean_text(value).replace("\n", " ")
    return value[:limit]


def field(value: Any, confidence: float, quote: str = "", page: int | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"value": value, "confidence": round(confidence, 3)}
    if quote:
        result["quote"] = compact(quote, 180)
    if page:
        result["page"] = page
    return result


def read_text_file(path: Path) -> tuple[str, dict[str, Any], list[str], list[dict[str, str]]]:
    raw = path.read_bytes()
    return decode_bytes(raw), {}, [], []


def read_html(path: Path) -> tuple[str, dict[str, Any], list[str], list[dict[str, str]]]:
    from lxml import html

    raw = path.read_bytes()
    document = html.fromstring(decode_bytes(raw))
    title = clean_text(document.xpath("string(//title)") or "")
    text = clean_text(document.text_content())
    links: list[dict[str, str]] = []
    seen: set[str] = set()
    for node in document.xpath("//a[@href]"):
        href = clean_text(node.get("href") or "")
        if not href or href.startswith(("javascript:", "#", "mailto:")):
            continue
        key = (href, compact(node.text_content(), 80))
        if key in seen:
            continue
        seen.add(key)
        links.append({"href": href, "text": compact(node.text_content(), 120)})
    published = ""
    for query in [
        "//meta[@name='PubDate']/@content",
        "//meta[@name='publishdate']/@content",
        "//meta[@property='article:published_time']/@content",
    ]:
        found = document.xpath(query)
        if found:
            published = clean_text(str(found[0]))
            break
    return text, {"title": title, "published_at": published}, [], links[:300]


def read_docx(path: Path) -> tuple[str, dict[str, Any], list[str], list[dict[str, str]]]:
    from docx import Document

    document = Document(str(path))
    chunks: list[str] = []
    for paragraph in document.paragraphs:
        if paragraph.text.strip():
            chunks.append(paragraph.text)
    for table in document.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells]
            if any(cells):
                chunks.append(" | ".join(cells))
    return clean_text("\n".join(chunks)), {}, [], []


def read_pdf(path: Path, allow_ocr: bool, max_ocr_pages: int) -> tuple[str, dict[str, Any], list[str], list[dict[str, str]]]:
    import pdfplumber

    chunks: list[str] = []
    warnings: list[str] = []
    page_count = 0
    with pdfplumber.open(str(path)) as pdf:
        page_count = len(pdf.pages)
        for index, page in enumerate(pdf.pages, start=1):
            text = page.extract_text(x_tolerance=2, y_tolerance=3) or ""
            if text.strip():
                chunks.append(f"\n[第{index}页]\n{text}")
    text = clean_text("\n".join(chunks))
    if len(text) < 80 and allow_ocr:
        ocr_text = ocr_pdf(path, max_ocr_pages, warnings)
        if ocr_text:
            text = clean_text(ocr_text)
    if len(text) < 80:
        warnings.append("PDF 文本层过少；如为扫描件，请安装并配置 OCR 引擎。")
    return text, {"page_count": page_count}, warnings, []


def read_csv(path: Path) -> tuple[str, dict[str, Any], list[str], list[dict[str, str]]]:
    raw = path.read_bytes()
    text = raw.decode("utf-8-sig", errors="replace")
    rows = list(csv.reader(io.StringIO(text)))
    lines = [" | ".join(row) for row in rows[:2000] if any(cell.strip() for cell in row)]
    return clean_text("\n".join(lines)), {"row_count": max(0, len(rows) - 1)}, [], []


def read_json(path: Path) -> tuple[str, dict[str, Any], list[str], list[dict[str, str]]]:
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    text = json.dumps(data, ensure_ascii=False, indent=2)
    count = len(data) if isinstance(data, list) else 1
    return text, {"record_count": count}, [], []


def run_command(command: list[str], timeout: int = 120) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)


def ocr_image(path: Path, warnings: list[str]) -> str:
    endpoint = os.environ.get("OCR_HTTP_ENDPOINT", "").strip()
    if endpoint:
        try:
            payload = json.dumps({
                "image_base64": base64.b64encode(path.read_bytes()).decode("ascii"),
                "languages": os.environ.get("OCR_LANGUAGES", "chi_sim+eng"),
            }).encode("utf-8")
            request = urllib.request.Request(endpoint, data=payload, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(request, timeout=120) as response:
                data = json.loads(response.read().decode("utf-8"))
            return clean_text(str(data.get("text", "")))
        except Exception as exc:  # noqa: BLE001 - return a useful warning to the caller
            warnings.append(f"OCR HTTP 服务调用失败：{exc}")

    command_template = os.environ.get("OCR_COMMAND", "").strip()
    if command_template:
        output_path = path.with_suffix(".ocr.txt")
        command = command_template.format(input=str(path), output=str(output_path))
        try:
            completed = run_command(command, timeout=180)
            if completed.returncode == 0 and output_path.exists():
                return clean_text(output_path.read_text(encoding="utf-8", errors="replace"))
            if completed.returncode == 0 and completed.stdout:
                return clean_text(completed.stdout)
            warnings.append(f"OCR_COMMAND 执行失败：{completed.stderr.strip()[:200]}")
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"OCR_COMMAND 调用失败：{exc}")

    try:
        from paddleocr import PaddleOCR  # type: ignore

        engine = PaddleOCR(use_angle_cls=True, lang="ch", show_log=False)
        result = engine.ocr(str(path), cls=True)
        lines: list[str] = []
        for page in result or []:
            for item in page or []:
                if len(item) >= 2 and item[1]:
                    lines.append(str(item[1][0]))
        if lines:
            return "\n".join(lines)
    except Exception:
        pass

    tesseract = shutil.which("tesseract")
    if tesseract:
        try:
            completed = run_command([tesseract, str(path), "stdout", "-l", os.environ.get("OCR_LANGUAGES", "chi_sim+eng")], timeout=180)
            if completed.returncode == 0:
                return clean_text(completed.stdout)
            warnings.append(f"Tesseract 执行失败：{completed.stderr.strip()[:200]}")
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"Tesseract 调用失败：{exc}")
    return ""


def ocr_pdf(path: Path, max_pages: int, warnings: list[str]) -> str:
    pdftoppm = shutil.which("pdftoppm")
    if not pdftoppm:
        warnings.append("未找到 pdftoppm，无法把扫描版 PDF 转为图片进行 OCR。")
        return ""

    texts: list[str] = []
    with tempfile.TemporaryDirectory(prefix="guobu-ocr-") as folder:
        prefix = str(Path(folder) / "page")
        try:
            completed = run_command([
                pdftoppm, "-png", "-r", "180", "-f", "1", "-l", str(max_pages), str(path), prefix,
            ], timeout=240)
            if completed.returncode != 0:
                warnings.append(f"PDF 转图片失败：{completed.stderr.strip()[:200]}")
                return ""
            images = sorted(Path(folder).glob("page-*.png"))
            for image in images:
                text = ocr_image(image, warnings)
                if text:
                    texts.append(text)
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"PDF OCR 失败：{exc}")
    return "\n\n".join(texts)


def normalize_date(year: str, month: str, day: str) -> str:
    return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"


def find_date_after_pattern(text: str, pattern: str) -> tuple[str, str] | None:
    match = re.search(pattern, text)
    if not match:
        return None
    year, month, day = match.group(1), match.group(2), match.group(3)
    return normalize_date(year, month, day), match.group(0)


def extract_dates(text: str) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    range_match = re.search(
        r"(?:自|从)?\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*(?:起)?\s*(?:至|到|-|—|~|～)\s*(\d{4})年(\d{1,2})月(\d{1,2})日",
        text,
    )
    if range_match:
        start = normalize_date(range_match.group(1), range_match.group(2), range_match.group(3))
        end = normalize_date(range_match.group(4), range_match.group(5), range_match.group(6))
        result["effective_from"] = field(start, 0.86, range_match.group(0))
        result["effective_to"] = field(end, 0.86, range_match.group(0))
        return result

    candidates = [
        ("effective_from", r"(?:自|从|于)?\s*(\d{4})年(\d{1,2})月(\d{1,2})日(?:起|开始)?(?:施行|执行|生效|实施)"),
        ("effective_to", r"(?:有效期至|截止(?:日期)?(?:为)?|至)\s*(\d{4})年(\d{1,2})月(\d{1,2})日"),
    ]
    for key, pattern in candidates:
        found = find_date_after_pattern(text, pattern)
        if found:
            result[key] = field(found[0], 0.78, found[1])

    iso_range = re.search(r"(20\d{2}-\d{2}-\d{2})\s*(?:至|到|—|~|～)\s*(20\d{2}-\d{2}-\d{2})", text)
    if iso_range:
        result.setdefault("effective_from", field(iso_range.group(1), 0.82, iso_range.group(0)))
        result.setdefault("effective_to", field(iso_range.group(2), 0.82, iso_range.group(0)))
    return result


def extract_categories(text: str) -> tuple[str | None, list[str], list[str]]:
    values: list[str] = []
    evidence: list[str] = []
    for category, keywords in CATEGORY_RULES:
        for keyword in keywords:
            index = text.find(keyword)
            if index >= 0:
                values.append(category)
                evidence.append(text[max(0, index - 35): index + len(keyword) + 45])
                break
    values = list(dict.fromkeys(values))
    return ("、".join(values) if values else None), values, evidence


def extract_program(text: str) -> tuple[str | None, str | None]:
    for program, keywords in PROGRAM_RULES:
        for keyword in keywords:
            index = text.find(keyword)
            if index >= 0:
                return program, text[max(0, index - 40): index + len(keyword) + 60]
    return None, None


def extract_funding_source(text: str) -> tuple[str | None, str | None]:
    funding_rules = [
        ("中央财政/超长期特别国债", ["超长期特别国债", "中央财政资金", "中央财政"]),
        ("省级财政", ["省级财政", "省财政安排", "省财政厅安排"]),
        ("市级财政", ["市级财政", "市财政安排", "市财政局安排"]),
        ("中央与地方共同承担", ["中央与地方", "中央和地方", "央地共担"]),
        ("财政资金", ["财政资金", "财政部安排", "财政部门安排"]),
        ("未在原文中明确", ["补贴资金由", "资金来源"]),
    ]
    for label, keywords in funding_rules:
        for keyword in keywords:
            index = text.find(keyword)
            if index >= 0:
                return label, text[max(0, index - 40): index + len(keyword) + 80]
    return None, None


def extract_jurisdiction(text: str, title: str = "") -> tuple[str | None, str | None]:
    ordered_provinces = sorted(PROVINCES, key=len, reverse=True)
    # 标题优先，其次只检查正文前 8000 字，避免页脚模板和 ICP 信息干扰。
    candidates = [title, text[:8000], text]
    for source in candidates:
        if not source:
            continue
        for province in ordered_provinces:
            index = source.find(province)
            if index >= 0:
                return province, source[max(0, index - 20): index + len(province) + 45]
    if any(keyword in title for keyword in ("全国", "国务院", "商务部", "财政部", "国家发展改革委")):
        return "全国", title
    city = re.search(r"([\u4e00-\u9fff]{2,8}(?:市|州|盟|地区))", text)
    if city:
        return city.group(1), city.group(0)
    return None, None


def extract_city_district(text: str, title: str = "") -> tuple[str | None, str | None, str | None, str | None]:
    source = f"{title}\n{text[:8000]}"
    city_pattern = re.compile(r"([\u4e00-\u9fff]{2,6}市)")
    district_pattern = re.compile(r"([\u4e00-\u9fff]{2,8}(?:区|县|旗))")
    excluded = ("自治区", "财政", "政府", "委员会", "商务局", "发展和改革", "通知", "公告", "专区", "换新")
    city = next((match.group(1) for match in city_pattern.finditer(source) if not any(word in match.group(1) for word in excluded)), None)
    district = next((match.group(1) for match in district_pattern.finditer(source) if not any(word in match.group(1) for word in excluded)), None)
    return None, city, district, (city or district)


def extract_amount(text: str) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    full_reduction = re.findall(r"满\s*\d+(?:\.\d+)?\s*减\s*\d+(?:\.\d+)?", text)
    if full_reduction:
        result["rule_text"] = field("、".join(dict.fromkeys(full_reduction)), 0.88, "；".join(full_reduction[:3]))
        result["amount_type"] = field("tiered", 0.82, "；".join(full_reduction[:3]))
    percent = re.search(r"(?:补贴|补助|按|比例(?:为|不超过)?|给予)[^\d%]{0,18}(\d+(?:\.\d+)?)\s*%", text)
    if not percent:
        percent = re.search(r"(\d+(?:\.\d+)?)\s*%[^。；\n]{0,35}(?:补贴|补助|优惠)", text)
    if percent:
        result["rate"] = field(float(percent.group(1)), 0.88, percent.group(0))
        result["amount_type"] = field("percent", 0.86, percent.group(0))

    cap = re.search(r"(?:最高|上限|最高不超过|不超过)[^\d]{0,12}(\d+(?:\.\d+)?)\s*元", text)
    if cap:
        result["cap_amount"] = field(float(cap.group(1)), 0.9, cap.group(0))

    fixed = re.search(r"(?:补贴|补助|每件|每台|每人|每户|每辆|每部)[^\d\n]{0,16}(\d+(?:\.\d+)?)\s*元", text)
    if fixed:
        result["amount_value"] = field(float(fixed.group(1)), 0.78, fixed.group(0))

    if any(keyword in text for keyword in ("分档", "一档", "二档", "三档", "价格区间")):
        result["amount_type"] = field("tiered", 0.72, "文档中出现分档/价格区间表述")
    elif "amount_type" not in result:
        if "cap_amount" in result:
            result["amount_type"] = field("fixed", 0.62, result["cap_amount"].get("quote", ""))
        elif "amount_value" in result:
            result["amount_type"] = field("fixed", 0.72, result["amount_value"].get("quote", ""))
        else:
            result["amount_type"] = field("unknown", 0.25)
    return result


def extract_cap_unit(text: str) -> tuple[str | None, str | None]:
    rules = [
        ("元/件", ["元/件", "每件", "每台", "每部"]),
        ("元/人", ["元/人", "每人"]),
        ("元/户", ["元/户", "每户"]),
        ("元/辆", ["元/辆", "每辆"]),
    ]
    for label, keywords in rules:
        for keyword in keywords:
            index = text.find(keyword)
            if index >= 0:
                return label, text[max(0, index - 40): index + len(keyword) + 40]
    return "元", "默认按元计"


def extract_end_note(text: str) -> tuple[str | None, str | None]:
    for keyword in ("额度用完", "资金用完", "先到先得", "提前截止", "预算用完"):
        index = text.find(keyword)
        if index >= 0:
            return "额度用完提前截止", text[max(0, index - 40): index + len(keyword) + 50]
    return None, None


def infer_title(text: str, metadata: dict[str, Any], lines: list[str]) -> tuple[str | None, str | None]:
    title = clean_text(str(metadata.get("title", "")))
    if title:
        return title, title
    for line in lines[:30]:
        value = clean_text(line)
        if 6 <= len(value) <= 100 and any(keyword in value for keyword in ("通知", "方案", "公告", "细则", "办法", "政策", "措施")):
            return value, value
    for line in lines[:20]:
        value = clean_text(line)
        if 6 <= len(value) <= 100:
            return value, value
    return None, None


def extract_fields(text: str, metadata: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    fields: dict[str, Any] = {}
    lines = [line for line in text.splitlines() if line.strip()]

    title, title_quote = infer_title(text, metadata, lines)
    if title:
        fields["title"] = field(title, 0.82, title_quote)

    doc_no = re.search(r"([\u4e00-\u9fffA-Za-z]{0,10}[〔\[]\d{4}[〕\]]\s*第?\s*\d+\s*号)", text)
    if doc_no:
        fields["doc_no"] = field(doc_no.group(1), 0.94, doc_no.group(0))

    issuer_match = re.search(r"(国务院|财政部|商务部|国家发展改革委|国家发改委|工业和信息化部|农业农村部|市场监管总局|省(?:人民)?政府|市(?:人民)?政府|商务厅|财政厅|发展改革委|农业农村厅|商务局|财政局)", text)
    if issuer_match:
        fields["issuer"] = field(issuer_match.group(1), 0.72, text[max(0, issuer_match.start() - 30): issuer_match.end() + 50])

    funding_source, funding_quote = extract_funding_source(text)
    if funding_source:
        fields["funding_source"] = field(funding_source, 0.72, funding_quote or "")

    published = str(metadata.get("published_at", "")).strip()
    if not published:
        published_date = find_date_after_pattern(text, r"(?:发布日期|发布时间|印发日期)[：: ]*\s*(\d{4})年(\d{1,2})月(\d{1,2})日")
        if published_date:
            published = published_date[0]
    if published:
        fields["published_at"] = field(published, 0.72, published)

    jurisdiction, jurisdiction_quote = extract_jurisdiction(text, title or "")
    if jurisdiction:
        fields["jurisdiction_name"] = field(jurisdiction, 0.68, jurisdiction_quote or "")
    _, city, district, geo_quote = extract_city_district(text, title or "")
    if city:
        fields["jurisdiction_city"] = field(city, 0.62, geo_quote or "")
    if district:
        fields["jurisdiction_district"] = field(district, 0.62, geo_quote or "")

    category, categories, category_evidence = extract_categories(text)
    if category:
        fields["category"] = field(category, 0.78, category_evidence[0] if category_evidence else "")
        fields["categories"] = field(categories, 0.68, category_evidence[0] if category_evidence else "")

    program, program_quote = extract_program(text)
    if program:
        fields["program"] = field(program, 0.88, program_quote or "")

    fields.update(extract_amount(text))
    cap_unit, cap_unit_quote = extract_cap_unit(text)
    fields["cap_unit"] = field(cap_unit, 0.65, cap_unit_quote or "")
    end_note, end_note_quote = extract_end_note(text)
    if end_note:
        fields["end_note"] = field(end_note, 0.72, end_note_quote or "")
    fields.update(extract_dates(text))

    conditions = []
    for sentence in re.split(r"[。；\n]", text):
        value = clean_text(sentence)
        if 12 <= len(value) <= 220 and any(keyword in value for keyword in ("条件", "对象", "要求", "凭证", "发票", "本人", "实名")):
            conditions.append(value)
    if conditions:
        fields["conditions"] = field(conditions[:8], 0.62, conditions[0])

    evidence: list[dict[str, Any]] = []
    for name, item in fields.items():
        if name in {"categories", "conditions"}:
            continue
        if isinstance(item, dict) and item.get("quote"):
            evidence.append({
                "field_name": name,
                "quote": item.get("quote"),
                "page_number": item.get("page"),
                "confidence": item.get("confidence", 0),
            })
    return fields, evidence


def parse_file(path: Path, original_name: str, mime_type: str, allow_ocr: bool, max_ocr_pages: int) -> dict[str, Any]:
    suffix = path.suffix.lower()
    name_suffix = Path(original_name or "").suffix.lower()
    effective_suffix = suffix or name_suffix
    metadata: dict[str, Any] = {}
    warnings: list[str] = []
    links: list[dict[str, str]] = []

    if effective_suffix == ".pdf" or mime_type == "application/pdf":
        text, metadata, warnings, links = read_pdf(path, allow_ocr, max_ocr_pages)
    elif effective_suffix in {".docx", ".doc"} or "wordprocessingml" in mime_type:
        if effective_suffix == ".doc":
            warnings.append("旧版 .doc 暂不支持直接解析，请转换为 .docx 或 PDF。")
            text = ""
        else:
            text, metadata, warnings, links = read_docx(path)
    elif effective_suffix in {".html", ".htm"} or "html" in mime_type:
        text, metadata, warnings, links = read_html(path)
    elif effective_suffix == ".csv" or mime_type == "text/csv":
        text, metadata, warnings, links = read_csv(path)
    elif effective_suffix == ".json" or mime_type == "application/json":
        text, metadata, warnings, links = read_json(path)
    elif effective_suffix in {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp"} or mime_type.startswith("image/"):
        text = ocr_image(path, warnings) if allow_ocr else ""
        if not text:
            warnings.append("OCR 未产生文本，请检查 OCR 环境或上传可复制文本的文件。")
    else:
        text, metadata, warnings, links = read_text_file(path)

    fields, evidence = extract_fields(text, metadata)
    if not text:
        status = "ocr_required"
    else:
        status = "processed"
    return {
        "status": status,
        "text": text[:500000],
        "text_chars": len(text),
        "meta": metadata,
        "fields": fields,
        "evidence": evidence,
        "links": links,
        "warnings": warnings,
    }


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("path")
    parser.add_argument("--original-name", default="")
    parser.add_argument("--mime", default="")
    parser.add_argument("--no-ocr", action="store_true")
    parser.add_argument("--max-ocr-pages", type=int, default=8)
    args = parser.parse_args()

    path = Path(args.path)
    if not path.exists():
        print(json.dumps({"status": "failed", "error": "文件不存在"}, ensure_ascii=False))
        return 2

    try:
        result = parse_file(path, args.original_name, args.mime, not args.no_ocr, args.max_ocr_pages)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:  # noqa: BLE001 - process boundary returns structured errors
        print(json.dumps({"status": "failed", "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
