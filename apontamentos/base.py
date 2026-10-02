# -*- coding: utf-8 -*-
"""Base de dados (SQLite) dos documentos e apontamentos.

Um *documento* é o relatório de uma empresa numa competência. Cada
*apontamento* guarda o texto exatamente como o contador escreveu (original)
e, separado, o texto formal que vai para o cliente. O original nunca é
apagado nem sobrescrito: é o rastro do que foi constatado.
"""
from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime
from pathlib import Path

from . import config

VERSAO_ESQUEMA = 1

CATEGORIAS = [
    "Documentação pendente",
    "Divergência de valores",
    "Lançamento sem comprovante",
    "Conciliação bancária",
    "Fiscal / Tributos",
    "Folha de pagamento",
    "Estoque / Patrimônio",
    "Cadastro / Dados da empresa",
    "Outros",
]
PRIORIDADES = ["Alta", "Média", "Baixa"]
SITUACOES = {
    "pendente": "Formalizando…",
    "formalizado": "Formalizado pela IA",
    "editado": "Editado manualmente",
    "sem_ia": "Texto original (sem IA)",
    "erro": "IA indisponível — texto original",
}

_ESQUEMA = """
CREATE TABLE IF NOT EXISTS documento (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    empresa TEXT NOT NULL,
    cnpj TEXT NOT NULL DEFAULT '',
    competencia TEXT NOT NULL,            -- AAAA-MM
    destinatario TEXT NOT NULL DEFAULT '',
    prazo_retorno TEXT NOT NULL DEFAULT '', -- AAAA-MM-DD ou vazio
    status TEXT NOT NULL DEFAULT 'rascunho',
    arquivos TEXT NOT NULL DEFAULT '[]',
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL,
    finalizado_em TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS apontamento (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    documento_id INTEGER NOT NULL REFERENCES documento(id) ON DELETE CASCADE,
    ordem INTEGER NOT NULL,
    categoria TEXT NOT NULL DEFAULT 'Outros',
    prioridade TEXT NOT NULL DEFAULT 'Média',
    original TEXT NOT NULL,
    titulo TEXT NOT NULL DEFAULT '',
    texto TEXT NOT NULL DEFAULT '',
    providencia TEXT NOT NULL DEFAULT '',
    valor TEXT NOT NULL DEFAULT '',
    referencia TEXT NOT NULL DEFAULT '',
    situacao TEXT NOT NULL DEFAULT 'pendente',
    avisos TEXT NOT NULL DEFAULT '[]',
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_apont_doc ON apontamento(documento_id, ordem);
CREATE TABLE IF NOT EXISTS meta (chave TEXT PRIMARY KEY, valor TEXT);
"""

CAMPOS_DOC = ("empresa", "cnpj", "competencia", "destinatario", "prazo_retorno")
CAMPOS_APONT = ("categoria", "prioridade", "original", "titulo", "texto",
                "providencia", "valor", "referencia", "situacao", "avisos")


def agora() -> str:
    return datetime.now().isoformat(timespec="seconds")


class ErroBase(ValueError):
    """Erro de uso (dado inválido, item inexistente): vira mensagem na tela."""


class Base:
    def __init__(self, caminho: Path | str | None = None):
        caminho = Path(caminho or (config.pasta_dados() / "apontamentos.db"))
        caminho.parent.mkdir(parents=True, exist_ok=True)
        self.caminho = str(caminho)
        self._trava = threading.RLock()
        with self._con() as c:
            c.executescript(_ESQUEMA)
            c.execute("INSERT OR REPLACE INTO meta VALUES ('versao_esquema', ?)",
                      (str(VERSAO_ESQUEMA),))

    def _con(self) -> sqlite3.Connection:
        con = sqlite3.connect(self.caminho, timeout=30)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys = ON")
        return con

    def _executar(self, func):
        with self._trava:
            con = self._con()
            try:
                with con:
                    return func(con)
            finally:
                con.close()

    # ------------------------------------------------------------------
    # documentos
    @staticmethod
    def _validar_doc(dados: dict, parcial: bool = False) -> dict:
        limpo = {}
        for k in CAMPOS_DOC:
            if k in dados:
                limpo[k] = str(dados[k] or "").strip()
        if not parcial or "empresa" in limpo:
            if not limpo.get("empresa"):
                raise ErroBase("Informe o nome da empresa.")
        if not parcial or "competencia" in limpo:
            comp = limpo.get("competencia", "")
            if not _competencia_valida(comp):
                raise ErroBase("Competência inválida. Use mês e ano (ex.: 09/2026).")
            limpo["competencia"] = _competencia_iso(comp)
        if limpo.get("prazo_retorno"):
            try:
                datetime.strptime(limpo["prazo_retorno"], "%Y-%m-%d")
            except ValueError:
                raise ErroBase("Prazo de retorno inválido.")
        return limpo

    def criar_documento(self, dados: dict) -> int:
        d = self._validar_doc(dados)
        momento = agora()

        def f(c):
            cur = c.execute(
                "INSERT INTO documento (empresa, cnpj, competencia, destinatario, "
                "prazo_retorno, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?)",
                (d["empresa"], d.get("cnpj", ""), d["competencia"],
                 d.get("destinatario", ""), d.get("prazo_retorno", ""), momento, momento))
            return cur.lastrowid
        return self._executar(f)

    def atualizar_documento(self, doc_id: int, dados: dict) -> None:
        d = self._validar_doc(dados, parcial=True)
        if not d:
            return
        self._exigir_rascunho(doc_id)
        sets = ", ".join(f"{k} = ?" for k in d)

        def f(c):
            c.execute(f"UPDATE documento SET {sets}, atualizado_em = ? WHERE id = ?",
                      (*d.values(), agora(), doc_id))
        self._executar(f)

    def listar_documentos(self) -> list[dict]:
        def f(c):
            linhas = c.execute(
                "SELECT d.*, (SELECT COUNT(*) FROM apontamento a WHERE a.documento_id = d.id) "
                "AS quantidade FROM documento d ORDER BY d.atualizado_em DESC, d.id DESC"
            ).fetchall()
            return [_doc_dict(r) for r in linhas]
        return self._executar(f)

    def empresas(self) -> list[dict]:
        """Empresas já usadas (para completar o nome e o CNPJ)."""
        def f(c):
            linhas = c.execute(
                "SELECT empresa, cnpj, MAX(atualizado_em) m FROM documento "
                "GROUP BY empresa, cnpj ORDER BY m DESC").fetchall()
            return [{"empresa": r["empresa"], "cnpj": r["cnpj"]} for r in linhas]
        return self._executar(f)

    def obter_documento(self, doc_id: int) -> dict:
        def f(c):
            r = c.execute("SELECT d.*, 0 AS quantidade FROM documento d WHERE id = ?",
                          (doc_id,)).fetchone()
            if not r:
                raise ErroBase("Documento não encontrado.")
            doc = _doc_dict(r)
            itens = c.execute("SELECT * FROM apontamento WHERE documento_id = ? "
                              "ORDER BY ordem, id", (doc_id,)).fetchall()
            doc["apontamentos"] = [_apont_dict(i) for i in itens]
            doc["quantidade"] = len(doc["apontamentos"])
            return doc
        return self._executar(f)

    def excluir_documento(self, doc_id: int) -> None:
        self._executar(lambda c: c.execute("DELETE FROM documento WHERE id = ?", (doc_id,)))

    def finalizar(self, doc_id: int, arquivos: list[str]) -> None:
        def f(c):
            c.execute("UPDATE documento SET status = 'finalizado', arquivos = ?, "
                      "finalizado_em = ?, atualizado_em = ? WHERE id = ?",
                      (json.dumps(arquivos, ensure_ascii=False), agora(), agora(), doc_id))
        self._executar(f)

    def reabrir(self, doc_id: int) -> None:
        def f(c):
            c.execute("UPDATE documento SET status = 'rascunho', atualizado_em = ? "
                      "WHERE id = ?", (agora(), doc_id))
        self._executar(f)

    def _exigir_rascunho(self, doc_id: int) -> None:
        def f(c):
            r = c.execute("SELECT status FROM documento WHERE id = ?", (doc_id,)).fetchone()
            if not r:
                raise ErroBase("Documento não encontrado.")
            if r["status"] != "rascunho":
                raise ErroBase("Este documento já foi finalizado. Clique em "
                               "\"Reabrir para edição\" para alterar.")
        self._executar(f)

    def _tocar(self, c, doc_id: int) -> None:
        c.execute("UPDATE documento SET atualizado_em = ? WHERE id = ?", (agora(), doc_id))

    # ------------------------------------------------------------------
    # apontamentos
    def adicionar_apontamento(self, doc_id: int, dados: dict) -> int:
        original = str(dados.get("original") or "").strip()
        if not original:
            raise ErroBase("Escreva o apontamento antes de adicionar.")
        self._exigir_rascunho(doc_id)
        categoria = dados.get("categoria") if dados.get("categoria") in CATEGORIAS else "Outros"
        prioridade = dados.get("prioridade") if dados.get("prioridade") in PRIORIDADES else "Média"
        momento = agora()

        def f(c):
            ordem = c.execute("SELECT COALESCE(MAX(ordem), 0) + 1 FROM apontamento "
                              "WHERE documento_id = ?", (doc_id,)).fetchone()[0]
            cur = c.execute(
                "INSERT INTO apontamento (documento_id, ordem, categoria, prioridade, "
                "original, texto, valor, referencia, situacao, criado_em, atualizado_em) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (doc_id, ordem, categoria, prioridade, original, original,
                 str(dados.get("valor") or "").strip(),
                 str(dados.get("referencia") or "").strip(),
                 dados.get("situacao") or "pendente", momento, momento))
            self._tocar(c, doc_id)
            return cur.lastrowid
        return self._executar(f)

    def obter_apontamento(self, ap_id: int) -> dict:
        def f(c):
            r = c.execute("SELECT * FROM apontamento WHERE id = ?", (ap_id,)).fetchone()
            if not r:
                raise ErroBase("Apontamento não encontrado.")
            return _apont_dict(r)
        return self._executar(f)

    def atualizar_apontamento(self, ap_id: int, dados: dict, *, forcar: bool = False) -> dict:
        atual = self.obter_apontamento(ap_id)
        if not forcar:
            self._exigir_rascunho(atual["documento_id"])
        novos = {}
        for k in CAMPOS_APONT:
            if k not in dados:
                continue
            v = dados[k]
            if k == "avisos":
                v = json.dumps(list(v or []), ensure_ascii=False)
            elif k == "categoria" and v not in CATEGORIAS:
                continue
            elif k == "prioridade" and v not in PRIORIDADES:
                continue
            elif k == "situacao" and v not in SITUACOES:
                continue
            else:
                v = str(v or "").strip()
            if k == "original" and not v:
                raise ErroBase("O texto original não pode ficar vazio.")
            novos[k] = v
        if not novos:
            return atual
        sets = ", ".join(f"{k} = ?" for k in novos)

        def f(c):
            c.execute(f"UPDATE apontamento SET {sets}, atualizado_em = ? WHERE id = ?",
                      (*novos.values(), agora(), ap_id))
            self._tocar(c, atual["documento_id"])
        self._executar(f)
        return self.obter_apontamento(ap_id)

    def excluir_apontamento(self, ap_id: int) -> None:
        atual = self.obter_apontamento(ap_id)
        self._exigir_rascunho(atual["documento_id"])

        def f(c):
            c.execute("DELETE FROM apontamento WHERE id = ?", (ap_id,))
            self._renumerar(c, atual["documento_id"])
            self._tocar(c, atual["documento_id"])
        self._executar(f)

    def mover_apontamento(self, ap_id: int, direcao: int) -> None:
        atual = self.obter_apontamento(ap_id)
        doc_id = atual["documento_id"]
        self._exigir_rascunho(doc_id)

        def f(c):
            ids = [r[0] for r in c.execute(
                "SELECT id FROM apontamento WHERE documento_id = ? ORDER BY ordem, id",
                (doc_id,))]
            i = ids.index(ap_id)
            j = i + (1 if direcao > 0 else -1)
            if 0 <= j < len(ids):
                ids[i], ids[j] = ids[j], ids[i]
            for n, x in enumerate(ids, 1):
                c.execute("UPDATE apontamento SET ordem = ? WHERE id = ?", (n, x))
            self._tocar(c, doc_id)
        self._executar(f)

    @staticmethod
    def _renumerar(c, doc_id: int) -> None:
        ids = [r[0] for r in c.execute(
            "SELECT id FROM apontamento WHERE documento_id = ? ORDER BY ordem, id", (doc_id,))]
        for n, x in enumerate(ids, 1):
            c.execute("UPDATE apontamento SET ordem = ? WHERE id = ?", (n, x))


# ----------------------------------------------------------------------
def _competencia_valida(texto: str) -> bool:
    try:
        _competencia_iso(texto)
        return True
    except ValueError:
        return False


def _competencia_iso(texto: str) -> str:
    """Aceita 09/2026, 9/2026, 2026-09 ou 092026; devolve 2026-09."""
    t = (texto or "").strip().replace(" ", "")
    for fmt in ("%m/%Y", "%Y-%m", "%m-%Y", "%m%Y", "%m.%Y"):
        try:
            d = datetime.strptime(t, fmt)
            if 2000 <= d.year <= 2100:
                return d.strftime("%Y-%m")
        except ValueError:
            pass
    raise ValueError(texto)


MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho",
         "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]


def competencia_extenso(iso: str) -> str:
    try:
        ano, mes = iso.split("-")
        return f"{MESES[int(mes) - 1]}/{ano}"
    except (ValueError, IndexError):
        return iso


def _doc_dict(r: sqlite3.Row) -> dict:
    d = dict(r)
    try:
        d["arquivos"] = json.loads(d.get("arquivos") or "[]")
    except ValueError:
        d["arquivos"] = []
    d["competencia_extenso"] = competencia_extenso(d["competencia"])
    return d


def _apont_dict(r: sqlite3.Row) -> dict:
    d = dict(r)
    try:
        d["avisos"] = json.loads(d.get("avisos") or "[]")
    except ValueError:
        d["avisos"] = []
    d["situacao_rotulo"] = SITUACOES.get(d["situacao"], d["situacao"])
    return d
