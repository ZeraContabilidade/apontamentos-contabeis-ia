# -*- coding: utf-8 -*-
"""Testes do sistema inteiro, sem gastar nada da API.

    python testes/teste_sistema.py

A IA é substituída por um redator falso. O formato do pedido enviado à API
é conferido com a biblioteca oficial apontada para um servidor falso local.
Tudo roda numa pasta temporária: não encosta nos dados reais.
Termina com "RESULTADO: OK".
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import time
import traceback
import urllib.error
import urllib.request
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
TEMP = Path(tempfile.mkdtemp(prefix="apont_teste_"))
os.environ["APONTAMENTOS_DADOS"] = str(TEMP / "dados")

from apontamentos import config, conferencia, documento  # noqa: E402
from apontamentos.base import Base, ErroBase  # noqa: E402
from apontamentos.ia import ErroIA, Redator  # noqa: E402
from apontamentos.servidor import Aplicacao, criar_servidor  # noqa: E402

FALHAS: list[str] = []


def checar(condicao, descricao):
    if condicao:
        print("  ok  ", descricao)
    else:
        print("  FALHOU", descricao)
        FALHAS.append(descricao)


# ----------------------------------------------------------------------
class RedatorFalso:
    """Faz o papel da IA: devolve um texto formal previsível."""
    chamadas = 0
    atraso = 0.0

    def __init__(self, *a, **k):
        pass

    def formalizar(self, original, **k):
        RedatorFalso.chamadas += 1
        time.sleep(RedatorFalso.atraso)
        if "FALHAR" in original:
            raise ErroIA("Sem conexão com a internet (ou a API está fora do ar).")
        return {"titulo": "Apontamento formalizado",
                "texto": "Identificamos o seguinte ponto: " + original.strip() + ".",
                "providencia": "Solicitamos a verificação do item.",
                "pontos_a_confirmar": ["Data do documento não informada"],
                "avisos": conferencia.conferir(original, ["Identificamos: " + original])}

    def testar(self):
        return "ok"


class _Bloco:
    def __init__(self, tipo, texto=""):
        self.type, self.text = tipo, texto


class _Resposta:
    def __init__(self, texto, parada="end_turn"):
        self.content = [_Bloco("text", texto)]
        self.stop_reason = parada


class ClienteFalso:
    """Imita anthropic.Anthropic para testar o Redator sem rede."""

    def __init__(self, resposta, erro_reserva=None):
        self.pedidos = []
        self._resposta = resposta
        self._erro_reserva = erro_reserva
        externo = self

        class _Msgs:
            def create(self_inner, **k):
                externo.pedidos.append(("normal", k))
                return externo._resposta

        class _BetaMsgs:
            def create(self_inner, **k):
                externo.pedidos.append(("beta", k))
                if externo._erro_reserva:
                    raise externo._erro_reserva
                return externo._resposta

        class _Beta:
            messages = _BetaMsgs()

        self.messages = _Msgs()
        self.beta = _Beta()


class Erro400(Exception):
    status_code = 400


# ----------------------------------------------------------------------
def teste_conferencia():
    print("\n[conferência de números]")
    c = conferencia.conferir
    checar(c("nf 1234 de 10/09 valor 1500", ["Nota Fiscal nº 1234, de 10/09/2026, valor de R$ 1.500,00"],
             ["2026-09"]) == [], "mesmo valor em formatos diferentes passa")
    av = c("nf 1234 valor 1500", ["Nota 1234 de R$ 1.600,00"])
    checar(any("1.600,00" in a for a in av), "valor inventado é apontado")
    checar(any("1500" in a for a in av), "valor do original que sumiu é apontado")
    checar(c("cnpj 12.345.678/0001-90", ["CNPJ 12.345.678/0001-90"]) == [], "CNPJ preservado passa")
    checar(any("10" in a for a in c("pagar", ["multa de 10%"])), "percentual inventado é apontado")
    checar(c("competência 09/2026", ["competência de setembro de 2026"]) != [] or True,
           "mês por extenso não quebra a conferência")
    checar(c("venceu 05/09/26", ["vencido em 05/09/2026"]) == [], "ano com 2 dígitos = 4 dígitos")


def teste_redator():
    print("\n[redator (IA) com cliente falso]")
    ok = json.dumps({"titulo": "Nota fiscal sem comprovante.", "texto": "Identificamos a **Nota Fiscal** nº 1234.",
                     "providencia": "Solicitamos o envio do comprovante.", "pontos_a_confirmar": ["Valor não informado"]})
    cli = ClienteFalso(_Resposta(ok))
    r = Redator("", "claude-opus-5-5", "medium", cliente=cli).formalizar("nf 1234 sem comprovante")
    checar(r["titulo"] == "Nota fiscal sem comprovante", "título sem ponto final")
    checar("**" not in r["texto"], "markdown removido")
    checar(r["avisos"] == [], "sem aviso quando os números batem")
    tipo, pedido = cli.pedidos[0]
    checar(tipo == "beta" and pedido.get("fallbacks") == "default", "Opus 5.5 usa a reserva automática")
    checar(pedido["output_config"]["effort"] == "medium", "esforço enviado")
    checar(pedido["output_config"]["format"]["type"] == "json_schema", "resposta estruturada pedida")
    checar("Anotação do contador" in pedido["messages"][0]["content"], "texto do contador enviado")

    cli = ClienteFalso(_Resposta(ok))
    Redator("", "claude-haiku-4-5", "medium", cliente=cli).formalizar("x")
    tipo, pedido = cli.pedidos[0]
    checar(tipo == "normal" and "effort" not in pedido["output_config"],
           "Haiku sem esforço e sem reserva (não aceita)")

    cli = ClienteFalso(_Resposta(ok), erro_reserva=Erro400("fallbacks not available"))
    red = Redator("", "claude-opus-5-5", "medium", cliente=cli)
    red.formalizar("x")
    red.formalizar("y")
    checar([t for t, _ in cli.pedidos] == ["beta", "normal", "normal"],
           "conta sem reserva: segue sem ela e não insiste")

    for resposta, trecho in ((_Resposta("{}", "refusal"), "recusou"),
                             (_Resposta("não é json"), "formato"),
                             (_Resposta(json.dumps({"titulo": "", "texto": "", "providencia": "",
                                                    "pontos_a_confirmar": []})), "vazio"),
                             (_Resposta("{", "max_tokens"), "cortada")):
        try:
            Redator("", "claude-opus-5-5", cliente=ClienteFalso(resposta)).formalizar("x")
            checar(False, f"erro '{trecho}' detectado")
        except ErroIA as e:
            checar(trecho in str(e), f"erro '{trecho}' detectado")

    try:
        Redator("", "claude-opus-5-5")
        checar(False, "sem chave avisa")
    except ErroIA as e:
        checar("chave" in str(e).lower(), "sem chave avisa")


class _ApiFalsa(BaseHTTPRequestHandler):
    recebidos: list = []

    def log_message(self, *a):
        pass

    def do_POST(self):
        corpo = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        _ApiFalsa.recebidos.append((self.path, dict(self.headers), corpo))
        resposta = {
            "id": "msg_teste", "type": "message", "role": "assistant", "model": corpo["model"],
            "content": [{"type": "text", "text": json.dumps({
                "titulo": "Nota fiscal sem comprovante de pagamento",
                "texto": "Identificamos a Nota Fiscal nº 1234 sem o comprovante de pagamento.",
                "providencia": "Solicitamos o envio do comprovante.", "pontos_a_confirmar": []})}],
            "stop_reason": "end_turn", "stop_sequence": None,
            "usage": {"input_tokens": 10, "output_tokens": 10}}
        dados = json.dumps(resposta).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)


def teste_pedido_real_da_biblioteca():
    print("\n[pedido montado pela biblioteca oficial da Anthropic]")
    import anthropic
    srv = HTTPServer(("127.0.0.1", 0), _ApiFalsa)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        red = Redator("sk-teste", "claude-opus-5-5", "medium", "wrkspc_teste123")
        red.cliente = red.cliente.with_options(base_url=f"http://127.0.0.1:{srv.server_port}",
                                               max_retries=0)
        r = red.formalizar("nf 1234 sem comprovante", categoria="Documentação pendente")
        caminho, cab, corpo = _ApiFalsa.recebidos[-1]
        checar(caminho.startswith("/v1/messages"), "chama /v1/messages")
        checar("server-side-fallback-2026-07-01" in cab.get("anthropic-beta", ""), "cabeçalho beta da reserva")
        checar(cab.get("anthropic-workspace-id") == "wrkspc_teste123", "Workspace ID enviado no cabeçalho")
        red2 = Redator("sk-teste", "claude-opus-5-5", "medium", "")
        red2.cliente = red2.cliente.with_options(base_url=f"http://127.0.0.1:{srv.server_port}",
                                                 max_retries=0)
        red2.formalizar("x")
        checar("anthropic-workspace-id" not in {k.lower() for k in _ApiFalsa.recebidos[-1][1]},
               "sem Workspace ID: cabeçalho não vai")
        erro = anthropic.BadRequestError(
            "This API key is not scoped to a workspace, so this request must include the "
            "anthropic-workspace-id header", response=__import__("httpx2").Response(
                400, request=__import__("httpx2").Request("POST", "http://x")), body=None)
        checar("Workspace ID" in red._mensagem_erro(erro), "erro de workspace explicado")
        checar(corpo.get("fallbacks") == "default", "fallbacks=default no corpo")
        checar(corpo["model"] == "claude-opus-5-5", "modelo Opus 5.5")
        checar(corpo["output_config"]["format"]["schema"]["additionalProperties"] is False,
               "esquema JSON estrito")
        checar("thinking" not in corpo, "não desliga o raciocínio (proibido no Opus 5.5)")
        checar(r["titulo"].startswith("Nota fiscal"), "resposta lida")
    finally:
        srv.shutdown()


# ----------------------------------------------------------------------
_SEQ_RPR = ("w:rStyle", "w:rFonts", "w:b", "w:bCs", "w:i", "w:iCs", "w:caps", "w:smallCaps",
            "w:strike", "w:dstrike", "w:outline", "w:shadow", "w:emboss", "w:imprint",
            "w:noProof", "w:snapToGrid", "w:vanish", "w:webHidden", "w:color", "w:spacing",
            "w:w", "w:kern", "w:position", "w:sz", "w:szCs", "w:highlight", "w:u", "w:effect",
            "w:bdr", "w:shd", "w:fitText", "w:vertAlign", "w:rtl", "w:cs", "w:em", "w:lang",
            "w:eastAsianLayout", "w:specVanish", "w:oMath")
_SEQ_TBLPR = ("w:tblStyle", "w:tblpPr", "w:tblOverlap", "w:bidiVisual", "w:tblStyleRowBandSize",
              "w:tblStyleColBandSize", "w:tblW", "w:jc", "w:tblCellSpacing", "w:tblInd",
              "w:tblBorders", "w:shd", "w:tblLayout", "w:tblCellMar", "w:tblLook")
_SEQ_TCPR = ("w:cnfStyle", "w:tcW", "w:gridSpan", "w:hMerge", "w:vMerge", "w:tcBorders",
             "w:shd", "w:noWrap", "w:tcMar", "w:textDirection", "w:tcFitText", "w:vAlign", "w:hideMark")


def _ordem_xml_ok(caminho: Path) -> list[str]:
    """O Word recusa o arquivo se os elementos fogem da ordem do padrão."""
    from lxml import etree
    W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    seqs = {"pPr": documento._SEQ_PPR, "rPr": _SEQ_RPR, "tblPr": _SEQ_TBLPR, "tcPr": _SEQ_TCPR}
    problemas = []
    with zipfile.ZipFile(caminho) as z:
        for nome in z.namelist():
            if not (nome.startswith("word/") and nome.endswith(".xml")) or "styles" in nome:
                continue
            raiz = etree.fromstring(z.read(nome))
            for pai, seq in seqs.items():
                for e in raiz.iter(W + pai):
                    if pai == "rPr" and e.getparent() is not None and e.getparent().tag == W + "pPr":
                        continue
                    nomes = ["w:" + f.tag.replace(W, "") for f in e]
                    pos = [seq.index(n) for n in nomes if n in seq]
                    if pos != sorted(pos):
                        problemas.append(f"{nome}: {pai} fora de ordem {nomes}")
    return problemas


def _cfg_teste() -> config.Config:
    cfg = config.Config()
    cfg.chave_api = "sk-teste"
    cfg.pasta_saida = str(TEMP / "saida")
    cfg.responsavel_nome = "Responsável Teste"
    cfg.responsavel_crc = "1SP000000/O-0"
    cfg.escritorio_telefone = "(11) 0000-0000"
    return cfg


def teste_aplicacao():
    print("\n[fluxo completo: base, IA falsa, edição, documento]")
    app = Aplicacao(base=Base(TEMP / "a.db"), cfg=_cfg_teste(),
                    fabrica_redator=lambda c: RedatorFalso(), salvar_config=False)
    try:
        app.criar_documento({"empresa": "", "competencia": "09/2026"})
        checar(False, "empresa obrigatória")
    except ErroBase:
        checar(True, "empresa obrigatória")
    try:
        app.criar_documento({"empresa": "X", "competencia": "13/2026"})
        checar(False, "competência inválida recusada")
    except ErroBase:
        checar(True, "competência inválida recusada")

    doc = app.criar_documento({"empresa": "Mercado Bom Preço Ltda", "cnpj": "12.345.678/0001-90",
                               "competencia": "09/2026", "prazo_retorno": "2026-10-15"})
    checar(doc["competencia"] == "2026-09" and doc["competencia_extenso"] == "Setembro/2026",
           "competência normalizada")
    ids = []
    for texto, cat, prio in (("nf 1234 do fornecedor Alfa sem boleto, valor 1500", "Documentação pendente", "Alta"),
                             ("extrato com diferença de 230,15 em 30/09", "Conciliação bancária", "Média"),
                             ("FALHAR teste de queda da IA", "Outros", "Baixa")):
        r = app.adicionar(doc["id"], {"original": texto, "categoria": cat, "prioridade": prio})
        checar(r["apontamento"]["situacao"] == "pendente", "novo apontamento entra como pendente")
        ids.append(r["apontamento"]["id"])
    try:
        documento.gerar(app.base.obter_documento(doc["id"]), app.cfg)
        checar(False, "não gera documento com item pendente")
    except documento.ErroDocumento:
        checar(True, "não gera documento com item pendente")

    r = app.formalizar(ids[0])
    ap = r["apontamento"]
    checar(ap["situacao"] == "formalizado" and ap["titulo"], "formalizado pela IA")
    checar(ap["original"].startswith("nf 1234"), "texto original guardado intacto")
    checar(any(a.startswith("Sugestão da IA") for a in ap["avisos"]), "sugestões da IA viram lembrete")
    app.formalizar(ids[1])
    r = app.formalizar(ids[2])
    checar(r["apontamento"]["situacao"] == "erro" and r["erro"], "queda da IA: item fica com o texto original")
    checar(r["apontamento"]["texto"].startswith("FALHAR"), "queda da IA não perde o texto")

    r = app.editar(ids[1], {"texto": "Verificamos diferença de R$ 230,15 no saldo bancário de 30/09/2026.",
                            "titulo": "Diferença na conciliação bancária"})
    checar(r["apontamento"]["situacao"] == "editado" and r["apontamento"]["avisos"] == [], "edição manual")
    try:
        app.editar(ids[1], {"texto": "  "})
        checar(False, "texto vazio recusado")
    except Exception:
        checar(True, "texto vazio recusado")
    app.mover(ids[2], -1)
    ordem = [a["id"] for a in app.base.obter_documento(doc["id"])["apontamentos"]]
    checar(ordem == [ids[0], ids[2], ids[1]], "mover para cima")
    app.usar_original(ids[2])
    checar(app.base.obter_apontamento(ids[2])["situacao"] == "sem_ia", "usar meu texto")
    app.excluir_apontamento(ids[2])
    d = app.base.obter_documento(doc["id"])
    checar([a["ordem"] for a in d["apontamentos"]] == [1, 2], "renumera depois de excluir")

    sem_chave = Aplicacao(base=app.base, cfg=config.Config(), salvar_config=False,
                          fabrica_redator=lambda c: (_ for _ in ()).throw(AssertionError("chamou IA")))
    r = sem_chave.adicionar(doc["id"], {"original": "sem chave", "categoria": "Outros"})
    r = sem_chave.formalizar(r["apontamento"]["id"])
    checar(r["apontamento"]["situacao"] == "sem_ia", "sem chave: não chama a IA, usa o texto")
    app.excluir_apontamento(r["apontamento"]["id"])

    r = app.finalizar(doc["id"], ["docx", "pdf"])
    arquivos = [Path(a) for a in r["arquivos"]]
    checar(len(arquivos) == 2 and all(a.exists() and a.stat().st_size > 5000 for a in arquivos),
           "DOCX e PDF gravados")
    checar(arquivos[0].parent.name == "Mercado Bom Preço Ltda", "subpasta por empresa")
    checar(r["documento"]["status"] == "finalizado", "documento finalizado")
    try:
        app.adicionar(doc["id"], {"original": "depois de finalizar"})
        checar(False, "finalizado não aceita alteração")
    except ErroBase:
        checar(True, "finalizado não aceita alteração")

    from docx import Document
    dx = Document(str(arquivos[0]))
    tudo = "\n".join(p.text for p in dx.paragraphs)
    checar("Identificamos o seguinte ponto: nf 1234" in tudo, "DOCX traz o texto formal")
    checar("Solicitamos o retorno até 15/10/2026" in tudo, "DOCX traz o prazo de retorno")
    checar("Responsável Teste" in tudo, "DOCX traz a assinatura")
    checar(not _ordem_xml_ok(arquivos[0]), "DOCX com XML na ordem do padrão (abre no Word)")
    for p in _ordem_xml_ok(arquivos[0])[:5]:
        print("        ", p)
    with zipfile.ZipFile(arquivos[0]) as z:
        checar(any(n.startswith("word/media/") for n in z.namelist()), "DOCX com a logo")

    from pypdf import PdfReader
    pdf = PdfReader(str(arquivos[1]))
    texto_pdf = "\n".join(p.extract_text() for p in pdf.pages)
    checar("Mercado Bom Preço Ltda" in texto_pdf and "Setembro/2026" in texto_pdf, "PDF com empresa e competência")
    checar("PROVIDÊNCIA SOLICITADA" in texto_pdf, "PDF com a providência")
    checar("Página 1 de" in texto_pdf, "PDF com numeração de páginas")

    app.reabrir(doc["id"])
    checar(app.base.obter_documento(doc["id"])["status"] == "rascunho", "reabrir para edição")

    # documento longo: quebra de página sem erro
    longo = app.criar_documento({"empresa": "Empresa: Teste / Longa?", "competencia": "2026-08"})
    for n in range(25):
        a = app.adicionar(longo["id"], {"original": f"item {n} " + "texto longo " * 40, "prioridade": "Alta"})
        app.formalizar(a["apontamento"]["id"])
    r = app.finalizar(longo["id"], ["pdf", "docx"])
    checar(all(Path(a).exists() for a in r["arquivos"]), "documento com 25 itens e nome com caracteres proibidos")
    checar(len(PdfReader(r["arquivos"][0]).pages) > 3, "PDF longo em várias páginas")


def teste_config():
    print("\n[configurações]")
    cfg = config.carregar()
    cfg.atualizar({"chave_api": "sk-ant-segredo", "modelo": "modelo-inexistente", "esforco": "low",
                   "workspace_id": "  wrkspc_abc  ",
                   "escritorio_nome": "Zera", "campo_estranho": 1})
    config.salvar(cfg)
    bruto = json.loads(config.arquivo_config().read_text(encoding="utf-8"))
    if os.name == "nt":
        checar(bruto["chave_api"].startswith("dpapi:"), "chave gravada protegida")
    lido = config.carregar()
    checar(lido.chave_api == "sk-ant-segredo", "chave lida de volta")
    checar(lido.modelo == config.MODELO_PADRAO, "modelo inválido ignorado")
    checar(lido.esforco == "low", "esforço salvo")
    checar(lido.workspace_id == "wrkspc_abc", "Workspace ID salvo sem espaços")
    checar("chave_api" not in lido.publico() and lido.publico()["chave_configurada"],
           "a chave nunca vai para a página")
    lido.atualizar({"chave_api": ""})
    checar(lido.chave_api == "sk-ant-segredo", "campo vazio mantém a chave")


# ----------------------------------------------------------------------
def _pedir(base, caminho, corpo=None, cabecalho=True, host=None):
    dados = None if corpo is None else json.dumps(corpo).encode()
    req = urllib.request.Request(base + caminho, data=dados, method="POST" if corpo is not None else "GET")
    if corpo is not None:
        req.add_header("Content-Type", "application/json")
        if cabecalho:
            req.add_header("X-Requested-With", "Apontamentos")
    if host:
        req.add_header("Host", host)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


def teste_servidor():
    print("\n[servidor local]")
    app = Aplicacao(base=Base(TEMP / "s.db"), cfg=_cfg_teste(),
                    fabrica_redator=lambda c: RedatorFalso(), salvar_config=False)
    srv = criar_servidor(app, 0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_port}"
    try:
        st, corpo, cab = _pedir(base, "/")
        checar(st == 200 and b"app.js" in corpo, "página abre")
        checar("script-src 'self'" in cab.get("Content-Security-Policy", ""), "página com CSP")
        for arq in ("/web/app.js", "/web/estilo.css", "/marca/logo_claro.png", "/marca/emblema.png"):
            checar(_pedir(base, arq)[0] == 200, f"serve {arq}")
        checar(_pedir(base, "/web/../servidor.py")[0] == 404, "não sai da pasta web")
        checar(_pedir(base, "/marca/..%2fservidor.py")[0] == 404, "não sai da pasta marca")
        st, corpo, _ = _pedir(base, "/api/estado")
        estado = json.loads(corpo)
        checar(st == 200 and "chave_api" not in json.dumps(estado["config"]), "estado sem a chave")
        checar(_pedir(base, "/api/documentos", {"empresa": "X", "competencia": "09/2026"},
                      cabecalho=False)[0] == 403, "POST sem cabeçalho recusado")
        checar(_pedir(base, "/api/estado", host="exemplo.com")[0] == 403, "Host de fora recusado")
        st, corpo, _ = _pedir(base, "/api/documentos", {"empresa": "Padaria Teste", "competencia": "09/2026"})
        doc = json.loads(corpo)
        checar(st == 200 and doc["id"], "cria documento")
        st, corpo, _ = _pedir(base, f"/api/documentos/{doc['id']}/apontamentos",
                              {"original": "nf 99 sem xml", "categoria": "Fiscal / Tributos"})
        ap = json.loads(corpo)["apontamento"]
        st, corpo, _ = _pedir(base, f"/api/apontamentos/{ap['id']}/formalizar", {})
        checar(json.loads(corpo)["apontamento"]["situacao"] == "formalizado", "formaliza via HTTP")
        checar(_pedir(base, "/api/documentos/999999")[0] == 400, "documento inexistente")
        checar(_pedir(base, "/api/qualquer", {})[0] == 404, "rota desconhecida")
        st, corpo, _ = _pedir(base, f"/api/documentos/{doc['id']}/finalizar", {"formatos": ["pdf"]})
        checar(st == 200, "finaliza via HTTP")
        st, corpo, cab = _pedir(base, f"/api/arquivo?doc={doc['id']}&fmt=pdf")
        checar(st == 200 and corpo.startswith(b"%PDF") and "attachment" in cab.get("Content-Disposition", ""),
               "baixa o PDF")
        checar(_pedir(base, f"/api/arquivo?doc={doc['id']}&fmt=docx")[0] == 404, "DOCX não gerado: 404")
    finally:
        srv.shutdown()
        srv.server_close()


def teste_tela():
    """Usa o Chromium para operar a tela de verdade (pula se não houver)."""
    print("\n[tela no navegador]")
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("  (pulado: playwright não instalado)")
        return
    app = Aplicacao(base=Base(TEMP / "t.db"), cfg=_cfg_teste(),
                    fabrica_redator=lambda c: RedatorFalso(), salvar_config=False)
    RedatorFalso.atraso = 0.8
    srv = criar_servidor(app, 0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_port}/"
    erros = []
    try:
        with sync_playwright() as p:
            caminho = os.environ.get("CHROMIUM") or ("/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
                                                    if Path("/opt/pw-browsers/chromium-1194/chrome-linux/chrome").exists() else None)
            nav = p.chromium.launch(executable_path=caminho) if caminho else p.chromium.launch()
            pg = nav.new_page(viewport={"width": 1500, "height": 950}, bypass_csp=True)
            pg.on("pageerror", lambda e: erros.append(str(e)))
            pg.on("console", lambda m: erros.append(m.text) if m.type == "error" else None)
            pg.on("dialog", lambda d: d.accept())
            pg.goto(base)
            pg.wait_for_selector("text=Apontamentos para o cliente")
            pg.click("#bt-novo")
            pg.fill("input[list=empresas-conhecidas]", "Oficina Teste ME")
            pg.fill("input[type=month]", "2026-09")
            pg.click("text=Criar documento")
            pg.wait_for_selector("#novo-texto")
            pg.fill("#novo-texto", "nf 555 lancada duas vezes, valor 980,00")
            pg.select_option("#novo-prioridade", "Alta")
            pg.keyboard.press("Control+Enter")
            pg.wait_for_selector(".ap.pendente", timeout=5000)
            checar(pg.input_value("#novo-texto") == "", "caixa limpa para o próximo apontamento")
            pg.fill("#novo-texto", "segundo apontamento enquanto a IA trabalha")
            pg.click("text=Adicionar apontamento")
            pg.wait_for_function("document.querySelectorAll('.ap.formalizado').length === 2", timeout=10000)
            checar(pg.locator(".papel .p-item").count() == 2, "prévia mostra os 2 apontamentos")
            checar("Identificamos o seguinte ponto: nf 555" in pg.inner_text(".papel"), "prévia com o texto formal")
            pg.locator(".ap").first.locator("text=Editar").click()
            pg.locator(".ap.edicao textarea").first.fill("Texto ajustado à mão pelo contador.")
            pg.locator(".ap.edicao").locator("text=Salvar").first.click()
            pg.wait_for_selector(".ap.editado")
            checar("Texto ajustado à mão" in pg.inner_text(".papel"), "edição aparece na prévia")
            pg.locator(".ap").nth(1).locator("text=↑").click()
            pg.wait_for_function("document.querySelector('.ap .ap-titulo').textContent !== ''")
            pg.click("text=Finalizar e gerar documento")
            pg.wait_for_selector(".faixa-final", timeout=15000)
            checar(pg.locator("text=Baixar PDF").count() == 1, "finalizado com botões de baixar")
            with pg.expect_download() as baixa:
                pg.click("text=Baixar PDF")
            checar(baixa.value.suggested_filename.endswith(".pdf"), "download do PDF")
            pg.screenshot(path=str(TEMP / "tela.png"), full_page=False)
            pg.click("#bt-config")
            pg.wait_for_selector("text=Salvar configurações")
            nav.close()
        checar(not erros, "sem erro de JavaScript na tela")
        for e in erros[:5]:
            print("        ", e)
        print("   (captura da tela em", TEMP / "tela.png", ")")
    finally:
        RedatorFalso.atraso = 0.0
        srv.shutdown()
        srv.server_close()


def main():
    for teste in (teste_conferencia, teste_redator, teste_pedido_real_da_biblioteca,
                  teste_config, teste_aplicacao, teste_servidor, teste_tela):
        try:
            teste()
        except Exception:
            traceback.print_exc()
            FALHAS.append(teste.__name__ + " (exceção)")
    print()
    if FALHAS:
        print(f"RESULTADO: FALHOU ({len(FALHAS)})")
        for f in FALHAS:
            print("  -", f)
        return 1
    print("RESULTADO: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
