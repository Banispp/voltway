@echo off
title VoltWay 2W - EV Route Planner Server
cd /d "%~dp0"
cls
echo =======================================================
echo        VoltWay 2W - EV Route Planner Server
echo =======================================================
echo.
echo 1. Laptop Browser:  http://localhost:8080
echo 2. Mobile (Same Wi-Fi): http://192.168.31.230:8080
echo.
echo Starting Server & Cloudflare Tunnel for Mobile PWA...
echo.

start "VoltWay Cloudflare Tunnel" "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:8080
start http://localhost:8080

python serve.py
pause
