"""
Preenchedor de Diários de Classe (UDC)
======================================

O programa faz duas coisas:

  1) criar-planilha  -> lê o PDF em branco do diário e cria uma planilha Excel
                        já com os alunos da turma, para você preencher.
  2) preencher       -> lê o PDF em branco + a planilha preenchida e gera
                        o PDF do diário com datas, C/F, faltas, médias e conteúdos.

Como usar (no terminal, dentro da pasta do programa):

    python diario.py criar-planilha  diario_em_branco.pdf
    python diario.py preencher       diario_em_branco.pdf  planilha.xlsx

Ideia central: NÃO editamos o PDF original. Criamos um PDF "transparente"
só com os textos novos (a "camada") e colamos por cima de cada página,
como um carimbo. Bibliotecas usadas:
  - pdfplumber : LER o PDF (achar os RAs, os bimestres, etc.)
  - reportlab  : DESENHAR a camada com os textos
  - pypdf      : JUNTAR a camada com o PDF original
  - openpyxl   : ler e escrever a planilha Excel
"""

import io
import logging
import sys
from datetime import date, datetime
from pathlib import Path

import openpyxl
import pdfplumber
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from pypdf import PdfReader, PdfWriter
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

# O PDF do sistema da faculdade tem uns "defeitos" inofensivos no começo do arquivo;
# o pypdf reclama, mas lê normalmente. Isto esconde essas mensagens.
logging.getLogger("pypdf").setLevel(logging.ERROR)

# ---------------------------------------------------------------------------
# MEDIDAS DO FORMULÁRIO (em pontos; 1 ponto = 1/72 de polegada ≈ 0,35 mm)
# Medidas lendo as linhas da grade do PDF em branco com o pdfplumber.
# Aqui o "y" é contado DE CIMA PARA BAIXO (como no pdfplumber).
# ---------------------------------------------------------------------------
ALTURA_PAGINA = 595.28  # A4 deitado

# Página de frequência
COL_DATAS_INICIO = 229.6   # borda esquerda da 1ª coluna de data
LARGURA_COLUNA = 11.34     # largura de cada quadradinho
MAX_COLUNAS = 42           # quantas colunas de data cabem
LINHA_MES = (102.0, 113.4)     # faixa vertical onde vai o nome do mês
LINHA_DIA = (113.4, 124.7)     # faixa vertical onde vai o dia
ALTURA_LINHA_ALUNO = 11.34
COL_FALTAS = (705.8, 728.5)
COL_MEDIA_1BIM = (785.2, 807.9)   # coluna "MÉDIA" na página do 1º bimestre
COL_MEDIA_2BIM = (728.5, 754.0)   # coluna "2º BIM" na página do 2º bimestre

# Página de conteúdo
CONTEUDO_PRIMEIRA_LINHA = 121.9
CONTEUDO_ALTURA_LINHA = 14.17
CONTEUDO_LINHAS_POR_LADO = 22
# (data, nº, texto) para o lado esquerdo e o lado direito da tabela
CONTEUDO_COLUNAS = [
    {"data": (28.4, 85.0), "num": (85.0, 107.7), "texto_x": 109.2, "texto_fim": 411.0},
    {"data": (411.0, 467.7), "num": (467.7, 496.1), "texto_x": 497.6, "texto_fim": 807.9},
]

MESES = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO",
         "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"]


# ===========================================================================
# PARTE 1 — LER O PDF EM BRANCO
# ===========================================================================

def ler_pdf_em_branco(caminho_pdf):
    """Descobre o que tem em cada página: tipo, bimestre e onde está cada aluno.

    Devolve uma lista, uma entrada por página, por exemplo:
      {"tipo": "frequencia", "bimestre": 1, "alunos": {"0252252010": (124.7, "DIEGO ...")}}
      {"tipo": "conteudo",   "bimestre": 1}
    """
    paginas = []
    with pdfplumber.open(caminho_pdf) as pdf:
        for pagina in pdf.pages:
            texto = pagina.extract_text() or ""
            bimestre = 2 if "2º BIM" in texto else 1

            if "AVALIAÇÕES" in texto:
                tipo = "frequencia"
            elif "Assinatura do Professor" in texto:
                tipo = "conteudo"
            else:
                tipo = "desconhecida"

            alunos = {}
            if tipo == "frequencia":
                palavras = pagina.extract_words()
                for p in palavras:
                    # O RA é uma palavra só de dígitos, na coluna da esquerda
                    if p["x0"] < 40 and p["text"].isdigit() and len(p["text"]) >= 8:
                        # descobre em qual linha da grade o RA está
                        topo_linha = LINHA_DIA[1] + int((p["top"] - LINHA_DIA[1]) // ALTURA_LINHA_ALUNO) * ALTURA_LINHA_ALUNO
                        # junta as palavras do nome que estão na mesma altura
                        nome = " ".join(w["text"] for w in palavras
                                        if abs(w["top"] - p["top"]) < 2 and 90 < w["x0"] < 229)
                        alunos[p["text"]] = (topo_linha, nome)

            paginas.append({"tipo": tipo, "bimestre": bimestre, "alunos": alunos})
    return paginas


# ===========================================================================
# PARTE 2 — CRIAR A PLANILHA MODELO
# ===========================================================================

def criar_planilha(caminho_pdf, caminho_saida=None):
    paginas = ler_pdf_em_branco(caminho_pdf)
    alunos = {}
    for pg in paginas:
        alunos.update({ra: nome for ra, (_, nome) in pg["alunos"].items()})
    if not alunos:
        sys.exit("Não encontrei alunos no PDF. É mesmo um diário em branco?")

    wb = openpyxl.Workbook()
    negrito = Font(bold=True)
    cinza = PatternFill("solid", fgColor="DDDDDD")

    # --- Aba Config ---
    ws = wb.active
    ws.title = "Config"
    config = [
        ("Peso da prova", 0.7),
        ("Peso das atividades", 0.3),
        ("Início do 2º bimestre", None),
        ("Aulas por dia", 2),
    ]
    for i, (nome, valor) in enumerate(config, start=1):
        ws.cell(i, 1, nome).font = negrito
        c = ws.cell(i, 2, valor)
        if nome.startswith("Início"):
            c.number_format = "DD/MM/YYYY"
    ws["D1"] = "Média = (prova × peso da prova + atividades × peso das atividades) ÷ (soma dos pesos)"
    ws["D3"] = "Primeira aula do 2º bimestre. Aulas antes dessa data vão para o 1º."
    ws.column_dimensions["A"].width = 24
    ws.column_dimensions["B"].width = 14

    # --- Aba Chamada ---
    ws = wb.create_sheet("Chamada")
    ws["A1"], ws["B1"] = "RA", "Nome"
    for c in ("A1", "B1"):
        ws[c].font, ws[c].fill = negrito, cinza
    for i, (ra, nome) in enumerate(alunos.items(), start=2):
        ws.cell(i, 1, ra)
        ws.cell(i, 2, nome)
    ws.column_dimensions["A"].width = 13
    ws.column_dimensions["B"].width = 40
    ws.freeze_panes = "C2"
    ws["C1"] = "← coloque a DATA de cada aula aqui na linha 1 (uma coluna por dia)"

    # --- Aba Conteúdo ---
    ws = wb.create_sheet("Conteúdo")
    ws["A1"], ws["B1"] = "Data", "Conteúdo"
    for c in ("A1", "B1"):
        ws[c].font, ws[c].fill = negrito, cinza
    ws.column_dimensions["A"].width = 12
    ws.column_dimensions["B"].width = 60

    # --- Aba Notas ---
    ws = wb.create_sheet("Notas")
    cab = ["RA", "Nome", "Prova 1º Bim", "Atividades 1º Bim", "Prova 2º Bim", "Atividades 2º Bim"]
    for j, t in enumerate(cab, start=1):
        c = ws.cell(1, j, t)
        c.font, c.fill = negrito, cinza
        ws.column_dimensions[get_column_letter(j)].width = 18 if j > 2 else (13 if j == 1 else 40)
    for i, (ra, nome) in enumerate(alunos.items(), start=2):
        ws.cell(i, 1, ra)
        ws.cell(i, 2, nome)

    caminho_saida = caminho_saida or Path(caminho_pdf).with_name(Path(caminho_pdf).stem + "_planilha.xlsx")
    wb.save(caminho_saida)
    print(f"Planilha criada: {caminho_saida}  ({len(alunos)} alunos)")
    return caminho_saida


# ===========================================================================
# PARTE 3 — LER A PLANILHA PREENCHIDA
# ===========================================================================

def para_data(valor):
    """Aceita data do Excel ou texto 'dd/mm/aaaa' e devolve um objeto date."""
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor
    if isinstance(valor, str) and valor.strip():
        return datetime.strptime(valor.strip(), "%d/%m/%Y").date()
    return None


def para_numero(valor):
    """Aceita 7, 7.5, '7,5' ... e devolve float (ou None se vazio)."""
    if valor is None or str(valor).strip() == "":
        return None
    return float(str(valor).replace(",", "."))


def ler_planilha(caminho):
    wb = openpyxl.load_workbook(caminho, data_only=True)  # data_only: pega o RESULTADO das fórmulas

    # Config
    cfg = {}
    for linha in wb["Config"].iter_rows(min_row=1, max_col=2, values_only=True):
        if linha[0]:
            cfg[linha[0]] = linha[1]
    peso_prova = para_numero(cfg.get("Peso da prova")) or 1
    peso_ativ = para_numero(cfg.get("Peso das atividades")) or 0
    inicio_2bim = para_data(cfg.get("Início do 2º bimestre"))
    aulas_por_dia = int(cfg.get("Aulas por dia") or 2)
    if not inicio_2bim:
        sys.exit("Preencha 'Início do 2º bimestre' na aba Config.")

    # Chamada: linha 1 = datas; linhas seguintes = alunos
    ws = wb["Chamada"]
    datas = []  # lista de (indice_da_coluna, data)
    for col in range(3, ws.max_column + 1):
        d = ws.cell(1, col).value
        if isinstance(d, str) and d.startswith("←"):
            continue  # é só a dica do modelo
        d = para_data(d)
        if d:
            datas.append((col, d))
    datas.sort(key=lambda x: x[1])

    presencas = {}  # presencas[ra][data] = ["C", "F"] (uma letra por aula) ou None
    for linha in range(2, ws.max_row + 1):
        ra = ws.cell(linha, 1).value
        if not ra:
            continue
        ra = str(ra).strip()
        presencas[ra] = {}
        for col, d in datas:
            bruto = str(ws.cell(linha, col).value or "").upper().replace(" ", "")
            if bruto == "":
                presencas[ra][d] = None       # dia sem chamada
            elif set(bruto) <= {"C", "F"} and len(bruto) in (1, aulas_por_dia):
                # "C" vira ["C","C"]; "CF" fica ["C","F"]
                presencas[ra][d] = list(bruto * aulas_por_dia) if len(bruto) == 1 else list(bruto)
            else:
                sys.exit(f"Valor inválido na Chamada, célula {get_column_letter(col)}{linha}: '{bruto}'. "
                         f"Use C, F, ou uma letra por aula (ex.: CF).")

    # Conteúdo
    conteudos = {}
    for d, texto in wb["Conteúdo"].iter_rows(min_row=2, max_col=2, values_only=True):
        d = para_data(d)
        if d:
            conteudos[d] = (texto or "").strip()

    # Notas -> médias por bimestre
    medias = {}  # medias[ra] = {1: 8.5, 2: 7.0}
    for linha in wb["Notas"].iter_rows(min_row=2, max_col=6, values_only=True):
        ra = linha[0]
        if not ra:
            continue
        medias[str(ra).strip()] = {}
        for bim, (prova, ativ) in {1: linha[2:4], 2: linha[4:6]}.items():
            p, a = para_numero(prova), para_numero(ativ)
            if p is not None and a is not None:
                medias[str(ra).strip()][bim] = (p * peso_prova + a * peso_ativ) / (peso_prova + peso_ativ)
            elif p is not None and peso_ativ == 0:
                medias[str(ra).strip()][bim] = p

    # Todas as datas de aula (da chamada e do conteúdo), separadas por bimestre
    todas = sorted(set(d for _, d in datas) | set(conteudos))
    por_bimestre = {1: [d for d in todas if d < inicio_2bim],
                    2: [d for d in todas if d >= inicio_2bim]}

    return {
        "aulas_por_dia": aulas_por_dia,
        "datas": por_bimestre,
        "presencas": presencas,
        "conteudos": conteudos,
        "medias": medias,
    }


# ===========================================================================
# PARTE 4 — DESENHAR A CAMADA DE TEXTO
# ===========================================================================

def texto_centralizado(c, texto, x0, x1, y_topo, y_base, fonte="Helvetica", tamanho=7.0):
    """Escreve 'texto' centralizado dentro do retângulo (x0..x1, y_topo..y_base).
    Os y vêm no padrão "de cima para baixo"; o reportlab conta de baixo para cima,
    por isso convertemos com ALTURA_PAGINA - y."""
    largura = stringWidth(texto, fonte, tamanho)
    x = (x0 + x1) / 2 - largura / 2
    y_meio = (y_topo + y_base) / 2
    c.setFont(fonte, tamanho)
    c.drawString(x, ALTURA_PAGINA - (y_meio + tamanho * 0.35), texto)


def texto_esquerda(c, texto, x, x_limite, y_topo, y_base, fonte="Helvetica", tamanho=7.5):
    """Escreve alinhado à esquerda; se não couber, diminui a fonte."""
    while stringWidth(texto, fonte, tamanho) > (x_limite - x - 2) and tamanho > 5:
        tamanho -= 0.25
    c.setFont(fonte, tamanho)
    y_meio = (y_topo + y_base) / 2
    c.drawString(x, ALTURA_PAGINA - (y_meio + tamanho * 0.35), texto)


def formatar_nota(n):
    return f"{n:.1f}".replace(".", ",")


def desenhar_frequencia(c, pagina, dados):
    bim = pagina["bimestre"]
    aulas = dados["aulas_por_dia"]
    datas = dados["datas"][bim]

    # Cada dia vira 'aulas' colunas (ex.: 2 colunas com a mesma data)
    colunas = [d for d in datas for _ in range(aulas)]
    if len(colunas) > MAX_COLUNAS:
        print(f"ATENÇÃO: {bim}º bimestre tem {len(colunas)} aulas, mas o diário só tem "
              f"{MAX_COLUNAS} colunas. As últimas foram ignoradas.")
        colunas = colunas[:MAX_COLUNAS]

    def x_coluna(i):
        return COL_DATAS_INICIO + i * LARGURA_COLUNA

    # --- Cabeçalho: dias ---
    for i, d in enumerate(colunas):
        texto_centralizado(c, f"{d.day:02d}", x_coluna(i), x_coluna(i + 1), *LINHA_DIA, tamanho=6.5)

    # --- Cabeçalho: meses (agrupa colunas seguidas do mesmo mês) ---
    i = 0
    c.setLineWidth(0.5)
    while i < len(colunas):
        mes = colunas[i].month
        j = i
        while j < len(colunas) and colunas[j].month == mes:
            j += 1
        x0, x1 = x_coluna(i), x_coluna(j)
        nome = MESES[mes - 1]
        tamanho = 7.0
        while stringWidth(nome, "Helvetica-Bold", tamanho) > (x1 - x0 - 1) and tamanho > 4:
            tamanho -= 0.1  # diminui a fonte até caber (ex.: JULHO em 2 colunas)
        texto_centralizado(c, nome, x0, x1, *LINHA_MES, fonte="Helvetica-Bold", tamanho=tamanho)
        # linha vertical separando os meses
        c.line(x1, ALTURA_PAGINA - LINHA_MES[0], x1, ALTURA_PAGINA - LINHA_MES[1])
        i = j

    # --- Alunos: C/F, faltas, média ---
    for ra, (topo, nome) in pagina["alunos"].items():
        base = topo + ALTURA_LINHA_ALUNO
        registro = dados["presencas"].get(ra)
        if registro is None:
            print(f"ATENÇÃO: aluno {ra} ({nome}) está no PDF mas não na planilha.")
            continue

        faltas = 0
        for i, d in enumerate(colunas):
            letras = registro.get(d)
            if letras is None:
                continue  # sem chamada nesse dia -> deixa em branco
            letra = letras[i % aulas]  # 1ª ou 2ª aula do dia
            texto_centralizado(c, letra, x_coluna(i), x_coluna(i + 1), topo, base)
            if letra == "F":
                faltas += 1

        texto_centralizado(c, str(faltas), *COL_FALTAS, topo, base)

        media = dados["medias"].get(ra, {}).get(bim)
        if media is not None:
            col = COL_MEDIA_1BIM if bim == 1 else COL_MEDIA_2BIM
            texto_centralizado(c, formatar_nota(media), *col, topo, base)


def desenhar_conteudo(c, pagina, dados, numero_inicial):
    """Preenche a tabela Data | Nº | Conteúdo. Devolve o próximo número de aula,
    porque a numeração continua de um bimestre para o outro (1..13, depois 14..)."""
    datas = dados["datas"][pagina["bimestre"]]
    capacidade = CONTEUDO_LINHAS_POR_LADO * len(CONTEUDO_COLUNAS)
    if len(datas) > capacidade:
        print(f"ATENÇÃO: mais de {capacidade} aulas no {pagina['bimestre']}º bimestre; o excesso foi ignorado.")

    numero = numero_inicial
    for k, d in enumerate(datas[:capacidade]):
        lado = CONTEUDO_COLUNAS[k // CONTEUDO_LINHAS_POR_LADO]
        linha = k % CONTEUDO_LINHAS_POR_LADO
        topo = CONTEUDO_PRIMEIRA_LINHA + linha * CONTEUDO_ALTURA_LINHA
        base = topo + CONTEUDO_ALTURA_LINHA

        texto_centralizado(c, d.strftime("%d/%m/%Y"), *lado["data"], topo, base, tamanho=7.5)
        texto_centralizado(c, str(numero), *lado["num"], topo, base, tamanho=7.5)
        assunto = dados["conteudos"].get(d, "")
        if assunto:
            texto_esquerda(c, assunto, lado["texto_x"], lado["texto_fim"], topo, base)
        numero += 1
    return numero


# ===========================================================================
# PARTE 5 — JUNTAR TUDO
# ===========================================================================

def preencher(caminho_pdf, caminho_planilha, caminho_saida=None):
    paginas = ler_pdf_em_branco(caminho_pdf)
    dados = ler_planilha(caminho_planilha)

    leitor = PdfReader(caminho_pdf)
    escritor = PdfWriter()
    numero_aula = 1

    for pagina_pdf, info in zip(leitor.pages, paginas):
        # 1) desenha a camada numa "folha transparente" na memória
        buffer = io.BytesIO()
        largura = float(pagina_pdf.mediabox.width)
        altura = float(pagina_pdf.mediabox.height)
        c = canvas.Canvas(buffer, pagesize=(largura, altura))

        if info["tipo"] == "frequencia":
            desenhar_frequencia(c, info, dados)
        elif info["tipo"] == "conteudo":
            numero_aula = desenhar_conteudo(c, info, dados, numero_aula)

        c.save()

        # 2) "carimba" a camada por cima da página original
        camada = PdfReader(io.BytesIO(buffer.getvalue())).pages[0]
        pagina_pdf.merge_page(camada)
        escritor.add_page(pagina_pdf)

    caminho_saida = caminho_saida or Path(caminho_pdf).with_name(Path(caminho_pdf).stem + "_preenchido.pdf")
    with open(caminho_saida, "wb") as f:
        escritor.write(f)
    print(f"Diário gerado: {caminho_saida}")
    return caminho_saida


# ===========================================================================
# PONTO DE ENTRADA — o que roda quando você chama "python diario.py ..."
# ===========================================================================

if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) >= 2 and args[0] == "criar-planilha":
        criar_planilha(args[1], args[2] if len(args) > 2 else None)
    elif len(args) >= 3 and args[0] == "preencher":
        preencher(args[1], args[2], args[3] if len(args) > 3 else None)
    else:
        print(__doc__)
