"""
Prepara os dados dos testes automáticos (só dados FALSOS — nunca use diários reais aqui).

Cria, dentro de testes/saida/:
  em_branco/  3 diários em branco falsos, com o mesmo layout e cabeçalho do PDF da UDC:
              CIRCUITOS ELÉTRICOS (turmas GELE4N e GELE6N) e ELETRÔNICA II (turma GELE4N)
  python/     os mesmos diários preenchidos pelo diario.py (a "referência")
  dados.json  os dados usados (datas, chamada, notas...) e os alunos de cada PDF,
              para o teste web preencher exatamente igual

Uso:  python3 testes/gerar_pdfs_falsos.py
Precisa de: reportlab, pdfplumber, pypdf, openpyxl  (pip install reportlab pdfplumber pypdf openpyxl)
"""
import json
import sys
from datetime import date, timedelta
from pathlib import Path

import openpyxl
from reportlab.pdfgen import canvas

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
import diario  # noqa: E402  (o programa Python original, usado como referência)

SAIDA = Path(__file__).resolve().parent / "saida"
(SAIDA / "em_branco").mkdir(parents=True, exist_ok=True)
(SAIDA / "python").mkdir(parents=True, exist_ok=True)

H, W = 595.28, 841.89  # A4 deitado

# Cada PDF: (arquivo, disciplina, turma, alunos)
PDFS = [
    ("doc.pdf", "CIRCUITOS ELÉTRICOS", "GELE4N",
     [("1000000001", "ANA FICTÍCIA"), ("1000000002", "BRUNO EXEMPLO"), ("1000000003", "CARLA TESTE")]),
    ("doc (1).pdf", "CIRCUITOS ELÉTRICOS", "GELE6N",
     [("2000000001", "DANIEL FICTÍCIO"), ("2000000002", "ÉRICA EXEMPLO"),
      ("2000000003", "FÁBIO TESTE"), ("2000000004", "GISELE MODELO")]),
    ("doc (2).pdf", "ELETRÔNICA II", "GELE4N",
     [("1000000001", "ANA FICTÍCIA"), ("1000000002", "BRUNO EXEMPLO")]),
]
SEMESTRE = "2026/1"


def cabecalho(c, disciplina, turma):
    """Cabeçalho igual ao do PDF real: rótulos numa linha, valores logo abaixo."""
    c.setFont("Helvetica", 6)
    for x, rotulo in [(173, "DISCIPLINA:"), (371, "PROFESSOR(A):"), (564, "TURMA:"), (612, "CURSO:"), (768, "SEM.:")]:
        c.drawString(x, H - 46, rotulo)
    c.setFont("Helvetica-Bold", 8)
    for x, valor in [(173, disciplina), (371, "PROFESSOR FICTÍCIO"), (564, turma),
                     (612, "Engenharia Fictícia"), (768, SEMESTRE)]:
        c.drawString(x, H - 61, valor)


def pdf_em_branco(arquivo, disciplina, turma, alunos):
    c = canvas.Canvas(str(SAIDA / "em_branco" / arquivo), pagesize=(W, H))
    for bim in (1, 2):  # mesma ordem do PDF real: freq. 1º, freq. 2º, conteúdo 1º, conteúdo 2º
        cabecalho(c, disciplina, turma)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(700, H - 92, "AVALIAÇÕES")
        c.setFont("Helvetica", 7)
        c.drawString(730 if bim == 2 else 786, H - 110, "2º BIM" if bim == 2 else "MÉDIA")
        for i, (ra, nome) in enumerate(alunos):
            topo = diario.LINHA_DIA[1] + i * diario.ALTURA_LINHA_ALUNO
            if i == 1:  # um RA desenhado letra por letra (alguns PDFs são assim)
                for k, ch in enumerate(ra):
                    c.drawString(30 + k * 3.9, H - (topo + 8.2), ch)
            else:
                c.drawString(30, H - (topo + 8.2), ra)
            c.drawString(95, H - (topo + 8.2), nome)
            c.line(28, H - topo, 808, H - topo)
        c._code.append("0 0 1 rg")  # deixa a cor azul "ligada": o app tem que isolar isso
        c.showPage()
    for bim in (1, 2):
        cabecalho(c, disciplina, turma)
        c.setFont("Helvetica", 8)
        c.drawString(300, 40, "Assinatura do Professor")
        if bim == 2:
            c.drawString(300, H - 90, "2º BIM")
        c.showPage()
    c.save()


# ---- Dados inventados, um conjunto por disciplina ----
inicio2 = date(2026, 4, 1)
quartas = [date(2026, 2, 4) + timedelta(days=7 * k) for k in range(18)]
ciclo = ["C", "F", "CF", "FC", "", "C"]
dados = {"materias": {}, "ref": {}, "inicio2bim": inicio2.isoformat()}
for arquivo, disciplina, turma, alunos in PDFS:
    pdf_em_branco(arquivo, disciplina, turma, alunos)
    chave = f"{disciplina}|{SEMESTRE}"
    datas = quartas if disciplina.startswith("CIRCUITOS") else quartas[:14]
    m = dados["materias"].setdefault(chave, {
        # formato ANTIGO de propósito: o teste também confere a conversão para o formato novo
        "config": {"pesoProva": "0.7", "pesoAtiv": "0.3", "inicio2bim": inicio2.isoformat()},
        "datas": [d.isoformat() for d in datas], "presencas": {}, "notas": {},
        "conteudos": {d.isoformat(): f"Conteúdo da aula {j + 1} — {disciplina.lower()}"
                      for j, d in enumerate(datas) if j % 5 != 2},
    })
    for i, (ra, _) in enumerate(alunos):
        base = int(ra[-1]) + len(disciplina)
        m["presencas"][ra] = {d.isoformat(): ciclo[(base + j) % 6] for j, d in enumerate(datas) if ciclo[(base + j) % 6]}
        m["notas"][ra] = {"p1": str(5 + base % 5), "a1": str(6 + base % 4), "p2": str(4 + base % 6), "a2": "8,5"}
    dados["ref"][arquivo] = {"chave": chave, "turma": turma, "alunos": [[ra, n] for ra, n in alunos]}

    # Planilha no formato do diario.py e o PDF de referência
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Config"
    for i, (k, v) in enumerate([("Peso da prova", 0.7), ("Peso das atividades", 0.3),
                                ("Início do 2º bimestre", inicio2), ("Aulas por dia", 2)], 1):
        ws.cell(i, 1, k)
        ws.cell(i, 2, v)
    ws = wb.create_sheet("Chamada")
    ws.cell(1, 1, "RA")
    for j, d in enumerate(datas):
        ws.cell(1, 3 + j, d)
    wn = wb.create_sheet("Notas")
    for i, (ra, nome) in enumerate(alunos, 2):
        ws.cell(i, 1, ra)
        wn.cell(i, 1, ra)
        for j, d in enumerate(datas):
            ws.cell(i, 3 + j, m["presencas"][ra].get(d.isoformat()))
        for j, chave_nota in enumerate(["p1", "a1", "p2", "a2"]):
            wn.cell(i, 3 + j, m["notas"][ra][chave_nota])
    wc = wb.create_sheet("Conteúdo")
    for k, (d, t) in enumerate(m["conteudos"].items(), 2):
        wc.cell(k, 1, date.fromisoformat(d))
        wc.cell(k, 2, t)
    planilha = SAIDA / "planilha_tmp.xlsx"
    wb.save(planilha)
    diario.preencher(str(SAIDA / "em_branco" / arquivo), str(planilha),
                     str(SAIDA / "python" / f"{disciplina} - {turma}.pdf"))

(SAIDA / "dados.json").write_text(json.dumps(dados, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"OK: {len(PDFS)} PDFs falsos e referências do diario.py em {SAIDA}")
