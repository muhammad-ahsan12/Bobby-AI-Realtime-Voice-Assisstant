from __future__ import annotations

import re
from html import escape
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    ListFlowable,
    ListItem,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "BOBBY_AI_PROJECT_GUIDE.md"
OUTPUT = ROOT / "docs" / "Bobby_AI_Project_Guide.pdf"
ACCENT = colors.HexColor("#00A9D2")
NAVY = colors.HexColor("#07142B")


def inline_markup(text: str) -> str:
    value = escape(text)
    value = re.sub(
        r"\[([^\]]+)\]\(([^)]+)\)",
        r'<link href="\2" color="#007FA3">\1</link>',
        value,
    )
    value = re.sub(r"`([^`]+)`", r'<font name="Courier" color="#145B77">\1</font>', value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", value)
    return value


def table_rows(lines: list[str]) -> list[list[str]]:
    rows = []
    for line in lines:
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if cells and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
            continue
        rows.append(cells)
    return rows


def make_table(
    lines: list[str],
    available_width: float,
    styles: dict[str, ParagraphStyle],
) -> Table:
    rows = table_rows(lines)
    column_count = max(len(row) for row in rows)
    widths = [available_width / column_count] * column_count
    data = []
    for row_index, row in enumerate(rows):
        cells = row + [""] * (column_count - len(row))
        style = styles["table_header"] if row_index == 0 else styles["table_cell"]
        data.append([Paragraph(inline_markup(cell), style) for cell in cells])

    table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#F3F8FB")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [
            colors.HexColor("#F3F8FB"),
            colors.white,
        ]),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#C8D6DF")),
        ("LINEBELOW", (0, 0), (-1, 0), 1.1, ACCENT),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


def build_story(source: str, available_width: float) -> list[object]:
    base = getSampleStyleSheet()
    styles = {
        "title": ParagraphStyle(
            "GuideTitle", parent=base["Title"], fontName="Helvetica-Bold",
            fontSize=26, leading=31, textColor=NAVY, alignment=TA_LEFT,
            spaceAfter=12,
        ),
        "h2": ParagraphStyle(
            "GuideH2", parent=base["Heading1"], fontName="Helvetica-Bold",
            fontSize=17, leading=21, textColor=NAVY, spaceBefore=13, spaceAfter=8,
            keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "GuideH3", parent=base["Heading2"], fontName="Helvetica-Bold",
            fontSize=12, leading=15, textColor=colors.HexColor("#086B88"),
            spaceBefore=9, spaceAfter=5, keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "GuideBody", parent=base["BodyText"], fontName="Helvetica",
            fontSize=9, leading=13, textColor=colors.HexColor("#192A36"),
            spaceAfter=6, splitLongWords=True,
        ),
        "bullet": ParagraphStyle(
            "GuideBullet", parent=base["BodyText"], fontName="Helvetica",
            fontSize=8.7, leading=12, textColor=colors.HexColor("#192A36"),
            spaceAfter=3, leftIndent=8,
        ),
        "table_header": ParagraphStyle(
            "GuideTableHeader", parent=base["BodyText"], fontName="Helvetica-Bold",
            fontSize=8, leading=10, textColor=colors.white,
        ),
        "table_cell": ParagraphStyle(
            "GuideTableCell", parent=base["BodyText"], fontName="Helvetica",
            fontSize=7.6, leading=10, textColor=colors.HexColor("#192A36"),
        ),
        "code": ParagraphStyle(
            "GuideCode", fontName="Courier", fontSize=7.1, leading=9.2,
            textColor=colors.HexColor("#16384B"), backColor=colors.HexColor("#F1F6F9"),
            borderColor=colors.HexColor("#D4E1E8"), borderWidth=0.5,
            borderPadding=7, leftIndent=2, rightIndent=2, spaceBefore=4,
            spaceAfter=8, splitLongWords=1,
        ),
    }

    lines = source.splitlines()
    story: list[object] = []
    paragraph: list[str] = []
    index = 0

    def flush_paragraph() -> None:
        if paragraph:
            text = " ".join(part.strip() for part in paragraph)
            story.append(Paragraph(inline_markup(text), styles["body"]))
            paragraph.clear()

    while index < len(lines):
        line = lines[index]
        stripped = line.strip()
        if not stripped:
            flush_paragraph()
            index += 1
            continue

        if stripped.startswith("```"):
            flush_paragraph()
            index += 1
            code_lines = []
            while index < len(lines) and not lines[index].strip().startswith("```"):
                code_lines.append(lines[index])
                index += 1
            story.append(Preformatted(escape("\n".join(code_lines)), styles["code"]))
            index += 1
            continue

        if stripped.startswith("|") and index + 1 < len(lines) and lines[index + 1].strip().startswith("|"):
            flush_paragraph()
            table = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                table.append(lines[index])
                index += 1
            story.append(make_table(table, available_width, styles))
            story.append(Spacer(1, 7))
            continue

        heading = re.match(r"^(#{1,3})\s+(.+)$", stripped)
        if heading:
            flush_paragraph()
            level = len(heading.group(1))
            style = styles["title"] if level == 1 else styles["h2"] if level == 2 else styles["h3"]
            story.append(Paragraph(inline_markup(heading.group(2)), style))
            index += 1
            continue

        bullet = re.match(r"^[-*]\s+(.+)$", stripped)
        if bullet:
            flush_paragraph()
            items = []
            while index < len(lines):
                match = re.match(r"^\s*[-*]\s+(.+)$", lines[index])
                if not match:
                    break
                items.append(ListItem(
                    Paragraph(inline_markup(match.group(1)), styles["bullet"]),
                    leftIndent=9,
                ))
                index += 1
            story.append(ListFlowable(items, bulletType="bullet", start="circle", leftIndent=11))
            story.append(Spacer(1, 4))
            continue

        numbered = re.match(r"^\s*(\d+)\.\s+(.+)$", line)
        if numbered:
            flush_paragraph()
            items = []
            while index < len(lines):
                match = re.match(r"^\s*(\d+)\.\s+(.+)$", lines[index])
                if not match:
                    break
                items.append(ListItem(
                    Paragraph(inline_markup(match.group(2)), styles["bullet"]),
                    value=int(match.group(1)),
                    leftIndent=12,
                ))
                index += 1
            story.append(ListFlowable(items, bulletType="1", start="1", leftIndent=17))
            story.append(Spacer(1, 4))
            continue

        paragraph.append(stripped)
        index += 1

    flush_paragraph()
    return story


def draw_page(canvas, document) -> None:
    canvas.saveState()
    page_width, page_height = letter
    canvas.setStrokeColor(colors.HexColor("#D7E5EC"))
    canvas.setLineWidth(0.5)
    canvas.line(
        document.leftMargin,
        0.55 * inch,
        page_width - document.rightMargin,
        0.55 * inch,
    )
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#527080"))
    canvas.drawString(document.leftMargin, 0.38 * inch, "BOBBY AI  |  PROJECT GUIDE")
    canvas.drawRightString(page_width - document.rightMargin, 0.38 * inch, f"Page {document.page}")
    if document.page > 1:
        canvas.setFont("Helvetica-Bold", 8)
        canvas.setFillColor(ACCENT)
        canvas.drawString(document.leftMargin, page_height - 0.42 * inch, "BOBBY AI")
    canvas.restoreState()


def main() -> None:
    if not SOURCE.is_file():
        raise FileNotFoundError(f"Project guide source not found: {SOURCE}")
    document = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=letter,
        rightMargin=0.62 * inch,
        leftMargin=0.62 * inch,
        topMargin=0.72 * inch,
        bottomMargin=0.72 * inch,
        title="Bobby AI — Project and Operations Guide",
        author="Bobby AI Project",
        subject="Bobby AI architecture, modules, technologies, setup, and YouTube playback",
    )
    story = build_story(SOURCE.read_text(encoding="utf-8"), document.width)
    document.build(story, onFirstPage=draw_page, onLaterPages=draw_page)
    print(f"Generated {OUTPUT} ({OUTPUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
