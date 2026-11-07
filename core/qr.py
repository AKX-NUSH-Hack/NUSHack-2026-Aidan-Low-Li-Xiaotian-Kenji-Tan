from re import sub, search, IGNORECASE

try:
    from qrcode import QRCode
    from qrcode.constants import ERROR_CORRECT_H
    QR_AVAILABLE = True
except ImportError:  # pragma: no cover - depends on the machine
    QRCode = None
    ERROR_CORRECT_H = 2
    QR_AVAILABLE = False

LOGO_FRACTION = 0.22
LOGO_PADDING = 0.03

def qr_matrix(text: str) -> list:
    if not QR_AVAILABLE:
        raise RuntimeError("The 'qrcode' package is not installed. Run: pip install -r requirements.txt")
    qr = QRCode(error_correction=ERROR_CORRECT_H, box_size=1, border=2)
    qr.add_data(text)
    qr.make(fit=True)
    return qr.get_matrix()

def matrix_to_svg(matrix: list, logo_svg: str = "", dark: str = "#0f172a", light: str = "#ffffff",
                  size: int = 512) -> str:
    n = len(matrix)
    cells = []
    for y, row in enumerate(matrix):
        x = 0
        while x < n:
            if row[x]:
                run = x
                while run < n and row[run]:
                    run += 1
                cells.append(f"M{x} {y}h{run - x}v1h-{run - x}z")
                x = run
            else:
                x += 1

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {n} {n}" '
        f'shape-rendering="crispEdges" role="img" aria-label="QR code">',
        f'<rect width="{n}" height="{n}" fill="{light}"/>',
        f'<path d="{"".join(cells)}" fill="{dark}"/>',
    ]

    if logo_svg:
        box = n * LOGO_FRACTION
        pad = n * LOGO_PADDING
        outer = box + pad * 2
        x0 = (n - outer) / 2
        inner = _embed_logo(logo_svg, x0 + pad, x0 + pad, box)
        if inner:
            parts.append(f'<rect x="{x0:.2f}" y="{x0:.2f}" width="{outer:.2f}" height="{outer:.2f}" '
                         f'rx="{pad:.2f}" fill="{light}"/>')
            parts.append(inner)

    parts.append("</svg>")
    return "".join(parts)

def _embed_logo(logo_svg: str, x: float, y: float, size: float) -> str:
    match = search(r"<svg\b[^>]*>", logo_svg, IGNORECASE)
    if not match:
        return ""
    open_tag = match.group(0)
    open_tag = sub(r'\s(x|y|width|height)="[^"]*"', "", open_tag)
    open_tag = open_tag[:-1] + (f' x="{x:.2f}" y="{y:.2f}" width="{size:.2f}" height="{size:.2f}" '
                                f'preserveAspectRatio="xMidYMid meet">')
    return open_tag + logo_svg[match.end():]

def qr_svg(text: str, logo_svg: str = "") -> str:
    return matrix_to_svg(qr_matrix(text), logo_svg)