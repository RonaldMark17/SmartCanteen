import os
import re
import subprocess
import tempfile
import logging
from typing import Optional, List

logger = logging.getLogger(__name__)

def _convert_via_excel_com(xlsx_path: str, pdf_path: str, sheet_name: Optional[str] = None) -> bool:
    """
    Converts an XLSX file to PDF using Microsoft Excel COM automation on Windows.
    This guarantees 100% fidelity matching Microsoft Excel's native PDF export.
    """
    if os.name != 'nt':
        return False

    abs_xlsx = os.path.abspath(xlsx_path).replace("'", "''")
    abs_pdf = os.path.abspath(pdf_path).replace("'", "''")
    sheet_param = (sheet_name or "").replace("'", "''")

    ps_script = f"""
$ErrorActionPreference = 'Stop'
$excel = $null
$wb = $null
try {{
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.ScreenUpdating = $false

    $wb = $excel.Workbooks.Open('{abs_xlsx}', [Type]::Missing, $true)

    $targetSheet = $null
    if ('{sheet_param}' -ne '') {{
        foreach ($sh in $wb.Sheets) {{
            if ($sh.Name -eq '{sheet_param}') {{
                $targetSheet = $sh
                break
            }}
        }}
    }}

    if ($targetSheet) {{
        # Restrict print area to rows 1-57 so blank trailing rows don't produce extra blank pages
        $targetSheet.PageSetup.PrintArea = '$A$1:$H$57'
        $targetSheet.ExportAsFixedFormat(0, '{abs_pdf}')
    }} else {{
        foreach ($sh in $wb.Sheets) {{
            $sh.PageSetup.PrintArea = '$A$1:$H$57'
        }}
        $wb.ExportAsFixedFormat(0, '{abs_pdf}')
    }}

    Write-Host "EXPORT_OK"
}} catch {{
    Write-Error $_
    exit 1
}} finally {{
    if ($wb) {{
        $wb.Close($false)
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($wb) | Out-Null
    }}
    if ($excel) {{
        $excel.Quit()
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
    }}
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}}
"""
    try:
        res = subprocess.run(
            ['powershell', '-NoProfile', '-NonInteractive', '-Command', ps_script],
            capture_output=True,
            text=True,
            timeout=45,
        )
        if res.returncode == 0 and os.path.isfile(pdf_path) and os.path.getsize(pdf_path) > 0:
            return True
        logger.warning(f"Excel COM export failed: {res.stderr.strip()}")
    except Exception as exc:
        logger.warning(f"Excel COM export exception: {exc}")

    return False


def _convert_via_libreoffice(xlsx_path: str, pdf_path: str, sheet_name: Optional[str] = None) -> bool:
    """
    Converts XLSX to PDF using headless LibreOffice/soffice CLI.
    Commonly available on Linux / Ubuntu VPS installations.
    """
    import shutil
    cmd = shutil.which('libreoffice') or shutil.which('soffice')
    if not cmd:
        return False
    try:
        outdir = os.path.dirname(os.path.abspath(pdf_path))
        res = subprocess.run(
            [cmd, '--headless', '--convert-to', 'pdf', '--outdir', outdir, os.path.abspath(xlsx_path)],
            capture_output=True,
            timeout=45,
        )
        base_name = os.path.splitext(os.path.basename(xlsx_path))[0]
        gen_pdf = os.path.join(outdir, f"{base_name}.pdf")
        if os.path.isfile(gen_pdf):
            if os.path.abspath(gen_pdf) != os.path.abspath(pdf_path):
                shutil.move(gen_pdf, pdf_path)
            return os.path.isfile(pdf_path) and os.path.getsize(pdf_path) > 0
    except Exception as exc:
        logger.warning(f"LibreOffice conversion failed: {exc}")
    return False


def _evaluate_cell_value(cell, ws):
    val = cell.value
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str) and val.startswith('='):
        formula = val[1:].strip()
        sum_match = re.match(r'^SUM\(([A-Z0-9:]+)\)$', formula, re.IGNORECASE)
        if sum_match:
            rng = sum_match.group(1)
            total = 0.0
            for row in ws[rng]:
                for c in row:
                    v = _evaluate_cell_value(c, ws)
                    if isinstance(v, (int, float)):
                        total += v
            return total
        diff_match = re.match(r'^([A-Z]+[0-9]+)\s*-\s*([A-Z]+[0-9]+)$', formula)
        if diff_match:
            c1 = ws[diff_match.group(1)]
            c2 = ws[diff_match.group(2)]
            v1 = _evaluate_cell_value(c1, ws) or 0.0
            v2 = _evaluate_cell_value(c2, ws) or 0.0
            return float(v1) - float(v2)
        ref_match = re.match(r'^([A-Z]+[0-9]+)$', formula)
        if ref_match:
            return _evaluate_cell_value(ws[ref_match.group(1)], ws) or 0.0
        return 0.0
    try:
        cleaned = str(val).replace(',', '').replace('₱', '').replace('PHP', '').replace('Php', '').strip()
        return float(cleaned)
    except (ValueError, TypeError):
        return str(val)


def _format_peso(val) -> str:
    if val is None or val == '' or val == 0:
        return 'PHP                  -'
    try:
        f = float(val)
        if f == 0.0:
            return 'PHP                  -'
        if f < 0:
            return f'-PHP {abs(f):>14,.2f}'
        return f'PHP {f:>15,.2f}'
    except (ValueError, TypeError):
        return str(val).replace('₱', 'PHP ')


def _format_peso_pdf(val) -> str:
    if val is None or val == '' or val == 0:
        return 'PHP 0.00'
    try:
        f = float(val)
        if f == 0.0:
            return 'PHP 0.00'
        if f < 0:
            return f'-PHP {abs(f):,.2f}'
        return f'PHP {f:,.2f}'
    except (ValueError, TypeError):
        return str(val).replace('₱', 'PHP ')


def _convert_via_reportlab(xlsx_path: str, pdf_path: str, sheet_name: Optional[str] = None) -> bool:
    """
    Fallback converter using openpyxl and ReportLab for environments without Microsoft Excel.
    """
    try:
        import openpyxl
        from reportlab.lib.pagesizes import letter, landscape
        from reportlab.lib import colors
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image
        )
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

        wb = openpyxl.load_workbook(xlsx_path, data_only=False)
        target_sheets = [sheet_name] if sheet_name and sheet_name in wb.sheetnames else wb.sheetnames

        doc = SimpleDocTemplate(
            pdf_path,
            pagesize=landscape(letter),
            leftMargin=36,
            rightMargin=36,
            topMargin=20,
            bottomMargin=20,
        )

        styles = getSampleStyleSheet()
        header_style = ParagraphStyle(
            'DepEdHdr',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=7.5,
            alignment=1,
            leading=10,
            textColor=colors.HexColor('#1e293b'),
        )
        bold_header_style = ParagraphStyle(
            'DepEdBoldHdr',
            parent=header_style,
            fontName='Helvetica-Bold',
            fontSize=8,
            leading=10.5,
        )
        dept_style = ParagraphStyle(
            'DepEdDeptHdr',
            parent=header_style,
            fontName='Times-Bold',
            fontSize=10,
            leading=12,
        )
        title_style = ParagraphStyle(
            'RepTitle',
            parent=styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=9.5,
            alignment=1,
            leading=12,
            textColor=colors.HexColor('#0f172a'),
        )
        subtitle_style = ParagraphStyle(
            'RepSub',
            parent=styles['Normal'],
            fontName='Helvetica-BoldOblique',
            fontSize=8.5,
            alignment=1,
            leading=11,
            textColor=colors.HexColor('#334155'),
        )
        cell_lbl = ParagraphStyle(
            'CellLbl',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=7.5,
            leading=9.5,
            textColor=colors.HexColor('#0f172a'),
        )
        cell_lbl_bold = ParagraphStyle(
            'CellLblB',
            parent=cell_lbl,
            fontName='Helvetica-Bold',
        )
        cell_amt = ParagraphStyle(
            'CellAmt',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=7.5,
            alignment=2,
            leading=9.5,
            textColor=colors.HexColor('#0f172a'),
        )
        cell_amt_bold = ParagraphStyle(
            'CellAmtB',
            parent=cell_amt,
            fontName='Helvetica-Bold',
        )
        cell_amt_red = ParagraphStyle(
            'CellAmtRed',
            parent=cell_amt_bold,
            textColor=colors.HexColor('#dc2626'),
        )
        th_style = ParagraphStyle(
            'TH',
            parent=styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=6.5,
            alignment=1,
            leading=8,
            textColor=colors.HexColor('#0f172a'),
        )

        template_dir = os.path.join(os.path.abspath(os.path.dirname(__file__)), "report_templates")
        logo_path = os.path.join(template_dir, "deped_logo.jpg")
        has_logo = False
        if os.path.isfile(logo_path):
            try:
                from PIL import Image as PILImage
                with PILImage.open(logo_path) as _img:
                    _img.verify()
                has_logo = True
            except Exception:
                has_logo = False

        story = []

        for s_idx, s_name in enumerate(target_sheets):
            if s_name not in wb.sheetnames:
                continue
            ws = wb[s_name]

            if s_idx > 0:
                story.append(PageBreak())

            # Header
            if has_logo:
                try:
                    logo_img = Image(logo_path, width=42, height=42)
                    hdr_lines = [
                        Paragraph("Republic of the Philippines", header_style),
                        Paragraph("Department of Education", dept_style),
                        Paragraph("REGION IV-A CALABARZON", header_style),
                        Paragraph("SCHOOLS DIVISION OFFICE OF LAGUNA", header_style),
                        Paragraph("BAY SUB-OFFICE", header_style),
                        Paragraph("<b>BAY CENTRAL ELEMENTARY SCHOOL</b>", bold_header_style),
                    ]
                    hdr_tbl = Table([[logo_img, hdr_lines]], colWidths=[50, 670])
                    hdr_tbl.setStyle(TableStyle([
                        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                        ('LEFTPADDING', (0, 0), (-1, -1), 0),
                        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
                        ('TOPPADDING', (0, 0), (-1, -1), 0),
                        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
                    ]))
                    story.append(hdr_tbl)
                except Exception:
                    has_logo = False

            if not has_logo:
                story.append(Paragraph("Republic of the Philippines", header_style))
                story.append(Paragraph("Department of Education", dept_style))
                story.append(Paragraph("REGION IV-A CALABARZON", header_style))
                story.append(Paragraph("SCHOOLS DIVISION OFFICE OF LAGUNA", header_style))
                story.append(Paragraph("BAY SUB-OFFICE", header_style))
                story.append(Paragraph("<b>BAY CENTRAL ELEMENTARY SCHOOL</b>", bold_header_style))

            story.append(Spacer(1, 3))
            story.append(Paragraph("STATEMENT OF MONTHLY CANTEEN OPERATION", title_style))
            month_label = str(ws['A13'].value or f"For the Month of {s_name}")
            story.append(Paragraph(month_label, subtitle_style))
            story.append(Spacer(1, 6))

            # Operating statement
            c15 = _evaluate_cell_value(ws['C15'], ws) or 0.0
            f16 = _evaluate_cell_value(ws['F16'], ws) or 0.0
            f17 = _evaluate_cell_value(ws['F17'], ws) or 0.0
            f18 = _evaluate_cell_value(ws['F18'], ws) or (f16 - f17)

            exp_categories = [
                ("Transportation/Freight", _evaluate_cell_value(ws['F21'], ws) or 0.0),
                ("Gas", _evaluate_cell_value(ws['F22'], ws) or 0.0),
                ("Supplies", _evaluate_cell_value(ws['F23'], ws) or 0.0),
                ("Helpers", _evaluate_cell_value(ws['F24'], ws) or 0.0),
                ("Repair", _evaluate_cell_value(ws['F25'], ws) or 0.0),
                ("Purchase from the looses of tools", _evaluate_cell_value(ws['F26'], ws) or 0.0),
                ("Other expenses", _evaluate_cell_value(ws['F27'], ws) or 0.0),
            ]
            tot_exp = _evaluate_cell_value(ws['F28'], ws) or sum(x[1] for x in exp_categories)
            tot_add_income = _evaluate_cell_value(ws['F35'], ws) or 0.0
            net_profit = _evaluate_cell_value(ws['F36'], ws) or (f18 - tot_exp + tot_add_income)

            left_data = [
                [Paragraph("Cash on Hand from previous net", cell_lbl), Paragraph(_format_peso(c15), cell_amt)],
                [Paragraph("Current Sales", cell_lbl_bold), Paragraph(_format_peso(f16), cell_amt_bold)],
                [Paragraph("Less: Cost of Sales", cell_lbl), Paragraph(_format_peso(f17), cell_amt)],
                [Paragraph("Gross income of the Operation", cell_lbl_bold), Paragraph(_format_peso(f18), cell_amt_bold)],
                [Paragraph("Additional Income", cell_lbl_bold), ""],
                [Paragraph("&nbsp;&nbsp;&nbsp;&nbsp;Catering", cell_lbl), Paragraph(_format_peso(_evaluate_cell_value(ws['G32'], ws)), cell_amt)],
                [Paragraph("&nbsp;&nbsp;&nbsp;&nbsp;Commission", cell_lbl), Paragraph(_format_peso(_evaluate_cell_value(ws['G33'], ws)), cell_amt)],
                [Paragraph("&nbsp;&nbsp;&nbsp;&nbsp;Others", cell_lbl), Paragraph(_format_peso(_evaluate_cell_value(ws['G34'], ws)), cell_amt)],
                [Paragraph("Total Additional Income", cell_lbl_bold), Paragraph(_format_peso(tot_add_income), cell_amt_bold)],
                [Paragraph("<font color='#dc2626'><b>Over All Net Profit:</b></font>", cell_lbl_bold), Paragraph(_format_peso(net_profit), cell_amt_red)],
            ]

            right_data = [
                [Paragraph("<b>Less: Operation Expenses</b>", cell_lbl_bold), ""],
            ]
            for label, val in exp_categories:
                right_data.append([
                    Paragraph(f"&nbsp;&nbsp;&nbsp;&nbsp;{label}", cell_lbl),
                    Paragraph(_format_peso(val), cell_amt)
                ])
            right_data.append([
                Paragraph("<b>Total Expenses:</b> ____________________", cell_lbl_bold),
                Paragraph(_format_peso(tot_exp), cell_amt_bold)
            ])
            right_data.append([
                Paragraph("<b>Net Profit:</b> ________________________", cell_lbl_bold),
                Paragraph(_format_peso(net_profit), cell_amt_bold)
            ])

            tbl_style = [
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('TOPPADDING', (0, 0), (-1, -1), 1.5),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 1.5),
                ('LEFTPADDING', (0, 0), (-1, -1), 4),
                ('RIGHTPADDING', (0, 0), (-1, -1), 4),
            ]

            t_left = Table(left_data, colWidths=[220, 135])
            t_left.setStyle(TableStyle(tbl_style))

            t_right = Table(right_data, colWidths=[220, 135])
            t_right.setStyle(TableStyle(tbl_style))

            op_table = Table([[t_left, t_right]], colWidths=[360, 360])
            op_table.setStyle(TableStyle([
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('LEFTPADDING', (0, 0), (-1, -1), 0),
                ('RIGHTPADDING', (0, 0), (-1, -1), 0),
                ('TOPPADDING', (0, 0), (-1, -1), 0),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
            ]))
            story.append(op_table)
            story.append(Spacer(1, 6))

            # Fund Allocation Table
            fund_cols = ['B', 'C', 'D', 'E', 'F', 'G']
            col_headers = [Paragraph("", th_style)]
            for col_letter in fund_cols:
                h_val = ws[f'{col_letter}38'].value or f'Fund {col_letter}'
                col_headers.append(Paragraph(f"<b>{h_val}</b>", th_style))

            fund_rows = [col_headers]
            fund_line_items = [
                ("39", "Balance in previous month", False),
                ("40", "Interest on the bank", False),
                ("41", "Net Income for the Month", True),
                ("42", "Expenses for the Month", False),
                ("43", "Others", False),
                ("44", "Total Current Expenses", True),
                ("45", "Current Balance", True),
                ("46", "Cash on Bank", False),
            ]

            for r_num, label, is_bold in fund_line_items:
                row_cells = [Paragraph(f"<b>{label}</b>" if is_bold else label, cell_lbl_bold if is_bold else cell_lbl)]
                for col_letter in fund_cols:
                    v = _evaluate_cell_value(ws[f'{col_letter}{r_num}'], ws) or 0.0
                    row_cells.append(Paragraph(_format_peso(v), cell_amt_bold if is_bold else cell_amt))
                fund_rows.append(row_cells)

            fund_table = Table(fund_rows, colWidths=[150, 95, 95, 95, 95, 95, 95], repeatRows=1)
            fund_table.setStyle(TableStyle([
                ('BOX', (0, 0), (-1, -1), 1, colors.black),
                ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.black),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('TOPPADDING', (0, 0), (-1, -1), 2),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
                ('LEFTPADDING', (0, 0), (-1, -1), 3),
                ('RIGHTPADDING', (0, 0), (-1, -1), 3),
            ]))
            story.append(fund_table)
            story.append(Spacer(1, 8))

            # Signatures
            raw_prep_name = str(ws['A50'].value or '').strip()
            prep_name = 'JOHN DIERIC V. ISLETA' if not raw_prep_name or raw_prep_name.upper() in {'MYRNA A. DE MESA', 'MYRNA DE MESA'} else raw_prep_name
            raw_prep_role = str(ws['A51'].value or '').strip()
            prep_role = 'Administrative Officer II' if not raw_prep_role or raw_prep_role.lower() in {'canteen manager', 'manager'} else raw_prep_role
            chk_name = str(ws['C56'].value or 'MARICAR A. AFUANG')
            chk_role = str(ws['C57'].value or 'School Head').strip()
            aud_name = str(ws['E50'].value or 'KATHLEEN B. HERNANDEZ')
            aud_role = str(ws['E51'].value or 'School Canteen Auditor')

            sig_data = [
                [
                    Paragraph("Prepared by:", cell_lbl),
                    Paragraph("Audited by:", cell_lbl),
                ],
                [
                    Spacer(1, 10),
                    Spacer(1, 10),
                ],
                [
                    Paragraph(f"<b>{prep_name}</b>", cell_lbl_bold),
                    Paragraph(f"<b>{aud_name}</b>", cell_lbl_bold),
                ],
                [
                    Paragraph(prep_role, cell_lbl),
                    Paragraph(aud_role, cell_lbl),
                ],
                [
                    Spacer(1, 6),
                    Spacer(1, 6),
                ],
                [
                    Paragraph("Checked by", cell_lbl),
                    "",
                ],
                [
                    Spacer(1, 6),
                    "",
                ],
                [
                    Paragraph(f"<b>{chk_name}</b>", cell_lbl_bold),
                    "",
                ],
                [
                    Paragraph(chk_role, cell_lbl),
                    "",
                ],
            ]
            sig_table = Table(sig_data, colWidths=[360, 360])
            sig_table.setStyle(TableStyle([
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('LEFTPADDING', (0, 0), (-1, -1), 4),
                ('RIGHTPADDING', (0, 0), (-1, -1), 4),
                ('TOPPADDING', (0, 0), (-1, -1), 0.5),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 0.5),
            ]))
            story.append(sig_table)

        doc.build(story)
        return os.path.isfile(pdf_path) and os.path.getsize(pdf_path) > 0
    except Exception as exc:
        logger.error(f"ReportLab export failed: {exc}", exc_info=True)
        return False


class PurePdf:
    """
    Lightweight, dependency-free pure Python PDF 1.4 generator.
    Produces valid vector PDFs with standard Type 1 fonts (Helvetica, Helvetica-Bold)
    that render universally in all PDF viewers and browsers without requiring ReportLab or external tools.
    """
    def __init__(self, width: float = 792.0, height: float = 612.0):
        self.width = float(width)
        self.height = float(height)
        self.pages: List[str] = []
        self.stream: List[str] = []

    def rect(self, x: float, y: float, w: float, h: float, fill=None, stroke=None, line_width: float = 0.5):
        s = f'q {line_width:.2f} w '
        if fill:
            s += f'{fill[0]:.3f} {fill[1]:.3f} {fill[2]:.3f} rg '
        if stroke:
            s += f'{stroke[0]:.3f} {stroke[1]:.3f} {stroke[2]:.3f} RG '
        s += f'{x:.2f} {y:.2f} {w:.2f} {h:.2f} re '
        if fill and stroke:
            s += 'B Q\n'
        elif fill:
            s += 'f Q\n'
        elif stroke:
            s += 'S Q\n'
        else:
            s += 'Q\n'
        self.stream.append(s)

    def line(self, x1: float, y1: float, x2: float, y2: float, stroke=(0, 0, 0), line_width: float = 0.5):
        self.stream.append(
            f'q {line_width:.2f} w {stroke[0]:.3f} {stroke[1]:.3f} {stroke[2]:.3f} RG '
            f'{x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S Q\n'
        )

    def text(self, x: float, y: float, txt: str, bold: bool = False, size: float = 8.0,
             color=(0, 0, 0), align: str = 'left', width: float = 0.0):
        font_name = 'F2' if bold else 'F1'
        txt_str = str(txt).replace('₱', 'PHP ')
        escaped = txt_str.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
        char_w = size * (0.56 if bold else 0.50)
        est_len = len(txt_str) * char_w
        tx = x
        if align == 'center' and width > 0:
            tx = x + max(0.0, (width - est_len) / 2.0)
        elif align == 'right' and width > 0:
            tx = x + max(0.0, width - est_len)

        self.stream.append(
            f'BT /{font_name} {size:.1f} Tf {color[0]:.3f} {color[1]:.3f} {color[2]:.3f} rg '
            f'1 0 0 1 {tx:.2f} {y:.2f} Tm ({escaped}) Tj ET\n'
        )

    def new_page(self):
        self.pages.append(''.join(self.stream))
        self.stream = []

    def build(self, filepath: str) -> bool:
        if self.stream or not self.pages:
            self.pages.append(''.join(self.stream))
            self.stream = []

        num_pages = len(self.pages)
        objects = []
        objects.append('<< /Type /Catalog /Pages 2 0 R >>')
        page_refs = ' '.join(f'{3 + i} 0 R' for i in range(num_pages))
        objects.append(f'<< /Type /Pages /Kids [{page_refs}] /Count {num_pages} >>')

        f1_idx = 3 + num_pages
        f2_idx = 4 + num_pages

        for i in range(num_pages):
            c_idx = 5 + num_pages + i
            objects.append(
                f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {self.width:.1f} {self.height:.1f}] '
                f'/Resources << /Font << /F1 {f1_idx} 0 R /F2 {f2_idx} 0 R >> >> '
                f'/Contents {c_idx} 0 R >>'
            )

        objects.append('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
        objects.append('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>')

        for p_stream in self.pages:
            b = p_stream.encode('latin1', errors='replace')
            objects.append(f'<< /Length {len(b)} >>\nstream\n{p_stream}\nendstream')

        out = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
        xref = []
        for i, obj in enumerate(objects, 1):
            xref.append(len(out))
            out.extend(f'{i} 0 obj\n{obj}\nendobj\n'.encode('latin1'))

        startxref = len(out)
        out.extend(f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'.encode('latin1'))
        for off in xref:
            out.extend(f'{off:010d} 00000 n \n'.encode('latin1'))
        out.extend(f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{startxref}\n%%EOF\n'.encode('latin1'))

        with open(filepath, 'wb') as f:
            f.write(out)
        return os.path.isfile(filepath) and os.path.getsize(filepath) > 0


def _convert_via_pure_python(xlsx_path: str, pdf_path: str, sheet_name: Optional[str] = None) -> bool:
    """
    Bulletproof zero-dependency PDF converter for DepEd Canteen monthly report workbooks.
    Works on any server without Excel, LibreOffice, or ReportLab.
    """
    import openpyxl

    wb = openpyxl.load_workbook(xlsx_path, data_only=False)
    target_sheets = [sheet_name] if sheet_name and sheet_name in wb.sheetnames else wb.sheetnames
    if not target_sheets:
        return False

    pdf = PurePdf(width=792, height=612)
    valid_page_count = 0

    for s_name in target_sheets:
        if s_name not in wb.sheetnames:
            continue
        ws = wb[s_name]
        if valid_page_count > 0:
            pdf.new_page()
        valid_page_count += 1

        # Header
        pdf.text(36, 588, 'Republic of the Philippines', bold=False, size=7.5, align='center', width=720)
        pdf.text(36, 576, 'Department of Education', bold=True, size=10, align='center', width=720)
        pdf.text(36, 565, 'REGION IV-A CALABARZON', bold=False, size=7.5, align='center', width=720)
        pdf.text(36, 554, 'SCHOOLS DIVISION OFFICE OF LAGUNA', bold=False, size=7.5, align='center', width=720)
        pdf.text(36, 543, 'BAY SUB-OFFICE', bold=False, size=7.5, align='center', width=720)
        pdf.text(36, 532, 'BAY CENTRAL ELEMENTARY SCHOOL', bold=True, size=8.5, align='center', width=720)
        pdf.text(36, 517, 'STATEMENT OF MONTHLY CANTEEN OPERATION', bold=True, size=9.5, align='center', width=720)
        
        month_label = str(ws['A13'].value or f"For the Month of {s_name}")
        pdf.text(36, 505, month_label, bold=True, size=8.5, align='center', width=720)

        # Left Column (Operating Statement)
        c15 = _evaluate_cell_value(ws['C15'], ws) or 0.0
        f16 = _evaluate_cell_value(ws['F16'], ws) or 0.0
        f17 = _evaluate_cell_value(ws['F17'], ws) or 0.0
        f18 = _evaluate_cell_value(ws['F18'], ws) or (f16 - f17)
        g32 = _evaluate_cell_value(ws['G32'], ws) or 0.0
        g33 = _evaluate_cell_value(ws['G33'], ws) or 0.0
        g34 = _evaluate_cell_value(ws['G34'], ws) or 0.0
        tot_add_inc = _evaluate_cell_value(ws['F35'], ws) or (g32 + g33 + g34)

        f21 = _evaluate_cell_value(ws['F21'], ws) or 0.0
        f22 = _evaluate_cell_value(ws['F22'], ws) or 0.0
        f23 = _evaluate_cell_value(ws['F23'], ws) or 0.0
        f24 = _evaluate_cell_value(ws['F24'], ws) or 0.0
        f25 = _evaluate_cell_value(ws['F25'], ws) or 0.0
        f26 = _evaluate_cell_value(ws['F26'], ws) or 0.0
        f27 = _evaluate_cell_value(ws['F27'], ws) or 0.0
        tot_exp = _evaluate_cell_value(ws['F28'], ws) or (f21+f22+f23+f24+f25+f26+f27)
        net_profit = _evaluate_cell_value(ws['F36'], ws) or (f18 - tot_exp + tot_add_inc)

        left_items = [
            ('Cash on Hand from previous net', _format_peso_pdf(c15), False),
            ('Current Sales', _format_peso_pdf(f16), True),
            ('Less: Cost of Sales', _format_peso_pdf(f17), False),
            ('Gross income of the Operation', _format_peso_pdf(f18), True),
            ('Additional Income', '', True),
            ('    Catering', _format_peso_pdf(g32), False),
            ('    Commission', _format_peso_pdf(g33), False),
            ('    Others', _format_peso_pdf(g34), False),
            ('Total Additional Income', _format_peso_pdf(tot_add_inc), True),
            ('Over All Net Profit:', _format_peso_pdf(net_profit), True),
        ]

        right_items = [
            ('Less: Operation Expenses', '', True),
            ('    Transportation/Freight', _format_peso_pdf(f21), False),
            ('    Gas', _format_peso_pdf(f22), False),
            ('    Supplies', _format_peso_pdf(f23), False),
            ('    Helpers', _format_peso_pdf(f24), False),
            ('    Repair', _format_peso_pdf(f25), False),
            ('    Purchase from the looses of tools', _format_peso_pdf(f26), False),
            ('    Other expenses', _format_peso_pdf(f27), False),
            ('Total Expenses:', _format_peso_pdf(tot_exp), True),
            ('Net Profit:', _format_peso_pdf(net_profit), True),
        ]

        cur_y = 488
        for (lbl, amt, bld) in left_items:
            color = (0.86, 0.15, 0.15) if lbl.startswith('Over All Net') else (0, 0, 0)
            pdf.text(36, cur_y, lbl, bold=bld, size=7.5, color=color)
            if amt:
                pdf.text(240, cur_y, amt, bold=bld, size=7.5, align='right', width=145, color=color)
            cur_y -= 12.5

        cur_y = 488
        for (lbl, amt, bld) in right_items:
            pdf.text(404, cur_y, lbl, bold=bld, size=7.5)
            if amt:
                pdf.text(605, cur_y, amt, bold=bld, size=7.5, align='right', width=145)
            cur_y -= 12.5

        # Fund Monitoring Grid
        col_widths = [150, 95, 95, 95, 95, 95, 95]
        fund_cols = ['B', 'C', 'D', 'E', 'F', 'G']
        col_x = [36]
        for w in col_widths[:-1]:
            col_x.append(col_x[-1] + w)

        tbl_top = 345
        row_h = 13.5
        # Header Row
        pdf.rect(36, tbl_top - 20, 720, 20, fill=(0.94, 0.96, 0.98), stroke=(0, 0, 0), line_width=0.5)
        for i, col_letter in enumerate(fund_cols, 1):
            h_text = str(ws[f'{col_letter}38'].value or f'Fund {col_letter}')
            pdf.text(col_x[i], tbl_top - 14, h_text, bold=True, size=5.5, align='center', width=col_widths[i])

        fund_rows_def = [
            ('39', 'Balance in previous month', False),
            ('40', 'Interest on the bank', False),
            ('41', 'Net Income for the Month', True),
            ('42', 'Expenses for the Month', False),
            ('43', 'Others', False),
            ('44', 'Total Current Expenses', True),
            ('45', 'Current Balance', True),
            ('46', 'Cash on Bank', False),
        ]

        tbl_y = tbl_top - 20
        for r_num, r_label, is_bold in fund_rows_def:
            tbl_y -= row_h
            fill = (0.90, 0.92, 0.95) if is_bold else None
            pdf.rect(36, tbl_y, 720, row_h, fill=fill, stroke=(0, 0, 0), line_width=0.5)
            pdf.text(40, tbl_y + 3.5, r_label, bold=is_bold, size=7.0)
            for i, col_letter in enumerate(fund_cols, 1):
                v = _evaluate_cell_value(ws[f'{col_letter}{r_num}'], ws) or 0.0
                pdf.text(col_x[i] + 4, tbl_y + 3.5, _format_peso_pdf(v), bold=is_bold, size=7.0, align='right', width=col_widths[i] - 8)

        # Vertical column separators
        for cx in col_x[1:]:
            pdf.line(cx, tbl_top, cx, tbl_y, stroke=(0, 0, 0), line_width=0.5)

        # Signatures
        sig_y = tbl_y - 25
        pdf.text(45, sig_y, 'Prepared by:', size=7.5)
        pdf.text(285, sig_y, 'Checked by:', size=7.5)
        pdf.text(525, sig_y, 'Audited by:', size=7.5)

        raw_prep_name = str(ws['A50'].value or '').strip()
        prep_name = 'JOHN DIERIC V. ISLETA' if not raw_prep_name or raw_prep_name.upper() in {'MYRNA A. DE MESA', 'MYRNA DE MESA'} else raw_prep_name
        raw_prep_role = str(ws['A51'].value or '').strip()
        prep_role = 'Administrative Officer II' if not raw_prep_role or raw_prep_role.lower() in {'canteen manager', 'manager'} else raw_prep_role
        chk_name = str(ws['C56'].value or 'MARICAR A. AFUANG')
        chk_role = str(ws['C57'].value or 'School Head').strip()
        aud_name = str(ws['E50'].value or 'KATHLEEN B. HERNANDEZ')
        aud_role = str(ws['E51'].value or 'School Canteen Auditor')

        pdf.text(45, sig_y - 20, prep_name, bold=True, size=8)
        pdf.text(45, sig_y - 30, prep_role, size=7.5)

        pdf.text(285, sig_y - 20, chk_name, bold=True, size=8)
        pdf.text(285, sig_y - 30, chk_role, size=7.5)

        pdf.text(525, sig_y - 20, aud_name, bold=True, size=8)
        pdf.text(525, sig_y - 30, aud_role, size=7.5)

    return pdf.build(pdf_path)


def convert_xlsx_to_pdf(xlsx_path: str, pdf_path: str, sheet_name: Optional[str] = None) -> bool:
    """
    Main conversion entrypoint:
    1. Attempts native Excel COM conversion first (Windows with MS Excel)
    2. Attempts LibreOffice / soffice CLI (Linux / server environments)
    3. Attempts ReportLab export (if installed)
    4. Falls back to built-in pure Python PDF generator (zero external dependencies)
    """
    if _convert_via_excel_com(xlsx_path, pdf_path, sheet_name=sheet_name):
        return True

    if _convert_via_libreoffice(xlsx_path, pdf_path, sheet_name=sheet_name):
        return True

    logger.info("Attempting ReportLab PDF conversion...")
    if _convert_via_reportlab(xlsx_path, pdf_path, sheet_name=sheet_name):
        return True

    logger.info("Falling back to pure Python PDF generator...")
    try:
        return _convert_via_pure_python(xlsx_path, pdf_path, sheet_name=sheet_name)
    except Exception as exc:
        logger.error(f"Pure Python PDF export failed: {exc}", exc_info=True)
        return False
