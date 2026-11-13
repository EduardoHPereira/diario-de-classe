/*
 * Preenchedor de Diários de Classe (UDC) — versão web
 * ===================================================
 *
 * É a "tradução" do diario.py para JavaScript, rodando 100% no navegador.
 *
 * Organização deste arquivo (mesma ordem do diario.py):
 *   PARTE 0 — medidas do formulário (copiadas do diario.py)
 *   PARTE 1 — ler o PDF em branco (pdf.js no lugar do pdfplumber)
 *   PARTE 2 — o "estado": todos os dados que você digita, salvos no navegador
 *   PARTE 3 — calcular datas por bimestre, presenças e médias (como ler_planilha)
 *   PARTE 4 — desenhar os textos no PDF (pdf-lib no lugar do reportlab + pypdf)
 *   PARTE 5 — a tela: montar as tabelas e reagir aos cliques
 *
 * Ideia central (igual ao Python): NÃO apagamos nada do PDF original.
 * Só escrevemos os textos novos POR CIMA de cada página, como um carimbo.
 */

"use strict"; // modo estrito: o JavaScript avisa sobre mais erros bobos

// ===========================================================================
// PARTE 0 — MEDIDAS DO FORMULÁRIO (em pontos; 1 ponto = 1/72 de polegada)
// Exatamente os mesmos números do diario.py.
// Aqui o "y" é contado DE CIMA PARA BAIXO (como no pdfplumber).
// ===========================================================================
const ALTURA_PAGINA = 595.28; // A4 deitado

// Página de frequência
const COL_DATAS_INICIO = 229.6;   // borda esquerda da 1ª coluna de data
const LARGURA_COLUNA = 11.34;     // largura de cada quadradinho
const MAX_COLUNAS = 42;           // quantas colunas de data cabem
const LINHA_MES = [102.0, 113.4]; // faixa vertical onde vai o nome do mês
const LINHA_DIA = [113.4, 124.7]; // faixa vertical onde vai o dia
const ALTURA_LINHA_ALUNO = 11.34;
const COL_FALTAS = [705.8, 728.5];
const COL_MEDIA_1BIM = [785.2, 807.9]; // coluna "MÉDIA" na página do 1º bimestre
const COL_MEDIA_2BIM = [728.5, 754.0]; // coluna "2º BIM" na página do 2º bimestre

// Página de conteúdo
const CONTEUDO_PRIMEIRA_LINHA = 121.9;
const CONTEUDO_ALTURA_LINHA = 14.17;
const CONTEUDO_LINHAS_POR_LADO = 22;
// (data, nº, texto) para o lado esquerdo e o lado direito da tabela
const CONTEUDO_COLUNAS = [
  { data: [28.4, 85.0], num: [85.0, 107.7], textoX: 109.2, textoFim: 411.0 },
  { data: [411.0, 467.7], num: [467.7, 496.1], textoX: 497.6, textoFim: 807.9 },
];

const MESES = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO",
  "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];

// No diario.py isto é configurável na planilha; o padrão (e o formulário) é 2.
const AULAS_POR_DIA = 2;

// Ciclo do clique na célula da chamada
const CICLO_CHAMADA = ["", "C", "F", "CF", "FC"];

// Onde o progresso fica guardado no navegador (localStorage)
const CHAVE_ARMAZENAMENTO = "diario-de-classe:v1";

// O pdf.js faz o trabalho pesado numa "thread" separada (o worker).
// Precisamos dizer onde está o arquivo dele (mesma versão do pdf.min.js).
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
}


// ===========================================================================
// PARTE 1 — LER O PDF EM BRANCO
// ===========================================================================

/*
 * O pdfplumber entrega "palavras" prontas. O pdf.js entrega "pedaços de texto"
 * (que podem ser uma letra, uma palavra ou uma frase inteira). Então primeiro
 * montamos as palavras do mesmo jeito que o pdfplumber faz:
 *   - letras na mesma altura (diferença de até 3 pt) formam uma linha;
 *   - dentro da linha, um espaço OU um buraco maior que 3 pt separa palavras.
 * Cada palavra tem { text, x0, x1, top }, com "top" medido de cima para baixo.
 */
function montarPalavras(conteudoTexto, pagina) {
  // page.view = [x0, y0, x1, y1] da página (a "mediabox")
  const [vx0, , , vy1] = pagina.view;
  const letras = [];

  for (const item of conteudoTexto.items) {
    if (!item.str) continue; // pedaços vazios (só "fim de linha")
    // transform = [a, b, c, d, e, f]: (e, f) é o ponto onde o texto começa,
    // na "linha de base" (a linha onde as letras se apoiam), y de BAIXO para CIMA.
    const [, , c, d, e, f] = item.transform;
    const tamanho = Math.hypot(c, d); // tamanho da fonte
    // "descent" = quanto as letras descem abaixo da linha de base (número negativo).
    // O pdfplumber calcula o topo da letra como: linha de base + descent + tamanho.
    const estilo = conteudoTexto.styles[item.fontName] || {};
    const descent = typeof estilo.descent === "number" ? estilo.descent : 0;
    const topo = (vy1 - f) - (descent * tamanho + tamanho); // vira "de cima para baixo"

    // O pdf.js dá a largura do pedaço inteiro; dividimos igualmente entre as letras.
    // (É uma aproximação, mas só usamos o x para saber em que coluna a palavra está.)
    const n = item.str.length;
    const largLetra = n ? item.width / n : 0;
    for (let i = 0; i < n; i++) {
      const x0 = e - vx0 + i * largLetra;
      letras.push({ ch: item.str[i], x0, x1: x0 + largLetra, top: topo });
    }
  }

  // 1) Agrupa em linhas (ordena por altura; junta quem está a até 3 pt)
  letras.sort((a, b) => a.top - b.top);
  const linhas = [];
  for (const l of letras) {
    const ultima = linhas[linhas.length - 1];
    if (ultima && Math.abs(l.top - ultima[0].top) <= 3) ultima.push(l);
    else linhas.push([l]);
  }

  // 2) Dentro de cada linha, da esquerda para a direita, monta as palavras
  const palavras = [];
  for (const linha of linhas) {
    linha.sort((a, b) => a.x0 - b.x0);
    let atual = null;
    for (const l of linha) {
      if (/\s/.test(l.ch)) { atual = null; continue; } // espaço termina a palavra
      if (atual && l.x0 <= atual.x1 + 3) {
        atual.text += l.ch;
        atual.x1 = l.x1;
      } else {
        atual = { text: l.ch, x0: l.x0, x1: l.x1, top: l.top };
        palavras.push(atual);
      }
    }
  }
  return { palavras, linhas: agruparTextoPorLinha(palavras) };
}

// Junta as palavras em texto corrido (como o extract_text do pdfplumber)
function agruparTextoPorLinha(palavras) {
  const porLinha = [];
  for (const p of palavras) {
    const ultima = porLinha[porLinha.length - 1];
    if (ultima && Math.abs(ultima.top - p.top) <= 3) ultima.textos.push(p.text);
    else porLinha.push({ top: p.top, textos: [p.text] });
  }
  return porLinha.map((l) => l.textos.join(" ")).join("\n");
}

/*
 * Equivale a ler_pdf_em_branco() do Python.
 * Devolve uma lista, uma entrada por página, por exemplo:
 *   { tipo: "frequencia", bimestre: 1, alunos: Map { "0252252010" => { topo: 124.7, nome: "DIEGO ..." } } }
 *   { tipo: "conteudo",   bimestre: 1, alunos: Map {} }
 */
async function lerPdfEmBranco(bytesPdf) {
  // .slice() faz uma CÓPIA: o pdf.js "consome" o buffer que recebe,
  // e ainda vamos precisar dos bytes originais para o pdf-lib depois.
  const doc = await pdfjsLib.getDocument({ data: bytesPdf.slice() }).promise;
  const paginas = [];

  for (let n = 1; n <= doc.numPages; n++) {
    const pagina = await doc.getPage(n);
    // disableNormalization: não "arrumar" caracteres (ex.: manter o "º" como está)
    const conteudo = await pagina.getTextContent({ disableNormalization: true });
    const { palavras, linhas: texto } = montarPalavras(conteudo, pagina);

    // Mesmas regras do Python. (Aceitamos também "2°" com o símbolo de grau,
    // que é fácil de confundir com o "º" ordinal.)
    const bimestre = (texto.includes("2º BIM") || texto.includes("2° BIM")) ? 2 : 1;
    let tipo = "desconhecida";
    if (texto.includes("AVALIAÇÕES")) tipo = "frequencia";
    else if (texto.includes("Assinatura do Professor")) tipo = "conteudo";

    const alunos = new Map();
    if (tipo === "frequencia") {
      for (const p of palavras) {
        // O RA é uma palavra só de dígitos, na coluna da esquerda
        if (p.x0 < 40 && /^\d+$/.test(p.text) && p.text.length >= 8) {
          // descobre em qual linha da grade o RA está
          const topoLinha = LINHA_DIA[1] +
            Math.floor((p.top - LINHA_DIA[1]) / ALTURA_LINHA_ALUNO) * ALTURA_LINHA_ALUNO;
          // junta as palavras do nome que estão na mesma altura
          const nome = palavras
            .filter((w) => Math.abs(w.top - p.top) < 2 && w.x0 > 90 && w.x0 < 229)
            .map((w) => w.text)
            .join(" ");
          alunos.set(p.text, { topo: topoLinha, nome });
        }
      }
    }
    paginas.push({ tipo, bimestre, alunos });
  }
  await doc.destroy();
  return paginas;
}


// ===========================================================================
// PARTE 2 — O ESTADO (tudo o que você digita)
// ===========================================================================

/*
 * Formato dos dados (é exatamente isto que vai para o backup .json):
 * {
 *   versao: 1,
 *   config:    { pesoProva: "0.7", pesoAtiv: "0.3", inicio2bim: "2026-04-01" },
 *   alunos:    [ { ra: "0252252010", nome: "DIEGO ..." }, ... ],
 *   datas:     [ "2026-02-10", "2026-02-17", ... ],      // sempre em ordem
 *   presencas: { "0252252010": { "2026-02-10": "C", "2026-02-17": "CF" } },
 *   conteudos: { "2026-02-10": "Apresentação da disciplina" },
 *   notas:     { "0252252010": { p1: "7,5", a1: "8", p2: "", a2: "" } }
 * }
 * As datas ficam como texto "AAAA-MM-DD": assim dá para ordenar e comparar
 * como texto, sem problemas de fuso horário.
 */
function estadoVazio() {
  return {
    versao: 1,
    config: { pesoProva: "0.7", pesoAtiv: "0.3", inicio2bim: "" },
    alunos: [],
    datas: [],
    presencas: {},
    conteudos: {},
    notas: {},
  };
}

let estado = carregarEstado();
let bytesPdf = null;     // o PDF aberto (só na memória; nunca salvo nem enviado)
let nomePdf = "diario";  // nome do arquivo, para batizar o PDF gerado

function carregarEstado() {
  try {
    const salvo = localStorage.getItem(CHAVE_ARMAZENAMENTO);
    if (salvo) return normalizarEstado(JSON.parse(salvo));
  } catch (erro) {
    console.warn("Não consegui ler o progresso salvo:", erro);
  }
  return estadoVazio();
}

// Garante que todos os campos existem (útil para backups antigos ou incompletos)
function normalizarEstado(obj) {
  const base = estadoVazio();
  if (!obj || typeof obj !== "object") throw new Error("Arquivo de backup inválido.");
  const e = {
    versao: 1,
    config: { ...base.config, ...(obj.config || {}) },
    alunos: Array.isArray(obj.alunos) ? obj.alunos.filter((a) => a && a.ra) : [],
    datas: Array.isArray(obj.datas) ? obj.datas.filter(ehDataValida) : [],
    presencas: obj.presencas || {},
    conteudos: obj.conteudos || {},
    notas: obj.notas || {},
  };
  e.alunos = e.alunos.map((a) => ({ ra: String(a.ra).trim(), nome: String(a.nome || "") }));
  e.datas = [...new Set(e.datas)].sort();
  return e;
}

// Salva no navegador. Espera 300 ms sem mudanças para não salvar a cada tecla.
let temporizadorSalvar = null;
function salvar() {
  clearTimeout(temporizadorSalvar);
  temporizadorSalvar = setTimeout(() => {
    try {
      localStorage.setItem(CHAVE_ARMAZENAMENTO, JSON.stringify(estado));
    } catch (erro) {
      alert("Não consegui salvar no navegador (modo anônimo?). Use 'Exportar backup'.");
    }
  }, 300);
}


// ===========================================================================
// PARTE 3 — CONVERSÕES E CÁLCULOS (equivale a ler_planilha do Python)
// ===========================================================================

function ehDataValida(texto) {
  return typeof texto === "string" && /^\d{4}-\d{2}-\d{2}$/.test(texto);
}

// "2026-03-05" -> { ano: 2026, mes: 3, dia: 5 }
function partesData(texto) {
  const [ano, mes, dia] = texto.split("-").map(Number);
  return { ano, mes, dia };
}

// "2026-03-05" -> "05/03/2026" (como o strftime("%d/%m/%Y") do Python)
function dataBR(texto) {
  const { ano, mes, dia } = partesData(texto);
  return `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}/${ano}`;
}

/* Aceita 7, 7.5, "7,5" ... e devolve número (ou null se vazio).
   Se não for número, devolve NaN (o Python daria erro; aqui avisamos na tela). */
function paraNumero(valor) {
  if (valor === null || valor === undefined || String(valor).trim() === "") return null;
  const texto = String(valor).trim().replace(",", ".");
  // Number("") é 0 e Number("7abc") é NaN — exigimos um número "limpo"
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(texto)) return NaN;
  return Number(texto);
}

// Pesos, como no Python:  peso_prova = ... or 1   e   peso_ativ = ... or 0
// (o "or" do Python troca vazio OU zero pelo valor padrão)
function pesos() {
  const pp = paraNumero(estado.config.pesoProva);
  const pa = paraNumero(estado.config.pesoAtiv);
  return {
    pesoProva: pp && !Number.isNaN(pp) ? pp : 1,
    pesoAtiv: pa && !Number.isNaN(pa) ? pa : 0,
  };
}

// Média de um bimestre. Mesma regra do Python:
//  - prova e atividades preenchidas -> média ponderada
//  - só a prova, e peso das atividades = 0 -> a própria prova
//  - senão -> sem média (null)
function calcularMedia(prova, ativ) {
  const { pesoProva, pesoAtiv } = pesos();
  const p = paraNumero(prova);
  const a = paraNumero(ativ);
  if (Number.isNaN(p) || Number.isNaN(a)) return null;
  if (p !== null && a !== null) return (p * pesoProva + a * pesoAtiv) / (pesoProva + pesoAtiv);
  if (p !== null && pesoAtiv === 0) return p;
  return null;
}

/*
 * Formata a nota com 1 casa e vírgula, IGUAL ao f"{n:.1f}" do Python.
 * Detalhe: num empate exato (ex.: 8.25), o Python arredonda para o PAR (8.2)
 * e o toFixed do JavaScript arredonda para cima (8.3). Tratamos esse caso.
 */
function formatarNota(n) {
  let texto = n.toFixed(1);
  const exato = Math.abs(n).toFixed(30); // valor exato guardado no computador
  if (/^\d+\.\d50*$/.test(exato)) {      // termina em ...5 seguido só de zeros = empate
    const truncado = Math.trunc(Math.abs(n) * 10); // ex.: 8.25 -> 82
    const arred = truncado % 2 === 0 ? truncado : truncado + 1; // vai para o par
    texto = (n < 0 ? "-" : "") + (arred / 10).toFixed(1);
  }
  return texto.replace(".", ",");
}

// Converte a célula da chamada em uma letra por aula: "C" -> ["C","C"]; "CF" -> ["C","F"]
function letrasDoDia(valor) {
  if (!valor) return null; // dia sem chamada
  return valor.length === 1 ? Array(AULAS_POR_DIA).fill(valor) : valor.split("");
}

// Separa as datas por bimestre (aulas antes do início do 2º vão para o 1º)
function datasPorBimestre() {
  const inicio = estado.config.inicio2bim;
  return {
    1: estado.datas.filter((d) => !inicio || d < inicio),
    2: inicio ? estado.datas.filter((d) => d >= inicio) : [],
  };
}

function bimestreDaData(d) {
  const inicio = estado.config.inicio2bim;
  return inicio && d >= inicio ? 2 : 1;
}


// ===========================================================================
// PARTE 4 — DESENHAR OS TEXTOS NO PDF (pdf-lib)
// ===========================================================================

/*
 * Lembrete sobre o "y":
 *   - Nossas medidas contam de CIMA para BAIXO (como o pdfplumber).
 *   - O PDF (e o pdf-lib, como o reportlab) conta de BAIXO para CIMA.
 * Por isso convertemos com  ALTURA_PAGINA - y,  exatamente como o Python.
 */

// As fontes padrão do PDF (Helvetica) só têm os caracteres do "WinAnsi"
// (letras com acento do português estão incluídas). Um caractere fora disso,
// como um emoji, faria o pdf-lib dar erro — então trocamos por "?".
function textoSeguro(fonte, texto) {
  let saida = "";
  for (const ch of String(texto).replace(/[\r\n\t]+/g, " ")) {
    try {
      fonte.widthOfTextAtSize(ch, 1); // dá erro se a fonte não tiver o caractere
      saida += ch;
    } catch {
      saida += "?";
    }
  }
  return saida;
}

// Largura de um texto, somando letra por letra — igual ao stringWidth do reportlab.
// (O widthOfTextAtSize do pdf-lib aplica "kerning", o ajuste fino entre pares de
// letras como "EV"; o reportlab não aplica. Sem isto, FEVEREIRO sairia 0,07 pt fora do lugar.)
function largura(fonte, texto, tamanho) {
  let total = 0;
  for (const ch of texto) total += fonte.widthOfTextAtSize(ch, tamanho);
  return total;
}

// Escreve "texto" centralizado dentro do retângulo (x0..x1, yTopo..yBase).
// Igual a texto_centralizado() do Python.
function textoCentralizado(ctx, texto, x0, x1, yTopo, yBase, fonte = ctx.helv, tamanho = 7.0) {
  texto = textoSeguro(fonte, texto);
  const x = (x0 + x1) / 2 - largura(fonte, texto, tamanho) / 2;
  const yMeio = (yTopo + yBase) / 2;
  ctx.pagina.drawText(texto, {
    x, y: ALTURA_PAGINA - (yMeio + tamanho * 0.35), size: tamanho, font: fonte,
    color: PDFLib.rgb(0, 0, 0),
  });
}

// Escreve alinhado à esquerda; se não couber, diminui a fonte.
// Igual a texto_esquerda() do Python.
function textoEsquerda(ctx, texto, x, xLimite, yTopo, yBase, fonte = ctx.helv, tamanho = 7.5) {
  texto = textoSeguro(fonte, texto);
  while (largura(fonte, texto, tamanho) > (xLimite - x - 2) && tamanho > 5) {
    tamanho -= 0.25;
  }
  const yMeio = (yTopo + yBase) / 2;
  ctx.pagina.drawText(texto, {
    x, y: ALTURA_PAGINA - (yMeio + tamanho * 0.35), size: tamanho, font: fonte,
    color: PDFLib.rgb(0, 0, 0),
  });
}

// Igual a desenhar_frequencia() do Python
function desenharFrequencia(ctx, info, dados, avisos) {
  const bim = info.bimestre;
  const aulas = AULAS_POR_DIA;
  const datas = dados.datas[bim];

  // Cada dia vira 'aulas' colunas (ex.: 2 colunas com a mesma data)
  let colunas = datas.flatMap((d) => Array(aulas).fill(d));
  if (colunas.length > MAX_COLUNAS) {
    avisos.add(`ATENÇÃO: ${bim}º bimestre tem ${colunas.length} aulas, mas o diário só tem ` +
      `${MAX_COLUNAS} colunas. As últimas foram ignoradas.`);
    colunas = colunas.slice(0, MAX_COLUNAS);
  }

  const xColuna = (i) => COL_DATAS_INICIO + i * LARGURA_COLUNA;

  // --- Cabeçalho: dias ---
  colunas.forEach((d, i) => {
    const dia = String(partesData(d).dia).padStart(2, "0");
    textoCentralizado(ctx, dia, xColuna(i), xColuna(i + 1), ...LINHA_DIA, ctx.helv, 6.5);
  });

  // --- Cabeçalho: meses (agrupa colunas seguidas do mesmo mês) ---
  let i = 0;
  while (i < colunas.length) {
    const mes = partesData(colunas[i]).mes;
    let j = i;
    while (j < colunas.length && partesData(colunas[j]).mes === mes) j++;
    const x0 = xColuna(i);
    const x1 = xColuna(j);
    const nome = MESES[mes - 1];
    let tamanho = 7.0;
    while (largura(ctx.helvBold, nome, tamanho) > (x1 - x0 - 1) && tamanho > 4) {
      tamanho -= 0.1; // diminui a fonte até caber (ex.: JULHO em 2 colunas)
    }
    textoCentralizado(ctx, nome, x0, x1, ...LINHA_MES, ctx.helvBold, tamanho);
    // linha vertical separando os meses (espessura 0,5 como no Python)
    ctx.pagina.drawLine({
      start: { x: x1, y: ALTURA_PAGINA - LINHA_MES[0] },
      end: { x: x1, y: ALTURA_PAGINA - LINHA_MES[1] },
      thickness: 0.5,
      color: PDFLib.rgb(0, 0, 0),
    });
    i = j;
  }

  // --- Alunos: C/F, faltas, média ---
  for (const [ra, { topo, nome }] of info.alunos) {
    const base = topo + ALTURA_LINHA_ALUNO;
    const registro = dados.presencas.get(ra);
    if (registro === undefined) {
      avisos.add(`ATENÇÃO: aluno ${ra} (${nome}) está no PDF mas não na lista de alunos.`);
      continue;
    }

    let faltas = 0;
    colunas.forEach((d, i) => {
      const letras = registro[d] ? letrasDoDia(registro[d]) : null;
      if (letras === null) return; // sem chamada nesse dia -> deixa em branco
      const letra = letras[i % aulas]; // 1ª ou 2ª aula do dia
      textoCentralizado(ctx, letra, xColuna(i), xColuna(i + 1), topo, base);
      if (letra === "F") faltas++;
    });

    textoCentralizado(ctx, String(faltas), ...COL_FALTAS, topo, base);

    const media = dados.medias.get(ra)?.[bim];
    if (media !== null && media !== undefined) {
      const col = bim === 1 ? COL_MEDIA_1BIM : COL_MEDIA_2BIM;
      textoCentralizado(ctx, formatarNota(media), ...col, topo, base);
    }
  }
}

// Igual a desenhar_conteudo() do Python. Devolve o próximo número de aula,
// porque a numeração continua de um bimestre para o outro (1..13, depois 14..).
function desenharConteudo(ctx, info, dados, numeroInicial, avisos) {
  const datas = dados.datas[info.bimestre];
  const capacidade = CONTEUDO_LINHAS_POR_LADO * CONTEUDO_COLUNAS.length;
  if (datas.length > capacidade) {
    avisos.add(`ATENÇÃO: mais de ${capacidade} aulas no ${info.bimestre}º bimestre; o excesso foi ignorado.`);
  }

  let numero = numeroInicial;
  datas.slice(0, capacidade).forEach((d, k) => {
    const lado = CONTEUDO_COLUNAS[Math.floor(k / CONTEUDO_LINHAS_POR_LADO)];
    const linha = k % CONTEUDO_LINHAS_POR_LADO;
    const topo = CONTEUDO_PRIMEIRA_LINHA + linha * CONTEUDO_ALTURA_LINHA;
    const base = topo + CONTEUDO_ALTURA_LINHA;

    textoCentralizado(ctx, dataBR(d), ...lado.data, topo, base, ctx.helv, 7.5);
    textoCentralizado(ctx, String(numero), ...lado.num, topo, base, ctx.helv, 7.5);
    const assunto = (dados.conteudos[d] || "").trim();
    if (assunto) textoEsquerda(ctx, assunto, lado.textoX, lado.textoFim, topo, base);
    numero++;
  });
  return numero;
}

// Junta os dados do estado no formato que as funções de desenho esperam
// (é o que o ler_planilha() do Python devolve). Também valida tudo.
function prepararDados(erros) {
  if (!estado.config.inicio2bim) erros.push("Preencha o 'Início do 2º bimestre' nas Configurações.");
  for (const campo of ["pesoProva", "pesoAtiv"]) {
    if (Number.isNaN(paraNumero(estado.config[campo]))) erros.push("Peso inválido nas Configurações.");
  }

  const presencas = new Map();
  const medias = new Map();
  for (const { ra, nome } of estado.alunos) {
    presencas.set(ra, estado.presencas[ra] || {});
    const n = estado.notas[ra] || {};
    for (const campo of ["p1", "a1", "p2", "a2"]) {
      if (Number.isNaN(paraNumero(n[campo]))) erros.push(`Nota inválida para ${nome || ra}: "${n[campo]}".`);
    }
    medias.set(ra, { 1: calcularMedia(n.p1, n.a1), 2: calcularMedia(n.p2, n.a2) });
  }
  return { datas: datasPorBimestre(), presencas, medias, conteudos: estado.conteudos };
}

// Igual a preencher() do Python: lê o PDF, desenha e devolve os bytes do novo PDF.
async function gerarPdfPreenchido(avisos) {
  const erros = [];
  const dados = prepararDados(erros);
  if (erros.length) throw new Error([...new Set(erros)].join("\n"));

  const paginasInfo = await lerPdfEmBranco(bytesPdf);
  const pdf = await PDFLib.PDFDocument.load(bytesPdf.slice(), { ignoreEncryption: true });
  // As fontes padrão do PDF: as mesmas do reportlab (mesmas larguras de letra)
  const helv = await pdf.embedFont(PDFLib.StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(PDFLib.StandardFonts.HelveticaBold);

  let numeroAula = 1;
  const paginasPdf = pdf.getPages();
  paginasPdf.forEach((pagina, idx) => {
    const info = paginasInfo[idx];
    if (!info) return;

    // "Isola" o desenho original entre q ... Q (salvar/restaurar o estado gráfico).
    // Assim, se o PDF original deixar algo "ligado" (cor, escala...), isso não
    // afeta o nosso texto. O pypdf faz o mesmo ao juntar as páginas no Python.
    const c = pdf.context;
    const inicio = c.register(c.contentStream([PDFLib.pushGraphicsState()]));
    const fim = c.register(c.contentStream([PDFLib.popGraphicsState()]));
    pagina.node.wrapContentStreams(inicio, fim);

    const ctx = { pagina, helv, helvBold };
    if (info.tipo === "frequencia") desenharFrequencia(ctx, info, dados, avisos);
    else if (info.tipo === "conteudo") numeroAula = desenharConteudo(ctx, info, dados, numeroAula, avisos);
  });

  return pdf.save();
}


// ===========================================================================
// PARTE 5 — A TELA
// ===========================================================================

// Atalho para document.getElementById
const $ = (id) => document.getElementById(id);

// Cria um elemento HTML: el("td", { className: "x" }, "texto", outroElemento)
function el(tag, props = {}, ...filhos) {
  const elemento = Object.assign(document.createElement(tag), props);
  for (const f of filhos) elemento.append(f);
  return elemento;
}

// Desenha a tela inteira a partir do estado
function render() {
  renderConfig();
  renderAulas();
  renderChamada();
  renderNotas();
}

// --- Configurações ---
function renderConfig() {
  $("cfgPesoProva").value = estado.config.pesoProva;
  $("cfgPesoAtiv").value = estado.config.pesoAtiv;
  $("cfgInicio2").value = estado.config.inicio2bim;
  marcarInvalido($("cfgPesoProva"));
  marcarInvalido($("cfgPesoAtiv"));
}

// Borda vermelha se o campo tiver algo que não é número
function marcarInvalido(input) {
  input.classList.toggle("invalido", Number.isNaN(paraNumero(input.value)));
}

// --- Lista de aulas (data + conteúdo) ---
function renderAulas() {
  const lista = $("listaAulas");
  lista.replaceChildren();
  estado.datas.forEach((d, i) => {
    const bim = bimestreDaData(d);
    const campo = el("input", {
      type: "text", value: estado.conteudos[d] || "", placeholder: "Conteúdo da aula",
    });
    campo.setAttribute("aria-label", `Conteúdo da aula de ${dataBR(d)}`);
    campo.addEventListener("input", () => {
      estado.conteudos[d] = campo.value;
      salvar();
    });
    const remover = el("button", { type: "button", className: "remover", title: "Remover esta data", textContent: "×" });
    remover.addEventListener("click", () => removerData(d));
    lista.append(el("div", { className: "aula" },
      el("span", { className: "num", textContent: i + 1 }),
      el("span", { textContent: dataBR(d) }),
      el("span", { className: `etiqueta bim${bim}`, textContent: `${bim}º bim` }),
      campo, remover));
  });

  // Resumo: quantas colunas cada bimestre ocupa (o diário tem 42 = 21 dias)
  const pb = datasPorBimestre();
  const resumo = [1, 2].map((b) => {
    const cols = pb[b].length * AULAS_POR_DIA;
    const alerta = cols > MAX_COLUNAS ? " ⚠ passa do limite!" : "";
    return `${b}º bimestre: ${pb[b].length} dias (${cols} de ${MAX_COLUNAS} colunas)${alerta}`;
  });
  $("resumoBimestres").textContent = estado.datas.length
    ? resumo.join(" · ") + (estado.config.inicio2bim ? "" : " — defina o início do 2º bimestre.")
    : "Nenhuma data ainda.";
}

function adicionarDatas(novas) {
  estado.datas = [...new Set([...estado.datas, ...novas.filter(ehDataValida)])].sort();
  salvar();
  render();
}

function removerData(d) {
  const temAlgo = estado.conteudos[d] ||
    Object.values(estado.presencas).some((p) => p[d]);
  if (temAlgo && !confirm(`Remover ${dataBR(d)} e apagar a chamada e o conteúdo desse dia?`)) return;
  estado.datas = estado.datas.filter((x) => x !== d);
  delete estado.conteudos[d];
  for (const p of Object.values(estado.presencas)) delete p[d];
  salvar();
  render();
}

// --- Chamada ---
function renderChamada() {
  const tabela = $("tabelaChamada");
  tabela.replaceChildren();
  if (!estado.alunos.length) {
    tabela.append(el("tr", {}, el("td", { textContent: "Abra o PDF em branco para carregar os alunos." })));
    return;
  }

  // Cabeçalho: RA | Nome | uma coluna por data | Faltas 1º | Faltas 2º
  const cab = el("tr", {}, el("th", { className: "fixo1", textContent: "RA" }),
    el("th", { className: "fixo2", textContent: "Nome" }));
  for (const d of estado.datas) {
    const { dia, mes } = partesData(d);
    const botaoTodos = el("button", { type: "button", className: "botao mini", textContent: "C",
      title: "Marcar C em todos os vazios deste dia" });
    botaoTodos.addEventListener("click", () => marcarTodosPresentes(d));
    cab.append(el("th", { className: `bim${bimestreDaData(d)}` },
      `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}`, el("br"), botaoTodos));
  }
  cab.append(el("th", { textContent: "Faltas 1º" }), el("th", { textContent: "Faltas 2º" }));
  tabela.append(el("thead", {}, cab));

  const corpo = el("tbody");
  for (const { ra, nome } of estado.alunos) {
    const linha = el("tr", {}, el("td", { className: "ra fixo1", textContent: ra }),
      el("td", { className: "nome fixo2", textContent: nome, title: nome }));
    for (const d of estado.datas) {
      const valor = estado.presencas[ra]?.[d] || "";
      const botao = el("button", { type: "button", className: `celula v-${valor}`, textContent: valor });
      botao.setAttribute("aria-label", `${nome}, ${dataBR(d)}: ${valor || "vazio"}`);
      botao.addEventListener("click", () => alternarPresenca(ra, d, botao));
      linha.append(el("td", {}, botao));
    }
    const f = contarFaltas(ra);
    linha.append(el("td", { textContent: f[1] }), el("td", { textContent: f[2] }));
    corpo.append(linha);
  }
  tabela.append(corpo);

  // A coluna "Nome" fica grudada logo depois da coluna "RA": medimos a largura do RA
  const thRa = tabela.querySelector("th.fixo1");
  tabela.style.setProperty("--larg-ra", `${thRa.offsetWidth}px`);
}

// Clique na célula: avança no ciclo vazio → C → F → CF → FC → vazio
function alternarPresenca(ra, d, botao) {
  const atual = estado.presencas[ra]?.[d] || "";
  const proximo = CICLO_CHAMADA[(CICLO_CHAMADA.indexOf(atual) + 1) % CICLO_CHAMADA.length];
  estado.presencas[ra] ??= {}; // cria o objeto do aluno se ainda não existir
  if (proximo) estado.presencas[ra][d] = proximo;
  else delete estado.presencas[ra][d];
  salvar();
  // Atualiza só a célula e as faltas (mais rápido do que redesenhar a tabela)
  botao.className = `celula v-${proximo}`;
  botao.textContent = proximo;
  const linha = botao.closest("tr");
  const f = contarFaltas(ra);
  linha.cells[linha.cells.length - 2].textContent = f[1];
  linha.cells[linha.cells.length - 1].textContent = f[2];
}

function marcarTodosPresentes(d) {
  for (const { ra } of estado.alunos) {
    estado.presencas[ra] ??= {};
    if (!estado.presencas[ra][d]) estado.presencas[ra][d] = "C";
  }
  salvar();
  renderChamada();
}

// Conta as faltas (cada "F" = 1 aula perdida), por bimestre
function contarFaltas(ra) {
  const total = { 1: 0, 2: 0 };
  for (const d of estado.datas) {
    const letras = letrasDoDia(estado.presencas[ra]?.[d]);
    if (letras) total[bimestreDaData(d)] += letras.filter((l) => l === "F").length;
  }
  return total;
}

// --- Notas ---
function renderNotas() {
  const tabela = $("tabelaNotas");
  tabela.replaceChildren();
  if (!estado.alunos.length) return;

  tabela.append(el("thead", {}, el("tr", {},
    ...["RA", "Nome", "Prova 1º", "Ativ. 1º", "Média 1º", "Prova 2º", "Ativ. 2º", "Média 2º"]
      .map((t, i) => el("th", { className: i === 0 ? "fixo1" : i === 1 ? "fixo2" : "", textContent: t })))));

  const corpo = el("tbody");
  for (const { ra, nome } of estado.alunos) {
    estado.notas[ra] ??= { p1: "", a1: "", p2: "", a2: "" };
    const n = estado.notas[ra];
    const celMedia = { 1: el("td"), 2: el("td") };

    const atualizarMedias = () => {
      for (const b of [1, 2]) {
        const m = calcularMedia(n[`p${b}`], n[`a${b}`]);
        celMedia[b].textContent = m === null ? "" : formatarNota(m);
      }
    };

    const campo = (chave) => {
      const input = el("input", { type: "text", inputMode: "decimal", value: n[chave] || "" });
      input.setAttribute("aria-label", `${chave} de ${nome}`);
      marcarInvalido(input);
      input.addEventListener("input", () => {
        n[chave] = input.value;
        marcarInvalido(input);
        atualizarMedias();
        salvar();
      });
      return el("td", {}, input);
    };

    corpo.append(el("tr", {},
      el("td", { className: "ra fixo1", textContent: ra }),
      el("td", { className: "nome fixo2", textContent: nome, title: nome }),
      campo("p1"), campo("a1"), celMedia[1],
      campo("p2"), campo("a2"), celMedia[2]));
    atualizarMedias();
  }
  tabela.append(corpo);
  tabela.style.setProperty("--larg-ra", `${tabela.querySelector("th.fixo1").offsetWidth}px`);
}

// --- Avisos na seção "Gerar" ---
function mostrarAvisos(lista, ehErro = false) {
  $("avisos").replaceChildren(...lista.map((t) => el("li", { className: ehErro ? "erro" : "", textContent: t })));
}

// Faz o navegador "baixar" um arquivo criado aqui mesmo na página
function baixarArquivo(conteudo, nome, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = el("a", { href: url, download: nome });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function hojeISO() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`;
}


// ===========================================================================
// EVENTOS — o que acontece quando você clica/digita
// ===========================================================================

// Abrir o PDF em branco
$("arquivoPdf").addEventListener("change", async (evento) => {
  const arquivo = evento.target.files[0];
  if (!arquivo) return;
  try {
    $("statusPdf").textContent = "Lendo o PDF…";
    // arrayBuffer() lê o arquivo do seu computador para a memória da página
    bytesPdf = new Uint8Array(await arquivo.arrayBuffer());
    nomePdf = arquivo.name.replace(/\.pdf$/i, "");
    const paginas = await lerPdfEmBranco(bytesPdf);

    // Junta os alunos de todas as páginas (sem repetir), na ordem em que aparecem
    const doPdf = new Map();
    for (const pg of paginas) for (const [ra, { nome }] of pg.alunos) doPdf.set(ra, nome);
    if (!doPdf.size) throw new Error("Não encontrei alunos no PDF. É mesmo um diário em branco?");

    // Mescla com o que já estava salvo: mantém os dados e acrescenta alunos novos
    const jaTinha = new Set(estado.alunos.map((a) => a.ra));
    const novos = [...doPdf].filter(([ra]) => !jaTinha.has(ra));
    if (!estado.alunos.length) {
      estado.alunos = [...doPdf].map(([ra, nome]) => ({ ra, nome }));
    } else {
      estado.alunos.push(...novos.map(([ra, nome]) => ({ ra, nome })));
    }
    const foraDoPdf = estado.alunos.filter((a) => !doPdf.has(a.ra));
    salvar();
    render();

    const tipos = paginas.map((p) => p.tipo === "frequencia" ? `freq. ${p.bimestre}º` :
      p.tipo === "conteudo" ? `conteúdo ${p.bimestre}º` : "?").join(", ");
    $("statusPdf").textContent = `${arquivo.name}: ${doPdf.size} alunos, ${paginas.length} páginas (${tipos}).`;
    if (jaTinha.size && novos.length) alert(`${novos.length} aluno(s) novo(s) adicionado(s) à lista.`);
    if (foraDoPdf.length) {
      alert("Atenção: estes alunos estão salvos, mas não aparecem neste PDF:\n" +
        foraDoPdf.map((a) => `${a.ra} ${a.nome}`).join("\n") +
        "\n\nSe for outra turma, exporte um backup e use 'Começar do zero'.");
    }
  } catch (erro) {
    bytesPdf = null;
    $("statusPdf").textContent = "Erro: " + erro.message;
  } finally {
    evento.target.value = ""; // permite abrir o mesmo arquivo de novo
  }
});

// Configurações
$("cfgPesoProva").addEventListener("input", (e) => {
  estado.config.pesoProva = e.target.value; marcarInvalido(e.target); salvar(); renderNotas();
});
$("cfgPesoAtiv").addEventListener("input", (e) => {
  estado.config.pesoAtiv = e.target.value; marcarInvalido(e.target); salvar(); renderNotas();
});
$("cfgInicio2").addEventListener("change", (e) => {
  estado.config.inicio2bim = e.target.value; salvar(); renderAulas(); renderChamada();
});

// Adicionar uma data
$("btnAddData").addEventListener("click", () => {
  const d = $("novaData").value;
  if (!d) return alert("Escolha uma data.");
  adicionarDatas([d]);
});

// Gerar datas semanais entre duas datas
$("btnGerar").addEventListener("click", () => {
  const de = $("gerDe").value;
  const ate = $("gerAte").value;
  const dias = [...document.querySelectorAll("#gerDias input:checked")].map((c) => Number(c.value));
  if (!de || !ate || !dias.length) return alert("Preencha 'de', 'até' e marque os dias da semana.");
  const novas = [];
  // Usamos UTC (horário universal) para não sofrer com horário de verão
  const { ano, mes, dia } = partesData(de);
  for (let t = Date.UTC(ano, mes - 1, dia); ; t += 86400000) {
    const iso = new Date(t).toISOString().slice(0, 10);
    if (iso > ate) break;
    if (dias.includes(new Date(t).getUTCDay())) novas.push(iso);
  }
  adicionarDatas(novas);
});

// Exportar backup
$("btnExportar").addEventListener("click", () => {
  baixarArquivo(JSON.stringify(estado, null, 2), `diario-backup-${hojeISO()}.json`, "application/json");
});

// Importar backup
$("arquivoBackup").addEventListener("change", async (evento) => {
  const arquivo = evento.target.files[0];
  if (!arquivo) return;
  try {
    const novo = normalizarEstado(JSON.parse(await arquivo.text()));
    if (estado.alunos.length && !confirm("Substituir os dados atuais pelos do backup?")) return;
    estado = novo;
    salvar();
    render();
  } catch (erro) {
    alert("Não consegui importar: " + erro.message);
  } finally {
    evento.target.value = "";
  }
});

// Começar do zero
$("btnLimpar").addEventListener("click", () => {
  if (!confirm("Apagar TODOS os dados salvos neste navegador? (Exporte um backup antes!)")) return;
  estado = estadoVazio();
  salvar();
  render();
});

// Gerar o PDF preenchido
$("btnGerarPdf").addEventListener("click", async () => {
  if (!bytesPdf) return mostrarAvisos(["Abra o PDF em branco primeiro (passo 1)."], true);
  const botao = $("btnGerarPdf");
  botao.disabled = true;
  const avisos = new Set(); // Set: não repete o mesmo aviso
  try {
    const bytes = await gerarPdfPreenchido(avisos);
    baixarArquivo(bytes, `${nomePdf}_preenchido.pdf`, "application/pdf");
    mostrarAvisos([`Diário gerado: ${nomePdf}_preenchido.pdf`, ...avisos]);
  } catch (erro) {
    mostrarAvisos(erro.message.split("\n"), true);
  } finally {
    botao.disabled = false;
  }
});

// Se as bibliotecas do CDN não carregaram (sem internet, bloqueio...), avisa
if (!window.pdfjsLib || !window.PDFLib) {
  mostrarAvisos(["Não consegui carregar as bibliotecas de PDF (pdf.js / pdf-lib). Verifique a internet e recarregue."], true);
}

// Primeira vez: desenha a tela com o que estava salvo
render();
