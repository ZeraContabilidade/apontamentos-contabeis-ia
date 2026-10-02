# -*- coding: utf-8 -*-
"""Conferência do texto formal contra o que o contador escreveu.

A IA só pode reescrever. Esta conferência é a trava: todo número que aparece
no texto formal (valor, data, nota, CNPJ, artigo de lei) precisa existir no
texto original ou nos dados que o próprio contador digitou (empresa, CNPJ,
competência, valor, referência). E todo número do original precisa continuar
no texto formal. O que não bater vira aviso na tela antes de o documento sair.
"""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation

_NUMERO = re.compile(r"\d+(?:[.,/\-]\d+)*")
_BR = re.compile(r"^\d{1,3}(?:\.\d{3})+(?:,\d+)?$|^\d+,\d+$")
_US_DEC = re.compile(r"^\d+\.\d{1,2}$")
_DATA = re.compile(r"^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2}|\d{4}))?$")
_DATA_ISO = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$")
_MES_ANO = re.compile(r"^(\d{1,2})/(\d{4})$")


def _formas(token: str) -> set:
    """Formas canônicas de um número: o mesmo valor escrito de jeitos
    diferentes (1500 / 1.500 / 1.500,00) tem uma forma em comum."""
    t = token.strip(".,/-")
    formas = {"txt:" + re.sub(r"\D", "", t)}
    m = _DATA_ISO.match(t)
    if m:
        a, mes, d = m.groups()
        formas |= {f"data:{int(d)}/{int(mes)}", f"data:{int(d)}/{int(mes)}/{int(a)}",
                   f"num:{int(a)}"}
        return formas
    m = _MES_ANO.match(t)
    if m and 1 <= int(m.group(1)) <= 12:
        formas |= {f"mes:{int(m.group(1))}/{m.group(2)}", f"num:{int(m.group(2))}"}
    m = _DATA.match(t)
    if m and not _BR.match(t):
        d, mes, a = m.groups()
        if 1 <= int(d) <= 31 and 1 <= int(mes) <= 12:
            formas.add(f"data:{int(d)}/{int(mes)}")
            if a:
                ano = int(a) + (2000 if len(a) == 2 else 0)
                formas.add(f"data:{int(d)}/{int(mes)}/{ano}")
    valor = None
    try:
        if _BR.match(t):
            valor = Decimal(t.replace(".", "").replace(",", "."))
        elif _US_DEC.match(t):
            valor = Decimal(t)
        elif t.isdigit():
            valor = Decimal(t)
    except InvalidOperation:
        valor = None
    if valor is not None:
        formas.add("num:" + _normal(valor))
    return formas


def _normal(v: Decimal) -> str:
    v = v.normalize()
    return format(v, "f")


def numeros(texto: str) -> list[str]:
    return [m.group(0).strip(".,/-") for m in _NUMERO.finditer(texto or "")]


def _aceito(token: str, permitidas: set) -> bool:
    return bool(_formas(token) & permitidas)


def conferir(original: str, formal: list[str], contexto: list[str] = ()) -> list[str]:
    """Devolve a lista de avisos (vazia quando está tudo certo)."""
    permitidas: set = set()
    for t in [original, *contexto]:
        for n in numeros(t):
            permitidas |= _formas(n)

    avisos = []
    vistos = set()
    texto_formal = "\n".join(x for x in formal if x)
    for n in numeros(texto_formal):
        if n in vistos:
            continue
        vistos.add(n)
        if not _aceito(n, permitidas):
            avisos.append(f"O texto formal traz o número \"{n}\", que não está no "
                          f"que você escreveu. Confira antes de enviar.")

    no_formal: set = set()
    for n in numeros(texto_formal):
        no_formal |= _formas(n)
    faltando = []
    for n in numeros(original):
        if n in faltando:
            continue
        if not (_formas(n) & no_formal):
            faltando.append(n)
    for n in faltando:
        avisos.append(f"O número \"{n}\" do seu texto não aparece no texto formal. "
                      f"Confira se ele deveria estar lá.")
    return avisos
