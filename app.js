/*
 * Preenchedor de Diários de Classe (UDC) — versão web
 * ===================================================
 *
 * É a "tradução" do diario.py para JavaScript, rodando 100% no navegador.
 *
 * Organização deste arquivo:
 *   PARTE 0 — medidas do formulário (copiadas do diario.py)
 *   PARTE 1 — ler o PDF em branco (pdf.js no lugar do pdfplumber)
 *   PARTE 2 — o "estado": matérias, turmas e tudo o que você digita
 *   PARTE 3 — guardar no navegador (localStorage + IndexedDB para os PDFs)
 *   PARTE 4 — cálculos: datas por bimestre, presenças e médias (como ler_planilha)
 *   PARTE 5 — desenhar os textos no PDF (pdf-lib no lugar do reportlab + pypdf)
 *   PARTE 6 — gerar vários diários e salvar numa pasta
 *   PARTE 7 — a tela: montar as tabelas e reagir aos cliques
 *
 * Como os dados se organizam:
 *   MATÉRIA (ex.: Circuitos Elétricos)  -> uma aba na barra da esquerda
 *     ├─ datas, conteúdos, pesos, início do 2º bimestre  (iguais para todas as turmas)
 *     ├─ chamada e notas de cada aluno (pelo RA)
 *     └─ TURMAS (ex.: GELE4N, GELE6N) -> cada uma tem o seu PDF em branco
 *                                        e gera o SEU diário preenchido
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

// Dias da semana para o gerador de datas (0 = domingo, padrão do JavaScript)
const DIAS_SEMANA = [[1, "Segunda"], [2, "Terça"], [3, "Quarta"], [4, "Quinta"], [5, "Sexta"], [6, "Sábado"]];

// Onde o progresso fica guardado no navegador
const CHAVE_ARMAZENAMENTO = "diario-de-classe:v2";
const CHAVE_ANTIGA_V1 = "diario-de-classe:v1"; // formato da 1ª versão (uma matéria só)
const PASTA_PADRAO = "Diários Preenchidos - 2º bimestre";
const PASTA_BACKUP = "Backup de diários"; // criada dentro da mesma pasta escolhida para os PDFs

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
  return { palavras, texto: juntarTexto(palavras) };
}

// Junta as palavras em texto corrido (como o extract_text do pdfplumber)
function juntarTexto(palavras) {
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
 *   { tipo: "frequencia", bimestre: 1, alunos: Map { "0000000001" => { topo: 124.7, nome: "FULANO ..." } } }
 *   { tipo: "conteudo",   bimestre: 1, alunos: Map {} }
 * e, em paginas.cabecalho, o que estiver no cabeçalho (veja lerCabecalho).
 */
async function lerPdfEmBranco(bytesPdf) {
  // .slice() faz uma CÓPIA: o pdf.js "consome" o buffer que recebe,
  // e ainda vamos precisar dos bytes originais para o pdf-lib depois.
  const doc = await pdfjsLib.getDocument({ data: bytesPdf.slice() }).promise;
  const paginas = [];
  let cabecalho = null;

  for (let n = 1; n <= doc.numPages; n++) {
    const pagina = await doc.getPage(n);
    // disableNormalization: não "arrumar" caracteres (ex.: manter o "º" como está)
    const conteudo = await pagina.getTextContent({ disableNormalization: true });
    const { palavras, texto } = montarPalavras(conteudo, pagina);
    if (n === 1) cabecalho = lerCabecalho(palavras); // disciplina, turma... (só na 1ª página)

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
  // Uma lista em JavaScript também pode ter "propriedades extras":
  // penduramos o cabeçalho nela para não mudar o formato da resposta.
  paginas.cabecalho = cabecalho;
  return paginas;
}

/*
 * Lê o cabeçalho do diário. No PDF da UDC ele é assim:
 *
 *   DISCIPLINA:              PROFESSOR(A):     TURMA:     CURSO:                       SEM.:
 *   CIRCUITOS ELÉTRICOS II   FULANO DE TAL     GELET04N   Engenharia Elétrica (...)    2026/2
 *
 * Achamos os RÓTULOS (linha de cima) e, para cada um, juntamos as palavras da
 * linha de baixo que ficam entre ele e o próximo rótulo. Assim não dependemos
 * de posições exatas. Devolve { disciplina, professor, turma, curso, semestre }
 * ou null se o PDF não tiver esse cabeçalho.
 */
const ROTULOS_CABECALHO = {
  "DISCIPLINA:": "disciplina", "PROFESSOR(A):": "professor", "TURMA:": "turma",
  "CURSO:": "curso", "SEM.:": "semestre",
};
function lerCabecalho(palavras) {
  const disc = palavras.find((p) => p.text === "DISCIPLINA:");
  if (!disc) return null;
  // Rótulos na mesma linha do "DISCIPLINA:", da esquerda para a direita
  const rotulos = palavras
    .filter((p) => ROTULOS_CABECALHO[p.text] && Math.abs(p.top - disc.top) < 3)
    .sort((a, b) => a.x0 - b.x0);
  // Valores: a linha logo abaixo dos rótulos (entre 3 e 20 pontos mais para baixo)
  const valores = palavras.filter((p) => p.top > disc.top + 3 && p.top < disc.top + 20);
  const cab = {};
  rotulos.forEach((r, i) => {
    const fim = i + 1 < rotulos.length ? rotulos[i + 1].x0 : Infinity;
    cab[ROTULOS_CABECALHO[r.text]] = valores
      .filter((v) => v.x0 >= r.x0 - 3 && v.x0 < fim - 3)
      .sort((a, b) => a.x0 - b.x0)
      .map((v) => v.text)
      .join(" ");
  });
  return cab.disciplina ? cab : null;
}

// Junta os alunos de todas as páginas (sem repetir), na ordem em que aparecem
function alunosDoPdf(paginas) {
  const alunos = new Map();
  for (const pg of paginas) for (const [ra, { nome }] of pg.alunos) alunos.set(ra, nome);
  return alunos;
}


// ===========================================================================
// PARTE 2 — O ESTADO (tudo o que você digita)
// ===========================================================================

/*
 * Formato dos dados (é isto que vai para o backup .json):
 * {
 *   versao: 2,
 *   materiaAtual: "id-da-matéria-aberta",
 *   inicio2bim: "2026-09-21",   // início do 2º bimestre: vale para TODAS as matérias
 *   nomePasta: "Diários Preenchidos - 2º bimestre",
 *   materias: [{
 *     id, nome: "Circuitos Elétricos",
 *     config:    { composicao: {                  // como a média de cada bimestre é calculada
 *                     1: [ { id: "prova", nome: "Prova", peso: "70" }, { id: "ativ", nome: "Atividades", peso: "30" } ],
 *                     2: [ ... ] } },
 *     chave: "CIRCUITOS ELÉTRICOS II|2026/2",       // lida do cabeçalho do PDF
 *     turmas:    [ { id, nome: "GELET04N", codigo: "GELET04N", curso, arquivo: "doc (3).pdf",
 *                    alunos: [ { ra: "0000000001", nome: "FULANO ..." } ] } ],
 *     datas:     [ "2026-02-10", "2026-02-11", ... ],   // sempre em ordem
 *     presencas: { "0000000001": { "2026-02-10": "C", "2026-02-11": "CF" } },
 *     conteudos: { "2026-02-10": "Apresentação da disciplina" },
 *     notas:     { "0000000001": { 1: { prova: "7,5", ativ: "8" }, 2: {} } },  // nota de cada componente
 *     ingressos: { "0000000001": "2026-03-10" },   // só as datas de ingresso digitadas à mão
 *     calendario: { de, ate, regras: { 3: { freq: "semanal" }, 4: { freq: "quinzenal", inicio } } }
 *   }],
 *   pdfs: { "id-da-turma": "JVBERi0x..." }  // só no backup, e só se você marcar
 * }
 * As datas ficam como texto "AAAA-MM-DD": assim dá para ordenar e comparar
 * como texto, sem problemas de fuso horário.
 */

// Cria um identificador único (para matérias e turmas)
function novoId() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Composição da nota de um bimestre quando nada foi configurado
function composicaoPadrao() {
  return [{ id: "prova", nome: "Prova", peso: "70" }, { id: "ativ", nome: "Atividades", peso: "30" }];
}

/*
 * Converte o formato ANTIGO (peso da prova + peso das atividades, notas p1/a1/p2/a2)
 * para o novo (lista de componentes). Os pesos antigos eram frações (0,7 e 0,3):
 * viram porcentagens (70 e 30). As regras do diario.py são mantidas:
 * peso da prova vazio/zero vale 1; peso das atividades vazio vale 0.
 */
function migrarPesosAntigos(config) {
  const pp = paraNumero(config.pesoProva);
  const pa = paraNumero(config.pesoAtiv);
  let prova = pp && !Number.isNaN(pp) ? pp : 1;
  let ativ = pa && !Number.isNaN(pa) ? pa : 0;
  if (prova + ativ <= 1.0001) { // eram frações -> porcentagem (arredonda o "lixo" do 0,7 × 100 = 70,000...01)
    prova = Math.round(prova * 100 * 1000) / 1000;
    ativ = Math.round(ativ * 100 * 1000) / 1000;
  }
  const lista = () => [{ id: "prova", nome: "Prova", peso: String(prova) }, { id: "ativ", nome: "Atividades", peso: String(ativ) }];
  return { 1: lista(), 2: lista() };
}
function migrarNotasAntigas(n) {
  if (!n || !("p1" in n || "a1" in n || "p2" in n || "a2" in n)) return n;
  return { 1: { prova: n.p1 ?? "", ativ: n.a1 ?? "" }, 2: { prova: n.p2 ?? "", ativ: n.a2 ?? "" } };
}

function novaMateria(nome = "Nova matéria") {
  return {
    id: novoId(),
    nome,
    chave: "", // "DISCIPLINA|SEMESTRE" lido do PDF: serve para achar a matéria de novo
    config: { composicao: { 1: composicaoPadrao(), 2: composicaoPadrao() } },
    turmas: [],
    datas: [],
    presencas: {},
    conteudos: {},
    notas: {},
    calendario: { de: "", ate: "", regras: {} },
    ingressos: {},
  };
}

function estadoVazio() {
  const m = novaMateria();
  return { versao: 2, materiaAtual: m.id, inicio2bim: "", nomePasta: PASTA_PADRAO, materias: [m] };
}

// Garante que uma matéria tem todos os campos (backups antigos ou incompletos)
function normalizarMateria(obj) {
  const base = novaMateria();
  const m = {
    ...base,
    id: obj.id || base.id,
    nome: String(obj.nome ?? base.nome),
    chave: String(obj.chave || ""),
    config: { composicao: normalizarComposicao(obj.config) },
    turmas: Array.isArray(obj.turmas) ? obj.turmas : [],
    datas: Array.isArray(obj.datas) ? obj.datas.filter(ehDataValida) : [],
    presencas: obj.presencas || {},
    conteudos: obj.conteudos || {},
    notas: Object.fromEntries(Object.entries(obj.notas || {}).map(([ra, n]) => [ra, migrarNotasAntigas(n) || {}])),
    calendario: { ...base.calendario, ...(obj.calendario || {}) },
    ingressos: obj.ingressos || {},
  };
  m.calendario.regras ||= {};
  m.turmas = m.turmas.map((t) => ({
    id: t.id || novoId(),
    nome: String(t.nome || "Turma"),
    codigo: String(t.codigo || ""), // código lido do PDF (ex.: GELET04N)
    curso: String(t.curso || ""),
    arquivo: String(t.arquivo || ""),
    alunos: (Array.isArray(t.alunos) ? t.alunos : [])
      .filter((a) => a && a.ra)
      .map((a) => ({ ra: String(a.ra).trim(), nome: String(a.nome || "") })),
  }));
  m.datas = [...new Set(m.datas)].sort();
  return m;
}

// Composição da nota de uma matéria (aceita o formato antigo de pesos)
function normalizarComposicao(config = {}) {
  const c = config.composicao;
  if (!c) return "pesoProva" in config || "pesoAtiv" in config ? migrarPesosAntigos(config) : { 1: composicaoPadrao(), 2: composicaoPadrao() };
  const limpa = (lista) => (Array.isArray(lista) ? lista : [])
    .map((x) => ({ id: String(x.id || novoId()), nome: String(x.nome ?? ""), peso: String(x.peso ?? "0") }));
  return { 1: limpa(c[1]), 2: limpa(c[2]) };
}

// A data que mais aparece numa lista (para juntar datas antigas, uma por matéria, em uma só)
function maisComum(lista) {
  const contagem = new Map();
  for (const x of lista) contagem.set(x, (contagem.get(x) || 0) + 1);
  return [...contagem].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

/*
 * Aceita os dois formatos:
 *   - versão 2 (várias matérias), o atual;
 *   - versão 1 (uma matéria só, com "alunos" direto) — convertemos para o novo.
 */
function normalizarEstado(obj) {
  if (!obj || typeof obj !== "object") throw new Error("Arquivo de backup inválido.");
  if (!Array.isArray(obj.materias)) {
    if (!Array.isArray(obj.alunos)) throw new Error("Este arquivo não parece um backup do diário.");
    // Formato antigo: vira uma matéria com uma turma
    obj = {
      versao: 2,
      materias: [{ ...obj, nome: "Minha matéria",
        turmas: [{ nome: "Turma 1", alunos: obj.alunos }] }],
    };
  }
  // Início do 2º bimestre: antes era um por matéria; agora é um só para todas.
  // Em backups antigos, usamos a data mais comum entre as matérias.
  const inicio2bim = ehDataValida(obj.inicio2bim) ? obj.inicio2bim
    : maisComum(obj.materias.map((m) => m.config?.inicio2bim).filter(ehDataValida));
  const materias = obj.materias.map(normalizarMateria);
  if (!materias.length) materias.push(novaMateria());
  const atual = materias.some((m) => m.id === obj.materiaAtual) ? obj.materiaAtual : materias[0].id;
  return { versao: 2, materiaAtual: atual, inicio2bim, nomePasta: obj.nomePasta || PASTA_PADRAO, materias };
}

let estado = carregarEstado();

// A matéria aberta na tela
function materia() {
  return estado.materias.find((m) => m.id === estado.materiaAtual) || estado.materias[0];
}

// Todos os alunos da matéria (de todas as turmas), sem repetir RA
function alunosDaMateria(m) {
  const vistos = new Map();
  for (const t of m.turmas) for (const a of t.alunos) if (!vistos.has(a.ra)) vistos.set(a.ra, a);
  return [...vistos.values()];
}


// ===========================================================================
// PARTE 3 — GUARDAR NO NAVEGADOR
// ===========================================================================

/*
 * Dois "lugares" do navegador:
 *   - localStorage: pequeno (uns 5 MB), guarda TEXTO. Usamos para o estado (JSON).
 *   - IndexedDB: um banco de dados do navegador, guarda arquivos grandes.
 *     Usamos para os PDFs em branco (para não precisar abri-los toda vez)
 *     e para lembrar a pasta onde salvar os diários.
 * Os dois ficam SÓ neste navegador, neste computador.
 */
function carregarEstado() {
  try {
    const salvo = localStorage.getItem(CHAVE_ARMAZENAMENTO) || localStorage.getItem(CHAVE_ANTIGA_V1);
    if (salvo) return normalizarEstado(JSON.parse(salvo));
  } catch (erro) {
    console.warn("Não consegui ler o progresso salvo:", erro);
  }
  return estadoVazio();
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

// --- IndexedDB: um pouco verboso, então escondemos tudo nestas funções ---
let promessaBanco = null;
function abrirBanco() {
  promessaBanco ??= new Promise((ok, falha) => {
    const pedido = indexedDB.open("diario-de-classe", 1);
    // Roda só na primeira vez: cria as "gavetas" (object stores)
    pedido.onupgradeneeded = () => {
      pedido.result.createObjectStore("pdfs");    // id da turma -> bytes do PDF
      pedido.result.createObjectStore("ajustes"); // "pasta" -> pasta escolhida
    };
    pedido.onsuccess = () => ok(pedido.result);
    pedido.onerror = () => falha(pedido.error);
  });
  return promessaBanco;
}

// Executa uma operação numa gaveta e devolve o resultado
async function banco(gaveta, modo, operacao) {
  const db = await abrirBanco();
  return new Promise((ok, falha) => {
    const transacao = db.transaction(gaveta, modo);
    const pedido = operacao(transacao.objectStore(gaveta));
    transacao.oncomplete = () => ok(pedido?.result);
    transacao.onerror = () => falha(transacao.error);
  });
}
const bancoLer = (gaveta, chave) => banco(gaveta, "readonly", (g) => g.get(chave));
const bancoGravar = (gaveta, chave, valor) => banco(gaveta, "readwrite", (g) => g.put(valor, chave));
const bancoApagar = (gaveta, chave) => banco(gaveta, "readwrite", (g) => g.delete(chave));

// Quais turmas têm o PDF guardado (para mostrar ✓ na tela sem esperar o banco)
const turmasComPdf = new Set();

async function guardarPdf(turmaId, bytes) {
  try {
    await bancoGravar("pdfs", turmaId, bytes);
    turmasComPdf.add(turmaId);
  } catch (erro) {
    console.warn("Não consegui guardar o PDF no navegador:", erro);
  }
}

async function obterPdf(turmaId) {
  try {
    return (await bancoLer("pdfs", turmaId)) || null;
  } catch {
    return null;
  }
}

async function apagarPdf(turmaId) {
  turmasComPdf.delete(turmaId);
  try { await bancoApagar("pdfs", turmaId); } catch { /* sem problema */ }
}

// Converte bytes <-> texto base64 (para colocar os PDFs dentro do backup .json)
function paraBase64(bytes) {
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) { // em pedaços, para não estourar a memória
    binario += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binario);
}
function deBase64(texto) {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}


// ===========================================================================
// PARTE 4 — CONVERSÕES E CÁLCULOS (equivale a ler_planilha do Python)
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

// Datas como número de dias (em UTC, o horário universal, para não sofrer
// com horário de verão). Útil para andar de um em um dia e contar semanas.
const UM_DIA = 86400000; // milissegundos em um dia
function paraUTC(texto) {
  const { ano, mes, dia } = partesData(texto);
  return Date.UTC(ano, mes - 1, dia);
}
function deUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
const DIA_SEMANA_NOME = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/* Aceita 7, 7.5, "7,5" ... e devolve número (ou null se vazio).
   Se não for número, devolve NaN (o Python daria erro; aqui avisamos na tela). */
function paraNumero(valor) {
  if (valor === null || valor === undefined || String(valor).trim() === "") return null;
  const texto = String(valor).trim().replace(",", ".");
  // Number("") é 0 e Number("7abc") é NaN — exigimos um número "limpo"
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(texto)) return NaN;
  return Number(texto);
}

// Peso de um componente como número (vazio ou inválido = 0)
function pesoDe(componente) {
  const p = paraNumero(componente.peso);
  return p && !Number.isNaN(p) ? p : 0;
}
const somaDosPesos = (lista) => lista.reduce((soma, c) => soma + pesoDe(c), 0);

/*
 * Média de um bimestre = soma(nota × peso) ÷ soma dos pesos.
 *  - Componentes com peso 0 não entram (podem ficar em branco).
 *  - Se faltar a nota de algum componente com peso > 0, ainda não há média (null).
 * Detalhe: transformamos os pesos em frações ANTES da conta (70% -> 0,7). Assim,
 * com Prova 70% e Atividades 30%, a conta é exatamente a do diario.py,
 * (prova × 0,7 + ativ × 0,3) ÷ (0,7 + 0,3), e os arredondamentos batem.
 */
function calcularMedia(m, bim, notasDoBimestre = {}) {
  const lista = m.config.composicao[bim] || [];
  const soma = somaDosPesos(lista);
  if (!(soma > 0)) return null;
  let total = 0;
  let somaFracoes = 0;
  for (const c of lista) {
    const peso = pesoDe(c);
    if (!peso) continue;
    const nota = paraNumero(notasDoBimestre[c.id]);
    if (nota === null || Number.isNaN(nota)) return null;
    const fracao = peso / soma;
    total += nota * fracao;
    somaFracoes += fracao;
  }
  return total / somaFracoes;
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

/*
 * INGRESSO: alunos podem entrar na matéria depois do início das aulas.
 * Antes da data de ingresso, o diário fica EM BRANCO e as faltas NÃO contam.
 *   - Se você digitou a data de ingresso do aluno, vale ela.
 *   - Senão, vale a 1ª presença dele (o 1º dia com algum "C").
 *   - Sem nenhuma presença (e sem data digitada): não há como saber quando
 *     ele entrou, então tudo conta normalmente.
 */
function primeiraPresenca(m, ra) {
  return m.datas.find((d) => (letrasDoDia(m.presencas[ra]?.[d]) || []).includes("C")) || null;
}
function dataIngresso(m, ra) {
  return m.ingressos[ra] || primeiraPresenca(m, ra);
}
// A data "d" é antes do ingresso? (datas "AAAA-MM-DD" se comparam como texto)
function antesDoIngresso(ingresso, d) {
  return Boolean(ingresso) && d < ingresso;
}

// Separa as datas por bimestre (aulas antes do início do 2º vão para o 1º)
function datasPorBimestre(m) {
  const inicio = estado.inicio2bim; // a mesma data para todas as matérias
  return {
    1: m.datas.filter((d) => !inicio || d < inicio),
    2: inicio ? m.datas.filter((d) => d >= inicio) : [],
  };
}

function bimestreDaData(m, d) {
  const inicio = estado.inicio2bim;
  return inicio && d >= inicio ? 2 : 1;
}

/*
 * Gera as datas de aula entre "de" e "ate" seguindo as regras de cada dia da semana:
 *   regras = { 3: { freq: "semanal" }, 4: { freq: "quinzenal", inicio: "2026-02-12" } }
 * Quinzenal: a partir da data "inicio", pula de 14 em 14 dias.
 */
function gerarDatasCalendario(de, ate, regras) {
  const datas = [];
  for (let t = paraUTC(de); t <= paraUTC(ate); t += UM_DIA) {
    const regra = regras[new Date(t).getUTCDay()];
    if (!regra || regra.freq === "nenhuma") continue;
    if (regra.freq === "semanal") {
      datas.push(deUTC(t));
    } else if (regra.freq === "quinzenal") {
      const diasDesdeInicio = Math.round((t - paraUTC(regra.inicio)) / UM_DIA);
      if (diasDesdeInicio >= 0 && diasDesdeInicio % 14 === 0) datas.push(deUTC(t));
    }
  }
  return datas;
}

// Confere as regras do calendário. Devolve o texto do problema, ou "" se estiver tudo certo.
function problemaNasRegras(regras) {
  if (!Object.keys(regras).length) return "Escolha a frequência de pelo menos um dia da semana no calendário da matéria.";
  for (const [num, regra] of Object.entries(regras)) {
    if (regra.freq !== "quinzenal") continue;
    const nome = DIAS_SEMANA.find(([n]) => n === Number(num))[1];
    if (!regra.inicio) return `Informe a 1ª aula quinzenal de ${nome}.`;
    if (new Date(paraUTC(regra.inicio)).getUTCDay() !== Number(num)) {
      return `A 1ª aula quinzenal de ${nome} (${dataBR(regra.inicio)}) não cai numa ${nome.toLowerCase()}.`;
    }
  }
  return "";
}

/*
 * Próxima aula da matéria: a primeira data DEPOIS da última aula da lista que
 * segue o calendário (ex.: toda sexta). Sem nenhuma aula ainda, começa no "De"
 * do calendário (ou hoje). Procuramos em 4 semanas, o que cobre o quinzenal.
 */
function proximaAula(m) {
  const { regras, de } = m.calendario;
  if (problemaNasRegras(regras)) return null;
  const ultima = m.datas[m.datas.length - 1];
  const inicio = ultima ? deUTC(paraUTC(ultima) + UM_DIA) : (de || hojeISO());
  const fim = deUTC(paraUTC(inicio) + 27 * UM_DIA);
  return gerarDatasCalendario(inicio, fim, regras)[0] || null;
}

// Primeira data, a partir de "de", que cai no dia da semana pedido
function primeiraOcorrencia(de, diaSemana) {
  let t = paraUTC(de);
  while (new Date(t).getUTCDay() !== diaSemana) t += UM_DIA;
  return deUTC(t);
}


// ===========================================================================
// PARTE 5 — DESENHAR OS TEXTOS NO PDF (pdf-lib)
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

    const ingresso = dados.ingressos.get(ra);
    let faltas = 0;
    colunas.forEach((d, i) => {
      if (antesDoIngresso(ingresso, d)) return; // antes de entrar na matéria -> em branco, não conta
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

// Cópia independente da configuração (para uma matéria nova começar igual a outra)
function copiarConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

// Junta os dados da matéria no formato que as funções de desenho esperam
// (é o que o ler_planilha() do Python devolve). Também valida tudo.
function prepararDados(m, erros) {
  if (!estado.inicio2bim) erros.push("Preencha o 'Início do 2º bimestre' (seção 2).");
  for (const b of [1, 2]) {
    for (const c of m.config.composicao[b]) {
      if (Number.isNaN(paraNumero(c.peso))) erros.push(`Peso inválido no componente “${c.nome}” (${b}º bimestre).`);
    }
  }

  const presencas = new Map();
  const medias = new Map();
  const ingressos = new Map();
  for (const { ra, nome } of alunosDaMateria(m)) {
    presencas.set(ra, m.presencas[ra] || {});
    ingressos.set(ra, dataIngresso(m, ra));
    const n = m.notas[ra] || {};
    for (const b of [1, 2]) {
      for (const c of m.config.composicao[b]) {
        const valor = n[b]?.[c.id];
        if (Number.isNaN(paraNumero(valor))) erros.push(`Nota inválida para ${nome || ra} (${c.nome}, ${b}º bim.): "${valor}".`);
      }
    }
    medias.set(ra, { 1: calcularMedia(m, 1, n[1]), 2: calcularMedia(m, 2, n[2]) });
  }
  return { datas: datasPorBimestre(m), presencas, medias, ingressos, conteudos: m.conteudos };
}

// Igual a preencher() do Python: recebe o PDF em branco de UMA turma e os dados
// já preparados da matéria; devolve os bytes do PDF preenchido.
async function gerarPdfPreenchido(bytesPdf, dados, avisos) {
  const paginasInfo = await lerPdfEmBranco(bytesPdf);
  const pdf = await PDFLib.PDFDocument.load(bytesPdf.slice(), { ignoreEncryption: true });
  // As fontes padrão do PDF: as mesmas do reportlab (mesmas larguras de letra)
  const helv = await pdf.embedFont(PDFLib.StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(PDFLib.StandardFonts.HelveticaBold);

  let numeroAula = 1;
  pdf.getPages().forEach((pagina, idx) => {
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
// PARTE 6 — GERAR VÁRIOS DIÁRIOS E SALVAR NUMA PASTA
// ===========================================================================

// Nomes de arquivo não podem ter  \ / : * ? " < > |  (o Windows proíbe)
function nomeDeArquivo(texto) {
  return String(texto).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "sem nome";
}

/*
 * Gera o diário de cada turma das matérias pedidas.
 * Devolve { arquivos: [{ nome, bytes }], mensagens: [{ texto, erro }] }.
 * Um problema numa turma NÃO impede as outras de serem geradas.
 */
async function gerarDiarios(materias) {
  const arquivos = [];
  const mensagens = [];
  const nomesUsados = new Set();

  for (const m of materias) {
    const titulo = m.nome || "Matéria sem nome";
    if (!m.turmas.length) {
      mensagens.push({ texto: `${titulo}: nenhuma turma (PDF) adicionada.`, erro: true });
      continue;
    }
    const erros = [];
    const dados = prepararDados(m, erros);
    if (erros.length) {
      for (const e of new Set(erros)) mensagens.push({ texto: `${titulo}: ${e}`, erro: true });
      continue;
    }
    for (const t of m.turmas) {
      const rotulo = `${titulo} – ${t.nome}`;
      const bytes = await obterPdf(t.id);
      if (!bytes) {
        mensagens.push({ texto: `${rotulo}: o PDF em branco não está guardado. Use “Trocar PDF” nessa turma.`, erro: true });
        continue;
      }
      try {
        const avisos = new Set();
        const saida = await gerarPdfPreenchido(bytes, dados, avisos);
        // Nome do arquivo: "Matéria - Turma.pdf" (sem repetir)
        let nome = nomeDeArquivo(`${titulo} - ${t.nome}`);
        for (let k = 2; nomesUsados.has(nome.toLowerCase()); k++) nome = nomeDeArquivo(`${titulo} - ${t.nome} (${k})`);
        nomesUsados.add(nome.toLowerCase());
        arquivos.push({ nome: `${nome}.pdf`, bytes: saida });
        mensagens.push({ texto: `✓ ${nome}.pdf` });
        for (const a of avisos) mensagens.push({ texto: `${rotulo}: ${a}` });
      } catch (erro) {
        mensagens.push({ texto: `${rotulo}: erro ao gerar (${erro.message}).`, erro: true });
      }
    }
  }
  return { arquivos, mensagens };
}

/*
 * Escolher uma pasta do computador e gravar nela só funciona no Chrome e no Edge
 * (é a "File System Access API"). Nos outros navegadores, baixamos os arquivos.
 */
const podeEscolherPasta = typeof window.showDirectoryPicker === "function";

// Devolve a pasta "base" escolhida (lembrada da última vez, se ainda tivermos permissão)
async function obterPastaBase(escolherOutra = false) {
  let pasta = null;
  if (!escolherOutra) {
    try { pasta = await bancoLer("ajustes", "pasta"); } catch { pasta = null; }
  }
  if (pasta && typeof pasta.queryPermission === "function") {
    // O navegador pede de novo a permissão de escrita a cada visita
    let permissao = await pasta.queryPermission({ mode: "readwrite" });
    if (permissao !== "granted") permissao = await pasta.requestPermission({ mode: "readwrite" });
    if (permissao !== "granted") pasta = null;
  }
  if (!pasta) {
    pasta = await window.showDirectoryPicker({ id: "diarios", mode: "readwrite" });
    try { await bancoGravar("ajustes", "pasta", pasta); } catch { /* só não vai lembrar */ }
  }
  mostrarInfoPasta(pasta);
  return pasta;
}

// "Elétricos" -> "Eletricos": tira os acentos (separa a letra do acento e apaga o acento)
function semAcentos(texto) {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[ºª°]/g, "o");
}

// Alguns sistemas de arquivos recusam acentos no nome. Tentamos com acento e,
// se der erro, tentamos de novo sem acento.
async function abrirOuCriar(pasta, nome, tipo) {
  const abrir = (n) => tipo === "pasta"
    ? pasta.getDirectoryHandle(n, { create: true })
    : pasta.getFileHandle(n, { create: true });
  try {
    return await abrir(nome);
  } catch (erro) {
    if (semAcentos(nome) === nome) throw erro;
    return abrir(semAcentos(nome));
  }
}

// Cria (ou reaproveita) a subpasta e grava todos os arquivos nela
async function gravarNaPasta(pastaBase, nomeSubpasta, arquivos) {
  const sub = await abrirOuCriar(pastaBase, nomeDeArquivo(nomeSubpasta), "pasta");
  for (const { nome, bytes } of arquivos) {
    const arquivo = await abrirOuCriar(sub, nome, "arquivo");
    const escritor = await arquivo.createWritable(); // abre para escrever (substitui o antigo)
    await escritor.write(bytes);
    await escritor.close();
  }
  return sub.name;
}

// Faz o navegador "baixar" um arquivo criado aqui mesmo na página
function baixarArquivo(conteudo, nome, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = el("a", { href: url, download: nome });
  document.body.append(a);
  a.click();
  a.remove();
  // Libera a memória depois de 1 minuto (se for antes, o download pode perder o nome)
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Monta o texto do backup: TODAS as matérias (e, se marcado, os PDFs em branco)
async function montarBackup() {
  const copia = JSON.parse(JSON.stringify(estado)); // cópia "profunda" do estado
  if ($("backupComPdfs").checked) {
    copia.pdfs = {};
    for (const m of estado.materias) {
      for (const t of m.turmas) {
        const bytes = await obterPdf(t.id);
        if (bytes) copia.pdfs[t.id] = paraBase64(bytes);
      }
    }
  }
  return JSON.stringify(copia, null, 2);
}

// Nome com data e hora, para um backup não apagar o outro: diario-backup-2026-11-16_14h05.json
function nomeBackup() {
  const h = new Date();
  const dois = (n) => String(n).padStart(2, "0");
  return `diario-backup-${hojeISO()}_${dois(h.getHours())}h${dois(h.getMinutes())}.json`;
}

// Grava o backup na subpasta "Backup de diários" e devolve o caminho, para mostrar na tela
async function gravarBackupNaPasta(pasta) {
  const nome = nomeBackup();
  const sub = await gravarNaPasta(pasta, PASTA_BACKUP, [{ nome, bytes: await montarBackup() }]);
  return `${pasta.name}/${sub}/${nome}`;
}

// O que acontece ao clicar em "Gerar diários..."
async function gerarESalvar(materias) {
  const botoes = [$("btnGerarMateria"), $("btnGerarTodas")];
  botoes.forEach((b) => (b.disabled = true));
  try {
    // 1) Primeiro a pasta: o navegador só deixa abrir a janela de escolha
    //    logo depois de um clique, então não dá para deixar para o final.
    let pasta = null;
    if (podeEscolherPasta) {
      try {
        pasta = await obterPastaBase();
      } catch (erro) {
        if (erro.name === "AbortError") return mostrarAvisos([{ texto: "Nenhuma pasta escolhida.", erro: true }]);
        throw erro;
      }
    }

    // 2) Gera os PDFs
    mostrarAvisos([{ texto: "Gerando…" }]);
    const { arquivos, mensagens } = await gerarDiarios(materias);
    if (!arquivos.length) return mostrarAvisos(mensagens);

    // 3) Grava na pasta (ou baixa um por um)
    if (pasta) {
      const nomeSub = await gravarNaPasta(pasta, estado.nomePasta || PASTA_PADRAO, arquivos);
      // Junto com os diários, um backup de tudo (se falhar, os diários já estão salvos)
      let textoBackup;
      try {
        textoBackup = `Backup salvo em “${await gravarBackupNaPasta(pasta)}”.`;
      } catch (erro) {
        textoBackup = `Os diários foram salvos, mas o backup falhou: ${erro.message}`;
      }
      mensagens.unshift({ texto: `${arquivos.length} diário(s) salvo(s) em “${pasta.name}/${nomeSub}”.` },
        { texto: textoBackup });
    } else {
      for (const { nome, bytes } of arquivos) {
        baixarArquivo(bytes, nome, "application/pdf");
        await esperar(400); // uma pausa: alguns navegadores bloqueiam muitos downloads seguidos
      }
      mensagens.unshift({ texto: `${arquivos.length} diário(s) baixado(s). (Para salvar direto numa pasta, use o Chrome ou o Edge.)` });
    }
    mostrarAvisos(mensagens);
  } catch (erro) {
    mostrarAvisos([{ texto: "Erro: " + erro.message, erro: true }]);
  } finally {
    botoes.forEach((b) => (b.disabled = false));
  }
}


// ===========================================================================
// PARTE 7 — A TELA
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
  renderLateral();
  renderMateria();
  renderConfig();
  renderCalendario();
  renderAulas();
  renderChamada();
  renderNotas();
  $("nomePasta").value = estado.nomePasta || PASTA_PADRAO;
}

// --- Barra lateral: uma "aba" por matéria ---
function renderLateral() {
  const lista = $("listaMaterias");
  lista.replaceChildren();
  for (const m of estado.materias) {
    const botao = el("button", { type: "button", className: "aba-materia" + (m.id === estado.materiaAtual ? " ativa" : "") },
      m.nome || "Matéria sem nome",
      el("small", { textContent: `${m.turmas.map((t) => t.nome).join(", ") || "sem turmas"} · ${m.datas.length} datas` }));
    botao.addEventListener("click", () => {
      estado.materiaAtual = m.id;
      salvar();
      render();
      window.scrollTo({ top: 0 });
    });
    lista.append(botao);
  }
}

// --- Nome da matéria e lista de turmas ---
function renderMateria() {
  const m = materia();
  $("nomeMateria").value = m.nome;
  const lista = $("listaTurmas");
  lista.replaceChildren();
  if (!m.turmas.length) {
    lista.append(el("p", { className: "dica", textContent: "Nenhuma turma ainda. Adicione o PDF em branco do diário." }));
  }
  for (const t of m.turmas) {
    const nome = el("input", { type: "text", value: t.nome });
    nome.setAttribute("aria-label", "Nome da turma");
    nome.addEventListener("input", () => { t.nome = nome.value; salvar(); renderLateral(); });
    nome.addEventListener("change", () => { renderChamada(); renderNotas(); });

    const temPdf = turmasComPdf.has(t.id);
    const status = el("span", {
      className: temPdf ? "ok" : "falta",
      textContent: temPdf ? "✓ PDF guardado" : "✗ falta o PDF",
      title: t.arquivo,
    });

    // "Trocar PDF": abre outro arquivo para ESTA turma
    const trocar = el("label", { className: "botao" }, "Trocar PDF…");
    const entrada = el("input", { type: "file", accept: "application/pdf,.pdf", hidden: true });
    entrada.addEventListener("change", async () => {
      if (entrada.files[0]) await abrirPdfTurma(entrada.files[0], t);
      entrada.value = "";
    });
    trocar.append(entrada);

    const remover = el("button", { type: "button", className: "botao perigo", textContent: "Remover turma" });
    remover.addEventListener("click", () => removerTurma(t));

    lista.append(el("div", { className: "turma" },
      nome, el("span", { textContent: `${t.alunos.length} alunos`, title: [t.curso, t.arquivo].filter(Boolean).join(" · ") }),
      status, trocar, remover));
  }
}

// Chave que identifica a matéria no cabeçalho: "CIRCUITOS ELÉTRICOS II|2026/2"
function chaveDoCabecalho(cab) {
  return `${cab.disciplina}|${cab.semestre || ""}`;
}

/*
 * Põe o conteúdo de um PDF já lido dentro de uma turma: atualiza código/curso,
 * acrescenta alunos novos (mantendo os antigos) e guarda o PDF no navegador.
 * Devolve os alunos que estavam salvos mas sumiram do PDF (para avisar).
 */
async function aplicarPdfNaTurma(turma, arquivo, bytes, paginas) {
  const doPdf = alunosDoPdf(paginas);
  const cab = paginas.cabecalho;
  turma.arquivo = arquivo.name;
  if (cab?.turma) turma.codigo = cab.turma;
  if (cab?.curso) turma.curso = cab.curso;

  // Mantém os alunos que já estavam e acrescenta os novos, na ordem do PDF
  const jaTinha = new Set(turma.alunos.map((a) => a.ra));
  for (const [ra, nome] of doPdf) if (!jaTinha.has(ra)) turma.alunos.push({ ra, nome });
  await guardarPdf(turma.id, bytes);
  return turma.alunos.filter((a) => !doPdf.has(a.ra));
}

// Lê um arquivo PDF do computador: devolve os bytes e o que foi lido dele
async function lerArquivoPdf(arquivo) {
  const bytes = new Uint8Array(await arquivo.arrayBuffer()); // lê o arquivo para a memória
  const paginas = await lerPdfEmBranco(bytes);
  if (!alunosDoPdf(paginas).size) throw new Error(`${arquivo.name}: não encontrei alunos. É mesmo um diário em branco?`);
  return { bytes, paginas };
}

/*
 * Abre UM PDF em branco na matéria aberta. Se "turma" for informada, atualiza
 * essa turma; senão, procura uma turma com o mesmo código (ou arquivo) ou cria uma nova.
 */
async function abrirPdfTurma(arquivo, turma = null) {
  const m = materia();
  const { bytes, paginas } = await lerArquivoPdf(arquivo);
  const cab = paginas.cabecalho;

  if (cab) {
    const chave = chaveDoCabecalho(cab);
    if (!m.chave && !m.turmas.length) {
      // Matéria vazia: ganha o nome e a chave da disciplina do PDF
      m.chave = chave;
      if (!m.nome || m.nome === "Nova matéria") m.nome = cab.disciplina;
    } else if (m.chave && m.chave !== chave &&
      !confirm(`Este PDF é de “${cab.disciplina}” (${cab.turma}), mas a matéria aberta é “${m.nome}”. Adicionar mesmo assim?`)) {
      return;
    }
  }

  turma ??= m.turmas.find((t) => (cab?.turma && t.codigo === cab.turma) || t.arquivo === arquivo.name);
  if (!turma) {
    turma = { id: novoId(), nome: cab?.turma || arquivo.name.replace(/\.pdf$/i, ""),
      codigo: "", curso: "", arquivo: "", alunos: [] };
    m.turmas.push(turma);
  }
  const foraDoPdf = await aplicarPdfNaTurma(turma, arquivo, bytes, paginas);
  salvar();
  render();
  if (foraDoPdf.length) {
    alert(`Atenção (${turma.nome}): estes alunos estavam salvos, mas não aparecem neste PDF:\n` +
      foraDoPdf.map((a) => `${a.ra} ${a.nome}`).join("\n"));
  }
}

/*
 * Abre uma PASTA inteira de diários em branco e organiza tudo sozinho:
 *   - lê o cabeçalho de cada PDF (disciplina, turma, semestre);
 *   - PDFs da mesma disciplina e semestre viram UMA matéria, com uma turma por PDF;
 *   - matérias e turmas que já existiam são atualizadas (nada é apagado);
 *   - se a mesma turma aparecer duas vezes, fica o arquivo mais recente.
 */
async function importarPasta(arquivos) {
  const pdfs = [...arquivos].filter((f) => /\.pdf$/i.test(f.name));
  if (!pdfs.length) return alert("Não encontrei arquivos PDF nessa pasta.");

  // 1) Lê todos os PDFs e agrupa por disciplina
  const grupos = new Map(); // chave -> { cab, turmas: Map(código -> { arquivo, bytes, paginas, cab }) }
  const problemas = [];
  for (const arquivo of pdfs) {
    try {
      const lido = await lerArquivoPdf(arquivo);
      const cab = lido.paginas.cabecalho;
      if (!cab || !cab.turma) {
        problemas.push(`${arquivo.name}: não achei a disciplina/turma no cabeçalho (use “Adicionar turma”).`);
        continue;
      }
      const chave = chaveDoCabecalho(cab);
      if (!grupos.has(chave)) grupos.set(chave, { cab, turmas: new Map() });
      const turmas = grupos.get(chave).turmas;
      const anterior = turmas.get(cab.turma);
      if (anterior) {
        // Mesma disciplina e turma duas vezes: fica o arquivo modificado por último
        const fica = arquivo.lastModified >= anterior.arquivo.lastModified ? arquivo : anterior.arquivo;
        const sai = fica === arquivo ? anterior.arquivo : arquivo;
        problemas.push(`${cab.disciplina} – ${cab.turma} aparece em dois arquivos; usei “${fica.name}” (mais recente) e ignorei “${sai.name}”.`);
        if (fica !== arquivo) continue;
      }
      turmas.set(cab.turma, { arquivo, ...lido, cab });
    } catch (erro) {
      problemas.push(erro.message);
    }
  }

  // 2) Se só existe a matéria inicial vazia, ela sai (vai ser substituída)
  const vazia = (m) => !m.turmas.length && !m.datas.length && !m.chave;
  if (grupos.size) estado.materias = estado.materias.filter((m) => !vazia(m));

  // 3) Cria/atualiza as matérias, em ordem alfabética
  let novasMaterias = 0, novasTurmas = 0, primeira = null;
  const ordenados = [...grupos].sort((a, b) => a[1].cab.disciplina.localeCompare(b[1].cab.disciplina, "pt"));
  for (const [chave, { cab, turmas }] of ordenados) {
    let m = estado.materias.find((x) => x.chave === chave);
    if (!m) {
      m = novaMateria(cab.disciplina);
      m.chave = chave;
      // Facilidade: começa com os mesmos pesos/início do 2º bimestre de outra matéria
      if (estado.materias[0]) m.config = copiarConfig(estado.materias[0].config);
      estado.materias.push(m);
      novasMaterias++;
    }
    primeira ??= m;
    const codigos = [...turmas.keys()].sort();
    for (const codigo of codigos) {
      const { arquivo, bytes, paginas } = turmas.get(codigo);
      let t = m.turmas.find((x) => x.codigo === codigo);
      if (!t) {
        t = { id: novoId(), nome: codigo, codigo, curso: "", arquivo: "", alunos: [] };
        m.turmas.push(t);
        novasTurmas++;
      }
      const sumiram = await aplicarPdfNaTurma(t, arquivo, bytes, paginas);
      if (sumiram.length) problemas.push(`${m.nome} – ${t.nome}: ${sumiram.length} aluno(s) salvos não estão mais no PDF.`);
    }
  }
  if (!estado.materias.length) estado.materias.push(novaMateria());
  if (primeira && !estado.materias.some((m) => m.id === estado.materiaAtual)) estado.materiaAtual = primeira.id;
  if (primeira && vazia(materia())) estado.materiaAtual = primeira.id;
  salvar();
  render();

  const totalTurmas = [...grupos.values()].reduce((s, g) => s + g.turmas.size, 0);
  alert(`${pdfs.length} PDF(s) lidos: ${grupos.size} matéria(s) (${novasMaterias} nova(s)) e ` +
    `${totalTurmas} turma(s) (${novasTurmas} nova(s)).` +
    (problemas.length ? "\n\nAtenção:\n• " + problemas.join("\n• ") : ""));
}

async function removerTurma(t) {
  const m = materia();
  if (!confirm(`Remover a turma ${t.nome} desta matéria? A chamada e as notas desses alunos serão apagadas.`)) return;
  m.turmas = m.turmas.filter((x) => x !== t);
  // Apaga os dados dos alunos que não estão em nenhuma outra turma da matéria
  const restantes = new Set(alunosDaMateria(m).map((a) => a.ra));
  for (const a of t.alunos) {
    if (!restantes.has(a.ra)) { delete m.presencas[a.ra]; delete m.notas[a.ra]; }
  }
  await apagarPdf(t.id);
  salvar();
  render();
}

// --- Bimestres e composição da nota ---
function renderConfig() {
  const m = materia();
  $("cfgInicio2").value = estado.inicio2bim || "";
  // Mostra onde termina o 1º bimestre nesta matéria
  const pb = datasPorBimestre(m);
  const ultima1 = pb[1][pb[1].length - 1];
  $("infoBimestre").textContent = !estado.inicio2bim
    ? "Defina a data: aulas antes dela vão para o 1º bimestre."
    : `Nesta matéria: última aula do 1º bimestre ${ultima1 ? dataBR(ultima1) : "—"}; ` +
      `${pb[2].length ? `1ª aula do 2º bimestre ${dataBR(pb[2][0])}` : "ainda sem aulas no 2º bimestre"}.`;
  for (const b of [1, 2]) renderComposicao(m, b);
}

// Lista de componentes da nota de um bimestre: nome | peso % | ×
function renderComposicao(m, bim) {
  const lista = m.config.composicao[bim];
  const caixa = $(`comp${bim}`);
  caixa.replaceChildren();

  const atualizarSoma = () => {
    const soma = somaDosPesos(lista);
    somaEl.textContent = `soma: ${String(Math.round(soma * 100) / 100).replace(".", ",")}%`;
    somaEl.classList.toggle("erro-texto", Math.abs(soma - 100) > 0.001);
    if (Math.abs(soma - 100) > 0.001) somaEl.textContent += " (o ideal é 100%)";
  };

  for (const c of lista) {
    const nome = el("input", { type: "text", value: c.nome, placeholder: "Nome do componente" });
    nome.setAttribute("aria-label", `Nome do componente (${bim}º bimestre)`);
    nome.addEventListener("input", () => { c.nome = nome.value; salvar(); });
    nome.addEventListener("change", renderNotas); // atualiza o título da coluna ao sair do campo

    const peso = el("input", { type: "text", inputMode: "decimal", value: c.peso, className: "peso" });
    peso.setAttribute("aria-label", `Peso de ${c.nome} (${bim}º bimestre)`);
    peso.addEventListener("input", () => {
      c.peso = peso.value;
      marcarInvalido(peso);
      atualizarSoma();
      salvar();
      renderNotas(); // as médias mudam
    });
    marcarInvalido(peso);

    const remover = el("button", { type: "button", className: "botao", textContent: "×", title: "Remover componente" });
    remover.addEventListener("click", () => {
      const temNota = Object.values(m.notas).some((n) => (n[bim]?.[c.id] ?? "") !== "");
      if (temNota && !confirm(`Remover “${c.nome}” do ${bim}º bimestre? As notas digitadas nele serão apagadas.`)) return;
      m.config.composicao[bim] = lista.filter((x) => x !== c);
      for (const n of Object.values(m.notas)) delete n[bim]?.[c.id];
      salvar();
      renderComposicao(m, bim);
      renderNotas();
    });
    caixa.append(el("div", { className: "comp-linha" }, nome, peso, el("span", { textContent: "%" }), remover));
  }

  const adicionar = el("button", { type: "button", className: "botao", textContent: "+ componente" });
  adicionar.addEventListener("click", () => {
    lista.push({ id: novoId(), nome: "Nova nota", peso: "0" });
    salvar();
    renderComposicao(m, bim);
    renderNotas();
    caixa.querySelectorAll(".comp-linha input[type=text]:not(.peso)")[lista.length - 1]?.select();
  });
  const somaEl = el("span", { className: "dica" });
  caixa.append(el("div", { className: "linha-botoes" }, adicionar, somaEl));
  atualizarSoma();
}

// Borda vermelha se o campo tiver algo que não é número
function marcarInvalido(input) {
  input.classList.toggle("invalido", Number.isNaN(paraNumero(input.value)));
}

// --- Gerador de datas: uma linha por dia da semana ---
function renderCalendario() {
  const cal = materia().calendario;
  $("gerador").open = !materia().datas.length; // aberto só enquanto não há datas
  $("gerDe").value = cal.de || "";
  $("gerAte").value = cal.ate || "";
  const corpo = $("gerDias");
  corpo.replaceChildren();

  for (const [num, nome] of DIAS_SEMANA) {
    const regra = cal.regras[num] || { freq: "nenhuma" };
    const escolha = el("select", {},
      el("option", { value: "nenhuma", textContent: "sem aula" }),
      el("option", { value: "semanal", textContent: "toda semana" }),
      el("option", { value: "quinzenal", textContent: "quinzenal" }));
    escolha.value = regra.freq;
    escolha.setAttribute("aria-label", `Frequência de ${nome}`);

    const inicio = el("input", { type: "date", value: regra.inicio || "" });
    inicio.setAttribute("aria-label", `Primeira aula quinzenal de ${nome}`);
    const rotuloInicio = el("label", { hidden: regra.freq !== "quinzenal" }, "1ª aula em ", inicio);

    // Guarda a escolha na matéria (assim ela é lembrada e vai para o backup)
    const atualizar = () => {
      if (escolha.value === "quinzenal" && !inicio.value && cal.de) {
        inicio.value = primeiraOcorrencia(cal.de, num); // sugestão: o primeiro dia desses
      }
      rotuloInicio.hidden = escolha.value !== "quinzenal";
      if (escolha.value === "nenhuma") delete cal.regras[num];
      else cal.regras[num] = { freq: escolha.value, inicio: inicio.value };
      salvar();
      atualizarBotaoProxima(); // o calendário mudou: a próxima aula pode mudar
    };
    escolha.addEventListener("change", atualizar);
    inicio.addEventListener("change", atualizar);

    corpo.append(el("tr", {}, el("td", { textContent: nome }), el("td", {}, escolha), el("td", {}, rotuloInicio)));
  }
}

// --- Lista de aulas (data + conteúdo) ---
function renderAulas() {
  const m = materia();
  const lista = $("listaAulas");
  lista.replaceChildren();
  m.datas.forEach((d, i) => {
    const bim = bimestreDaData(m, d);
    const campo = el("input", {
      type: "text", value: m.conteudos[d] || "", placeholder: "Conteúdo da aula",
    });
    campo.setAttribute("aria-label", `Conteúdo da aula de ${dataBR(d)}`);
    campo.addEventListener("input", () => {
      m.conteudos[d] = campo.value;
      salvar();
    });
    const remover = el("button", { type: "button", className: "remover", title: "Remover esta data", textContent: "×" });
    remover.addEventListener("click", () => removerData(d));
    lista.append(el("div", { className: "aula" },
      el("span", { className: "num", textContent: i + 1 }),
      el("span", { textContent: `${dataBR(d)}`, title: DIA_SEMANA_NOME[new Date(paraUTC(d)).getUTCDay()] }),
      el("span", { className: `etiqueta bim${bim}`, textContent: `${bim}º bim` }),
      campo, remover));
  });

  atualizarBotaoProxima();

  // Resumo: quantas colunas cada bimestre ocupa (o diário tem 42 = 21 dias)
  const pb = datasPorBimestre(m);
  const resumo = [1, 2].map((b) => {
    const cols = pb[b].length * AULAS_POR_DIA;
    const alerta = cols > MAX_COLUNAS ? " ⚠ passa do limite!" : "";
    return `${b}º bimestre: ${pb[b].length} dias (${cols} de ${MAX_COLUNAS} colunas)${alerta}`;
  });
  $("resumoBimestres").textContent = m.datas.length
    ? resumo.join(" · ") + (estado.inicio2bim ? "" : " — defina o início do 2º bimestre (seção 2).")
    : "Nenhuma data ainda.";
}

function adicionarDatas(novas) {
  const m = materia();
  const antes = m.datas.length;
  m.datas = [...new Set([...m.datas, ...novas.filter(ehDataValida)])].sort();
  salvar();
  render();
  return m.datas.length - antes; // quantas eram realmente novas
}

function removerData(d) {
  const m = materia();
  const temAlgo = m.conteudos[d] || Object.values(m.presencas).some((p) => p[d]);
  if (temAlgo && !confirm(`Remover ${dataBR(d)} e apagar a chamada e o conteúdo desse dia?`)) return;
  m.datas = m.datas.filter((x) => x !== d);
  delete m.conteudos[d];
  for (const p of Object.values(m.presencas)) delete p[d];
  salvar();
  render();
}

// O botão mostra qual data ele vai adicionar, ex.: "+ Próxima aula: sex 20/11/2026"
function atualizarBotaoProxima() {
  const m = materia();
  const proxima = proximaAula(m);
  const botao = $("btnProxima");
  botao.disabled = !proxima;
  botao.textContent = proxima
    ? `+ Próxima aula: ${DIA_SEMANA_NOME[new Date(paraUTC(proxima)).getUTCDay()]} ${dataBR(proxima)}`
    : "+ Próxima aula";
  botao.title = proxima ? "" : (problemaNasRegras(m.calendario.regras) || "Nenhuma data encontrada nas próximas 4 semanas.");
}

// --- Chamada (alunos agrupados por turma) ---
function renderChamada() {
  const m = materia();
  const tabela = $("tabelaChamada");
  tabela.replaceChildren();
  if (!m.turmas.some((t) => t.alunos.length)) {
    tabela.append(el("tr", {}, el("td", { textContent: "Adicione uma turma (PDF em branco) para carregar os alunos." })));
    return;
  }

  // Cabeçalho: RA | Nome | uma coluna por data | Faltas 1º | Faltas 2º
  const cab = el("tr", {}, el("th", { className: "fixo1", textContent: "RA" }),
    el("th", { className: "fixo2", textContent: "Nome" }),
    el("th", { textContent: "Ingresso", title: "Antes desta data o diário fica em branco e as faltas não contam" }));
  for (const d of m.datas) {
    const { dia, mes } = partesData(d);
    const botaoTodos = el("button", { type: "button", className: "botao mini", textContent: "C",
      title: "Marcar C em todos os vazios deste dia" });
    botaoTodos.addEventListener("click", () => marcarTodosPresentes(d));
    cab.append(el("th", { className: `bim${bimestreDaData(m, d)}` },
      DIA_SEMANA_NOME[new Date(paraUTC(d)).getUTCDay()], el("br"),
      `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}`, el("br"), botaoTodos));
  }
  cab.append(el("th", { textContent: "Faltas 1º" }), el("th", { textContent: "Faltas 2º" }));
  tabela.append(el("thead", {}, cab));

  const corpo = el("tbody");
  for (const t of m.turmas) {
    // Linha-título da turma
    corpo.append(el("tr", { className: "grupo-turma" },
      el("th", { colSpan: 2, textContent: `${t.nome} (${t.alunos.length} alunos)` }),
      el("td", { colSpan: m.datas.length + 3 })));
    for (const { ra, nome } of t.alunos) {
      const ingresso = dataIngresso(m, ra);
      const linha = el("tr", {}, el("td", { className: "ra fixo1", textContent: ra }),
        el("td", { className: "nome fixo2", textContent: nome, title: nome }),
        celulaIngresso(m, ra, nome));
      for (const d of m.datas) {
        const valor = m.presencas[ra]?.[d] || "";
        const antes = antesDoIngresso(ingresso, d);
        const botao = el("button", { type: "button", className: `celula v-${valor}${antes ? " antes" : ""}`, textContent: valor });
        if (antes) botao.title = "Antes do ingresso: fica em branco no diário e não conta falta";
        botao.setAttribute("aria-label", `${nome}, ${dataBR(d)}: ${valor || "vazio"}${antes ? " (antes do ingresso)" : ""}`);
        botao.addEventListener("click", () => alternarPresenca(ra, d, botao));
        linha.append(el("td", {}, botao));
      }
      const f = contarFaltas(m, ra);
      linha.append(el("td", { textContent: f[1] }), el("td", { textContent: f[2] }));
      corpo.append(linha);
    }
  }
  tabela.append(corpo);

  // A coluna "Nome" fica grudada logo depois da coluna "RA": medimos a largura do RA
  tabela.style.setProperty("--larg-ra", `${tabela.querySelector("th.fixo1").offsetWidth}px`);
}

/*
 * Célula "Ingresso": um campo de data. Vazio = automático (1ª presença), e
 * mostramos embaixo qual data o automático achou. Preenchido = vale a sua data.
 */
function celulaIngresso(m, ra, nome) {
  const campo = el("input", { type: "date", value: m.ingressos[ra] || "" });
  campo.setAttribute("aria-label", `Data de ingresso de ${nome}`);
  campo.addEventListener("change", () => {
    if (ehDataValida(campo.value)) m.ingressos[ra] = campo.value;
    else delete m.ingressos[ra]; // apagou a data -> volta para o automático
    salvar();
    renderChamada();
  });
  const auto = primeiraPresenca(m, ra);
  const dica = m.ingressos[ra]
    ? "digitada"
    : auto ? `auto: ${dataBR(auto).slice(0, 5)}` : "auto: sem presença";
  return el("td", { className: "ingresso" }, campo, el("small", { textContent: dica }));
}

// Clique na célula: avança no ciclo vazio → C → F → CF → FC → vazio
function alternarPresenca(ra, d, botao) {
  const m = materia();
  const ingressoAntes = dataIngresso(m, ra);
  const atual = m.presencas[ra]?.[d] || "";
  const proximo = CICLO_CHAMADA[(CICLO_CHAMADA.indexOf(atual) + 1) % CICLO_CHAMADA.length];
  m.presencas[ra] ??= {}; // cria o objeto do aluno se ainda não existir
  if (proximo) m.presencas[ra][d] = proximo;
  else delete m.presencas[ra][d];
  salvar();
  // Se o mesmo aluno aparece em duas turmas, redesenha tudo; senão, só a célula
  const repetido = m.turmas.filter((t) => t.alunos.some((a) => a.ra === ra)).length > 1;
  // A 1ª presença mudou? Então muda o que fica "antes do ingresso": redesenha
  if (repetido || dataIngresso(m, ra) !== ingressoAntes) return renderChamada();
  botao.className = `celula v-${proximo}`;
  botao.textContent = proximo;
  const linha = botao.closest("tr");
  const f = contarFaltas(m, ra);
  linha.cells[linha.cells.length - 2].textContent = f[1];
  linha.cells[linha.cells.length - 1].textContent = f[2];
}

function marcarTodosPresentes(d) {
  const m = materia();
  for (const { ra } of alunosDaMateria(m)) {
    // Aluno com data de ingresso digitada depois deste dia: não marca
    if (antesDoIngresso(m.ingressos[ra], d)) continue;
    m.presencas[ra] ??= {};
    if (!m.presencas[ra][d]) m.presencas[ra][d] = "C";
  }
  salvar();
  renderChamada();
}

// Conta as faltas (cada "F" = 1 aula perdida), por bimestre, a partir do ingresso
function contarFaltas(m, ra) {
  const total = { 1: 0, 2: 0 };
  const ingresso = dataIngresso(m, ra);
  for (const d of m.datas) {
    if (antesDoIngresso(ingresso, d)) continue;
    const letras = letrasDoDia(m.presencas[ra]?.[d]);
    if (letras) total[bimestreDaData(m, d)] += letras.filter((l) => l === "F").length;
  }
  return total;
}

// --- Notas (também agrupadas por turma) ---
function renderNotas() {
  const m = materia();
  const tabela = $("tabelaNotas");
  tabela.replaceChildren();
  if (!m.turmas.some((t) => t.alunos.length)) return;

  const comps = { 1: m.config.composicao[1], 2: m.config.composicao[2] };

  // Cabeçalho em duas linhas:  RA | Nome | 1º bimestre (componentes + Média) | 2º bimestre (...)
  const linha1 = el("tr", {},
    el("th", { className: "fixo1", rowSpan: 2, textContent: "RA" }),
    el("th", { className: "fixo2", rowSpan: 2, textContent: "Nome" }));
  const linha2 = el("tr");
  for (const b of [1, 2]) {
    linha1.append(el("th", { className: `bim${b}`, colSpan: comps[b].length + 1, textContent: `${b}º bimestre` }));
    for (const c of comps[b]) linha2.append(el("th", { className: `bim${b}`, textContent: `${c.nome} (${c.peso}%)` }));
    linha2.append(el("th", { className: `bim${b}`, textContent: "Média" }));
  }
  tabela.append(el("thead", {}, linha1, linha2));

  const totalColunas = comps[1].length + comps[2].length + 2;
  const corpo = el("tbody");
  for (const t of m.turmas) {
    corpo.append(el("tr", { className: "grupo-turma" },
      el("th", { colSpan: 2, textContent: t.nome }), el("td", { colSpan: totalColunas })));
    for (const { ra, nome } of t.alunos) {
      m.notas[ra] ??= {};
      const n = m.notas[ra];
      const celMedia = { 1: el("td", { className: "media" }), 2: el("td", { className: "media" }) };

      const atualizarMedias = () => {
        for (const b of [1, 2]) {
          const media = calcularMedia(m, b, n[b]);
          celMedia[b].textContent = media === null ? "" : formatarNota(media);
        }
      };

      // Campo de nota de um componente "c" no bimestre "b"
      const campo = (b, c) => {
        const input = el("input", { type: "text", inputMode: "decimal", value: n[b]?.[c.id] || "" });
        input.setAttribute("aria-label", `${c.nome} (${b}º bim.) de ${nome}`);
        marcarInvalido(input);
        input.addEventListener("input", () => {
          n[b] ??= {};
          n[b][c.id] = input.value;
          marcarInvalido(input);
          atualizarMedias();
          salvar();
        });
        return el("td", {}, input);
      };

      corpo.append(el("tr", {},
        el("td", { className: "ra fixo1", textContent: ra }),
        el("td", { className: "nome fixo2", textContent: nome, title: nome }),
        ...comps[1].map((c) => campo(1, c)), celMedia[1],
        ...comps[2].map((c) => campo(2, c)), celMedia[2]));
      atualizarMedias();
    }
  }
  tabela.append(corpo);
  tabela.style.setProperty("--larg-ra", `${tabela.querySelector("th.fixo1").offsetWidth}px`);
}

// --- Mensagens na seção "Gerar" ---
// lista = [{ texto, erro }]  (ou só textos)
function mostrarAvisos(lista) {
  $("avisos").replaceChildren(...lista.map((item) => {
    const { texto, erro } = typeof item === "string" ? { texto: item } : item;
    return el("li", { className: erro ? "erro" : "", textContent: texto });
  }));
}

// Mostra qual pasta está escolhida (ou explica a alternativa)
function mostrarInfoPasta(pasta) {
  if (!podeEscolherPasta) {
    $("infoPasta").textContent = "Este navegador não deixa salvar direto numa pasta: os PDFs serão baixados um por um. " +
      "(No Chrome ou no Edge, você escolhe uma pasta e o app cria a subpasta acima dentro dela.)";
    $("btnTrocarPasta").hidden = true;
  } else if (pasta) {
    $("infoPasta").textContent = `Pasta escolhida: “${pasta.name}”. A subpasta acima será criada dentro dela, ` +
      `junto com a subpasta “${PASTA_BACKUP}” (um backup é salvo toda vez que você gera os diários).`;
  } else {
    $("infoPasta").textContent = "Na primeira vez, o navegador vai pedir para você escolher uma pasta do computador. " +
      "A subpasta acima será criada dentro dela.";
  }
}

function hojeISO() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`;
}


// ===========================================================================
// EVENTOS — o que acontece quando você clica/digita
// ===========================================================================

// Nova matéria
$("btnNovaMateria").addEventListener("click", () => {
  const nome = prompt("Nome da matéria:", "");
  if (nome === null) return; // cancelou
  const m = novaMateria(nome.trim() || "Nova matéria");
  // Facilidade: copia os pesos e o início do 2º bimestre da matéria atual
  m.config = copiarConfig(materia().config);
  estado.materias.push(m);
  estado.materiaAtual = m.id;
  salvar();
  render();
});

// Nome da matéria
$("nomeMateria").addEventListener("input", (e) => {
  materia().nome = e.target.value;
  salvar();
  renderLateral();
});

// Excluir matéria
$("btnExcluirMateria").addEventListener("click", async () => {
  const m = materia();
  if (!confirm(`Excluir a matéria “${m.nome}” com todas as turmas, chamadas e notas? (Exporte um backup antes!)`)) return;
  for (const t of m.turmas) await apagarPdf(t.id);
  estado.materias = estado.materias.filter((x) => x !== m);
  if (!estado.materias.length) estado.materias.push(novaMateria());
  estado.materiaAtual = estado.materias[0].id;
  salvar();
  render();
});

// Abrir uma pasta de diários: cria as matérias e turmas sozinho
$("arquivoPasta").addEventListener("change", async (evento) => {
  const arquivos = [...evento.target.files];
  evento.target.value = "";
  if (!arquivos.length) return;
  $("statusPasta").textContent = `Lendo ${arquivos.length} arquivo(s)…`;
  try {
    await importarPasta(arquivos);
  } finally {
    $("statusPasta").textContent = "";
  }
});

// Adicionar turma(s): dá para escolher vários PDFs de uma vez
$("arquivoPdf").addEventListener("change", async (evento) => {
  const erros = [];
  for (const arquivo of evento.target.files) {
    try {
      await abrirPdfTurma(arquivo);
    } catch (erro) {
      erros.push(erro.message);
    }
  }
  evento.target.value = ""; // permite abrir o mesmo arquivo de novo
  if (erros.length) alert(erros.join("\n"));
});

// Configurações
// Início do 2º bimestre: uma data só, para todas as matérias
$("cfgInicio2").addEventListener("change", (e) => {
  estado.inicio2bim = ehDataValida(e.target.value) ? e.target.value : "";
  salvar(); renderConfig(); renderAulas(); renderChamada();
});

// Período do gerador (guardado na matéria)
$("gerDe").addEventListener("change", (e) => { materia().calendario.de = e.target.value; salvar(); renderCalendario(); });
$("gerAte").addEventListener("change", (e) => { materia().calendario.ate = e.target.value; salvar(); });

// Adicionar as datas do gerador (semanal/quinzenal)
$("btnGerar").addEventListener("click", () => {
  const { de, ate, regras } = materia().calendario;
  if (!de || !ate) return alert("Preencha 'De' e 'até'.");
  if (ate < de) return alert("A data 'até' é antes da data 'De'.");
  const problema = problemaNasRegras(regras);
  if (problema) return alert(problema);
  const novas = adicionarDatas(gerarDatasCalendario(de, ate, regras));
  alert(`${novas} data(s) nova(s) adicionada(s).`);
});

// Adicionar uma data avulsa
$("btnAddData").addEventListener("click", () => {
  const d = $("novaData").value;
  if (!d) return alert("Escolha uma data.");
  adicionarDatas([d]);
});

// Adicionar a próxima aula do calendário (depois da última da lista)
$("btnProxima").addEventListener("click", () => {
  const proxima = proximaAula(materia());
  if (proxima) adicionarDatas([proxima]);
});

// Exportar backup: no Chrome/Edge, grava na subpasta "Backup de diários" da pasta
// escolhida para os diários; nos outros navegadores, baixa o arquivo.
$("btnExportar").addEventListener("click", async () => {
  const status = $("statusBackup");
  try {
    if (podeEscolherPasta) {
      const pasta = await obterPastaBase(); // 1º a pasta (o navegador exige que seja logo após o clique)
      status.textContent = `Backup salvo em “${await gravarBackupNaPasta(pasta)}”.`;
    } else {
      baixarArquivo(await montarBackup(), nomeBackup(), "application/json");
      status.textContent = "Backup baixado.";
    }
  } catch (erro) {
    status.textContent = erro.name === "AbortError" ? "Nenhuma pasta escolhida." : "Erro no backup: " + erro.message;
  }
});

// Importar backup (substitui tudo)
$("arquivoBackup").addEventListener("change", async (evento) => {
  const arquivo = evento.target.files[0];
  evento.target.value = "";
  if (!arquivo) return;
  try {
    const bruto = JSON.parse(await arquivo.text());
    const novo = normalizarEstado(bruto);
    const qtd = novo.materias.length;
    if (!confirm(`Substituir TUDO pelo backup (${qtd} matéria(s))?`)) return;
    estado = novo;
    // Restaura os PDFs que vieram dentro do backup
    for (const [turmaId, base64] of Object.entries(bruto.pdfs || {})) {
      await guardarPdf(turmaId, deBase64(base64));
    }
    salvar();
    render();
  } catch (erro) {
    alert("Não consegui importar: " + erro.message);
  }
});

// Apagar tudo
$("btnApagarTudo").addEventListener("click", async () => {
  if (!confirm("Apagar TODAS as matérias e PDFs guardados neste navegador? (Exporte um backup antes!)")) return;
  for (const m of estado.materias) for (const t of m.turmas) await apagarPdf(t.id);
  estado = estadoVazio();
  salvar();
  render();
});

// Pasta de saída
$("nomePasta").addEventListener("input", (e) => { estado.nomePasta = e.target.value; salvar(); });
$("btnTrocarPasta").addEventListener("click", async () => {
  try {
    await obterPastaBase(true);
  } catch (erro) {
    if (erro.name !== "AbortError") alert(erro.message);
  }
});

// Gerar
$("btnGerarMateria").addEventListener("click", () => gerarESalvar([materia()]));
$("btnGerarTodas").addEventListener("click", () => gerarESalvar(estado.materias));

// Se as bibliotecas do CDN não carregaram (sem internet, bloqueio...), avisa
if (!window.pdfjsLib || !window.PDFLib) {
  mostrarAvisos([{ texto: "Não consegui carregar as bibliotecas de PDF (pdf.js / pdf-lib). Verifique a internet e recarregue.", erro: true }]);
}

// Primeira vez: desenha a tela com o que estava salvo e descobre
// quais turmas já têm o PDF guardado e qual pasta foi escolhida.
render();
(async () => {
  try {
    const chaves = await banco("pdfs", "readonly", (g) => g.getAllKeys());
    chaves.forEach((k) => turmasComPdf.add(k));
    renderMateria();
  } catch { /* navegador sem IndexedDB: os PDFs terão de ser abertos de novo */ }
  let pasta = null;
  try { pasta = await bancoLer("ajustes", "pasta"); } catch { /* nada */ }
  mostrarInfoPasta(pasta);
})();
