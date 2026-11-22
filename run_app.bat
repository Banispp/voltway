@echo off
title VoltWay 2W - EV Route Planner
cd /d "%~dp0"
echo =======================================================
echo   VoltWay 2W - EV Route Planner Server
echo =======================================================
echo.
echo Starting local preview server...
echo.
echo PC Browser:    http://localhost:8080
echo Mobile Phone:  http://192.168.31.230:8080
echo.
echo Opening browser now...
start http://localhost:8080
echo.
python serve.py
pause
