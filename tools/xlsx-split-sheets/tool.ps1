param(
    [Parameter(Mandatory = $true)]
    [string]$inputFile,
    [string]$outputDir
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'

function Write-ProgressLine {
    param([string]$msg)
    Write-Output ('{"progress":"' + $msg + '"}')
}

function Get-OfficCli {
    return $env:OFFICECLI
}

# ---------- 校验 ----------
if (-not $inputFile) {
    Write-Error "缺少必须参数 inputFile（待拆分的 xlsx 文件路径）"
    exit 1
}
if (-not (Test-Path -LiteralPath $inputFile)) {
    Write-Error "输入文件不存在: $inputFile"
    exit 1
}
$ext = [System.IO.Path]::GetExtension($inputFile).ToLowerInvariant()
if ($ext -ne '.xlsx') {
    Write-Error "仅支持 .xlsx 格式，当前文件为 $ext"
    exit 1
}

$officeCli = Get-OfficCli
if (-not $officeCli -or -not (Test-Path -LiteralPath $officeCli)) {
    Write-Error "未获取到 OFFICECLI 环境变量指向的 officecli.exe"
    exit 1
}

# 确定输出目录
if (-not $outputDir) {
    $outputDir = [System.IO.Path]::GetDirectoryName((Resolve-Path -LiteralPath $inputFile).Path)
}
if (-not (Test-Path -LiteralPath $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

$inputFull = (Resolve-Path -LiteralPath $inputFile).Path

# ---------- 读取工作簿结构 ----------
Write-ProgressLine "正在读取工作簿结构"
$json = & $officeCli get $inputFull / --json 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Error "officecli 读取工作簿失败"
    exit 1
}

$data = $json | ConvertFrom-Json
$workbook = $data.data.results
if (-not $workbook) {
    Write-Error "未能解析工作簿"
    exit 1
}

# 收集所有 sheet
$sheets = @()
foreach ($sheetNode in $workbook.children) {
    $name = $sheetNode.preview
    if ($name) {
        $sheets += $name
    }
}

if ($sheets.Count -eq 0) {
    Write-Error "工作簿中没有可拆分的工作表"
    exit 1
}

# 收集所有行数据（每个 sheet 一个二维数组）
$allSheetData = [ordered]@{}
$index = 0
foreach ($sheetName in $sheets) {
    Write-ProgressLine "正在读取工作表 [$sheetName] 内容"
    $sheetJson = & $officeCli get $inputFull "/sheet[$($index + 1)]" --json 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "读取工作表 [$sheetName] 失败"
        exit 1
    }
    $sheetData = $sheetJson | ConvertFrom-Json
    $sheetNode = $sheetData.data.results

    $rows = @()
    if ($sheetNode.children) {
        $rowIdx = 0
        foreach ($rowNode in $sheetNode.children) {
            $cellValues = @()
            if ($rowNode.children) {
                foreach ($cellNode in $rowNode.children) {
                    $cellValues += [string]$cellNode.text
                }
            }
            $row = [pscustomobject]@{ index = $rowIdx + 1 }
            for ($c = 0; $c -lt $cellValues.Count; $c++) {
                $row | Add-Member -NotePropertyName "c$($c+1)" -NotePropertyValue $cellValues[$c]
            }
            $rows += $row
            $rowIdx++
        }
    }
    $allSheetData[$sheetName] = $rows
    $index++
}

# ---------- 每个 sheet 生成一个文件 ----------
$outputFiles = @()
$i = 0
foreach ($sheetName in $sheets) {
    $safeName = [System.IO.Path]::GetInvalidFileNameChars() | ForEach-Object { $sheetName = $sheetName.Replace($_, '_') }
    $outPath = Join-Path $outputDir "$safeName.xlsx"
    Write-ProgressLine "正在生成文件 [$safeName.xlsx]"

    # 新建工作簿
    & $officeCli create $outPath 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "创建输出文件失败: $outPath"
        exit 1
    }

    # 重命名默认 sheet
    & $officeCli set $outPath /sheet[1] "name=$safeName" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "重命名默认工作表失败"
        exit 1
    }

    $rows = $allSheetData[$sheetName]
    $r = 1
    foreach ($rowObj in $rows) {
        $cells = @($rowObj.PSObject.Properties | Where-Object { $_.Name -like 'c*' } | Sort-Object { [int]$_.Name.Substring(1) })
        $c = 1
        foreach ($cellProp in $cells) {
            $val = [string]$cellProp.Value
            $cmd = @()
            if ($c -eq 1) {
                $cmd = @('add', $outPath, '/sheet[1]/row[$r]', 'cell',
                    ('text=' + $val), ('col=$c'))
            } else {
                $cmd = @('add', $outPath, '/sheet[1]/row[$r]', 'cell',
                    ('text=' + $val), ('col=$c'))
            }
            & $officeCli @cmd 2>$null
            if ($LASTEXITCODE -ne 0) {
                Write-Error "写入单元格失败: row=$r col=$c"
                & $officeCli close $outPath 2>$null
                exit 1
            }
            $c++
        }
        $r++
        $rowObj = $null
    }

    & $officeCli save $outPath 2>$null
    & $officeCli close $outPath 2>$null
    $outputFiles += (Resolve-Path -LiteralPath $outPath).Path
    $i++
}

$summary = "已按工作表拆分，共生成 $($outputFiles.Count) 个文件：$(($outputFiles | ForEach-Object { [System.IO.Path]::GetFileName($_) }) -join '、')"
Write-Output ("{\"ok\":true,\"outputFiles\":" + (($outputFiles | ForEach-Object { '"{0}"' -f $_ }) -join ',') + ",\"summary\":\"" + $summary + "\"}")
exit 0
