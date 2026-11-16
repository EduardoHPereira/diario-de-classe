"""
Compara dois PDFs letra por letra: texto, fonte, tamanho, cor e posição (tolerância 0,01 pt),
e também as linhas desenhadas. Usado para conferir se o app web gera o mesmo diário do diario.py.

Uso:  python3 testes/comparar_pdfs.py pasta_referencia pasta_web [--ignorar-notas]

--ignorar-notas: nas páginas de frequência, ignora as colunas de nota (x >= 728). O app web
arredonda as médias de 0,5 em 0,5 e preenche EXAME/FINAL; o diario.py não faz isso.
Imprime um JSON: {"arquivos": N, "letras": N, "diferencas": N, "detalhes": [...]}
"""
import json
import sys
from pathlib import Path

import pdfplumber


def extrair(caminho):
    paginas = []
    with pdfplumber.open(caminho) as pdf:
        for pg in pdf.pages:
            letras = sorted((round(c["top"], 3), round(c["x0"], 3), c["text"], c["fontname"].split("+")[-1],
                             round(c["size"], 3), tuple(c["non_stroking_color"] or ())) for c in pg.chars)
            linhas = sorted((round(ln["x0"], 3), round(ln["top"], 3), round(ln["bottom"], 3)) for ln in pg.lines)
            paginas.append((letras, linhas, "AVALIAÇÕES" in (pg.extract_text() or "")))
    return paginas


def preto(cor):
    return cor in ((0,), (0.0, 0.0, 0.0))


def main():
    ref, web = Path(sys.argv[1]), Path(sys.argv[2])
    ignorar = "--ignorar-notas" in sys.argv
    total = {"arquivos": 0, "letras": 0, "diferencas": 0, "detalhes": []}
    for arq_ref in sorted(ref.glob("*.pdf")):
        arq_web = web / arq_ref.name
        total["arquivos"] += 1
        if not arq_web.exists():
            total["diferencas"] += 1
            total["detalhes"].append(f"{arq_ref.name}: não foi gerado pelo app")
            continue
        a, b = extrair(arq_ref), extrair(arq_web)
        if len(a) != len(b):
            total["diferencas"] += 1
            total["detalhes"].append(f"{arq_ref.name}: número de páginas diferente")
            continue
        for n, ((la, lna, freq), (lb, lnb, _)) in enumerate(zip(a, b), 1):
            if ignorar and freq:
                la = [c for c in la if c[1] < 728]
                lb = [c for c in lb if c[1] < 728]
            if len(la) != len(lb) or lna != lnb:
                total["diferencas"] += 1
                total["detalhes"].append(f"{arq_ref.name} pág. {n}: {len(la)} x {len(lb)} letras ou linhas diferentes")
                continue
            for x, y in zip(la, lb):
                total["letras"] += 1
                igual = (x[2:4] == y[2:4] and abs(x[4] - y[4]) < 1e-6 and preto(x[5]) and preto(y[5])
                         and abs(x[0] - y[0]) <= 0.01 and abs(x[1] - y[1]) <= 0.01)
                if not igual:
                    total["diferencas"] += 1
                    if len(total["detalhes"]) < 10:
                        total["detalhes"].append(f"{arq_ref.name} pág. {n}: {x} x {y}")
    print(json.dumps(total, ensure_ascii=False))


if __name__ == "__main__":
    main()
