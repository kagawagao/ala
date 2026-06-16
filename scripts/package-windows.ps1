<#
.SYNOPSIS
  Package ALA as a Windows ZIP and MSI installer.

.DESCRIPTION
  Creates a ZIP archive and optionally an MSI installer for ALA.
  Requires WiX Toolset v3.11 for MSI creation.

.PARAMETER Version
  The version string (default: read from package.json).

.PARAMETER OutputDir
  Output directory relative to repo root (default: "release-assets").

.PARAMETER SkipMsi
  Skip MSI creation and only produce the ZIP archive.

.EXAMPLE
  .\scripts\package-windows.ps1 -Version 2.3.4
  .\scripts\package-windows.ps1 -Version 2.3.4 -SkipMsi
  .\scripts\package-windows.ps1 -Version 2.3.4 -OutputDir my-release
#>

param(
  [string]$Version,
  [string]$OutputDir = "release-assets",
  [switch]$SkipMsi
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

# Default version from package.json
if (-not $Version) {
  $PkgJson = Join-Path $RepoRoot "package.json"
  if (Test-Path $PkgJson) {
    $Pkg = Get-Content $PkgJson -Raw | ConvertFrom-Json
    $Version = $Pkg.version
  }
  if (-not $Version) {
    Write-Error "Could not read version from package.json. Provide -Version."
    exit 1
  }
  Write-Host "[package-windows] Version from package.json: $Version"
}

# ---- Validate input ----
$BackendDist = Join-Path $RepoRoot "backend\dist\ala"
if (-not (Test-Path $BackendDist)) {
  Write-Error "Backend dist not found: $BackendDist. Run scripts/build-exe.sh first."
  exit 1
}

# Sanitize version for MSI (must be X.X.X.X)
$SafeVersion = $Version -replace '-.*$',''
$SafeVersion = $SafeVersion -replace '[^0-9\.]',''
if ([string]::IsNullOrWhiteSpace($SafeVersion)) { $SafeVersion = "1.0.0" }

$ReleaseDir = Join-Path $RepoRoot $OutputDir
New-Item -ItemType Directory -Force -Path $ReleaseDir | Out-Null

Write-Host "[package-windows] Packaging ALA v$Version for Windows..."

# ---- ZIP ----
$ZipName = "ALA-$Version-windows-x64.zip"
$ZipPath = Join-Path $ReleaseDir $ZipName
Compress-Archive -Path "$BackendDist\*" -DestinationPath $ZipPath -Force
Write-Host "  ZIP: $ZipPath"

# ---- MSI ----
if ($SkipMsi) {
  Write-Host "  MSI: skipped (--skip-msi)"
  Write-Host ""
  Write-Host "Done: $ZipPath"
  exit 0
}

# Locate WiX Toolset (any 3.x)
$WixBin = $null
$WixPaths = @(
  "${env:ProgramFiles(x86)}\WiX Toolset v3.*"
  "${env:ProgramFiles}\WiX Toolset v3.*"
  "${env:LOCALAPPDATA}\WiX Toolset v3.*"
)
foreach ($pattern in $WixPaths) {
  $found = Get-Item (Join-Path $pattern "bin\heat.exe") -ErrorAction SilentlyContinue
  if ($found) { $WixBin = Split-Path -Parent $found.FullName; break }
}
if (-not $WixBin -and (Get-Command heat.exe -ErrorAction SilentlyContinue)) {
  $WixBin = Split-Path -Parent (Get-Command heat.exe).Source
}

if (-not $WixBin) {
  Write-Warning "WiX Toolset v3 not found. MSI creation requires WiX."
  Write-Warning "Install: choco install wixtoolset"
  Write-Warning "Or run with -SkipMsi to create ZIP only."
  Write-Host ""
  Write-Host "Done (ZIP only): $ZipPath"
  exit 0
}

Write-Host "  WiX: $WixBin"
$env:PATH = "$WixBin;$env:PATH"

# Temp working directory
$WxsDir = Join-Path $env:TEMP "ala-wix-$PID"
New-Item -ItemType Directory -Force -Path $WxsDir | Out-Null

# Icon
$IconSrc = Join-Path $RepoRoot "assets\icons\icon.ico"
$IconDest = Join-Path $WxsDir "icon.ico"
if (Test-Path $IconSrc) {
  Copy-Item -Path $IconSrc -Destination $IconDest -Force
} else {
  Write-Warning "Icon not found: $IconSrc"
}

# License RTF
$LicenseRtf = Join-Path $WxsDir "License.rtf"
$LicenseSrc = Join-Path $RepoRoot "LICENSE"
if (Test-Path $LicenseSrc) {
  $licLines = Get-Content -Path $LicenseSrc -Encoding UTF8
  $rtfLines = $licLines | ForEach-Object {
    $line = $_ -replace '\\', '\\\\' -replace '\{', '\{' -replace '\}', '\}'
    if ([string]::IsNullOrWhiteSpace($line)) { '\par\par ' } else { "$line\par " }
  }
  $rtfBody = $rtfLines -join ' '
  $rtfContent = "{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\fswiss\fcharset0 Arial;}}\f0\fs18 $rtfBody}"
  [System.IO.File]::WriteAllText($LicenseRtf, $rtfContent, [System.Text.Encoding]::GetEncoding(1252))
}

# Product.wxs
# Uses WixUI_Advanced to expose optional features (Desktop shortcut, Start Menu, PATH)
# via the "Advanced" button in the installer UI.
$ProductWxs = Join-Path $WxsDir "Product.wxs"
@"
<?xml version='1.0' encoding='UTF-8'?>
<Wix xmlns='http://schemas.microsoft.com/wix/2006/wi'>
  <Product Id='*' Name='ALA' Language='1033' Version='$SafeVersion' Manufacturer='kagawagao' UpgradeCode='EC2F02F9-F9C5-4A31-8F0E-EF2A2B049A2D'>
    <Package InstallerVersion='500' Compressed='yes' InstallScope='perMachine' Platform='x64'/>
    <MajorUpgrade DowngradeErrorMessage='A newer version of ALA is already installed.'/>
    <MediaTemplate EmbedCab='yes'/>
    <Icon Id='AlaIcon' SourceFile='$IconDest'/>
    <Property Id='ARPPRODUCTICON' Value='AlaIcon'/>
    <Property Id='ApplicationFolderName' Value='ALA'/>
    <Property Id='WixAppFolder' Value='WixPerMachineFolder'/>
    <WixVariable Id='WixUILicenseRtf' Value='$LicenseRtf'/>

    <!--
      MainFeature is always installed (Absent='disallow').
      Sub-features are enabled by default (Level='1') and can be toggled
      via the "Advanced" button in the installer UI.
    -->
    <Feature Id='MainFeature' Title='ALA' Level='1' Absent='disallow' Display='expand'>
      <ComponentGroupRef Id='AppFiles'/>
      <Feature Id='DesktopShortcut' Title='Desktop Shortcut' Level='1'
               Description='Create a shortcut on the desktop.'>
        <ComponentRef Id='DesktopShortcutComp'/>
      </Feature>
      <Feature Id='StartMenuShortcut' Title='Start Menu Shortcuts' Level='1'
               Description='Create a shortcut in the Start Menu.'>
        <ComponentRef Id='ProgramMenuShortcutComp'/>
      </Feature>
      <Feature Id='AddToPath' Title='Add to PATH' Level='1'
               Description='Add ALA to the system PATH so you can run ala from PowerShell or Command Prompt.'>
        <ComponentRef Id='PathEnvComp'/>
      </Feature>
    </Feature>

    <UIRef Id='WixUI_Advanced'/>
  </Product>

  <Fragment>
    <Directory Id='TARGETDIR' Name='SourceDir'>
      <Directory Id='ProgramFiles64Folder'>
        <Directory Id='APPLICATIONFOLDER' Name='ALA'/>
      </Directory>
      <Directory Id='DesktopFolder'/>
      <Directory Id='CommonProgramsFolder'>
        <Directory Id='ProgramMenuDir' Name='ALA'/>
      </Directory>
    </Directory>
  </Fragment>

  <!-- Desktop shortcut -->
  <Fragment>
    <DirectoryRef Id='DesktopFolder'>
      <Component Id='DesktopShortcutComp' Guid='B8A7C6D5-E4F3-210A-9B8C-7D6E5F4A3B2C' Win64='yes'>
      <Shortcut Id='DesktopShortcut' Name='ALA' Target='[APPLICATIONFOLDER]ala.exe'
                WorkingDirectory='APPLICATIONFOLDER' Description='ALA - Android Log Analyzer'
                Icon='AlaIcon' IconIndex='0'/>
      <RegistryValue Root='HKCU' Key='Software\kagawagao\ALA' Name='desktop_shortcut' Type='integer' Value='1' KeyPath='yes'/>
      </Component>
    </DirectoryRef>
  </Fragment>

  <!-- Start Menu shortcut -->
  <Fragment>
    <DirectoryRef Id='ProgramMenuDir'>
      <Component Id='ProgramMenuShortcutComp' Guid='C9F3B1D2-4E6F-5A8B-0C1D-2E3F4A5B6C7D' Win64='yes'>
      <Shortcut Id='StartMenuShortcut' Name='ALA' Target='[APPLICATIONFOLDER]ala.exe'
                WorkingDirectory='APPLICATIONFOLDER' Description='ALA - Android Log Analyzer'
                Icon='AlaIcon' IconIndex='0'/>
      <RemoveFolder Id='RemoveProgramMenuDir' Directory='ProgramMenuDir' On='uninstall'/>
      <RegistryValue Root='HKLM' Key='Software\kagawagao\ALA' Name='startmenu_shortcut' Type='integer' Value='1' KeyPath='yes'/>
      </Component>
    </DirectoryRef>
  </Fragment>

  <!-- PATH environment variable -->
  <Fragment>
    <DirectoryRef Id='APPLICATIONFOLDER'>
      <Component Id='PathEnvComp' Guid='A1B2C3D4-E5F6-7890-ABCD-EF1234567890' Win64='yes'>
        <Environment Id='PathEnv' Name='PATH' Value='[APPLICATIONFOLDER]' Action='set' Part='last' Permanent='no' System='yes'/>
        <RegistryValue Root='HKLM' Key='Software\kagawagao\ALA' Name='path_env' Type='integer' Value='1' KeyPath='yes'/>
      </Component>
    </DirectoryRef>
  </Fragment>
</Wix>
"@ | Set-Content -Path $ProductWxs -Encoding utf8

# Stage files for heat
$StageDir = Join-Path $env:TEMP "ala-msi-stage-$PID"
if (Test-Path $StageDir) { Remove-Item $StageDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $StageDir | Out-Null
Copy-Item -Path "$BackendDist\*" -Destination $StageDir -Recurse -Force

# Generate Files.wxs with heat
$FilesWxs = Join-Path $WxsDir "Files.wxs"
& heat.exe dir $StageDir -cg AppFiles -dr APPLICATIONFOLDER -srd -gg -g1 -scom -sreg -var var.StageDir -out $FilesWxs

# Mark all components as Win64
[xml]$FilesDoc = Get-Content -Path $FilesWxs
$WixNs = New-Object System.Xml.XmlNamespaceManager($FilesDoc.NameTable)
$WixNs.AddNamespace("w", "http://schemas.microsoft.com/wix/2006/wi")
$FilesDoc.SelectNodes("//w:Component", $WixNs) | ForEach-Object {
  $_.SetAttribute("Win64", "yes")
}
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$Writer = [System.IO.StreamWriter]::new($FilesWxs, $false, $Utf8NoBom)
$FilesDoc.Save($Writer)
$Writer.Close()

# Compile + link
$MsiName = "ALA-$Version-windows-x64.msi"
$MsiPath = Join-Path $ReleaseDir $MsiName
& candle.exe -dStageDir="$StageDir" -ext WixUIExtension -out "$WxsDir\" $ProductWxs $FilesWxs
& light.exe -ext WixUIExtension -sval -out $MsiPath (Join-Path $WxsDir "Product.wixobj") (Join-Path $WxsDir "Files.wixobj")

# Cleanup temp
Remove-Item $StageDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $WxsDir -Recurse -Force -ErrorAction SilentlyContinue

# Verify
if (-not (Test-Path $ZipPath)) { throw "ZIP artifact was not created" }
if (-not (Test-Path $MsiPath)) { throw "MSI artifact was not created" }

Write-Host "  MSI: $MsiPath"
Write-Host ""
Write-Host "Done:"
Write-Host "  $ZipPath"
Write-Host "  $MsiPath"
