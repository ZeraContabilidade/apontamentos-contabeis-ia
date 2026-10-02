# Apontamentos Contábeis IA — contexto para o Claude Code

Sistema da **Zera Contabilidade**: o contador registra, por empresa e
competência, os erros e divergências encontrados ao lançar a contabilidade; a
IA (API da Anthropic) reescreve cada anotação em linguagem formal sem inventar
fatos; o relatório sai em DOCX e PDF com a identidade visual do escritório.
Usuário: escritório de contabilidade, não programador. Responder em português.
Windows 10/11, Python 3.11+.

## Princípios (não negociáveis)

1. **A IA só reescreve.** Nunca acrescenta valor, data, número de documento,
   lei, multa ou prazo. `conferencia.conferir` compara os números do texto
   formal com o original + dados digitados e gera avisos; não remover.
2. O **texto original** do contador nunca é descartado (coluna `original`).
3. Sem chave/sem internet o sistema continua funcionando com o texto original.
4. Servidor só em 127.0.0.1; POST exige `X-Requested-With: Apontamentos` e Host
   local; a chave da API nunca volta para a página (`Config.publico`).
5. Texto na página sempre como texto (`el(..., {text})`, nunca innerHTML).
6. Não fazer chamada paga à API em teste.

## Estrutura

```
executar.py            liga o servidor (porta 8770) e abre o navegador
INSTALAR_E_ABRIR.bat   pip install -r requirements.txt + executar
ABRIR.bat              executar
apontamentos/
  config.py      config.json em %APPDATA%\ApontamentosContabeis (APONTAMENTOS_DADOS
                 nos testes); chave protegida por DPAPI; textos padrão
  base.py        SQLite: documento (rascunho/finalizado) e apontamento
                 (original, titulo, texto, providencia, situacao, avisos)
  ia.py          Redator: Claude com saída JSON estruturada; Opus 5.5 padrão,
                 esforço configurável, reserva automática (fallbacks="default")
                 com recuo se a conta não aceitar
  conferencia.py trava contra número inventado/sumido
  documento.py   montar_conteudo (comum) -> gerar_pdf (fpdf2) / gerar_docx
                 (python-docx, XML na ordem do padrão OOXML senão o Word recusa)
  servidor.py    Aplicacao (regras) + HTTP (só biblioteca padrão)
  web/           index.html, app.js, estilo.css (sem biblioteca externa, CSP)
  marca/         logo, emblema, fontes Cinzel e Liberation Sans
testes/teste_sistema.py  tudo, inclusive a tela no Chromium (playwright, opcional)
```

## Ao mudar o código

Subir `__version__` em `apontamentos/__init__.py` (a tela mostra a versão) e
rodar `python testes/teste_sistema.py` (precisa terminar com RESULTADO: OK).
