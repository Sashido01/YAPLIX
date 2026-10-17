# Read-only inventory. Never reads hotspot SSID/passphrase or changes tethering.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$adapters = @(Get-NetAdapter -IncludeHidden -ErrorAction Stop)
$physical = @($adapters | Where-Object { $_.HardwareInterface -and $_.Status -eq 'Up' } | Select-Object -ExpandProperty Name)
$state = 'Unavailable'
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    [Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime] | Out-Null
    [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime] | Out-Null
    foreach ($profile in [Windows.Networking.Connectivity.NetworkInformation]::GetConnectionProfiles()) {
        try {
            $manager = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)
            $observed = $manager.TetheringOperationalState.ToString()
            if ($observed -eq 'On') { $state = 'On'; break }
            if ($observed -eq 'Off') { $state = 'Off' }
        } catch { } # No positive evidence means no virtual-adapter admission.
    }
} catch { }
$hotspot = @()
if ($state -eq 'On') {
    foreach ($adapter in $adapters) {
        if (-not $adapter.HardwareInterface -and $adapter.Status -eq 'Up' -and
            $adapter.InterfaceType -eq 71 -and
            $adapter.InterfaceDescription -match '^Microsoft Wi-Fi Direct Virtual Adapter( #\d+)?$') {
            $ips = @(Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction Stop |
                Where-Object AddressState -eq Preferred | Select-Object -ExpandProperty IPAddress)
            $hotspot += @{ name=$adapter.Name; guid=$adapter.InterfaceGuid.ToString(); addresses=$ips;
                description=$adapter.InterfaceDescription; hardware=$false; status='Up'; interfaceType=71 }
        }
    }
}
ConvertTo-Json -Compress -Depth 4 -InputObject @{ physical=$physical; hotspotState=$state; hotspot=$hotspot }
