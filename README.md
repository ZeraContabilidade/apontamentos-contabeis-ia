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
   Se o teste disser que a chave "não pertence a um workspace", crie a chave
   dentro de um workspace (console.anthropic.com → Settings → Workspaces →
   abra o workspace → API Keys) ou preencha o campo **Workspace ID**.

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
4. **Finalizar e gerar**: grava o DOCX e o PDF em
   `Documentos\Apontamentos Contábeis\<Empresa>\` (a pasta pode ser trocada em
   Configurações). Use **Baixar**, **Compartilhar** ou **Abrir pasta**. Precisa
   mudar algo? **Reabrir para edição** e gere de novo.
5. **Mensagem para o cliente**: texto pronto (montado só com o que está no
   relatório) para copiar, mandar pelo WhatsApp ou por e-mail junto com o PDF.

Mais recursos:

- **Painel** com documentos em andamento, itens de prioridade alta em aberto e
  finalizados no mês.
- **Ditar** (🎤): fale o apontamento em vez de digitar (Safari no iPhone,
  Chrome e Edge).
- **Trazer de outro mês**: copia apontamentos de outra competência (o que
  continua pendente). Ao criar o documento do mês seguinte de uma empresa, o
  sistema já oferece.
- **Backup** (Configurações): baixa um arquivo com todos os documentos (sem a
  chave da API) e importa em outro aparelho: Windows ⇄ iPhone ⇄ iPad.

## Usar no iPhone e no iPad

O sistema também funciona como aplicativo, direto no navegador, sem instalar
nada. Os dados ficam guardados no próprio aparelho e a IA é chamada direto
dele; o PDF e o Word são gerados no aparelho.

**Uma vez (quem administra o GitHub):** no repositório, abra **Settings →
Pages**, em *Build and deployment* escolha **Deploy from a branch**, branch
**main**, pasta **/docs**, e salve. Em alguns minutos o endereço fica no ar:

    https://zeracontabilidade.github.io/apontamentos-contabeis-ia/

**Em cada iPhone/iPad:**

1. Abra o endereço acima no **Safari**.
2. Toque em **Compartilhar** (quadrado com a seta) → **Adicionar à Tela de
   Início**.
3. Abra pelo ícone, vá em **Configurações** e cole a chave da API (fica só
   naquele aparelho). Preencha os dados do escritório.

Para levar os documentos entre aparelhos, use **Baixar backup** em um e
**Importar backup** no outro. Se apagar os dados do Safari, os documentos do
aparelho vão junto: faça backup de vez em quando.

O mesmo endereço funciona em qualquer navegador (Android, Mac, outro
computador). No Windows do escritório, continue usando o `ABRIR.bat`, que
guarda os dados no computador.

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

No iPhone/iPad (aplicativo), tudo fica no armazenamento do navegador daquele
aparelho; nada vai para o GitHub. O único envio é o texto do apontamento para
a API da Anthropic, quando a IA formaliza (igual ao programa do Windows).

## Para quem mantém o código

Python 3.11+, só biblioteca padrão no servidor; `anthropic` (IA),
`python-docx` (DOCX) e `fpdf2` (PDF). Testes, sem gastar API:

```
python testes/teste_sistema.py
```

Termina com `RESULTADO: OK`. Detalhes técnicos em `CLAUDE.md`.

Fontes incluídas: Cinzel e Liberation Sans, ambas sob a SIL Open Font License
(ver `docs/marca/LICENCA_*.txt`). Bibliotecas do aplicativo: jsPDF e docx,
ambas sob licença MIT (ver `docs/vendor/LICENCAS.txt`).
