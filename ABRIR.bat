@echo off
chcp 65001 >nul
title Apontamentos Contabeis
cd /d "%~dp0"
set PY=
where py >nul 2>nul && set PY=py -3
if not defined PY (where python >nul 2>nul && set PY=python)
if not defined PY (
  echo Python nao encontrado. Rode INSTALAR_E_ABRIR.bat primeiro.
  pause
  exit /b 1
)
%PY% executar.py
if errorlevel 1 pause
