# Diário de Classe

Preenche o diário de classe em PDF (UDC) com datas, chamada (C/F), faltas, médias e conteúdos.

Existem duas versões, que geram **o mesmo PDF** (mesmas coordenadas, fontes e regras):

- **Versão web** (`index.html` + `app.js` + `estilo.css`): roda no navegador, sem servidor.
  O PDF e os dados dos alunos nunca saem do seu computador.
- **Versão Python** (`diario.py`): linha de comando, usando uma planilha Excel.

## Usar a versão web

1. Abra o site (veja "Publicar" abaixo) ou simplesmente dê dois cliques no `index.html`
   (Chrome ou Edge; precisa de internet para baixar as bibliotecas de PDF).
2. Na barra da esquerda, crie uma **matéria** (ex.: Circuitos Elétricos). Cada matéria é uma aba.
3. **Adicionar turma**: abra o PDF em branco de cada turma (ex.: GELE4N e GELE6N).
   Os alunos (RA e nome) são lidos do PDF, e o PDF fica guardado no navegador.
4. Preencha o peso da prova, o peso das atividades e o início do 2º bimestre.
5. Adicione as datas: escolha o período e, para cada dia da semana, "toda semana" ou "quinzenal".
   Ex.: quarta toda semana + quinta quinzenal = semanas com 4 aulas e semanas com 2.
6. Faça a chamada clicando nas células (vazio → C → F → CF → FC → vazio) e digite as notas.
7. **Gerar diários**: na primeira vez, escolha uma pasta do computador. O app cria dentro dela a
   subpasta "Diários Preenchidos - 2º bimestre" (o nome pode ser mudado) e salva um PDF por turma,
   chamado "Matéria - Turma.pdf". Fora do Chrome/Edge, os PDFs são baixados um por um.

As datas, os conteúdos e os pesos são da matéria (valem para todas as turmas). A chamada e as notas são de cada aluno.

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
