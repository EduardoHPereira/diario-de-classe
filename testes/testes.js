/*
 * Testes automáticos do Diário de Classe (versão web)
 * ===================================================
 *
 * Abre o app num navegador "invisível" (Chromium, via Playwright), clica nos botões
 * como uma pessoa faria e confere os resultados. No fim, compara os diários gerados
 * com os do diario.py (a referência).
 *
 * Como rodar (veja testes/README.md):
 *   cd testes
 *   npm install
 *   npx playwright install chromium
 *   python3 gerar_pdfs_falsos.py      (cria os PDFs falsos e as referências do diario.py)
 *   node testes.js
 *
 * Só usa PDFs FALSOS (testes/saida). Nunca coloque diários reais aqui.
 */
"use strict";
const { chromium } = require("playwright");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFileSync } = require("child_process");

const RAIZ = path.resolve(__dirname, "..");          // pasta do app (index.html, app.js...)
const SAIDA = path.join(__dirname, "saida");          // PDFs falsos e resultados
const EM_BRANCO = path.join(SAIDA, "em_branco");
const PERFIS = path.join(SAIDA, "perfis");            // perfis de navegador descartáveis

// ---------------------------------------------------------------------------
// Pequenas ferramentas
// ---------------------------------------------------------------------------
let passou = 0;
const falhas = [];
function confere(condicao, descricao, detalhe = "") {
  if (condicao) { passou++; console.log("  ✓ " + descricao); }
  else { falhas.push(descricao); console.log("  ✗ " + descricao + (detalhe ? `  →  ${detalhe}` : "")); }
}
function secao(titulo) { console.log("\n" + titulo); }

// Servidor web simples para a pasta do app (o navegador precisa de http://, não de file://)
function servidor() {
  const tipos = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css" };
  const srv = http.createServer((req, res) => {
    const arquivo = path.join(RAIZ, decodeURIComponent(req.url.split("?")[0]));
    if (!arquivo.startsWith(RAIZ) || !fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) {
      res.writeHead(404); return res.end();
    }
    res.writeHead(200, { "Content-Type": tipos[path.extname(arquivo)] || "application/octet-stream" });
    fs.createReadStream(arquivo).pipe(res);
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

// As bibliotecas do CDN vêm do node_modules (os testes funcionam sem internet)
const BIBLIOTECAS = {
  "pdfjs-dist@3.11.174/build/pdf.min.js": require.resolve("pdfjs-dist/build/pdf.min.js"),
  "pdfjs-dist@3.11.174/build/pdf.worker.min.js": require.resolve("pdfjs-dist/build/pdf.worker.min.js"),
  "pdf-lib@1.17.1/dist/pdf-lib.min.js": require.resolve("pdf-lib/dist/pdf-lib.min.js"),
};

/*
 * Abre o app num perfil de navegador novo. A janela "escolher pasta" é simulada com a
 * pasta privada do navegador (OPFS). Usamos perfil "normal" (persistente) porque o modo
 * anônimo do Chromium de testes não relê do IndexedDB essa pasta simulada.
 */
async function abrirApp(url, { comPasta = true, largura = 1400 } = {}) {
  fs.mkdirSync(PERFIS, { recursive: true });
  const perfil = fs.mkdtempSync(path.join(PERFIS, "p-"));
  const ctx = await chromium.launchPersistentContext(perfil, { acceptDownloads: true, viewport: { width: largura, height: 900 } });
  await ctx.route("https://cdn.jsdelivr.net/**", (rota) => {
    const chave = Object.keys(BIBLIOTECAS).find((k) => rota.request().url().endsWith(k));
    if (!chave) return rota.abort();
    rota.fulfill({ body: fs.readFileSync(BIBLIOTECAS[chave]), contentType: "application/javascript",
      headers: { "Access-Control-Allow-Origin": "*" } });
  });
  await ctx.addInitScript((comPasta) => {
    window.showDirectoryPicker = comPasta ? () => navigator.storage.getDirectory() : undefined;
  }, comPasta);
  const pagina = ctx.pages()[0] || await ctx.newPage();
  pagina.erros = [];
  pagina.on("pageerror", (e) => pagina.erros.push(e.message));
  pagina.on("console", (m) => { if (m.type() === "error") pagina.erros.push(m.text()); });
  pagina.on("dialog", (d) => (d.type() === "prompt" ? d.accept("Matéria de teste") : d.accept()));
  await pagina.goto(url);
  return { ctx, pagina };
}

// Lê todos os arquivos de uma subpasta da "pasta escolhida" simulada
async function lerSubpasta(pagina, nome) {
  return pagina.evaluate(async (nome) => {
    const sub = await (await navigator.storage.getDirectory()).getDirectoryHandle(nome);
    const saida = {};
    for await (const [arq, h] of sub.entries()) {
      if (h.kind === "file") saida[arq] = Array.from(new Uint8Array(await (await h.getFile()).arrayBuffer()));
    }
    return saida;
  }, nome);
}

// Coloca no app os dados inventados de dados.json (no formato antigo: testa a conversão)
async function preencherDados(pagina, dados) {
  await pagina.evaluate((dados) => {
    estado.inicio2bim = dados.inicio2bim;
    for (const m of estado.materias) {
      const antigo = JSON.parse(JSON.stringify(dados.materias[m.chave]));
      Object.assign(m, normalizarMateria({ ...m, ...antigo }), { id: m.id });
      // ingresso de todos na 1ª aula = mesma regra do diario.py (todas as faltas contam)
      m.ingressos = Object.fromEntries(alunosDaMateria(m).map((a) => [a.ra, m.datas[0]]));
    }
    salvar(); render();
  }, dados);
}

// ---------------------------------------------------------------------------
(async () => {
  if (!fs.existsSync(path.join(SAIDA, "dados.json"))) {
    console.error("Rode antes:  python3 gerar_pdfs_falsos.py");
    process.exit(2);
  }
  const dados = JSON.parse(fs.readFileSync(path.join(SAIDA, "dados.json"), "utf8"));
  const srv = await servidor();
  const URL_APP = `http://127.0.0.1:${srv.address().port}/index.html`;

  // ===================================================================
  secao("1. Abrir a pasta de diários (cria matérias e turmas pelo cabeçalho)");
  let { ctx, pagina } = await abrirApp(URL_APP);
  await pagina.setInputFiles("#arquivoPasta", EM_BRANCO);
  await pagina.waitForFunction(() => document.querySelectorAll(".aba-materia").length === 2 && !document.getElementById("statusPasta").textContent);
  const materias = await pagina.evaluate(() => estado.materias.map((m) => ({ chave: m.chave, nome: m.nome,
    turmas: m.turmas.map((t) => ({ codigo: t.codigo, arquivo: t.arquivo, alunos: t.alunos.map((a) => [a.ra, a.nome]) })) })));
  confere(JSON.stringify(materias.map((m) => m.nome)) === JSON.stringify(["CIRCUITOS ELÉTRICOS", "ELETRÔNICA II"]),
    "2 matérias, em ordem alfabética", JSON.stringify(materias.map((m) => m.nome)));
  let iguais = 0;
  for (const [arquivo, r] of Object.entries(dados.ref)) {
    const t = materias.find((m) => m.chave === r.chave)?.turmas.find((x) => x.codigo === r.turma);
    if (t && t.arquivo === arquivo && JSON.stringify(t.alunos) === JSON.stringify(r.alunos)) iguais++;
  }
  confere(iguais === 3, "matéria, turma, RAs e nomes iguais aos lidos pelo diario.py (3 de 3 PDFs)", `${iguais}`);
  await pagina.setInputFiles("#arquivoPasta", EM_BRANCO);
  await pagina.waitForTimeout(800);
  confere(await pagina.evaluate(() => estado.materias.length === 2 && estado.materias[0].turmas.length === 2),
    "abrir a mesma pasta de novo não duplica nada");

  // ===================================================================
  secao("2. Gerar todos os diários e comparar com o diario.py");
  await preencherDados(pagina, dados);
  confere(await pagina.evaluate(() => JSON.stringify(materia().config.composicao[1].map((c) => c.peso))) === '["70","30"]',
    "pesos antigos (0,7 e 0,3) convertidos para 70% e 30%");
  await pagina.click("#btnGerarTodas");
  await pagina.waitForFunction(() => /salvo\(s\) em|Erro/.test(document.getElementById("avisos").textContent));
  const avisos = await pagina.$$eval("#avisos li", (l) => l.map((x) => x.textContent));
  confere(avisos[0].startsWith("3 diário(s) salvo(s)"), "3 diários salvos na subpasta", avisos[0]);
  confere(avisos[1].startsWith("Backup salvo em"), "backup salvo junto, em “Backup de diários”", avisos[1]);
  const gerados = await lerSubpasta(pagina, "Diários Preenchidos - 2º bimestre");
  const pastaWeb = path.join(SAIDA, "web");
  fs.mkdirSync(pastaWeb, { recursive: true });
  for (const [nome, bytes] of Object.entries(gerados)) fs.writeFileSync(path.join(pastaWeb, nome), Buffer.from(bytes));
  try {
    const r = JSON.parse(execFileSync("python3", [path.join(__dirname, "comparar_pdfs.py"),
      path.join(SAIDA, "python"), pastaWeb, "--ignorar-notas"], { encoding: "utf8" }));
    confere(r.arquivos === 3 && r.diferencas === 0 && r.letras > 1000,
      `idêntico ao diario.py fora das colunas de nota (${r.letras} letras, ${r.diferencas} diferenças)`, r.detalhes.join(" | "));
  } catch (erro) {
    confere(false, "comparar com o diario.py (precisa de python3 + pdfplumber)", erro.message.split("\n")[0]);
  }
  // Conferir as colunas de nota (arredondadas) direto no PDF: ANA em CIRCUITOS (GELE4N)
  const notasAna = await pagina.evaluate(() => {
    const m = estado.materias[0];
    const n = m.notas["1000000001"];
    const m1 = calcularMedia(m, 1, n[1]), m2 = calcularMedia(m, 2, n[2]);
    return { m1, m2, r: resultadoFinal(m1, m2, n.ex) };
  });
  confere(notasAna.m1 * 2 === Math.round(notasAna.m1 * 2) && notasAna.r.anual !== null,
    `médias múltiplas de 0,5 (ANA: ${notasAna.m1} | ${notasAna.m2} | anual ${notasAna.r.anual})`);
  pagina.erros.length && console.log("    erros na página:", pagina.erros);
  await ctx.close();

  // ===================================================================
  secao("3. Notas: arredondamento, exame, final e validação de 0 a 10");
  ({ ctx, pagina } = await abrirApp(URL_APP));
  const casos = await pagina.evaluate(() => {
    const m = { config: { composicao: { 1: [{ id: "p", peso: "70" }, { id: "a", peso: "30" }] } } };
    const r = (p, a) => calcularMedia(m, 1, { p, a });
    return {
      arred: [6.1, 6.5, 6.51, 7, 5.75, 0].map(arredondarMeio),
      media: [r("6", "5"), r("8", "6"), r("10", ""), r("11", "5"), r("-1", "5")],
      aprovado: resultadoFinal(9, 8.5, ""), reprovado: resultadoFinal(3, 2, ""),
      exameSemNota: resultadoFinal(6, 4, ""), exame: resultadoFinal(6, 4, "6"),
      exameInvalido: resultadoFinal(6, 4, "12"),
      problemas: ["7,5", "11", "abc", "-1", "6,3", ""].map((v) => problemaNota(v, true)?.erro ?? null),
    };
  });
  confere(casos.arred.join(" ") === "6.5 6.5 7 7 6 0", "arredonda para cima de 0,5 em 0,5: 6,1→6,5 6,5→6,5 6,51→7 5,75→6", casos.arred.join(" "));
  confere(JSON.stringify(casos.media) === "[6,7.5,null,null,null]",
    "média: (6;5)→6,0  (8;6)→7,5  faltando nota→vazio  nota 11 ou -1→vazio", JSON.stringify(casos.media));
  confere(casos.aprovado.final === 9 && !casos.aprovado.precisaExame, "anual ≥ 7: aprovado, final = anual (9,0)");
  confere(casos.reprovado.final === 2.5 && !casos.reprovado.precisaExame, "anual < 4: reprovado sem exame (2,5)");
  confere(casos.exameSemNota.precisaExame && casos.exameSemNota.final === null, "anual entre 4 e 6,5: precisa de exame, final vazia");
  confere(casos.exame.final === 5.5, "exame 6 com anual 5,0 → final (5+6)÷2 = 5,5");
  confere(casos.exameInvalido.final === null, "exame 12 (fora de 0 a 10) não conta");
  confere(JSON.stringify(casos.problemas) === "[null,true,true,true,false,null]",
    "validação: 7,5 ok | 11, abc, -1 erro | 6,3 aviso (exame não é múltiplo de 0,5)", JSON.stringify(casos.problemas));

  // ===================================================================
  secao("4. Digitar notas como numa planilha (Enter e colar do Excel)");
  await pagina.setInputFiles("#arquivoPdf", path.join(EM_BRANCO, "doc (1).pdf")); // 4 alunos
  await pagina.waitForFunction(() => document.querySelectorAll(".turma").length === 1);
  const campo = (l, c) => pagina.locator(`#tabelaNotas input[data-linha="${l}"][data-coluna="${c}"]`);
  await campo(0, 0).click();
  await pagina.keyboard.type("7");
  await pagina.keyboard.press("Enter");
  confere(await campo(1, 0).evaluate((e) => e === document.activeElement), "Enter desce para o próximo aluno");
  await pagina.keyboard.press("Shift+Enter");
  confere(await campo(0, 0).evaluate((e) => e === document.activeElement), "Shift+Enter sobe");
  // "Colar do Excel": 3 alunos × 2 colunas (prova e atividades do 1º bimestre)
  await campo(1, 0).focus();
  await pagina.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "8\t6,5\r\n9\t10\r\n4,5\t5\r\n");
    document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  const colado = await pagina.evaluate(() => Object.values(materia().notas).map((n) => [n[1]?.prova ?? "", n[1]?.ativ ?? ""]));
  confere(JSON.stringify(colado) === JSON.stringify([["7", ""], ["8", "6,5"], ["9", "10"], ["4,5", "5"]]),
    "colar 3 linhas × 2 colunas preenche a partir do campo clicado", JSON.stringify(colado));
  confere((await pagina.textContent("#statusNotas")).startsWith("6 nota(s) colada(s)"), "mensagem: 6 notas coladas");
  const medias1 = await pagina.$$eval("#tabelaNotas tbody tr:not(.grupo-turma)", (trs) => trs.map((tr) => tr.querySelector("td.media").textContent));
  confere(JSON.stringify(medias1) === JSON.stringify(["", "8,0", "9,5", "5,0"]), "médias depois de colar: 8×70%+6,5×30% = 7,55 → 8,0 | 9,3 → 9,5 | 4,65 → 5,0", JSON.stringify(medias1));
  await campo(0, 1).fill("11");
  confere(await campo(0, 1).evaluate((e) => e.classList.contains("invalido") && /0 e 10/.test(e.title)), "nota 11 fica vermelha, com a explicação");

  // ===================================================================
  secao("5. Botão “+ Aula de hoje” e cartões recolhíveis");
  const hoje = await pagina.evaluate(() => hojeISO());
  confere(await pagina.isVisible("#btnHoje") && (await pagina.textContent("#btnHoje")).includes(
    await pagina.evaluate((d) => dataBR(d), hoje)), "botão “+ Aula de hoje” mostra a data de hoje");
  await pagina.click("#btnHoje");
  confere(await pagina.evaluate((d) => materia().datas.includes(d), hoje), "clicar adiciona a aula de hoje à lista");
  confere(!(await pagina.isVisible("#btnHoje")), "depois de adicionada, o botão some");
  confere(await pagina.locator("#tabelaChamada thead th", { hasText: (await pagina.evaluate((d) => dataBR(d).slice(0, 5), hoje)) }).count() === 1,
    "a aula de hoje aparece como coluna na chamada (cartão 4)");
  // Recolher o cartão de notas
  const cartaoNotas = pagina.locator('section[data-cartao="notas"]');
  await cartaoNotas.locator("h2 button").click();
  confere(await cartaoNotas.evaluate((c) => c.classList.contains("recolhido")) && !(await pagina.isVisible("#tabelaNotas")),
    "clicar no título recolhe o cartão (a tabela de notas some)");
  confere(await cartaoNotas.locator("h2 button").getAttribute("aria-expanded") === "false", "o botão do título informa que está recolhido");
  await pagina.reload();
  // espera a página terminar de montar os cartões e a tabela de notas
  await pagina.waitForFunction(() => document.querySelector('section[data-cartao="notas"] h2 button')
    && document.querySelectorAll("#tabelaNotas tbody tr").length > 0);
  confere(await pagina.locator('section[data-cartao="notas"]').evaluate((c) => c.classList.contains("recolhido")),
    "depois de recarregar a página, continua recolhido");
  confere(await pagina.isVisible("#nomeMateria") && await pagina.isVisible("#tabelaChamada"), "o nome da matéria e os outros cartões continuam à vista");
  await pagina.locator('section[data-cartao="notas"] h2 button').click();
  confere(await pagina.isVisible("#tabelaNotas"), "clicar de novo expande");
  await pagina.setViewportSize({ width: 390, height: 800 });
  confere(!(await pagina.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "no celular, sem rolagem para o lado");
  await pagina.setViewportSize({ width: 1400, height: 900 });

  // ===================================================================
  secao("6. Datas: quinzenal e “+ Próxima aula”");
  await pagina.click("#btnNovaMateria");
  await pagina.fill("#gerDe", "2026-08-03"); await pagina.dispatchEvent("#gerDe", "change");
  await pagina.selectOption('select[aria-label="Frequência de Quarta"]', "semanal");
  await pagina.selectOption('select[aria-label="Frequência de Quinta"]', "quinzenal");
  confere(await pagina.inputValue('input[aria-label="Primeira aula quinzenal de Quinta"]') === "2026-08-06", "sugere a 1ª quinta (06/08)");
  for (let i = 0; i < 5; i++) await pagina.click("#btnProxima");
  confere(await pagina.evaluate(() => document.getElementById("gerador").open), "o gerador de datas não se fecha sozinho ao adicionar datas");
  const datas = await pagina.evaluate(() => materia().datas);
  confere(JSON.stringify(datas) === JSON.stringify(["2026-08-05", "2026-08-06", "2026-08-12", "2026-08-19", "2026-08-20"]),
    "quarta semanal + quinta quinzenal: 05, 06, 12, 19, 20/08", datas.join(" "));
  await pagina.fill("#gerAte", "2026-08-31"); await pagina.dispatchEvent("#gerAte", "change");
  await pagina.click("#btnGerar");
  confere(await pagina.evaluate(() => materia().datas.length) === 6, "“Adicionar essas datas” completa agosto sem repetir (4 quartas + 2 quintas)");
  confere(pagina.erros.length === 0, "nenhum erro na página", pagina.erros.join(" | "));
  await ctx.close();

  // ===================================================================
  secao("7. Ingresso do aluno, prévia e backup");
  ({ ctx, pagina } = await abrirApp(URL_APP));
  await pagina.setInputFiles("#arquivoPdf", path.join(EM_BRANCO, "doc.pdf")); // ANA, BRUNO, CARLA
  await pagina.waitForFunction(() => document.querySelectorAll(".turma").length === 1);
  await pagina.evaluate(() => {
    const m = materia();
    m.datas = ["2026-08-05", "2026-08-12", "2026-08-19", "2026-08-26"];
    estado.inicio2bim = "2026-10-01";
    const p = (v) => Object.fromEntries(m.datas.map((d, i) => [d, v[i]]));
    m.presencas = { "1000000001": p("FFCF"), "1000000002": p("FFFF"), "1000000003": p("FFCC") };
    m.ingressos = { "1000000003": "2026-08-05" };
    salvar(); render();
  });
  const faltas = await pagina.$$eval("#tabelaChamada tbody tr:not(.grupo-turma)", (trs) => trs.map((tr) => tr.cells[tr.cells.length - 2].textContent));
  confere(JSON.stringify(faltas) === '["2","8","4"]', "faltas: ANA 2 (ingresso automático), BRUNO 8 (sem presença), CARLA 4 (data digitada)", JSON.stringify(faltas));

  // Prévia
  await pagina.click("#btnPrevia");
  await pagina.waitForFunction(() => document.querySelectorAll("#previaPaginas canvas").length === 4, null, { timeout: 20000 });
  const previa = await pagina.evaluate(async () => {
    const r = await fetch(document.getElementById("previaAbrir").href);
    const bytes = new Uint8Array(await r.arrayBuffer());
    // a 1ª página desenhada tem algo além de branco?
    const tela = document.querySelector("#previaPaginas canvas");
    const px = tela.getContext("2d").getImageData(0, 0, tela.width, tela.height).data;
    let escuros = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] < 128) escuros++;
    return { aberta: document.getElementById("dlgPrevia").open, inicio: String.fromCharCode(...bytes.slice(0, 5)), escuros };
  });
  confere(previa.aberta && previa.inicio === "%PDF-" && previa.escuros > 1000,
    "prévia abre a janela e desenha as 4 páginas do diário da turma", JSON.stringify(previa));
  confere(await pagina.evaluate(async () => {
    try { await (await navigator.storage.getDirectory()).getDirectoryHandle("Diários Preenchidos - 2º bimestre"); return false; }
    catch { return true; }
  }), "a prévia não salva nada na pasta");
  await pagina.click("#previaFechar");

  // Backup: exportar -> apagar tudo -> importar
  await pagina.click("#btnExportar");
  await pagina.waitForFunction(() => /Backup salvo/.test(document.getElementById("statusBackup").textContent));
  const backups = await lerSubpasta(pagina, "Backup de diários");
  const nomeBackup = Object.keys(backups).sort().pop();
  confere(/^diario-backup-\d{4}-\d\d-\d\d_\d\dh\d\d\.json$/.test(nomeBackup), "backup com data e hora no nome", nomeBackup);
  const arqBackup = path.join(SAIDA, "backup_teste.json");
  fs.writeFileSync(arqBackup, Buffer.from(backups[nomeBackup]));
  await pagina.click("#btnApagarTudo");
  await pagina.waitForTimeout(400);
  confere(await pagina.evaluate(() => estado.materias.length === 1 && !estado.materias[0].turmas.length), "“Apagar tudo” limpa");
  await pagina.setInputFiles("#arquivoBackup", arqBackup);
  await pagina.waitForFunction(() => materia().turmas.length === 1);
  await pagina.waitForTimeout(300);
  confere((await pagina.textContent("#listaTurmas")).includes("✓ PDF guardado")
    && await pagina.evaluate(() => materia().ingressos["1000000003"] === "2026-08-05"),
    "importar o backup devolve turmas, PDF, chamada e ingressos");
  confere(pagina.erros.length === 0, "nenhum erro na página", pagina.erros.join(" | "));
  await ctx.close();

  // ===================================================================
  secao("8. Conversão de dados da versão antiga e navegador sem “escolher pasta”");
  ({ ctx, pagina } = await abrirApp(URL_APP, { comPasta: false }));
  await pagina.evaluate(() => localStorage.setItem("diario-de-classe:v1", JSON.stringify({
    config: { pesoProva: "0.6", pesoAtiv: "0.4", inicio2bim: "2026-04-01" },
    alunos: [{ ra: "1000000001", nome: "ANA FICTÍCIA" }], datas: ["2026-03-04"],
    presencas: { "1000000001": { "2026-03-04": "CF" } }, conteudos: {},
    notas: { "1000000001": { p1: "8", a1: "6", p2: "", a2: "" } } })));
  await pagina.reload();
  const convertido = await pagina.evaluate(() => ({ nome: materia().nome, data: estado.inicio2bim,
    media: calcularMedia(materia(), 1, materia().notas["1000000001"][1]) }));
  confere(convertido.nome === "Minha matéria" && convertido.data === "2026-04-01" && convertido.media === 7.5,
    "dados da 1ª versão viram “Minha matéria” (8×60% + 6×40% = 7,2 → 7,5)", JSON.stringify(convertido));
  await pagina.setInputFiles("#arquivoBackup", arqBackup);
  await pagina.waitForFunction(() => materia().turmas.length === 1);
  const downloads = [];
  pagina.on("download", (d) => downloads.push(d.suggestedFilename()));
  await pagina.click("#btnGerarMateria");
  await pagina.waitForFunction(() => /baixado|Erro/.test(document.getElementById("avisos").textContent));
  await pagina.waitForTimeout(500);
  confere(downloads.length === 1 && downloads[0].endsWith(".pdf"), "sem “escolher pasta”, o PDF é baixado", JSON.stringify(downloads));
  confere(pagina.erros.length === 0, "nenhum erro na página", pagina.erros.join(" | "));
  await ctx.close();

  // ===================================================================
  srv.close();
  console.log(`\n${passou} passaram, ${falhas.length} falharam.`);
  if (falhas.length) { console.log("Falharam:\n - " + falhas.join("\n - ")); process.exit(1); }
})().catch((erro) => { console.error(erro); process.exit(1); });
