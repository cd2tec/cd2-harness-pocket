@echo off
chcp 65001 >nul
title CD2 IA de Bolso
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0core\start-windows.ps1"
if errorlevel 1 pause
