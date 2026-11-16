# Diário de Classe

Preenche o diário de classe em PDF (UDC) com datas, chamada (C/F), faltas, médias e conteúdos.

Existem duas versões, que geram **o mesmo PDF** (mesmas coordenadas, fontes e regras):

- **Versão web** (`index.html` + `app.js` + `estilo.css`): roda no navegador, sem servidor.
  O PDF e os dados dos alunos nunca saem do seu computador.
- **Versão Python** (`diario.py`): linha de comando, usando uma planilha Excel.

## Usar a versão web

1. Abra o site (veja "Publicar" abaixo) ou simplesmente dê dois cliques no `index.html`
   (Chrome ou Edge; precisa de internet para baixar as bibliotecas de PDF).
2. Clique em **Abrir pasta de diários** e escolha a pasta com os PDFs em branco (podem ter
   qualquer nome, ex.: "doc (3).pdf"). O app lê o cabeçalho de cada PDF (DISCIPLINA, TURMA, SEM.)
   e cria sozinho uma **matéria** (aba à esquerda) por disciplina, com uma **turma** por PDF.
   Ex.: Circuitos Elétricos II com GELET04N, GELET05N e GELET06N.
   Abrir a pasta de novo só atualiza (não duplica nada). Se a mesma turma aparecer em dois
   arquivos, fica o mais recente.
3. Também dá para adicionar um PDF avulso numa matéria com **Adicionar turma**.
   Os alunos (RA e nome) são lidos do PDF, e o PDF fica guardado no navegador.
4. Na seção 2, defina o **início do 2º bimestre** (uma data só, que vale para todas as matérias)
   e a **composição da nota** de cada bimestre: componentes com nome e peso em % (ex.: Prova 70%,
   Atividades 30%; use "+ componente" para acrescentar Trabalho, Lista etc.). A tabela de Notas
   ganha uma coluna por componente e calcula a média: soma(nota × peso) ÷ soma dos pesos,
   arredondada **para cima** de 0,5 em 0,5 (o sistema da faculdade só aceita notas assim: 6,1 → 6,5).
   **Resultado:** média anual = (1º + 2º) ÷ 2, arredondada do mesmo jeito. 7 ou mais: aprovado;
   abaixo de 4: reprovado; de 4 a 6,5: exame, e final = (média anual + exame) ÷ 2, arredondada.
   No diário, a página do 2º bimestre recebe EXAME (só de quem fez) e FINAL (em negrito).
5. Adicione as datas: escolha o período e, para cada dia da semana, "toda semana" ou "quinzenal".
   Ex.: quarta toda semana + quinta quinzenal = semanas com 4 aulas e semanas com 2.
   O botão **+ Próxima aula** adiciona a próxima data do calendário depois da última aula da lista
   (ex.: matéria às sextas → a próxima sexta).
6. **Aula de hoje** (no topo, pensada para o celular em sala): escolha a data (ou "+ Dar aula hoje"),
   escreva o conteúdo, toque em **Todos presentes** e depois na aula (1ª ou 2ª) em que o aluno faltou.
   A tabela completa da chamada continua na seção 4 (clique alterna vazio → C → F → CF → FC → vazio).
   **Notas** (de 0 a 10): Enter desce para o próximo aluno, e dá para colar colunas do Excel (Ctrl+V).
   **Ingresso:** antes da data de ingresso do aluno, o diário fica em branco e as faltas não contam.
   Automático = 1ª presença. Para quem está desde o início e faltou as primeiras aulas (ou nunca veio
   mas ganhou um "C"), digite a data certa na coluna "Ingresso". Sem nenhuma presença, tudo conta.
7. **Prévia do PDF**: mostra na tela o diário de uma turma, sem salvar nada.
8. **Gerar diários**: na primeira vez, escolha uma pasta do computador. O app cria dentro dela a
   subpasta "Diários Preenchidos - 2º bimestre" (o nome pode ser mudado) e salva um PDF por turma,
   chamado "Matéria - Turma.pdf". Fora do Chrome/Edge, os PDFs são baixados um por um.

As datas, os conteúdos e a composição da nota são da matéria (valem para todas as turmas). A chamada e as notas são de cada aluno.

Backup: no Chrome/Edge, **Exportar backup** grava na subpasta "Backup de diários" (dentro da mesma
pasta escolhida para os diários), e um backup também é salvo toda vez que você gera os diários.
Os arquivos têm data e hora no nome (ex.: `diario-backup-2026-11-16_14h05.json`).

O progresso fica salvo no navegador. Use **Exportar backup** de vez em quando: o arquivo `.json`
leva todas as matérias e, se a opção estiver marcada, os PDFs em branco. Com ele, dá para
continuar em outro computador (**Importar backup**).

## Publicar no GitHub Pages

No GitHub: *Settings → Pages → Build and deployment → Source: Deploy from a branch*,
escolha a branch e a pasta `/ (root)` e salve. Em alguns minutos o site fica em
`https://<seu-usuario>.github.io/diario-de-classe/`.

> O `.gitignore` impede que PDFs, planilhas e backups sejam enviados ao repositório,
> porque o site e o repositório são públicos.

## Usar a versão Python

```
python diario.py criar-planilha  diario_em_branco.pdf
python diario.py preencher       diario_em_branco.pdf  planilha.xlsx
```

## Testes automáticos

A pasta `testes/` tem testes que conferem o app inteiro (com PDFs falsos) e comparam os
diários gerados com os do `diario.py`. Veja `testes/README.md`.
