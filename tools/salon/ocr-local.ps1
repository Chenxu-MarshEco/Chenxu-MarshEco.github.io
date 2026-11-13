# Windows 自带 OCR（Windows.Media.Ocr）试跑：给一张图，吐出识别到的文字。
# 用法（必须用 Windows PowerShell 5.1，pwsh 7 跑不了 WinRT）：
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\salon\ocr-local.ps1 -Path <图片>
param([Parameter(Mandatory = $true)][string]$Path)

$ErrorActionPreference = 'Stop'
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
} catch { }

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and
    $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]

function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null

$full = (Resolve-Path $Path).Path
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($full)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

# 选引擎：**先点中文**，再退到用户语言，最后随便挑一个。
# ⚠ 别用 TryCreateFromUserProfileLanguages 一把梭（2026-11-13 踩到）：
#   这台机器用户语言是 en-US + ja，它就只给了 en-US，中文全被认成乱码。
$engine = $null
foreach ($tag in @('zh-Hans-CN', 'zh-CN', 'zh-Hans')) {
  try {
    $lang = [Windows.Globalization.Language]::new($tag)
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
  } catch { $engine = $null }
  if ($engine) { break }
}
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if (-not $engine) {
  $langs = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages
  Write-Host ("可用 OCR 语言：" + (($langs | ForEach-Object { $_.LanguageTag }) -join ', '))
  foreach ($l in $langs) {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($l)
    if ($engine) { break }
  }
}
if (-not $engine) { Write-Host 'NO_OCR_ENGINE'; exit 2 }

$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
Write-Host ("LANG=" + $engine.RecognizerLanguage.LanguageTag)
Write-Host ("LINES=" + $result.Lines.Count)
foreach ($line in $result.Lines) { Write-Host $line.Text }
