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

# 先试用户语言，再逐个试所有可用语言（中文包不一定在）
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
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
