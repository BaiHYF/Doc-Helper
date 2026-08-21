param(
  [Parameter(Mandatory = $true)][string]$inputDir,
  [Parameter(Mandatory = $true)][string]$output
)

$oc = $env:OFFICECLI
if (-not $oc -or -not (Test-Path $oc)) {
  Write-Error "OFFICECLI 环境变量未设置或路径不存在: $oc"
  exit 1
}

# 统一 stdout 为 UTF-8，避免中文结果在管道传输时按系统代码页编码而乱码
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Invoke-OC {
  param([string[]]$Arguments)
  & $oc @Arguments 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "officecli 命令失败: $($Arguments -join ' ')"
  }
}

function Get-OCJson {
  param([string[]]$Arguments)
  $raw = & $oc @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "officecli 命令失败: $($Arguments -join ' ')"
  }
  $text = ($raw | Out-String).Trim()
  $start = $text.IndexOf('{')
  $end = $text.LastIndexOf('}')
  if ($start -lt 0 -or $end -lt 0) {
    throw "无法解析 officecli 输出: $($Arguments -join ' ')"
  }
  return ($text.Substring($start, $end - $start + 1) | ConvertFrom-Json)
}

function Get-SheetName {
  param([string]$fileName)
  $base = [System.IO.Path]::GetFileNameWithoutExtension($fileName)
  $base = $base -replace '[\\/?*\[\]:]', '_'
  if ($base.Length -gt 31) { $base = $base.Substring(0, 31) }
  if ([string]::IsNullOrWhiteSpace($base)) { $base = 'Sheet' }
  return $base
}

# 1. 收集源文件
$sources = @(Get-ChildItem -Path $inputDir -Filter *.xlsx -File | Sort-Object Name)
if ($sources.Count -eq 0) {
  Write-Error "inputDir 中没有 xlsx 文件: $inputDir"
  exit 1
}

# 2. 创建目标工作簿
if (Test-Path $output) { Remove-Item $output -Force }
Invoke-OC @('create', $output)

$createdSheets = @()
$index = 0

foreach ($src in $sources) {
  $sheetName = Get-SheetName $src.Name

  # 读取源文件第一个 sheet 的单元格
  $doc = Get-OCJson @('get', $src.FullName, '/', '--json')
  $firstSheet = @($doc.data.results[0].children | Where-Object { $_.type -eq 'sheet' })[0]
  if (-not $firstSheet) {
    throw "源文件没有工作表: $($src.Name)"
  }

  $batch = New-Object System.Collections.Generic.List[object]
  if ($index -eq 0) {
    # 首个 sheet 复用 create 生成的默认 sheet
    $batch.Add(@{ command = 'set'; path = '/sheet[1]'; props = @{ name = $sheetName } })
  }
  else {
    $batch.Add(@{ command = 'add'; parent = '/'; type = 'sheet'; props = @{ name = $sheetName } })
  }

  foreach ($row in $firstSheet.children) {
    foreach ($cell in $row.children) {
      $text = "$($cell.text)"
      if ([string]::IsNullOrEmpty($text)) { continue }
      $ref = [System.IO.Path]::GetFileName($cell.path)
      $props = @{ ref = $ref; value = $text }
      $cellType = ''
      if ($cell.format -and $cell.format.type) {
        switch ($cell.format.type) {
          'String'  { $cellType = 'string' }
          'Number'  { $cellType = 'number' }
          'Boolean' { $cellType = 'boolean' }
        }
      }
      if ($cellType) { $props.type = $cellType }
      $batch.Add(@{ command = 'add'; parent = "/$sheetName"; type = 'cell'; props = $props })
    }
  }

  if ($batch.Count -gt 1) {
    $batchJson = $batch | ConvertTo-Json -Depth 6
    $tmp = Join-Path $env:TEMP ("dh-batch-" + [guid]::NewGuid().ToString('N') + ".json")
    [System.IO.File]::WriteAllText($tmp, $batchJson, (New-Object System.Text.UTF8Encoding($false)))
    try {
      Invoke-OC @('batch', $output, '--input', $tmp)
    }
    finally {
      Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }
  }

  $createdSheets += $sheetName
  $index++
}

# 3. 落盘并释放文件
Invoke-OC @('save', $output)
Invoke-OC @('close', $output)

# 4. 输出结果 JSON
$result = @{
  ok          = $true
  summary     = "已合并 $($sources.Count) 个文件"
  outputFiles = @($output)
  sheets      = $createdSheets
} | ConvertTo-Json -Compress
Write-Output $result
