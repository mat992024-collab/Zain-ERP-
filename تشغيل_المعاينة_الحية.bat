@echo off
chcp 65001 >nul
title Zain ERP - Live Preview Server
cd /d "%~dp0"
echo ====================================================
echo   Zain ERP - خادم المعاينة الحية والتحديث اللحظي
echo ====================================================
echo.
echo  الرابط المحلي على هذا الجهاز:
echo    http://127.0.0.1:4782
echo.
echo  الرابط عبر الشبكة المحلية (للموبايل أو أي جهاز آخر):
echo    http://192.168.1.2:4782
echo.
echo  جاري فتح المتصفح تلقائياً...
start http://127.0.0.1:4782/
echo.
echo  الخادم يعمل بوضع المراقبة الحية.
echo  أي تعديل تقوم بحفظه ينعكس مباشرة فور تحديث الصفحة (F5).
echo.
if exist "node.exe" (
  node.exe --watch src/server/index.js
) else if exist "installer\node.exe" (
  installer\node.exe --watch src/server/index.js
) else (
  node --watch src/server/index.js
)
pause
