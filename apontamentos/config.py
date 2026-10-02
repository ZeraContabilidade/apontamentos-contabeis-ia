# -*- coding: utf-8 -*-
"""Configurações do sistema e dados do escritório.

Tudo fica em %APPDATA%\\ApontamentosContabeis (config.json e a base
apontamentos.db). Os testes apontam APONTAMENTOS_DADOS para uma pasta
temporária e nunca encostam nos dados reais.

A chave da API é gravada protegida pelo Windows (DPAPI): só o mesmo usuário,
no mesmo computador, consegue abri-la.
"""
from __future__ import annotations

import base64
import json
import os
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path

MODELOS = {
    "claude-opus-5-5": "Claude Opus 5.5 (recomendado: melhor redação)",
    "claude-sonnet-5-5": "Claude Sonnet 5.5 (mais rápido e mais barato)",
    "claude-haiku-4-5": "Claude Haiku 4.5 (o mais barato)",
}
MODELO_PADRAO = "claude-opus-5-5"
ESFORCOS = {
    "low": "Baixo (mais rápido)",
    "medium": "Médio (recomendado)",
    "high": "Alto (mais cuidadoso, mais lento)",
}
ESFORCO_PADRAO = "medium"

INTRODUCAO_PADRAO = (
    "No decorrer da escrituração contábil referente à competência {competencia}, "
    "nossa equipe identificou os pontos relacionados a seguir. Eles necessitam da "
    "atenção e, quando indicado, de providência por parte de V.Sas., para que os "
    "registros reflitam corretamente a situação da empresa e os trabalhos do "
    "período possam ser concluídos."
)
ENCERRAMENTO_PADRAO = (
    "Solicitamos a gentileza de analisar os apontamentos acima e nos encaminhar "
    "os documentos e esclarecimentos indicados. Permanecemos à disposição para "
    "quaisquer dúvidas."
)


def pasta_dados() -> Path:
    especial = os.environ.get("APONTAMENTOS_DADOS")
    if especial:
        p = Path(especial)
    elif os.name == "nt" and os.environ.get("APPDATA"):
        p = Path(os.environ["APPDATA"]) / "ApontamentosContabeis"
    else:
        p = Path.home() / ".apontamentos_contabeis"
    p.mkdir(parents=True, exist_ok=True)
    return p


def pasta_saida_padrao() -> str:
    docs = Path.home() / "Documents"
    if not docs.exists():
        docs = Path.home() / "Documentos"
    if not docs.exists():
        docs = Path.home()
    return str(docs / "Apontamentos Contábeis")


# ----------------------------------------------------------------------
# Proteção da chave (Windows DPAPI)
PREFIXO_PROTEGIDA = "dpapi:"


def _dpapi(dados: bytes, proteger: bool) -> bytes:
    import ctypes
    from ctypes import wintypes

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    buf = ctypes.create_string_buffer(dados, len(dados))
    entrada = DATA_BLOB(len(dados), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    saida = DATA_BLOB()
    crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32
    funcao = crypt32.CryptProtectData if proteger else crypt32.CryptUnprotectData
    if not funcao(ctypes.byref(entrada), None, None, None, None, 0x1, ctypes.byref(saida)):
        raise OSError("a proteção do Windows recusou a operação")
    try:
        return ctypes.string_at(saida.pbData, saida.cbData)
    finally:
        kernel32.LocalFree(saida.pbData)


def proteger_chave(chave: str) -> str:
    if not chave or os.name != "nt":
        return chave
    try:
        return PREFIXO_PROTEGIDA + base64.b64encode(
            _dpapi(chave.encode("utf-8"), True)).decode("ascii")
    except Exception:
        return chave


def abrir_chave(gravada: str) -> str:
    if not gravada or not gravada.startswith(PREFIXO_PROTEGIDA):
        return gravada or ""
    try:
        return _dpapi(base64.b64decode(gravada[len(PREFIXO_PROTEGIDA):]),
                      False).decode("utf-8")
    except Exception:
        return ""


# ----------------------------------------------------------------------
@dataclass
class Config:
    chave_api: str = ""                 # em memória: sempre a chave aberta
    modelo: str = MODELO_PADRAO
    esforco: str = ESFORCO_PADRAO
    # só para chave de organização que não pertence a um workspace
    workspace_id: str = ""
    porta: int = 8770
    pasta_saida: str = field(default_factory=pasta_saida_padrao)
    # dados do escritório (vão no documento)
    escritorio_nome: str = "Zera Contabilidade"
    escritorio_cnpj: str = ""
    escritorio_endereco: str = ""
    escritorio_telefone: str = ""
    escritorio_email: str = ""
    escritorio_site: str = ""
    responsavel_nome: str = ""
    responsavel_crc: str = ""
    responsavel_cargo: str = "Contador(a) responsável"
    introducao: str = INTRODUCAO_PADRAO
    encerramento: str = ENCERRAMENTO_PADRAO

    # campos que a página pode ler (a chave nunca volta para a página)
    def publico(self) -> dict:
        d = asdict(self)
        chave = d.pop("chave_api")
        d["chave_configurada"] = bool(chave)
        d["modelos"] = MODELOS
        d["esforcos"] = ESFORCOS
        return d

    def atualizar(self, novos: dict) -> None:
        nomes = {f.name for f in fields(self)}
        for k, v in novos.items():
            if k not in nomes:
                continue
            if k == "chave_api":
                v = (v or "").strip()
                if not v:              # campo vazio = manter a chave atual
                    continue
            if k == "porta":
                try:
                    v = int(v)
                except (TypeError, ValueError):
                    continue
            if k == "modelo" and v not in MODELOS:
                continue
            if k == "esforco" and v not in ESFORCOS:
                continue
            if isinstance(getattr(self, k), str):
                v = "" if v is None else str(v)
            if k == "workspace_id":
                v = v.strip()
            setattr(self, k, v)

    def apagar_chave(self) -> None:
        self.chave_api = ""


def arquivo_config() -> Path:
    return pasta_dados() / "config.json"


def carregar() -> Config:
    cfg = Config()
    arq = arquivo_config()
    if arq.exists():
        try:
            dados = json.loads(arq.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            dados = {}
        if isinstance(dados, dict):
            dados["chave_api"] = abrir_chave(dados.get("chave_api", ""))
            nomes = {f.name for f in fields(cfg)}
            for k, v in dados.items():
                if k in nomes and v is not None:
                    setattr(cfg, k, v)
    if cfg.modelo not in MODELOS:
        cfg.modelo = MODELO_PADRAO
    if cfg.esforco not in ESFORCOS:
        cfg.esforco = ESFORCO_PADRAO
    return cfg


def salvar(cfg: Config) -> None:
    dados = asdict(cfg)
    dados["chave_api"] = proteger_chave(cfg.chave_api)
    arq = arquivo_config()
    tmp = arq.with_suffix(".tmp")
    tmp.write_text(json.dumps(dados, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, arq)
