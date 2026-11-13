# Diário de Classe

Preenche o diário de classe em PDF (UDC) com datas, chamada (C/F), faltas, médias e conteúdos.

Existem duas versões, que geram **o mesmo PDF** (mesmas coordenadas, fontes e regras):

- **Versão web** (`index.html` + `app.js` + `estilo.css`): roda no navegador, sem servidor.
  O PDF e os dados dos alunos nunca saem do seu computador.
- **Versão Python** (`diario.py`): linha de comando, usando uma planilha Excel.

## Usar a versão web

1. Abra o site (veja "Publicar no GitHub Pages" abaixo) ou, no seu computador,
   rode `python -m http.server` nesta pasta e acesse http://localhost:8000.
2. **Abrir PDF em branco**: os alunos (RA e nome) são lidos do PDF.
3. Preencha o peso da prova, o peso das atividades e o início do 2º bimestre.
4. Adicione as datas das aulas (uma a uma ou "Gerar várias datas") e o conteúdo de cada uma.
5. Faça a chamada clicando nas células: vazio → C → F → CF → FC → vazio.
6. Digite as notas, que viram médias automaticamente.
7. **Gerar e baixar PDF**.

O progresso é salvo automaticamente no navegador (`localStorage`). Use **Exportar backup**
de vez em quando: se você limpar os dados do navegador, o backup é o que salva você.

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
