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


def _evaluate_cell_value(cell, ws):
    val = cell.value
    if val is None:
        return None
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
    return val


def _format_peso(val) -> str:
    if val is None or val == '' or val == 0:
        return '₱                  -'
    try:
        f = float(val)
        if f == 0.0:
            return '₱                  -'
        if f < 0:
            return f'-₱{abs(f):>14,.2f}'
        return f'₱{f:>15,.2f}'
    except (ValueError, TypeError):
        return str(val)


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
        has_logo = os.path.isfile(logo_path)

        story = []

        for s_idx, s_name in enumerate(target_sheets):
            if s_name not in wb.sheetnames:
                continue
            ws = wb[s_name]

            if s_idx > 0:
                story.append(PageBreak())

            # Header
            if has_logo:
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
            else:
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
            prep_name = ws['A50'].value or 'MYRNA A. DE MESA'
            prep_role = ws['A51'].value or 'Canteen Manager'
            chk_name = ws['C56'].value or 'MARICAR A. AFUANG'
            chk_role = (ws['C57'].value or 'School Head').strip()
            aud_name = ws['E50'].value or 'KATHLEEN B. HERNANDEZ'
            aud_role = ws['E51'].value or 'School Canteen Auditor'

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


def convert_xlsx_to_pdf(xlsx_path: str, pdf_path: str, sheet_name: Optional[str] = None) -> bool:
    """
    Main conversion entrypoint:
    Attempts native Excel COM conversion first (matches Excel's exact Print-to-PDF output),
    falling back to ReportLab if Excel is not available.
    """
    if _convert_via_excel_com(xlsx_path, pdf_path, sheet_name=sheet_name):
        return True

    logger.info("Falling back to ReportLab PDF conversion...")
    return _convert_via_reportlab(xlsx_path, pdf_path, sheet_name=sheet_name)
