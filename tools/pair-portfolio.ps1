# Pair one TV with a hosted portfolio feed or update an existing paired build.
[CmdletBinding()]
param(
    [switch] $UpdateOnly,
    [string] $RobinhoodConnectionId,
    [string] $InstallerPath = (Join-Path $env:TEMP 'frame-apps2samsung-v3.3.0/apps2samsung-cli.exe'),
    [string] $TvAddress = $env:FRAME_TV_ADDRESS,
    [string] $LocalAddress = $env:FRAME_LOCAL_ADDRESS,
    [string] $StreamForgeUrl = $env:FRAME_STREAMFORGE_URL
)

$ErrorActionPreference = 'Stop'
$launcher = Split-Path -Parent $PSScriptRoot
$workerConfig = Join-Path $PSScriptRoot 'wrangler.toml'
$pairingDirectory = Join-Path $env:LOCALAPPDATA 'R3K5/Frame'
$pairingFile = Join-Path $pairingDirectory 'portfolio-pairing.clixml'
$localSettings = Join-Path $launcher '.local/office.json'
if (Test-Path -LiteralPath $localSettings -PathType Leaf) {
    $settings = Get-Content -LiteralPath $localSettings -Raw | ConvertFrom-Json
    if (-not $TvAddress) { $TvAddress = $settings.tvAddress }
    if (-not $LocalAddress) { $LocalAddress = $settings.localAddress }
    if (-not $StreamForgeUrl) { $StreamForgeUrl = $settings.streamForgeUrl }
}
if (-not $TvAddress -or -not $LocalAddress) {
    throw 'Supply the TV and PC LAN addresses with -TvAddress and -LocalAddress.'
}

# Convert the saved secure string for packaging and clear the native buffer.
function Read-SecretText([Security.SecureString] $Secret) {
    $buffer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secret)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($buffer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($buffer) }
}

# Deploy the Worker before prompting for the SnapTrade credentials.
function Publish-PortfolioWorker {
    Write-Host 'Checking Cloudflare and publishing the portfolio Worker…'
    $ErrorActionPreference = 'Continue'
    $PSNativeCommandUseErrorActionPreference = $false
    $deploymentOutput = (& npx.cmd --yes wrangler@4 deploy --config $workerConfig 2>&1) -join "`n"
    $deployExitCode = $LASTEXITCODE
    if ($deploymentOutput -match '\b10034\b|verify your email address') {
        throw 'Cloudflare Workers rejected deployment with error 10034. In the Cloudflare dashboard, check the address in My Profile. If the address already shows as verified, contact Cloudflare Support about the Workers verification error. Otherwise, use Send verification email.'
    }
    $workerAddress = [regex]::Match($deploymentOutput, 'https://r3k5-frame-portfolio\.[a-z0-9-]+\.workers\.dev').Value
    if (($deployExitCode -ne 0 -or -not $workerAddress) -and
        $deploymentOutput -match 'register a workers\.dev subdomain') {
        throw 'Register a workers.dev subdomain in Cloudflare Workers & Pages, then rerun this script.'
    }
    if ($deployExitCode -ne 0) {
        Write-Host $deploymentOutput
        throw 'Cloudflare deployment failed. Check the Wrangler output above before retrying.'
    }
    if (-not $workerAddress) {
        throw 'Cloudflare did not report the workers.dev URL. Enable workers.dev for the portfolio Worker.'
    }
    return "$workerAddress/portfolio"
}

# Collect both credential values in masked fields outside the terminal.
function Read-SnapTradeKeys {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [Windows.Forms.Application]::EnableVisualStyles()

    $dialog = [Windows.Forms.Form]::new()
    $dialog.Text = 'Pair Robinhood with Frame'
    $dialog.StartPosition = 'CenterScreen'
    $dialog.FormBorderStyle = 'FixedDialog'
    $dialog.ClientSize = [Drawing.Size]::new(478, 226)
    $dialog.MinimizeBox = $false
    $dialog.MaximizeBox = $false
    $dialog.AutoScaleMode = 'Dpi'
    $dialog.TopMost = $true

    $instructions = [Windows.Forms.Label]::new()
    $instructions.Text = 'Copy both values from the API Key page of your SnapTrade Personal dashboard.'
    $instructions.Location = [Drawing.Point]::new(16, 14)
    $instructions.Size = [Drawing.Size]::new(446, 36)

    $idLabel = [Windows.Forms.Label]::new()
    $idLabel.Text = 'Client ID'
    $idLabel.Location = [Drawing.Point]::new(16, 57)
    $idLabel.AutoSize = $true
    $idInput = [Windows.Forms.TextBox]::new()
    $idInput.Location = [Drawing.Point]::new(16, 78)
    $idInput.Width = 446
    $idInput.UseSystemPasswordChar = $true
    $idInput.TabIndex = 0

    $keyLabel = [Windows.Forms.Label]::new()
    $keyLabel.Text = 'Consumer key'
    $keyLabel.Location = [Drawing.Point]::new(16, 117)
    $keyLabel.AutoSize = $true
    $keyInput = [Windows.Forms.TextBox]::new()
    $keyInput.Location = [Drawing.Point]::new(16, 138)
    $keyInput.Width = 446
    $keyInput.UseSystemPasswordChar = $true
    $keyInput.TabIndex = 1

    $pairButton = [Windows.Forms.Button]::new()
    $pairButton.Text = 'Pair TV'
    $pairButton.Location = [Drawing.Point]::new(282, 181)
    $pairButton.Size = [Drawing.Size]::new(82, 28)
    $pairButton.DialogResult = 'OK'
    $pairButton.TabIndex = 2
    $pairButton.Enabled = $false
    $cancelButton = [Windows.Forms.Button]::new()
    $cancelButton.Text = 'Cancel'
    $cancelButton.Location = [Drawing.Point]::new(380, 181)
    $cancelButton.Size = [Drawing.Size]::new(82, 28)
    $cancelButton.DialogResult = 'Cancel'
    $cancelButton.TabIndex = 3

    $checkInputs = {
        $pairButton.Enabled = -not [string]::IsNullOrWhiteSpace($idInput.Text) -and
            -not [string]::IsNullOrWhiteSpace($keyInput.Text)
    }.GetNewClosure()
    $idInput.Add_TextChanged($checkInputs)
    $keyInput.Add_TextChanged($checkInputs)
    $dialog.Controls.AddRange(@($instructions, $idLabel, $idInput, $keyLabel, $keyInput, $pairButton, $cancelButton))
    $dialog.AcceptButton = $pairButton
    $dialog.CancelButton = $cancelButton
    $dialog.ActiveControl = $idInput
    try {
        if ($dialog.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) {
            throw 'Frame portfolio pairing was canceled.'
        }
        return @{ ClientId = $idInput.Text.Trim(); ConsumerKey = $keyInput.Text.Trim() }
    } finally {
        $idInput.Clear()
        $keyInput.Clear()
        $dialog.Dispose()
    }
}

if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
    throw 'Apps2Samsung CLI was not found. Supply its executable with -InstallerPath.'
}
if ($UpdateOnly -and -not (Test-Path -LiteralPath $pairingFile -PathType Leaf)) {
    throw 'The TV has no saved portfolio pairing. Run this script without -UpdateOnly first.'
}
if (-not $UpdateOnly -and (Test-Path -LiteralPath $pairingFile -PathType Leaf)) {
    throw 'The TV already has a saved portfolio pairing. Use -UpdateOnly to install an update with that pairing.'
}

# Reuse the workstation’s saved pairing for an update.
if ($UpdateOnly) {
    $pairing = Import-Clixml -LiteralPath $pairingFile
    $portfolioUrl = $pairing.Url
    $displayToken = Read-SecretText $pairing.Token
} else {
    $portfolioUrl = Publish-PortfolioWorker
    $keys = Read-SnapTradeKeys
    $clientId = $keys.ClientId
    $consumerKey = $keys.ConsumerKey
    $keys.Clear()
    if (-not $clientId -or -not $consumerKey) {
        throw 'Both SnapTrade Personal API credentials are required.'
    }

    # Give the TV a separate display token and keep SnapTrade keys on the Worker.
    $tokenBytes = [byte[]]::new(32)
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($tokenBytes) }
    finally { $generator.Dispose() }
    $displayToken = [Convert]::ToBase64String($tokenBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    [Array]::Clear($tokenBytes, 0, $tokenBytes.Length)

    $bindings = @{
        SNAPTRADE_CLIENT_ID = $clientId
        SNAPTRADE_CONSUMER_KEY = $consumerKey
        FRAME_PORTFOLIO_TOKEN = $displayToken
    }
    if ($RobinhoodConnectionId) {
        $bindings.FRAME_ROBINHOOD_CONNECTION_ID = $RobinhoodConnectionId
    }
    try {
        $bindings | ConvertTo-Json -Compress | & npx.cmd --yes wrangler@4 secret bulk --config $workerConfig
        if ($LASTEXITCODE -ne 0) { throw 'Cloudflare could not save the portfolio secrets.' }
    } finally {
        $bindings.Clear()
        Remove-Variable clientId, consumerKey
    }

    # Verify the hosted connection before saving the pairing.
    $snapshot = $null
    for ($attempt = 0; $attempt -lt 4; $attempt++) {
        try {
            $snapshot = Invoke-RestMethod -Uri $portfolioUrl -Headers @{ Authorization = "Bearer $displayToken" } -TimeoutSec 12 -MaximumRedirection 0
            break
        } catch {
            if ($attempt -eq 3) { throw 'The hosted portfolio endpoint is unavailable. Check the SnapTrade connection and key.' }
            Start-Sleep -Seconds 2
        }
    }
    if ($snapshot.status -ne 'connected' -or $snapshot.currency -ne 'USD' -or $null -eq $snapshot.total) {
        throw "The hosted feed returned $($snapshot.status). Link one read-only Robinhood connection in SnapTrade before pairing the TV."
    }

    $null = New-Item -ItemType Directory -Path $pairingDirectory -Force
    # On Windows, Export-Clixml encrypts the SecureString for this user on this PC.
    [pscustomobject]@{ Url = $portfolioUrl; Token = ConvertTo-SecureString $displayToken -AsPlainText -Force } |
        Export-Clixml -LiteralPath $pairingFile
}

$version = ([xml](Get-Content -LiteralPath (Join-Path $launcher 'config.xml') -Raw)).widget.version
# Limit display settings to the packaging call and restore the previous environment.
$previousUrl = $env:FRAME_PORTFOLIO_URL
$previousToken = $env:FRAME_PORTFOLIO_TOKEN
$previousStreamForgeUrl = $env:FRAME_STREAMFORGE_URL
try {
    $env:FRAME_PORTFOLIO_URL = $portfolioUrl
    $env:FRAME_PORTFOLIO_TOKEN = $displayToken
    $env:FRAME_STREAMFORGE_URL = $StreamForgeUrl
    & python (Join-Path $PSScriptRoot 'package.py')
    if ($LASTEXITCODE -ne 0) { throw 'The paired TV package could not be built.' }
} finally {
    $env:FRAME_PORTFOLIO_URL = $previousUrl
    $env:FRAME_PORTFOLIO_TOKEN = $previousToken
    $env:FRAME_STREAMFORGE_URL = $previousStreamForgeUrl
    Remove-Variable displayToken
}

# The installer signs the paired unsigned WGT for the TV.
$package = Join-Path $launcher "dist/Frame-$version-private-unsigned.wgt"
& $InstallerPath install $package --tv $TvAddress --local-ip $LocalAddress --tizen-cert public --launch --plain
if ($LASTEXITCODE -ne 0) {
    throw 'The TV installation failed. The saved pairing can be reused with -UpdateOnly.'
}
