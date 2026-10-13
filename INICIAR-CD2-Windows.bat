@echo off
chcp 65001 >nul
title CD2 Harness
set "FLAG="
if /I "%~1"=="--banco" set "FLAG=-Banco"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0core\start-windows.ps1" %FLAG%
if errorlevel 1 pause
