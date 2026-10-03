# -*- coding: utf-8 -*-
"""Apontamentos Contábeis com IA -- Zera Contabilidade.

O contador escreve, no momento em que encontra, cada erro ou divergência da
empresa que está lançando. A IA reescreve o texto em linguagem formal (sem
inventar fato nenhum) e o documento de apontamentos vai se montando na tela.
No fim, o documento sai em DOCX e PDF com a identidade visual do escritório.

Histórico de versões
1.0  primeira versão: documentos por empresa e competência, formalização
     pela IA com conferência de números, prévia ao vivo, DOCX e PDF.
1.1  campo Workspace ID nas Configurações (chave de organização sem
     workspace) e mensagem clara quando a API pede o workspace.
2.0  roda também no iPhone, iPad e em qualquer navegador (aplicativo em
     docs/, publicado pelo GitHub Pages, dados guardados no aparelho, PDF e
     Word gerados no próprio navegador); painel com indicadores; ditado por
     voz; trazer apontamentos de outro mês; compartilhar o PDF e mensagem
     pronta para o cliente (WhatsApp/e-mail); backup para levar os
     documentos entre aparelhos; tela adaptada ao celular.
"""

__version__ = "2.0"
