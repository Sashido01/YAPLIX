param([string]$Fixture)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/windows-lan-setup.ps1')
$script:plan=Get-Content -LiteralPath $Fixture -Raw -Encoding UTF8 | ConvertFrom-Json
$script:rules=@();$script:writes=@();$script:failNew=$false;$script:policyRace=$false
function Assert($Value,$Message){if(-not $Value){throw $Message}}
function Get-NetAdapter {param([switch]$Physical) [pscustomobject]@{Status='Up';ifIndex=1;InterfaceGuid='physical-1';Name='Wi-Fi'}}
function Get-NetConnectionProfile {param($InterfaceIndex) [pscustomobject]@{NetworkCategory='Private'}}
function Get-NetIPAddress {param($InterfaceIndex,$AddressFamily) [pscustomobject]@{AddressState='Preferred';IPAddress='192.168.10.12';PrefixLength=24}}
function Get-NetFirewallProfile {param($Name,$PolicyStore) [pscustomobject]@{Enabled='True';AllowInboundRules='True';AllowLocalFirewallRules='True';DisabledInterfaceAliases=$null}}
function Get-NetFirewallRule {param($PolicyStore,[switch]$TracePolicyStore,$Direction) return @()}
function Get-NetTCPConnection {param($State) return @()}
$read=Get-LanSnapshot
Assert ($read.complete -and $read.adapters.Count -eq 1) 'null DisabledInterfaceAliases must not make diagnostics unavailable'
function Get-NetFirewallPortFilter {process{[pscustomobject]@{RemotePort='Any';LocalPort=@('52604','52605');Protocol='TCP';DynamicTarget='Any'}}}
function Get-NetFirewallApplicationFilter {process{[pscustomobject]@{Program=$script:plan.nodePath;Package='Any'}}}
function Get-NetFirewallAddressFilter {process{[pscustomobject]@{LocalAddress=@('192.168.10.0/24');RemoteAddress=@('192.168.10.0/24')}}}
function Get-NetFirewallInterfaceFilter {process{[pscustomobject]@{InterfaceAlias=@('Wi-Fi')}}}
function Get-NetFirewallInterfaceTypeFilter {process{[pscustomobject]@{InterfaceType='Any'}}}
function Get-NetFirewallServiceFilter {process{[pscustomobject]@{Service='Any'}}}
function Get-NetFirewallSecurityFilter {process{[pscustomobject]@{Authentication='NotRequired';Encryption='NotRequired';OverrideBlockRules='False';LocalUser='Any';RemoteUser='Any';RemoteMachine='Any'}}}
$raw=[pscustomobject]@{Name='fixture';Group='';Description='';Action='Allow';Enabled='True';Profile='Private';PolicyStoreSourceType='Local';Platform=$null;Owner=$null;PrimaryStatus='OK'}
Assert ((Read-LanRule $raw).unconditional) 'ordinary Allow should be understood'
$raw.Platform=@('2:6.1');Assert (-not (Read-LanRule $raw).unconditional) 'platform-limited Allow incorrectly unconditional'
$raw.Platform=$null;$raw.Owner='restricted-owner';Assert (-not (Read-LanRule $raw).unconditional) 'owner-limited Allow incorrectly unconditional'
# All system mutation/query seams are synthetic. Never call NetSecurity here.
function Get-LanSnapshot {
 return [pscustomobject]@{platform='win32';complete=$true;adapters=@($script:plan.adapter);firewall=@{enabled=$true;allowLocal=(-not $script:policyRace);allowInbound=$true};rules=@($script:rules);listeners=@()}
}
function New-NetFirewallRule {
 param($PolicyStore,$Name,$DisplayName,$Group,$Description,$Direction,$Action,$Enabled,$Profile,$Protocol,$LocalPort,$Program,$InterfaceAlias,$LocalAddress,$RemoteAddress,$EdgeTraversalPolicy)
 $entry=@{};foreach($key in $PSBoundParameters.Keys){$entry[$key]=$PSBoundParameters[$key]};$script:writes+=,$entry
 Assert ($PolicyStore -eq 'PersistentStore' -and $Profile -eq 'Private' -and $Direction -eq 'Inbound' -and $Protocol -eq 'TCP') 'unsafe rule constants'
 Assert ($LocalAddress -eq '192.168.10.0/24' -and $RemoteAddress -eq '192.168.10.0/24') 'unbounded address'
 $script:rules+=,[pscustomobject][ordered]@{name=$Name;group=$Group;description=$Description;action='Allow';enabled=$true;profiles=@('Private');program=$Program;protocol='TCP';ports=@($LocalPort | ForEach-Object {[string]$_});local=@($LocalAddress);remote=@($RemoteAddress);interfaces=@($script:plan.adapter.name);unconditional=$true;source='Local'}
 if($script:failNew){throw 'synthetic partial-create failure'}
}
function Get-NetFirewallRule {param($PolicyStore,$Name) if($Name){$script:rules | Where-Object name -CEQ $Name}else{$script:rules}}
function Read-LanRule($Rule){return $Rule}
function Remove-NetFirewallRule {
 param([Parameter(ValueFromPipeline)]$InputObject)
 process {Assert ($InputObject.name -like 'YAPLIX-LAN-*') 'foreign removal';$script:writes+=,'remove';if(-not $script:noOpRemove){$script:rules=@($script:rules | Where-Object name -CNE $InputObject.name)};if($script:failRemove){throw 'synthetic partial-delete failure'}}
}
$result=Invoke-LanApply $script:plan
Assert ($result.code -eq 'applied' -and $script:rules.Count -eq 1) 'normal bounded creation'
Assert ($script:writes[0].InterfaceAlias -ceq [System.Management.Automation.WildcardPattern]::Escape($script:plan.adapter.name)) 'alias must be literal'
# Duplicate creation must fail without touching the first rule.
$script:writes=@();$result=Invoke-LanApply $script:plan
Assert ($result.code -eq 'failed_rolled_back' -and $script:writes.Count -eq 0 -and $script:rules.Count -eq 1) 'duplicate changed rule'
# Partial-create failure rolls back only the newly created owned rule.
$script:rules=@();$script:failNew=$true;$result=Invoke-LanApply $script:plan
Assert ($result.code -eq 'failed_rolled_back' -and $script:rules.Count -eq 0) 'partial creation rollback'
$script:failNew=$false;$script:policyRace=$true;$script:writes=@();$result=Invoke-LanApply $script:plan
Assert ($result.code -eq 'failed_rolled_back' -and $script:writes.Count -eq 0) 'GPO bypass'
$script:policyRace=$false
$script:plan.adapter.profile='Public';$result=Invoke-LanApply $script:plan
Assert ($result.code -eq 'failed_rolled_back' -and $script:rules.Count -eq 0) 'Public accepted'
$script:plan.adapter.profile='Private'
# Explicit removal success, indeterminate delete response, no-op deletion.
$result=Invoke-LanApply $script:plan
Assert ($result.code -eq 'applied') 'prepare removal'
$own=$script:rules[0];$script:plan.add=@();$script:plan.remove=@($own);$script:plan.action='remove'
$script:failRemove=$true;$result=Invoke-LanApply $script:plan
Assert ($result.code -eq 'failed_rolled_back' -and $script:rules.Count -eq 1 -and $script:rules[0].name -ceq $own.name) 'partial deletion falsely reported rollback'
$script:failRemove=$false;$script:noOpRemove=$true;$result=Invoke-LanApply $script:plan
Assert ($result.code -eq 'failed_rolled_back' -and $script:rules.Count -eq 1) 'no-op deletion falsely reported applied'
$script:noOpRemove=$false;$result=Invoke-LanApply $script:plan
Assert ($result.code -eq 'applied' -and $script:rules.Count -eq 0) 'explicit removal not verified'
$script:rules=@($own);$script:plan.adapter.profile='Public'
$result=Invoke-LanApply $script:plan
Assert ($result.code -eq 'applied' -and $script:rules.Count -eq 0) 'cleanup should not require opening a Public network'
# A spoofed removal of a manual rule must fail before any add.
$script:plan.remove=@([pscustomobject]@{name='YAPLIX Arena TCP 52605';group='';description='';source='Local'})
$script:writes=@();$result=Invoke-LanApply $script:plan
Assert ($result.code -eq 'failed_rolled_back' -and $script:writes.Count -eq 0) 'manual rule touched'
Write-Output 'SYNTHETIC_HELPER_PASS'
