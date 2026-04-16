# ============================================================
# 公网 PowerShell Agent Client v2.0
# 道生一 · 一命接万机 — 任意公网电脑，一条命令，全权掌控
#
# 用法1 (公网一键·推荐): irm https://aiotvr.xyz/ps-agent/bootstrap.ps1 | iex
# 用法2 (默认云端):     .\ps_agent_client.ps1
# 用法3 (指定服务器):   .\ps_agent_client.ps1 -Server http://192.168.31.141:9910
# 用法4 (本地调试):     .\ps_agent_client.ps1 -Server http://localhost:9910
#
# 可用环境变量覆盖:
#   $env:PS_AGENT_SERVER = 'http://x.x.x.x:9910'    # 优先级高于 -Server 默认
#
# 支持的命令类型:
#   shell          执行任意PowerShell命令
#   screenshot     截取屏幕
#   sysinfo        系统详细信息
#   process_list   进程列表
#   process_kill   结束进程
#   file_list      目录列表
#   file_read      读取/下载文件
#   file_write     写入/上传文件
#   registry_read  读注册表
#   service_list   服务列表
#   network_info   网络详情
#   env_vars       环境变量
#   installed_apps 已装软件
#   scheduled_tasks 计划任务
#   clipboard      剪贴板内容
#   audio_devices  音频设备
#   display_info   显示器信息
#   wifi_profiles  WiFi配置
#   firewall_rules 防火墙规则
#   power_plan     电源计划
# ============================================================

param(
    [string]$Server = $(if ($env:PS_AGENT_SERVER) { $env:PS_AGENT_SERVER } else { 'https://aiotvr.xyz/ps-agent' }),
    [int]$PollTimeout = 30,
    [switch]$Verbose
)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

$POLL_URL      = "$Server/api/poll"
$CONNECT_URL   = "$Server/api/connect"
$RESULT_URL    = "$Server/api/result"
$HEARTBEAT_URL = "$Server/api/heartbeat"

# ═══════════════════════════════════════════════════════════
# 系统信息收集
# ═══════════════════════════════════════════════════════════

function Get-AgentSysInfo {
    $os  = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
    $cpu = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1
    $gpu = Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | Select-Object -First 1
    $net = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
           Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254)' } |
           Select-Object -First 1
    $pub_ip = 'unknown'; try { $pub_ip = (Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 5) } catch { }
    $uptime_h = -1; try { $uptime_h = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1) } catch { }
    $dotnet_ver = ''; try { $dotnet_ver = [System.Runtime.InteropServices.RuntimeInformation]::FrameworkDescription } catch { $dotnet_ver = 'N/A' }

    @{
        hostname      = $env:COMPUTERNAME
        username      = $env:USERNAME
        domain        = $env:USERDOMAIN
        local_ip      = $net.IPAddress
        public_ip     = $pub_ip
        os_version    = "$($os.Caption) $($os.Version)"
        os_arch       = $env:PROCESSOR_ARCHITECTURE
        cpu_name      = $cpu.Name
        cpu_cores     = $cpu.NumberOfCores
        cpu_threads   = $cpu.NumberOfLogicalProcessors
        gpu_name      = $gpu.Name
        ram_total_gb  = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
        ram_free_gb   = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
        disk_info     = (Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue | ForEach-Object {
            "$($_.Name): $([math]::Round($_.Used/1GB,1))/$([math]::Round(($_.Used+$_.Free)/1GB,1))GB"
        }) -join ' | '
        ps_version    = $PSVersionTable.PSVersion.ToString()
        dotnet_version = $dotnet_ver
        uptime_hours  = $uptime_h
        agent_version = '2.0'
        agent_pid     = $PID
    }
}

# ═══════════════════════════════════════════════════════════
# 安全的JSON发送 (处理大payload)
# ═══════════════════════════════════════════════════════════

function Send-JsonSafe {
    param([string]$Url, [hashtable]$Body, [int]$TimeoutSec = 30)
    $json = $Body | ConvertTo-Json -Depth 10 -Compress
    if ($json.Length -gt 8MB) {
        # Truncate output to prevent OOM
        if ($Body.result -and $Body.result.stdout) {
            $Body.result.stdout = $Body.result.stdout.Substring(0, [Math]::Min($Body.result.stdout.Length, 500000)) + "`n... [TRUNCATED, total $($json.Length) bytes]"
        }
        if ($Body.result -and $Body.result.screenshot_base64 -and $Body.result.screenshot_base64.Length -gt 6MB) {
            # Re-capture at lower quality
            $Body.result.error = "Screenshot too large ($([math]::Round($json.Length/1MB,1))MB), try lower resolution"
            $Body.result.Remove('screenshot_base64')
        }
        $json = $Body | ConvertTo-Json -Depth 10 -Compress
    }
    Invoke-RestMethod -Uri $Url -Method POST -Body $json -ContentType 'application/json; charset=utf-8' -TimeoutSec $TimeoutSec
}

# ═══════════════════════════════════════════════════════════
# 命令执行器 (全功能)
# ═══════════════════════════════════════════════════════════

function Invoke-AgentCommand($cmd) {
    $type = $cmd.type
    $payload = $cmd.payload
    $result = @{}

    switch ($type) {
        'shell' {
            $command = $payload.command
            Write-Host "  [>] shell: $command" -ForegroundColor DarkCyan
            try {
                # In-process execution via PowerShell API (no child process spawn)
                # Avoids hangs in ScheduledTask/S4U/non-interactive contexts
                $ps = [PowerShell]::Create()
                $ps.AddScript($command) | Out-Null
                $handle = $ps.BeginInvoke()
                if ($handle.AsyncWaitHandle.WaitOne(300000)) {
                    $output = $ps.EndInvoke($handle)
                    $stdout = ($output | Out-String -Width 4096)
                    $stderr = ($ps.Streams.Error | ForEach-Object { $_.ToString() }) -join "`n"
                    $result = @{
                        stdout    = if ($stdout) { $stdout.Substring(0, [Math]::Min($stdout.Length, 1048576)) } else { '' }
                        stderr    = if ($stderr) { $stderr.Substring(0, [Math]::Min($stderr.Length, 262144)) } else { '' }
                        exit_code = if ($ps.HadErrors) { 1 } else { 0 }
                    }
                } else {
                    $ps.Stop()
                    $result = @{ error = 'Command timed out (300s)'; exit_code = -1; stdout = '' }
                }
                $ps.Dispose()
            } catch {
                $result = @{ error = $_.Exception.Message; exit_code = -1 }
            }
        }

        'screenshot' {
            Write-Host "  [>] screenshot" -ForegroundColor DarkCyan
            try {
                Add-Type -AssemblyName System.Windows.Forms
                Add-Type -AssemblyName System.Drawing
                $scale = if ($payload.scale) { [int]$payload.scale } else { 50 }
                $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
                $bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
                $g = [System.Drawing.Graphics]::FromImage($bmp)
                $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)

                # Scale down to reduce size
                $newW = [int]($bounds.Width * $scale / 100)
                $newH = [int]($bounds.Height * $scale / 100)
                $scaled = New-Object System.Drawing.Bitmap($newW, $newH)
                $g2 = [System.Drawing.Graphics]::FromImage($scaled)
                $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $g2.DrawImage($bmp, 0, 0, $newW, $newH)

                $ms = New-Object System.IO.MemoryStream
                # Use JPEG for smaller size
                $jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
                $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
                $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 60L)
                $scaled.Save($ms, $jpegCodec, $encoderParams)

                $b64 = [Convert]::ToBase64String($ms.ToArray())
                $g.Dispose(); $g2.Dispose(); $bmp.Dispose(); $scaled.Dispose(); $ms.Dispose()
                $result = @{
                    screenshot_base64 = $b64
                    width = $newW; height = $newH
                    original_width = $bounds.Width; original_height = $bounds.Height
                    scale = $scale; format = 'jpeg'
                    size_kb = [math]::Round($b64.Length / 1024, 1)
                }
            } catch {
                $result = @{ error = $_.Exception.Message }
            }
        }

        'sysinfo' {
            Write-Host "  [>] sysinfo" -ForegroundColor DarkCyan
            $result = Get-AgentSysInfo
            $result['processes_count'] = (Get-Process).Count
            $result['top_cpu'] = @(Get-Process | Sort-Object CPU -Descending | Select-Object -First 10 |
                ForEach-Object { @{ name=$_.ProcessName; pid=$_.Id; cpu_sec=[math]::Round($_.CPU,1); mem_mb=[math]::Round($_.WorkingSet64/1MB,1) } })
            $result['top_mem'] = @(Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 10 |
                ForEach-Object { @{ name=$_.ProcessName; pid=$_.Id; mem_mb=[math]::Round($_.WorkingSet64/1MB,1) } })
            $result['network_adapters'] = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up' |
                ForEach-Object { @{ name=$_.Name; speed=$_.LinkSpeed; mac=$_.MacAddress } })
            $result['listening_ports'] = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
                Sort-Object LocalPort | Select-Object -First 50 |
                ForEach-Object { @{ port=$_.LocalPort; pid=$_.OwningProcess; process=(Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName } })
        }

        'process_list' {
            Write-Host "  [>] process_list" -ForegroundColor DarkCyan
            $result = @{
                processes = @(Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 100 |
                    ForEach-Object { @{
                        name=$_.ProcessName; pid=$_.Id
                        mem_mb=[math]::Round($_.WorkingSet64/1MB,1)
                        cpu_sec=[math]::Round($_.CPU,1)
                        window=$_.MainWindowTitle
                        path=$_.Path
                    }})
            }
        }

        'process_kill' {
            $pid_to_kill = $payload.pid
            $name_to_kill = $payload.name
            Write-Host "  [>] process_kill: pid=$pid_to_kill name=$name_to_kill" -ForegroundColor DarkYellow
            try {
                if ($pid_to_kill) { Stop-Process -Id $pid_to_kill -Force; $result = @{ killed_pid = $pid_to_kill; ok = $true } }
                elseif ($name_to_kill) { Stop-Process -Name $name_to_kill -Force; $result = @{ killed_name = $name_to_kill; ok = $true } }
                else { $result = @{ error = 'pid or name required' } }
            } catch { $result = @{ error = $_.Exception.Message } }
        }

        'file_list' {
            $dir = $payload.path
            if (-not $dir) { $dir = 'C:\' }
            Write-Host "  [>] file_list: $dir" -ForegroundColor DarkCyan
            try {
                $items = @(Get-ChildItem -Path $dir -ErrorAction Stop | Select-Object -First 500 |
                    ForEach-Object { @{
                        name=$_.Name; size=$_.Length; is_dir=$_.PSIsContainer
                        modified=$_.LastWriteTime.ToString('s')
                        ext=$_.Extension
                    }})
                $result = @{ path = $dir; items = $items; count = $items.Count }
            } catch { $result = @{ error = $_.Exception.Message } }
        }

        'file_read' {
            $path = $payload.path
            Write-Host "  [>] file_read: $path" -ForegroundColor DarkCyan
            try {
                $fi = Get-Item $path -ErrorAction Stop
                if ($fi.Length -gt 5MB) {
                    $result = @{ error = "File too large: $([math]::Round($fi.Length/1MB,1))MB (max 5MB)"; size = $fi.Length }
                } else {
                    $bytes = [IO.File]::ReadAllBytes($path)
                    $result = @{
                        path = $path
                        size = $bytes.Length
                        content_base64 = [Convert]::ToBase64String($bytes)
                    }
                }
            } catch { $result = @{ error = $_.Exception.Message } }
        }

        'file_write' {
            $path = $payload.path
            Write-Host "  [>] file_write: $path" -ForegroundColor DarkYellow
            try {
                $dir = Split-Path $path -Parent
                if (-not (Test-Path $dir)) { New-Item -Path $dir -ItemType Directory -Force | Out-Null }
                $bytes = [Convert]::FromBase64String($payload.content_base64)
                [IO.File]::WriteAllBytes($path, $bytes)
                $result = @{ path = $path; written_bytes = $bytes.Length; ok = $true }
            } catch { $result = @{ error = $_.Exception.Message } }
        }

        'registry_read' {
            $key = $payload.path
            Write-Host "  [>] registry_read: $key" -ForegroundColor DarkCyan
            try {
                $item = Get-ItemProperty -Path $key -ErrorAction Stop
                $props = @{}
                $item.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } |
                    ForEach-Object { $props[$_.Name] = $_.Value.ToString() }
                $result = @{ path = $key; properties = $props }
            } catch { $result = @{ error = $_.Exception.Message } }
        }

        'service_list' {
            Write-Host "  [>] service_list" -ForegroundColor DarkCyan
            $filter = $payload.filter
            $svcs = Get-Service
            if ($filter) { $svcs = $svcs | Where-Object { $_.Name -like "*$filter*" -or $_.DisplayName -like "*$filter*" } }
            $result = @{
                services = @($svcs | Select-Object -First 200 |
                    ForEach-Object { @{
                        name=$_.Name; display=$_.DisplayName
                        status=$_.Status.ToString()
                        start_type=$_.StartType.ToString()
                    }})
            }
        }

        'network_info' {
            Write-Host "  [>] network_info" -ForegroundColor DarkCyan
            $result = @{
                adapters = @(Get-NetAdapter -ErrorAction SilentlyContinue |
                    ForEach-Object { @{ name=$_.Name; status=$_.Status.ToString(); speed=$_.LinkSpeed; mac=$_.MacAddress } })
                ip_config = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                    ForEach-Object { @{ ip=$_.IPAddress; prefix=$_.PrefixLength; iface=$_.InterfaceAlias } })
                dns = @(Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                    ForEach-Object { @{ iface=$_.InterfaceAlias; dns=$_.ServerAddresses } })
                connections_count = (Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | Measure-Object).Count
                routes = @(Get-NetRoute -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                    Where-Object { $_.DestinationPrefix -ne '0.0.0.0/0' } | Select-Object -First 20 |
                    ForEach-Object { @{ dest=$_.DestinationPrefix; next=$_.NextHop; iface=$_.InterfaceAlias } })
            }
        }

        'env_vars' {
            Write-Host "  [>] env_vars" -ForegroundColor DarkCyan
            $filter = $payload.filter
            $all = [Environment]::GetEnvironmentVariables()
            $vars = @{}
            $all.GetEnumerator() | ForEach-Object {
                if (-not $filter -or $_.Key -like "*$filter*") { $vars[$_.Key] = $_.Value }
            }
            $result = @{ variables = $vars; count = $vars.Count }
        }

        'installed_apps' {
            Write-Host "  [>] installed_apps" -ForegroundColor DarkCyan
            $result = @{
                apps = @(
                    Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
                                     "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
                    Where-Object { $_.DisplayName } |
                    Sort-Object DisplayName |
                    ForEach-Object { @{
                        name=$_.DisplayName
                        version=$_.DisplayVersion
                        publisher=$_.Publisher
                        size_mb=if($_.EstimatedSize){[math]::Round($_.EstimatedSize/1024,1)}else{$null}
                    }})
            }
        }

        'scheduled_tasks' {
            Write-Host "  [>] scheduled_tasks" -ForegroundColor DarkCyan
            $result = @{
                tasks = @(Get-ScheduledTask -ErrorAction SilentlyContinue |
                    Where-Object { $_.State -ne 'Disabled' } | Select-Object -First 100 |
                    ForEach-Object { @{
                        name=$_.TaskName; path=$_.TaskPath
                        state=$_.State.ToString()
                        description=$_.Description
                    }})
            }
        }

        'clipboard' {
            Write-Host "  [>] clipboard" -ForegroundColor DarkCyan
            try {
                Add-Type -AssemblyName System.Windows.Forms
                $text = [System.Windows.Forms.Clipboard]::GetText()
                $result = @{ text = if($text){$text.Substring(0,[Math]::Min($text.Length,100000))}else{'[empty]'}; length = $text.Length }
            } catch { $result = @{ error = $_.Exception.Message } }
        }

        'display_info' {
            Write-Host "  [>] display_info" -ForegroundColor DarkCyan
            try {
                Add-Type -AssemblyName System.Windows.Forms
                $result = @{
                    screens = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
                        @{ name=$_.DeviceName; primary=$_.Primary; width=$_.Bounds.Width; height=$_.Bounds.Height; bpp=$_.BitsPerPixel }
                    })
                    dpi = & { try { (Get-ItemProperty 'HKCU:\Control Panel\Desktop\WindowMetrics' -ErrorAction Stop).AppliedDPI } catch { 96 } }
                }
            } catch { $result = @{ error = $_.Exception.Message } }
        }

        'wifi_profiles' {
            Write-Host "  [>] wifi_profiles" -ForegroundColor DarkCyan
            try {
                $profiles = netsh wlan show profiles 2>&1 | Select-String '所有用户配置文件|All User Profile' |
                    ForEach-Object { ($_ -split ':')[1].Trim() }
                $details = @()
                foreach ($p in $profiles | Select-Object -First 30) {
                    $info = netsh wlan show profile name="$p" key=clear 2>&1
                    $key = ($info | Select-String '关键内容|Key Content' | ForEach-Object { ($_ -split ':')[1].Trim() })
                    $auth = ($info | Select-String '身份验证|Authentication' | Select-Object -First 1 | ForEach-Object { ($_ -split ':')[1].Trim() })
                    $details += @{ name=$p; password=$key; auth=$auth }
                }
                $result = @{ profiles = $details; count = $details.Count }
            } catch { $result = @{ error = $_.Exception.Message } }
        }

        'firewall_rules' {
            Write-Host "  [>] firewall_rules" -ForegroundColor DarkCyan
            $result = @{
                rules = @(Get-NetFirewallRule -Enabled True -ErrorAction SilentlyContinue |
                    Where-Object { $_.Direction -eq 'Inbound' } | Select-Object -First 50 |
                    ForEach-Object { @{
                        name=$_.DisplayName; action=$_.Action.ToString()
                        profile=$_.Profile.ToString(); direction=$_.Direction.ToString()
                    }})
            }
        }

        'power_plan' {
            Write-Host "  [>] power_plan" -ForegroundColor DarkCyan
            try {
                $plan = powercfg /getactivescheme 2>&1
                $result = @{ active_plan = $plan.ToString().Trim() }
            } catch { $result = @{ error = $_.Exception.Message } }
        }

        'startup_items' {
            Write-Host "  [>] startup_items" -ForegroundColor DarkCyan
            $result = @{
                registry = @(
                    Get-ItemProperty 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue |
                    ForEach-Object { $_.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } |
                        ForEach-Object { @{ name=$_.Name; command=$_.Value; scope='CurrentUser' } } }
                ) + @(
                    Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue |
                    ForEach-Object { $_.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } |
                        ForEach-Object { @{ name=$_.Name; command=$_.Value; scope='LocalMachine' } } }
                )
                startup_folder = @(Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup" -ErrorAction SilentlyContinue |
                    ForEach-Object { @{ name=$_.Name; path=$_.FullName } })
            }
        }

        'share_list' {
            Write-Host "  [>] share_list" -ForegroundColor DarkCyan
            $result = @{
                shares = @(Get-SmbShare -ErrorAction SilentlyContinue |
                    ForEach-Object { @{ name=$_.Name; path=$_.Path; description=$_.Description } })
            }
        }

        default {
            $result = @{ error = "Unknown command type: $type"; supported_types = @(
                'shell','screenshot','sysinfo','process_list','process_kill',
                'file_list','file_read','file_write','registry_read','service_list',
                'network_info','env_vars','installed_apps','scheduled_tasks',
                'clipboard','display_info','wifi_profiles','firewall_rules',
                'power_plan','startup_items','share_list'
            )}
        }
    }
    return $result
}

# ═══════════════════════════════════════════════════════════
# 主程序
# ═══════════════════════════════════════════════════════════

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║  ☰ 公网 PowerShell Agent v1.0               ║" -ForegroundColor Cyan
Write-Host "  ║  道生一 · 一命接万机                          ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# 收集系统信息
Write-Host "[*] 收集系统信息..." -ForegroundColor Gray
$sysinfo = Get-AgentSysInfo
Write-Host "[*] 主机: $($sysinfo.hostname) | IP: $($sysinfo.public_ip) | OS: $($sysinfo.os_version)" -ForegroundColor Gray
Write-Host "[*] CPU: $($sysinfo.cpu_name) | RAM: $($sysinfo.ram_total_gb)GB | GPU: $($sysinfo.gpu_name)" -ForegroundColor Gray

# 连接服务器
Write-Host "[*] 连接服务器: $Server" -ForegroundColor Yellow
try {
    $regBody = @{ sysinfo = $sysinfo } | ConvertTo-Json -Depth 5
    $reg = Invoke-RestMethod -Uri $CONNECT_URL -Method POST -Body $regBody -ContentType 'application/json; charset=utf-8' -TimeoutSec 15
} catch {
    Write-Host "[!] 连接失败: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "[!] 请确认服务器地址正确: $Server" -ForegroundColor Red
    Write-Host "[!] 如果是公网模式，请确认 FRP 隧道已开启" -ForegroundColor Red
    return
}

$AGENT_ID = $reg.agent_id
$TOKEN    = $reg.token
Write-Host "[+] 注册成功!" -ForegroundColor Green
Write-Host "[+] Agent ID: $AGENT_ID" -ForegroundColor Green
Write-Host "[+] 服务器时间: $($reg.server_time)" -ForegroundColor Gray
Write-Host "[+] 等待命令中... (Ctrl+C 退出)" -ForegroundColor Green
Write-Host ""

# 心跳后台任务
$heartbeatTimer = New-Object System.Timers.Timer
$heartbeatTimer.Interval = 30000  # 30秒
$heartbeatTimer.AutoReset = $true
$heartbeatAction = {
    try {
        $body = @{ agent_id = $script:AGENT_ID; token = $script:TOKEN } | ConvertTo-Json
        Invoke-RestMethod -Uri $script:HEARTBEAT_URL -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 10 | Out-Null
    } catch { }
}
Register-ObjectEvent -InputObject $heartbeatTimer -EventName Elapsed -Action $heartbeatAction | Out-Null
$heartbeatTimer.Start()

# 自动重注册 (服务器重启时token失效)
function Invoke-ReRegister {
    Write-Host "[*] 服务器token失效，重新注册..." -ForegroundColor Yellow
    $script:sysinfo = Get-AgentSysInfo
    try {
        $regBody = @{ sysinfo = $script:sysinfo } | ConvertTo-Json -Depth 5
        $reg = Invoke-RestMethod -Uri $CONNECT_URL -Method POST -Body $regBody -ContentType 'application/json; charset=utf-8' -TimeoutSec 15
        $script:AGENT_ID = $reg.agent_id
        $script:TOKEN    = $reg.token
        Write-Host "[+] 重新注册成功! Agent ID: $($script:AGENT_ID)" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "[!] 重新注册失败: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# 主循环: 长轮询
$reconnect_count = 0
$total_commands = 0

try {
    while ($true) {
        try {
            $pollUri = $POLL_URL + '?id=' + $AGENT_ID + '&token=' + $TOKEN + '&timeout=' + $PollTimeout
            $poll = Invoke-RestMethod -Uri $pollUri -TimeoutSec ($PollTimeout + 5)
            $reconnect_count = 0

            if ($poll.commands -and $poll.commands.Count -gt 0) {
                foreach ($cmd in $poll.commands) {
                    $total_commands++
                    $ts = Get-Date -Format 'HH:mm:ss'
                    Write-Host "[$ts] #$total_commands 收到命令: $($cmd.type) ($($cmd.cmd_id))" -ForegroundColor Cyan

                    $sw = [System.Diagnostics.Stopwatch]::StartNew()
                    $result = Invoke-AgentCommand $cmd
                    $sw.Stop()

                    $result['execution_time_ms'] = $sw.ElapsedMilliseconds

                    # 提交结果
                    try {
                        $resultBody = @{
                            agent_id = $AGENT_ID
                            token    = $TOKEN
                            cmd_id   = $cmd.cmd_id
                            result   = $result
                        }
                        Send-JsonSafe -Url $RESULT_URL -Body $resultBody -TimeoutSec 30
                        Write-Host "  [+] 结果已提交 (${($sw.ElapsedMilliseconds)}ms)" -ForegroundColor Green
                    } catch {
                        Write-Host "  [!] 提交失败: $($_.Exception.Message)" -ForegroundColor Red
                    }
                }
            }
        } catch [System.Net.WebException] {
            # Timeout is normal for long-polling
            if ($_.Exception.Status -eq 'Timeout') { continue }
            # 401 = token expired (server restarted) → re-register
            $resp = $_.Exception.Response
            if ($resp -and [int]$resp.StatusCode -eq 401) {
                if (Invoke-ReRegister) { $reconnect_count = 0; continue }
            }
            $reconnect_count++
            $wait = [Math]::Min($reconnect_count * 5, 60)
            Write-Host "[!] 连接断开 ($($_.Exception.Message))，${wait}秒后重连 (#$reconnect_count)..." -ForegroundColor Yellow
            Start-Sleep -Seconds $wait
        } catch {
            # 检查是否为401 (不同PS版本异常类型不同)
            if ($_.Exception.Message -match '401|Unauthorized') {
                if (Invoke-ReRegister) { $reconnect_count = 0; continue }
            }
            $reconnect_count++
            $wait = [Math]::Min($reconnect_count * 5, 60)
            Write-Host "[!] 错误: $($_.Exception.Message)，${wait}秒后重连 (#$reconnect_count)..." -ForegroundColor Yellow
            Start-Sleep -Seconds $wait
        }
    }
} finally {
    $heartbeatTimer.Stop()
    $heartbeatTimer.Dispose()
    Get-EventSubscriber | Unregister-Event -ErrorAction SilentlyContinue
    Write-Host "`n[*] Agent 已退出 (共执行 $total_commands 条命令)" -ForegroundColor Yellow
}
