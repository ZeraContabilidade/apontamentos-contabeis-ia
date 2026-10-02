# -*- coding: utf-8 -*-
"""Servidor local: a tela do sistema abre no navegador (http://127.0.0.1:8770).

Só biblioteca padrão. Escuta apenas em 127.0.0.1 (o próprio computador):
nada fica exposto na rede. Toda alteração exige o cabeçalho
X-Requested-With: Apontamentos e o endereço local no Host, o que impede
outro site aberto no navegador de mexer nos dados.
"""
from __future__ import annotations

import json
import mimetypes
import os
import subprocess
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

from . import __version__, config, documento
from .base import CATEGORIAS, PRIORIDADES, Base, ErroBase
from .ia import ErroIA, Redator

PASTA_WEB = Path(__file__).resolve().parent / "web"
PASTA_MARCA = Path(__file__).resolve().parent / "marca"
CABECALHO_SEGURANCA = "Apontamentos"
CAMPOS_TEXTO = ("titulo", "texto", "providencia")


class ErroPedido(Exception):
    def __init__(self, mensagem: str, status: int = 400):
        super().__init__(mensagem)
        self.status = status


class Aplicacao:
    """Regras da tela, separadas do HTTP (os testes chamam direto)."""

    def __init__(self, base: Base | None = None, cfg: config.Config | None = None,
                 fabrica_redator=None, salvar_config: bool = True):
        self.base = base or Base()
        self.cfg = cfg or config.carregar()
        self._salvar_config = salvar_config
        self.fabrica_redator = fabrica_redator or (
            lambda c: Redator(c.chave_api, c.modelo, c.esforco))
        self._trava_cfg = threading.Lock()

    # ------------------------------------------------------------------
    def estado(self) -> dict:
        return {
            "versao": __version__,
            "config": self.cfg.publico(),
            "categorias": CATEGORIAS,
            "prioridades": PRIORIDADES,
            "documentos": self.base.listar_documentos(),
            "empresas": self.base.empresas(),
        }

    def documento_completo(self, doc_id: int) -> dict:
        doc = self.base.obter_documento(doc_id)
        doc["previa"] = documento.montar_conteudo(doc, self.cfg)
        return doc

    def criar_documento(self, dados: dict) -> dict:
        return self.documento_completo(self.base.criar_documento(dados))

    def atualizar_documento(self, doc_id: int, dados: dict) -> dict:
        self.base.atualizar_documento(doc_id, dados)
        return self.documento_completo(doc_id)

    def adicionar(self, doc_id: int, dados: dict) -> dict:
        ap_id = self.base.adicionar_apontamento(doc_id, dados)
        return {"apontamento": self.base.obter_apontamento(ap_id),
                "documento": self.documento_completo(doc_id)}

    def formalizar(self, ap_id: int) -> dict:
        ap = self.base.obter_apontamento(ap_id)
        doc = self.base.obter_documento(ap["documento_id"])
        if doc["status"] != "rascunho":
            raise ErroPedido("Este documento já foi finalizado.")
        erro = ""
        if not self.cfg.chave_api:
            novos = {"situacao": "sem_ia", "texto": ap["original"], "titulo": "",
                     "providencia": "",
                     "avisos": ["IA não configurada: o apontamento ficou com o seu texto. "
                                "Cadastre a chave em Configurações para formalizar."]}
        else:
            self.base.atualizar_apontamento(ap_id, {"situacao": "pendente"})
            try:
                redator = self.fabrica_redator(self.cfg)
                r = redator.formalizar(
                    ap["original"], categoria=ap["categoria"], prioridade=ap["prioridade"],
                    valor=ap["valor"], referencia=ap["referencia"], empresa=doc["empresa"],
                    competencia=doc["competencia_extenso"])
                avisos = list(r["avisos"]) + [f"Sugestão da IA (não vai para o cliente): {p}"
                                              for p in r["pontos_a_confirmar"]]
                novos = {"situacao": "formalizado", "titulo": r["titulo"], "texto": r["texto"],
                         "providencia": r["providencia"], "avisos": avisos}
            except ErroIA as e:
                erro = str(e)
                novos = {"situacao": "erro", "texto": ap["original"], "titulo": "",
                         "providencia": "", "avisos": [erro]}
            except Exception as e:   # nunca deixar o item preso em "formalizando"
                traceback.print_exc()
                erro = f"Erro inesperado na IA: {e}"
                novos = {"situacao": "erro", "texto": ap["original"], "titulo": "",
                         "providencia": "", "avisos": [erro]}
        self.base.atualizar_apontamento(ap_id, novos, forcar=True)
        return {"apontamento": self.base.obter_apontamento(ap_id), "erro": erro,
                "documento": self.documento_completo(doc["id"])}

    def editar(self, ap_id: int, dados: dict) -> dict:
        atual = self.base.obter_apontamento(ap_id)
        dados = {k: v for k, v in dados.items()
                 if k in ("titulo", "texto", "providencia", "categoria", "prioridade",
                          "valor", "referencia", "original")}
        mudou_texto = any(k in dados and (dados[k] or "").strip() != (atual[k] or "")
                          for k in CAMPOS_TEXTO)
        if mudou_texto:
            dados["situacao"] = "editado"
            dados["avisos"] = []
            if not (dados.get("texto", atual["texto"]) or "").strip():
                raise ErroPedido("O texto do apontamento não pode ficar vazio.")
        ap = self.base.atualizar_apontamento(ap_id, dados)
        return {"apontamento": ap, "documento": self.documento_completo(ap["documento_id"])}

    def usar_original(self, ap_id: int) -> dict:
        ap = self.base.obter_apontamento(ap_id)
        ap = self.base.atualizar_apontamento(ap_id, {
            "situacao": "sem_ia", "texto": ap["original"], "titulo": "", "providencia": "",
            "avisos": []})
        return {"apontamento": ap, "documento": self.documento_completo(ap["documento_id"])}

    def excluir_apontamento(self, ap_id: int) -> dict:
        ap = self.base.obter_apontamento(ap_id)
        self.base.excluir_apontamento(ap_id)
        return {"documento": self.documento_completo(ap["documento_id"])}

    def mover(self, ap_id: int, direcao: int) -> dict:
        ap = self.base.obter_apontamento(ap_id)
        self.base.mover_apontamento(ap_id, direcao)
        return {"documento": self.documento_completo(ap["documento_id"])}

    def finalizar(self, doc_id: int, formatos) -> dict:
        formatos = [f for f in (formatos or ["docx", "pdf"]) if f in ("docx", "pdf")]
        if not formatos:
            raise ErroPedido("Escolha DOCX, PDF ou os dois.")
        doc = self.base.obter_documento(doc_id)
        try:
            arquivos = documento.gerar(doc, self.cfg, formatos)
        except documento.ErroDocumento as e:
            raise ErroPedido(str(e))
        except OSError as e:
            raise ErroPedido(f"Não consegui gravar na pasta de saída "
                             f"({self.cfg.pasta_saida}): {e}")
        self.base.finalizar(doc_id, [str(a) for a in arquivos])
        return {"documento": self.documento_completo(doc_id),
                "arquivos": [str(a) for a in arquivos]}

    def reabrir(self, doc_id: int) -> dict:
        self.base.reabrir(doc_id)
        return {"documento": self.documento_completo(doc_id)}

    def arquivo(self, doc_id: int, formato: str) -> Path:
        doc = self.base.obter_documento(doc_id)
        for a in doc["arquivos"]:
            p = Path(a)
            if p.suffix.lower() == "." + formato and p.exists():
                return p
        raise ErroPedido("Arquivo não encontrado. Gere o documento de novo.", 404)

    def abrir_pasta(self, doc_id: int) -> dict:
        doc = self.base.obter_documento(doc_id)
        pasta = documento.pasta_destino(self.cfg, doc)
        _abrir_no_sistema(pasta)
        return {"pasta": str(pasta)}

    def salvar_config(self, dados: dict) -> dict:
        with self._trava_cfg:
            self.cfg.atualizar(dados or {})
            if self._salvar_config:
                config.salvar(self.cfg)
        return {"config": self.cfg.publico()}

    def apagar_chave(self) -> dict:
        with self._trava_cfg:
            self.cfg.apagar_chave()
            if self._salvar_config:
                config.salvar(self.cfg)
        return {"config": self.cfg.publico()}

    def testar_ia(self) -> dict:
        if not self.cfg.chave_api:
            raise ErroPedido("Cadastre a chave da API primeiro.")
        try:
            texto = self.fabrica_redator(self.cfg).testar()
        except ErroIA as e:
            raise ErroPedido(str(e))
        return {"ok": True, "exemplo": texto}


def _abrir_no_sistema(caminho: Path) -> None:
    try:
        if os.name == "nt":
            os.startfile(str(caminho))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(caminho)])
        else:
            subprocess.Popen(["xdg-open", str(caminho)])
    except OSError:
        pass


# ----------------------------------------------------------------------
class Manipulador(BaseHTTPRequestHandler):
    app: Aplicacao = None  # definido em criar_servidor
    server_version = "Apontamentos/" + __version__

    def log_message(self, formato, *args):   # silencioso no console
        pass

    # respostas ----------------------------------------------------------
    def _json(self, dados, status=200):
        corpo = json.dumps(dados, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(corpo)

    def _arquivo(self, caminho: Path, baixar_como: str | None = None):
        tipo = mimetypes.guess_type(str(caminho))[0] or "application/octet-stream"
        if caminho.suffix == ".js":
            tipo = "text/javascript"
        dados = caminho.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", tipo + ("; charset=utf-8" if tipo.startswith("text/") else ""))
        self.send_header("Content-Length", str(len(dados)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if baixar_como:
            self.send_header("Content-Disposition",
                             f"attachment; filename*=UTF-8''{quote(baixar_como)}")
        else:
            self.send_header("Content-Security-Policy",
                             "default-src 'self'; img-src 'self' data:; "
                             "style-src 'self'; script-src 'self'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(dados)

    def _host_local(self) -> bool:
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]").lower()
        return host in ("127.0.0.1", "localhost", "::1")

    # GET ----------------------------------------------------------------
    def do_GET(self):
        if not self._host_local():
            return self._json({"erro": "Acesso permitido só neste computador."}, 403)
        url = urlparse(self.path)
        caminho = url.path
        try:
            if caminho in ("/", "/index.html"):
                return self._arquivo(PASTA_WEB / "index.html")
            if caminho.startswith("/web/") or caminho.startswith("/marca/"):
                pasta = PASTA_WEB if caminho.startswith("/web/") else PASTA_MARCA
                nome = caminho.split("/", 2)[2]
                alvo = (pasta / nome).resolve()
                if alvo.parent != pasta.resolve() or not alvo.is_file():
                    return self._json({"erro": "não encontrado"}, 404)
                return self._arquivo(alvo)
            if caminho == "/api/ping":
                return self._json({"app": "apontamentos", "versao": __version__})
            if caminho == "/api/estado":
                return self._json(self.app.estado())
            partes = caminho.strip("/").split("/")
            if len(partes) == 3 and partes[:2] == ["api", "documentos"]:
                return self._json(self.app.documento_completo(int(partes[2])))
            if caminho == "/api/arquivo":
                q = parse_qs(url.query)
                p = self.app.arquivo(int(q["doc"][0]), q.get("fmt", ["pdf"])[0])
                return self._arquivo(p, baixar_como=p.name)
            return self._json({"erro": "não encontrado"}, 404)
        except (ErroBase, ErroPedido) as e:
            return self._json({"erro": str(e)}, getattr(e, "status", 400))
        except (ValueError, KeyError):
            return self._json({"erro": "Pedido inválido."}, 400)
        except Exception as e:
            traceback.print_exc()
            return self._json({"erro": f"Erro interno: {e}"}, 500)

    # POST ---------------------------------------------------------------
    def do_POST(self):
        if not self._host_local() or self.headers.get("X-Requested-With") != CABECALHO_SEGURANCA:
            return self._json({"erro": "Pedido recusado."}, 403)
        try:
            tamanho = int(self.headers.get("Content-Length") or 0)
            if tamanho > 2_000_000:
                return self._json({"erro": "Pedido grande demais."}, 413)
            corpo = json.loads(self.rfile.read(tamanho) or b"{}") if tamanho else {}
            if not isinstance(corpo, dict):
                raise ValueError
            return self._json(self._rota_post(urlparse(self.path).path, corpo))
        except (ErroBase, ErroPedido) as e:
            return self._json({"erro": str(e)}, getattr(e, "status", 400))
        except (ValueError, KeyError):
            return self._json({"erro": "Pedido inválido."}, 400)
        except Exception as e:
            traceback.print_exc()
            return self._json({"erro": f"Erro interno: {e}"}, 500)

    def _rota_post(self, caminho: str, corpo: dict):
        app = self.app
        p = caminho.strip("/").split("/")
        if p == ["api", "config"]:
            return app.salvar_config(corpo)
        if p == ["api", "config", "apagar_chave"]:
            return app.apagar_chave()
        if p == ["api", "config", "testar"]:
            return app.testar_ia()
        if p == ["api", "documentos"]:
            return app.criar_documento(corpo)
        if len(p) >= 3 and p[:2] == ["api", "documentos"]:
            doc_id = int(p[2])
            acao = p[3] if len(p) > 3 else ""
            if acao == "":
                return app.atualizar_documento(doc_id, corpo)
            if acao == "apontamentos":
                return app.adicionar(doc_id, corpo)
            if acao == "finalizar":
                return app.finalizar(doc_id, corpo.get("formatos"))
            if acao == "reabrir":
                return app.reabrir(doc_id)
            if acao == "excluir":
                app.base.excluir_documento(doc_id)
                return {"ok": True}
            if acao == "abrir_pasta":
                return app.abrir_pasta(doc_id)
        if len(p) >= 3 and p[:2] == ["api", "apontamentos"]:
            ap_id = int(p[2])
            acao = p[3] if len(p) > 3 else ""
            if acao == "":
                return app.editar(ap_id, corpo)
            if acao == "formalizar":
                return app.formalizar(ap_id)
            if acao == "original":
                return app.usar_original(ap_id)
            if acao == "excluir":
                return app.excluir_apontamento(ap_id)
            if acao == "mover":
                return app.mover(ap_id, int(corpo.get("direcao", 0)))
        raise ErroPedido("Endereço desconhecido.", 404)


def criar_servidor(app: Aplicacao, porta: int, host: str = "127.0.0.1") -> ThreadingHTTPServer:
    classe = type("ManipuladorApp", (Manipulador,), {"app": app})
    servidor = ThreadingHTTPServer((host, porta), classe)
    servidor.daemon_threads = True
    return servidor
