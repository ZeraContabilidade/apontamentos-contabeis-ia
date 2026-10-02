# Apontamentos Contábeis IA · Zera Contabilidade

Enquanto você lança a contabilidade de uma empresa, escreve cada erro ou
divergência do jeito que vier ("nf 1234 lançada 2x, valor 1500"). A IA
transforma o texto em linguagem formal, o documento vai se montando ao lado,
em tempo real, e no fim sai um **relatório de apontamentos em DOCX e PDF**
com a identidade visual do escritório, pronto para você decidir enviar ao cliente.

## Instalar (uma vez por computador)

1. Tenha o **Python 3.11 ou mais novo** instalado (python.org, marcando
   "Add python.exe to PATH").
2. Dê dois cliques em **`INSTALAR_E_ABRIR.bat`**. Ele instala as bibliotecas
   e abre o sistema no navegador.
3. Em **Configurações**, cole a chave da API da Anthropic
   (console.anthropic.com → API Keys), preencha os dados do escritório e do
   responsável que assina, e clique em **Testar a IA**.

Nas próximas vezes, use **`ABRIR.bat`**. Uma janela preta fica aberta enquanto
o sistema está em uso; para fechar o sistema, feche essa janela.

## Usar

1. **+ Novo documento**: empresa, CNPJ, competência e, se quiser, A/C e prazo
   de retorno.
2. Escreva o apontamento, escolha categoria e prioridade (valor e documento
   são opcionais) e tecle **Ctrl + Enter**. Pode continuar escrevendo o
   próximo enquanto a IA formaliza o anterior.
3. Revise na lista: **Editar**, **Refazer com IA**, **Usar meu texto**,
   mudar a ordem ou excluir. A prévia à direita mostra o documento como vai sair.
4. **Finalizar e gerar documento**: grava o DOCX e o PDF em
   `Documentos\Apontamentos Contábeis\<Empresa>\` (a pasta pode ser trocada em
   Configurações). Use **Baixar** ou **Abrir pasta**. Precisa mudar algo?
   **Reabrir para edição** e gere de novo.

## O que a IA pode e não pode fazer

- Ela **só reescreve**: corrige português, abreviações e tom, e separa o
  texto, o título e a providência solicitada.
- Ela **não inventa** valor, data, número de nota, artigo de lei, multa ou
  prazo. Depois de cada resposta o sistema confere os números: se aparecer
  um número que você não escreveu, ou se sumir um que você escreveu, o
  apontamento ganha um **aviso amarelo** para você conferir.
- O que faltar (ex.: "número da nota não informado") vira uma **sugestão**
  só para você; não vai para o cliente.
- Seu texto original fica guardado em cada apontamento.
- Sem a chave da API (ou sem internet), o sistema funciona do mesmo jeito,
  usando o texto que você escreveu.

## Onde ficam os dados

`%APPDATA%\ApontamentosContabeis\`: `apontamentos.db` (documentos e
apontamentos) e `config.json` (configurações; a chave da API fica gravada
protegida pelo Windows e só abre neste usuário, neste computador).

O sistema só atende no próprio computador (127.0.0.1); ninguém da rede acessa.

## Para quem mantém o código

Python 3.11+, só biblioteca padrão no servidor; `anthropic` (IA),
`python-docx` (DOCX) e `fpdf2` (PDF). Testes, sem gastar API:

```
python testes/teste_sistema.py
```

Termina com `RESULTADO: OK`. Detalhes técnicos em `CLAUDE.md`.

Fontes incluídas: Cinzel e Liberation Sans, ambas sob a SIL Open Font License
(ver `apontamentos/marca/LICENCA_*.txt`).
