# Korean report font

`NotoSansKR.ttf` is a static weight-400 instance of Google Fonts' Noto Sans KR,
licensed under the accompanying `NotoSansKR-OFL.txt` (SIL OFL 1.1).

Source: https://github.com/google/fonts/tree/main/ofl/notosanskr
Source file: `NotoSansKR[wght].ttf` retrieved 2026-10-27.
Original SHA-256: `194018e6b2b293a7964f037b25c0249ce1418bc9ab3c971060a03aa57861e252`.
Static SHA-256: `e9054b9dee34c35f3315a0fb3420378903b7aec0ed4cc2e351f5939eed13d3da`.

Conversion uses FontTools `instantiateVariableFont(TTFont(source), {'wght': 400})`.
The static font is embedded in full: subsetting this Korean composite font with
pdf-lib/fontkit lost visible glyphs in render tests. Per-glyph positioning keeps
measured wrapping and rendered text advances consistent.
