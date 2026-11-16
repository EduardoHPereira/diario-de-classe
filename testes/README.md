# Testes automáticos

Estes testes abrem o app num navegador "invisível", clicam nos botões como uma pessoa
faria e conferem os resultados. No fim, comparam os diários gerados com os do `diario.py`.
Rode sempre que mudar alguma coisa: se algo que funcionava quebrar, eles avisam.

**Só usam PDFs falsos**, criados pelo próprio teste em `testes/saida/` (que não vai para o
GitHub). Nunca coloque diários reais aqui.

## Preparar (uma vez)

Precisa de [Node.js](https://nodejs.org) e Python 3.

```bash
cd testes
npm install
npx playwright install chromium
pip install reportlab pdfplumber pypdf openpyxl
```

## Rodar

```bash
cd testes
python3 gerar_pdfs_falsos.py
node testes.js
```

O resultado termina com algo como `49 passaram, 0 falharam.`

## O que é testado

1. **Abrir a pasta de diários:** cria as matérias e as turmas pelo cabeçalho; reabrir não duplica.
2. **Gerar os diários:** salva na subpasta junto com o backup, e o PDF é **idêntico ao do `diario.py`**
   (letra por letra) fora das colunas de nota, que o app arredonda.
3. **Notas:** arredondamento de 0,5 em 0,5, exame, final e validação de 0 a 10.
4. **Digitar notas como numa planilha:** Enter/Shift+Enter e colar várias células do Excel.
5. **Botão "+ Aula de hoje" e cartões recolhíveis** (inclusive se continuam recolhidos ao recarregar).
6. **Datas:** quinzenal e "+ Próxima aula".
7. **Ingresso do aluno, prévia e backup** (exportar, apagar tudo e importar).
8. **Conversão de dados das versões antigas** e navegador sem "escolher pasta".

## Arquivos

- `gerar_pdfs_falsos.py`: cria os diários em branco falsos e as referências do `diario.py`.
- `testes.js`: os testes (Playwright).
- `comparar_pdfs.py`: compara dois PDFs letra por letra.
