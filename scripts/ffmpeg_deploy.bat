@echo off
rem =====================================================================
rem ffmpeg.exe 自動取得バッチ
rem  0) 同じフォルダに既にffmpeg.exeがあればスキップ
rem  1) gyan.dev から ffmpeg の zip を作業用フォルダへダウンロード
rem  2) 展開（PowerShellのExpand-Archive＝Windows標準の解凍機能）
rem  3) 展開フォルダの中から ffmpeg.exe を探してbatと同じ場所に移動
rem  4) 作業用フォルダ（zipと展開結果）を削除
rem
rem ダウンロード・展開・検索は %TEMP% 配下の作業用フォルダで行います。
rem OneDrive等のクラウド同期フォルダ内で直接これらを行うと、同期エンジンが
rem 割り込み、一瞬だけ実在しないパスが見える等の不整合が起きることがあるため、
rem 同期対象外の場所で作業してから、完成したffmpeg.exeだけを最終的な
rem 置き場所（bat自身と同じフォルダ）へ移動する構成にしています。
rem =====================================================================
setlocal

rem --- 設定 ---
rem DOWNLOAD_URL: gyan.dev の「essentials」ビルド。常に最新版を指す固定URL
set "DOWNLOAD_URL=https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
rem %~dp0 = このbatファイルが置かれているフォルダのパス（末尾に \ 付き）＝最終的な配置先
set "DEST_DIR=%~dp0..\companion\"
rem WORK_DIR: ダウンロード・展開用の作業フォルダ（%TEMP%＝クラウド同期対象外の一時フォルダ）
set "WORK_DIR=%TEMP%\ffmpeg_setup_tmp"
set "ZIP_FILE=%WORK_DIR%\ffmpeg-release-essentials.zip"
set "EXTRACT_DIR=%WORK_DIR%\extracted"

echo [0/4] ffmpeg.exeの有無を確認中...
if exist "%DEST_DIR%ffmpeg.exe" (
    echo 既に「%DEST_DIR%ffmpeg.exe」が存在するため、処理をスキップします。
    goto :end
)

rem 作業フォルダを作り直す（前回の残骸があれば削除してから作成）
if exist "%WORK_DIR%" rd /s /q "%WORK_DIR%"
mkdir "%WORK_DIR%"

echo [1/4] ffmpegをダウンロード中...
rem curl: ファイルをダウンロードするコマンド。Windows10/11に標準搭載
curl -L -o "%ZIP_FILE%" "%DOWNLOAD_URL%"
if errorlevel 1 (
    rem errorlevel 1 = 直前のコマンドが失敗した場合
    echo ダウンロードに失敗しました。
    goto :error
)

echo [2/4] zipを展開中...
rem Expand-Archive: PowerShellに標準で入っているzip展開コマンド
powershell -NoProfile -Command "Expand-Archive -LiteralPath '%ZIP_FILE%' -DestinationPath '%EXTRACT_DIR%' -Force"
if errorlevel 1 (
    echo 展開に失敗しました。
    goto :error
)

echo [3/4] ffmpeg.exeを探して移動中...
rem gyan.devのzipはバージョン名入りフォルダ(例: ffmpeg-7.1-essentials_build\bin\ffmpeg.exe)なので
rem dir /s /b でEXTRACT_DIR配下を再帰的に検索してffmpeg.exeを見つける
rem （for /r はワイルドカードなしの固定ファイル名を指定すると、実在確認をせずに
rem   各フォルダ名＋指定名をそのまま返してしまうことがあるため、ここでは使わない）
set "FFMPEG_PATH="
for /f "delims=" %%F in ('dir /s /b "%EXTRACT_DIR%\ffmpeg.exe" 2^>nul') do (
    set "FFMPEG_PATH=%%F"
)

if not defined FFMPEG_PATH (
    echo ffmpeg.exeが見つかりませんでした。配布元のフォルダ構成が変わった可能性があります。
    echo 展開フォルダの中身は以下の通りです。
    dir /s /b "%EXTRACT_DIR%"
    goto :error
)

rem --- 念のための安全確認：検出したパスが実在するか ---
if not exist "%FFMPEG_PATH%" (
    echo エラー: 検出したパス "%FFMPEG_PATH%" にファイルが存在しません。展開フォルダの中身は以下の通りです。
    dir /s /b "%EXTRACT_DIR%"
    goto :error
)

move /y "%FFMPEG_PATH%" "%DEST_DIR%ffmpeg.exe" >nul
if errorlevel 1 (
    echo moveコマンドが失敗しました。エラーコード: %errorlevel%
    goto :error
)

echo [4/4] 作業用フォルダ（zipと展開結果）を削除中...
rd /s /q "%WORK_DIR%"

echo.
echo 完了しました。「%DEST_DIR%ffmpeg.exe」に配置しました。
goto :end

:error
echo 処理を中断しました。
REM pause
endlocal
exit /b 1

:end
endlocal
REM pause
