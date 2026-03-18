# Setting up the Vidur Bot

Vidur Bot currently works on Teams, as a Team's calling bot.

## Components of the Vidur Bot
Following are the different components that need to be set up:
1.  Azure Entra App Registration
    - You need to be a tenant admin to create an Azure Entra App Registration
2.  MS Teams, Bot Using - [dev.teams.microsoft.com](https://dev.teams.cloud.microsoft/home)
    - You need to be teams admin to set up the bot correctly
3.  MS Teams Admin
    - Approve the published bot in the Teams admin center
4.  Azure Bot Service
    - This must be connected to the Azure Entra App Registration
5. MS Teams approval from powershell
    - You need to run a powershell command to approve the bot
6.  Azure VM
    - VM deployed in **same Azure region as Teams workloads**


## 6. Azure VM Infrastructure

### 6.1 Set up an Azure VM with the following requirements:

-   Azure **Windows Server VM 2025 Data Center Edition**
-   Recommended OS: **Windows Server 2025**
-   VM size minimum 2 vCPUs / 2 cores
-   **RDP enabled (port 3389)**
-   **Local Administrator account for RDP**
        - Save the admin username and password for later use
-  Note the public IP address for later use
        - 20.246.68.158

### 6.2 Set up a DNS Name to map to the VM Public IP:
- Click on the public IP address in the Azure portal
- Click on Settings in the left Menu
- Click on the "Configure" 
- Enter a DNS name for the VM in the field - DNS name label (optional)
    - ax-vidur-bot-vm
- Save and wait for the DNS name to be propagated
- Save the DNS name for later use

### 6.3 Network Settings on the VM:
- Go to the VM in the Azure portal
- Click on Networking in the left Menu
- Click on the "Network Settings" 
- Create following Port Rule (Click onf Create Port Rule):
    -   **TCP 3389** -- RDP (Must be already there)
    -   **TCP 443** -- Teams callbacks / bot framework
    -   **TCP 8445** -- bot control plane / join endpoint
    -   **UDP 8445** -- bot control plane / join endpoint
    -   **UDP media port range (RTP)** UDP 49152 - 65535
    -   Allow port 80

### 6.4 Establish RDP to the VM:
- Use the public IP address and the admin username and password to establish RDP to the VM
- For Mac- Windows App will be required from App Store - Install and follow the instructions to connect to the VM

### 6.4 Add Windows Features:
- Open PowerShell as Administrator on the VM
- Run the following command to install Media Foundation:
```powershell
Install-WindowsFeature Server-Media-Foundation
```
- Verify the installation by running:
```powershell
Get-WindowsFeature Server-Media-Foundation
```
- Run the command to install IIS
```powershell
Install-WindowsFeature -name Web-Server -IncludeManagementTools
```

### 6.5 Install Dot Net 8.0
- Install using powershell command:
```powershell
winget install Microsoft.DotNet.HostingBundle.8
```
- Install Dot Net SDK 8.0 using powershell command:
```powershell
winget install Microsoft.DotNet.SDK.8
```
- Verify the installation by running:
```powershell
& "C:\Program Files\dotnet\dotnet.exe" --list-runtimes
```

### 6.6 Install Microsoft Visual C++ Redistributable 2015--2022 (x64)
- Install using powershell command:
```powershell
$vcUrl = "https://aka.ms/vs/17/release/vc_redist.x64.exe"
$installer = "C:\vc_redist.x64.exe"

Invoke-WebRequest $vcUrl -OutFile $installer
Start-Process $installer -ArgumentList "/install /quiet /norestart" -Wait
```
- Verify the installation by running:
```powershell
& Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64"
```
- Alternative method to verify:
```powershell
Get-ChildItem "HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes"
```
- Create New cerificate with default option
- Choose single binding if asked
-  Correctly put the DNS Name from the VM
------------------------------------------------------------------------

# 6.7 Open Ports Locally on the VM

- Port 80
```powershell
New-NetFirewallRule `
-DisplayName "Allow HTTP 80" `
-Direction Inbound `
-Protocol TCP `
-LocalPort 80 `
-Action Allow
```

- Port 443
```powershell
New-NetFirewallRule `
-DisplayName "Allow HTTPS 443" `
-Direction Inbound `
-Protocol TCP `
-LocalPort 443 `
-Action Allow
```

- Port for UDP
```powershell
New-NetFirewallRule `
-DisplayName "Teams Media UDP" `
-Direction Inbound `
-Protocol UDP `
-LocalPort 49152-65535 `
-Action Allow
```

- Port for UDP 8445
```powershell
New-NetFirewallRule `
-DisplayName "Teams Media UDP" `
-Direction Inbound `
-Protocol UDP `
-LocalPort 8445 `
-Action Allow
```

- Port for TCP 8445
```powershell
New-NetFirewallRule `
-DisplayName "Teams Media TCP" `
-Direction Inbound `
-Protocol TCP `
-LocalPort 8445 `
-Action Allow
```


# 6.8 SSL / TLS Configuration - Lets Encrypt - win-acme

- Use win-acme to obtain and install a free SSL certificate from Let's Encrypt
- Download win-acme
```powershell
$zipUrl = "https://github.com/win-acme/win-acme/releases/latest/download/win-acme.v2.2.9.1701.x64.pluggable.zip"
$zipPath = "C:\win-acme.zip"
$installDir = "C:\win-acme"

Invoke-WebRequest $zipUrl -OutFile $zipPath
Expand-Archive $zipPath -DestinationPath $installDir -Force
cd C:\win-acme
```
- Start certificate Request
```powershell
.\wacs.exe
```
- Verify Certificate
```powershell
Get-ChildItem Cert:\LocalMachine\My
```
- Copy and Paste the Certificate Thumbprint

Thumbprint                                Subject
----------                                -------
F56BA28A04DD325486B610607DBBB26C0AB4F976  DC=Windows Azure CRP Certificate Generator
BBD7842E7E0281422C4679C5577A3E94D4A45BD0  CN=ax-vidur-bot-vm.eastus2.cloudapp.azure.com

The one with the DNS Name is the one we need.

- Binding 443
    - Get a new GUID
    ```powershell
    [guid]::NewGuid()
    ```
    - Copy the GUID # 42113a12-08ef-4550-9f96-baeca3ea7726
    - Binding
    ```powershell
     netsh http add sslcert ipport=0.0.0.0:443 certhash=BBD7842E7E0281422C4679C5577A3E94D4A45BD0 appid="{42113a12-08ef-4550-9f96-baeca3ea7726}" certstorename=MY
    ```
- Binding 8445

```powershell
netsh http add sslcert ipport=0.0.0.0:8445 certhash=BBD7842E7E0281422C4679C5577A3E94D4A45BD0 appid="{42113a12-08ef-4550-9f96-baeca3ea7726}" certstorename=MY
```
     

- Test the connectivity from any other machine outside the VM
curl http://ax-vidur-bot-vm.eastus2.cloudapp.azure.com

------------------------------------------------------------------------

# 6.9 Install and configure git

- Run the winget command to install git
```powershell
winget install --id Git.Git -e --source winget
```
- Verify the installation
```powershell
git --version
```

- Set git config
```powershell
git config --global user.name "keshavjeet"
git config --global user.email "keshav.jeet@gmail.com"
```

- Git clone
```powershell
 git clone https://github.com/keshavjeet/ax-vidur-bot.git
```

# 6.10 Publish and Run
- Cd to the cloned repository
```powershell
cd ax-vidur-bot\vidur-team-call-bot
copy appsettings.example.json appsettings.json
notepad appsettings.json # Edit the configuration as needed
dotnet publish VidurTeamCallBot.csproj -c Release -r win-x64 --self-contained true -o publish
VidurTeamCallBot.exe
```
- Verify if the bot is running
```powershell
netstat -ano | findstr ":443"
netstat -ano | findstr ":8445"
# from another machine
curl -k -s https://ax-vidur-bot-vm.eastus2.cloudapp.azure.com/Health
```

- Get a meeting link (must be created in the same tenant as the bot and must be the full meeting url)
- Call the join meeting api with the meeting url (must be the log url)

```Terminal
curl -k -s -X POST "https://ax-vidur-bot-vm.eastus2.cloudapp.azure.com/Calls" \
  -H "Content-Type: application/json" \
  -d "{\"JoinUrl\":\"https://teams.microsoft.com/l/meetup-join/19%3ameeting_ZTUwOGIxY2YtZjFiZS00ZTM5LTgwNGEtNzRkOTNjYjg5MWU4%40thread.v2/0?context=%7b%22Tid%22%3a%22df94721f-849a-4439-bac1-3575268e60f5%22%2c%22Oid%22%3a%22b8acf5e0-5f4d-48f0-a0bf-c2bc25ad0817%22%7d\"}"
```
------------------------------------------------------------------------

# 6.11 Make sure the following:

- Publish output must contain libraries from:

    Microsoft.Graph.Communications
    Microsoft.Graph.Communications.Calls
    Microsoft.Graph.Communications.Calls.Media
    Microsoft.Skype.Bots.Media

Including native media platform binaries.


- The deployed VM must contain configuration for:

    ServiceDnsName
    MediaDnsName
    CertificateThumbprint
    AadAppId
    AadAppSecret
    Ports (443/8445)

    Stored in:

        appsettings.json

- Minimal “known-good” network checklist (what actually made it work)
    NSG inbound: TCP 443, TCP 8445, UDP 8445 (+ optional TCP 80)
    Windows Firewall inbound: TCP 443, TCP 8445, UDP 8445
    Cert installed in LocalMachine\My
    Cert bound to 8445 with netsh http add sslcert (+ urlacl)
    VM size: 2+ vCPU

- The VM must be reachable by:

    Microsoft Teams media servers
    Microsoft Graph callbacks
    Bot Framework service

Requires:

-   Public IP
-   Public DNS
-   Valid TLS certificate

- Make sure you use full meeting url to join the meeting (its generally available in the meeting invite in "System reference” link)
 eg https://teams.microsoft.com/l/meetup-join/19%3ameeting_ZTUwOGIxY2YtZjFiZS00ZTM5LTgwNGEtNzRkOTNjYjg5MWU4%40thread.v2/0?context=%7b%22Tid%22%3a%22df94721f-849a-4439-bac1-3575268e60f5%22%2c%22Oid%22%3a%22b8acf5e0-5f4d-48f0-a0bf-c2bc25ad0817%22%7d\
 
------------------------------------------------------------------------


