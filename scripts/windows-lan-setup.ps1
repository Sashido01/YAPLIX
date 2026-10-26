param([ValidateSet('Inspect','Elevate','Apply')][string]$Mode='Inspect',[string]$PlanPath)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)

# No caller text is evaluated as PowerShell. This file is also dot-sourceable by
# synthetic tests which replace every NetSecurity command before calling functions.
function Read-LanRule($Rule) {
    $port=$Rule | Get-NetFirewallPortFilter
    $app=$Rule | Get-NetFirewallApplicationFilter
    $address=$Rule | Get-NetFirewallAddressFilter
    $iface=$Rule | Get-NetFirewallInterfaceFilter
    $ifaceType=$Rule | Get-NetFirewallInterfaceTypeFilter
    $service=$Rule | Get-NetFirewallServiceFilter
    $security=$Rule | Get-NetFirewallSecurityFilter
    $plain=([string]$service.Service -eq 'Any') -and ([string]$app.Package -in @('Any','')) -and
      ([string]$port.RemotePort -eq 'Any') -and ([string]$security.Authentication -eq 'NotRequired') -and
      ([string]$security.Encryption -eq 'NotRequired') -and ([string]$security.OverrideBlockRules -eq 'False') -and
      ([string]$security.LocalUser -in @('Any','')) -and ([string]$security.RemoteUser -in @('Any','')) -and
      ([string]$security.RemoteMachine -in @('Any','')) -and ([string]$ifaceType.InterfaceType -eq 'Any') -and
      (-not $Rule.Platform) -and (-not $Rule.Owner) -and ([string]$port.DynamicTarget -in @('Any','')) -and
      ([string]$Rule.PrimaryStatus -in @('OK',''))
    return [ordered]@{name=[string]$Rule.Name;group=[string]$Rule.Group;description=[string]$Rule.Description;action=[string]$Rule.Action;
      enabled=([string]$Rule.Enabled -eq 'True');profiles=@(([string]$Rule.Profile -split ',\s*'));program=[Environment]::ExpandEnvironmentVariables([string]$app.Program);
      protocol=[string]$port.Protocol;ports=@($port.LocalPort | ForEach-Object {[string]$_});
      local=@($address.LocalAddress | ForEach-Object {[string]$_});remote=@($address.RemoteAddress | ForEach-Object {[string]$_});
      interfaces=@($iface.InterfaceAlias | ForEach-Object {[string]$_});unconditional=[bool]$plain;source=[string]$Rule.PolicyStoreSourceType}
}
function Get-LanSnapshot {
    $data=[ordered]@{platform='win32';complete=$false;adapters=@();rules=@();listeners=@()}
    $stage='ADAPTERS'
    try {
        $data.adapters=@(Get-NetAdapter -Physical | Where-Object Status -eq Up | ForEach-Object {
            $adapter=$_
            $profiles=@(Get-NetConnectionProfile -InterfaceIndex $adapter.ifIndex)
            $profile=if($profiles.Count -eq 1){[string]$profiles[0].NetworkCategory}else{'Unknown'}
            Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 | Where-Object AddressState -eq Preferred | ForEach-Object {
                if($_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)') {
                    [ordered]@{id=[string]$adapter.InterfaceGuid;name=[string]$adapter.Name;address=[string]$_.IPAddress;prefix=[int]$_.PrefixLength;profile=$profile}
                }
            }
        })
        $stage='PROFILE'
        $policy=Get-NetFirewallProfile -Name Private -PolicyStore ActiveStore
        # NotConfigured uses Windows defaults: enabled, inbound exceptions/local merge allowed.
        $data.firewall=[ordered]@{enabled=([string]$policy.Enabled -ne 'False');allowInbound=([string]$policy.AllowInboundRules -ne 'False');allowLocal=([string]$policy.AllowLocalFirewallRules -ne 'False')}
        if(@($policy.DisabledInterfaceAliases | Where-Object {$_ -and $_ -ne 'NotConfigured'}).Count -gt 0){throw 'DISABLED_INTERFACE_POLICY'}
        $stage='RULES'
        $rules=@(Get-NetFirewallRule -PolicyStore ActiveStore -TracePolicyStore -Direction Inbound | Where-Object {([string]$_.Enabled -eq 'True') -or ([string]$_.Group -like 'YAPLIX LAN *')})
        if($rules.Count -gt 1500){throw 'RULE_LIMIT'}
        $stage='FILTERS'
        $data.rules=@($rules | ForEach-Object {Read-LanRule $_} | Sort-Object {$_.name})
        $stage='LISTENERS'
        $data.listeners=@(Get-NetTCPConnection -State Listen | ForEach-Object {[ordered]@{address=[string]$_.LocalAddress;port=[int]$_.LocalPort;pid=[int]$_.OwningProcess}})
        $data.complete=$true
    } catch {$data.error='WINDOWS_'+$stage+'_UNREADABLE'}
    return $data
}
function Get-Subnet($Adapter) {
    $bytes=[System.Net.IPAddress]::Parse([string]$Adapter.address).GetAddressBytes()
    if($bytes.Length -ne 4 -or $Adapter.address -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)' -or $Adapter.prefix -lt 8 -or $Adapter.prefix -gt 30){throw 'INVALID_SUBNET'}
    if(($Adapter.address -like '192.168.*' -and $Adapter.prefix -lt 16) -or ($Adapter.address -like '172.*' -and $Adapter.prefix -lt 12)){throw 'INVALID_SUBNET'}
    $remaining=[int]$Adapter.prefix
    $result=foreach($byte in $bytes){$bits=[Math]::Min(8,[Math]::Max(0,$remaining));$byte -band (256-[Math]::Pow(2,8-$bits));$remaining-=8}
    return (($result -join '.')+'/'+[int]$Adapter.prefix)
}
function Assert-Owned($Rule,$Installation) {
    if($Rule.name -cnotmatch ('^YAPLIX-LAN-'+$Installation+'-[a-f0-9]{20}$') -or $Rule.group -cne ('YAPLIX LAN '+$Installation) -or $Rule.description -cne ('YAPLIX managed LAN v1 '+$Installation) -or $Rule.source -notin @('Local','',$null)){throw 'FOREIGN_RULE'}
}
function Assert-Plan($Plan,$Snapshot) {
    if($Plan.installation -cnotmatch '^[a-f0-9]{20}$' -or $Plan.id -notmatch '^[a-f0-9-]{36}$' -or $Plan.action -notin @('configure','remove') -or $Plan.expiresAt -lt [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -or $Plan.expiresAt -gt ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+310000)){throw 'INVALID_PLAN'}
    if(-not $Snapshot.complete){throw 'UNABLE_TO_MANAGE'}
    if($Plan.action -eq 'configure') {
    if(-not $Snapshot.firewall.enabled -or -not $Snapshot.firewall.allowInbound -or -not $Snapshot.firewall.allowLocal){throw 'UNABLE_TO_MANAGE'}
    $adapter=@($Snapshot.adapters | Where-Object {$_.id -ceq $Plan.adapter.id -and $_.name -ceq $Plan.adapter.name -and $_.address -ceq $Plan.adapter.address -and $_.prefix -eq $Plan.adapter.prefix -and $_.profile -ceq 'Private'})
    if($adapter.Count -ne 1 -or (Get-Subnet $adapter[0]) -cne $Plan.subnet){throw 'NETWORK_CHANGED'}
    if($Plan.nodePath -notmatch '^[a-zA-Z]:\\[^\r\n]*\\node\.exe$' -or -not (Test-Path -LiteralPath $Plan.nodePath -PathType Leaf) -or $Plan.nodePath -match '[\x00-\x1f"*?\[\]]'){throw 'INVALID_NODE'}
    if(@($Plan.ports).Count -lt 1 -or @($Plan.ports).Count -gt 2 -or @($Plan.ports | Where-Object {$_ -isnot [int] -and $_ -isnot [long] -or $_ -lt 1 -or $_ -gt 65535}).Count){throw 'INVALID_PORTS'}
    # InterfaceAlias is a WildcardPattern parameter. Escape literal alias names;
    # control characters are refused rather than becoming helper arguments.
    if($Plan.adapter.name -match '[\x00-\x1f]' -or $Plan.adapter.name.Length -gt 256){throw 'INVALID_INTERFACE'}
    }
    if(@($Plan.add).Count -gt 1 -or @($Plan.remove).Count -gt 32){throw 'PLAN_LIMIT'}
    foreach($rule in @($Plan.add)) {
        Assert-Owned $rule $Plan.installation
        if($Plan.action -ne 'configure' -or $rule.program -cne $Plan.nodePath -or $rule.subnet -cne $Plan.subnet -or @($rule.ports).Count -lt 1 -or @($rule.ports).Count -gt 2 -or @($rule.ports | Where-Object {$_ -notin $Plan.ports}).Count -or $rule.adapter.name -cne $Plan.adapter.name){throw 'INVALID_RULE'}
        if(@($Snapshot.rules | Where-Object name -CEQ $rule.name).Count){throw 'RULE_COLLISION'}
    }
    foreach($rule in @($Plan.remove)) {
        Assert-Owned $rule $Plan.installation
        $current=@($Snapshot.rules | Where-Object name -CEQ $rule.name)
        if($current.Count -ne 1 -or (ConvertTo-Json $current[0] -Compress -Depth 10) -cne (ConvertTo-Json $rule -Compress -Depth 10)){throw 'RULE_CHANGED'}
        # Rollback only supports the exact narrow shape authored by this helper.
        if($rule.action -cne 'Allow' -or ($rule.profiles -join ',') -cne 'Private' -or $rule.protocol -notin @('TCP','6') -or -not $rule.unconditional -or @($rule.interfaces).Count -ne 1 -or @($rule.local).Count -ne 1 -or ($rule.local -join ',') -cne ($rule.remote -join ',') -or $rule.local[0] -notmatch '^\d+\.\d+\.\d+\.\d+/\d+$' -or @($rule.ports | Where-Object {$_ -notmatch '^\d+$'}).Count){throw 'UNSUPPORTED_MANAGED_RULE'}
        $parts=$rule.local[0] -split '/'
        if((Get-Subnet ([pscustomobject]@{address=$parts[0];prefix=[int]$parts[1]})) -cne $rule.local[0] -or $rule.program -notmatch '^[a-zA-Z]:\\[^\r\n]*\\node\.exe$' -or $rule.interfaces[0] -in @('Any','*') -or @($rule.ports).Count -lt 1 -or @($rule.ports).Count -gt 2 -or @($rule.ports | Where-Object {[int]$_ -lt 1 -or [int]$_ -gt 65535}).Count){throw 'UNSUPPORTED_MANAGED_RULE'}
    }
    # Any potentially applicable Block, including program-wide, is fail-closed.
    foreach($rule in @($Snapshot.rules | Where-Object {$Plan.action -eq 'configure'})) {
        $portMatch=$false
        foreach($port in @($Plan.ports)){foreach($filter in @($rule.ports)){
            if($filter -in @('Any','*') -or $filter -eq [string]$port -or ($filter -match '^(\d+)-(\d+)$' -and $port -ge [int]$Matches[1] -and $port -le [int]$Matches[2])){$portMatch=$true}
        }}
        $interfaceMatch=($rule.interfaces -contains 'Any' -or $rule.interfaces -contains '*' -or $rule.interfaces -contains $Plan.adapter.name)
        if($portMatch -and $interfaceMatch -and $rule.enabled -ne $false -and $rule.action -eq 'Block' -and ($rule.profiles -contains 'Any' -or $rule.profiles -contains 'Private') -and ($rule.program -eq 'Any' -or $rule.program -ieq $Plan.nodePath) -and $rule.protocol -in @('Any','TCP','6','256')){throw 'UNABLE_TO_MANAGE_BLOCK'}
    }
}
function New-BoundedRule($Spec) {
    New-NetFirewallRule -PolicyStore PersistentStore -Name $Spec.name -DisplayName ('YAPLIX LAN TCP '+($Spec.ports -join ', ')) -Group $Spec.group -Description $Spec.description -Direction Inbound -Action Allow -Enabled True -Profile Private -Protocol TCP -LocalPort $Spec.ports -Program $Spec.program -InterfaceAlias ([System.Management.Automation.WildcardPattern]::Escape($Spec.adapter.name)) -LocalAddress $Spec.subnet -RemoteAddress $Spec.subnet -EdgeTraversalPolicy Block | Out-Null
}
function Restore-BoundedRule($Rule) {
    $enabled=if($Rule.enabled){'True'}else{'False'}
    New-NetFirewallRule -PolicyStore PersistentStore -Name $Rule.name -DisplayName ('YAPLIX LAN restored '+$Rule.name) -Group $Rule.group -Description $Rule.description -Direction Inbound -Action Allow -Enabled $enabled -Profile Private -Protocol TCP -LocalPort $Rule.ports -Program $Rule.program -InterfaceAlias ([System.Management.Automation.WildcardPattern]::Escape($Rule.interfaces[0])) -LocalAddress $Rule.local -RemoteAddress $Rule.remote -EdgeTraversalPolicy Block | Out-Null
}
function Invoke-LanApply($Plan) {
    $created=@();$removed=@()
    try {
        Assert-Plan $Plan (Get-LanSnapshot)
        foreach($spec in @($Plan.add)) {$created+=,$spec;New-BoundedRule $spec}
        # Recheck policy/Block/physical adapter after creating, before deleting.
        $after=Get-LanSnapshot
        $recheck=$Plan | ConvertTo-Json -Depth 12 | ConvertFrom-Json
        $recheck.add=@()
        Assert-Plan $recheck $after
        foreach($spec in $created) {
            $active=@($after.rules | Where-Object name -CEQ $spec.name)
            if($active.Count -ne 1 -or $active[0].action -ne 'Allow' -or -not $active[0].enabled -or -not $active[0].unconditional -or ($active[0].profiles -join ',') -cne 'Private' -or ($active[0].ports -join ',') -cne ($spec.ports -join ',') -or $active[0].program -ine $spec.program -or ($active[0].local -join ',') -cne $spec.subnet -or ($active[0].remote -join ',') -cne $spec.subnet -or ($active[0].interfaces -join ',') -cne $spec.adapter.name){throw 'RULE_NOT_EFFECTIVE'}
        }
        foreach($rule in @($Plan.remove)) {
            $current=@(Get-NetFirewallRule -PolicyStore PersistentStore -Name $rule.name | ForEach-Object {Read-LanRule $_})
            if($current.Count -ne 1 -or (ConvertTo-Json $current[0] -Compress -Depth 10) -cne (ConvertTo-Json $rule -Compress -Depth 10)){throw 'RULE_CHANGED'}
            $removed+=,$rule
            Get-NetFirewallRule -PolicyStore PersistentStore -Name $rule.name | Remove-NetFirewallRule
            if(@(Get-NetFirewallRule -PolicyStore PersistentStore | Where-Object Name -CEQ $rule.name).Count){throw 'REMOVAL_NOT_VERIFIED'}
        }
        return @{code='applied'}
    } catch {
        $rollback=$true
        # A cmdlet can mutate and then throw. Re-read every attempted operation;
        # restore the old access before cleaning up a newly created replacement.
        foreach($rule in $removed){try{
            $current=@(Get-NetFirewallRule -PolicyStore PersistentStore | Where-Object Name -CEQ $rule.name | ForEach-Object {Read-LanRule $_})
            if(-not $current.Count){Restore-BoundedRule $rule}
            $verified=@(Get-NetFirewallRule -PolicyStore PersistentStore | Where-Object Name -CEQ $rule.name | ForEach-Object {Read-LanRule $_})
            if($verified.Count -ne 1 -or (ConvertTo-Json $verified[0] -Compress -Depth 10) -cne (ConvertTo-Json $rule -Compress -Depth 10)){$rollback=$false}
        }catch{$rollback=$false}}
        if($rollback){foreach($spec in $created){try{
            Get-NetFirewallRule -PolicyStore PersistentStore | Where-Object {$_.Name -ceq $spec.name -and $_.Group -ceq $spec.group -and $_.Description -ceq $spec.description} | Remove-NetFirewallRule
            if(@(Get-NetFirewallRule -PolicyStore PersistentStore | Where-Object Name -CEQ $spec.name).Count){$rollback=$false}
        }catch{$rollback=$false}}}
        return @{code=$(if($rollback){'failed_rolled_back'}else{'failed_rollback_incomplete'})}
    }
}
if($MyInvocation.InvocationName -ne '.') {
    if($Mode -eq 'Inspect'){Get-LanSnapshot | ConvertTo-Json -Compress -Depth 12;exit 0}
    if(-not [IO.Path]::IsPathRooted($PlanPath) -or $PlanPath -match '["\r\n]' -or (Get-Item -LiteralPath $PlanPath).Length -gt 131072){throw 'INVALID_PLAN_PATH'}
    if($Mode -eq 'Elevate') {
        # ArgumentList is a quoted Windows argv string, never a -Command expression.
        $exe=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $arguments='-NoProfile -NonInteractive -File "'+$PSCommandPath+'" -Mode Apply -PlanPath "'+$PlanPath+'"'
        try{
            $child=Start-Process -FilePath $exe -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru
            $code=switch($child.ExitCode){0 {'applied'};30 {'failed_rolled_back'};31 {'failed_rollback_incomplete'};default {'unable_to_manage'}}
        }catch{$code='cancelled_or_unavailable'}
        # Only the unelevated parent writes a result beside the owner's plan.
        @{code=$code} | ConvertTo-Json -Compress | Set-Content -LiteralPath ($PlanPath+'.result') -Encoding UTF8
    } else {
        $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
        if(-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMIN_REQUIRED'}
        $plan=Get-Content -LiteralPath $PlanPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $result=Invoke-LanApply $plan
        switch($result.code){'applied'{exit 0};'failed_rolled_back'{exit 30};default{exit 31}}
    }
}
