# ax-vidur-bot

Teams meeting bot that joins calls and echoes audio (based on Microsoft Graph Communications EchoBot). Ready to run on a Windows Server VM.

## Contents

- **vidur-team-call-bot** – .NET 8 bot app. Join Teams meetings via HTTP POST; bot echoes audio.
- **node-downstream** – Optional Node bridge (if you use it).

## Prerequisites (Windows Server VM)

1. **.NET 8 SDK** (to build) or **.NET 8 Runtime** (to run published app)  
   - [Download .NET 8](https://dotnet.microsoft.com/download/dotnet/8.0)

2. **SSL certificate**  
   - Installed in **Local Computer → Personal (My)** with private key.  
   - Thumbprint used in config (see below).

3. **Azure Bot (Calling)**  
   - App registration with Client ID and Secret.  
   - Bot configured for **Calls**; **Calling webhook** = `https://YOUR_VM_DNS/api/calling/notification`.

4. **Firewall**  
   - TCP **443** (HTTPS) and **8445** (media) open for the bot VM.

5. **Media port binding (required for media)**  
   - On the VM (run as Administrator):
   ```powershell
   netsh http add sslcert ipport=0.0.0.0:8445 certhash=YOUR_CERT_THUMBPRINT appid='{00000000-0000-0000-0000-000000000000}'
   netsh http add urlacl url=https://+:8445/ user=Everyone
   ```
   Replace `YOUR_CERT_THUMBPRINT` with the thumbprint (no spaces).

## Setup on a new Windows Server VM

1. **Clone the repo**
   ```powershell
   git clone https://github.com/YOUR_USERNAME/ax-vidur-bot.git
   cd ax-vidur-bot
   ```

2. **Configure the bot**
   - In `vidur-team-call-bot`, copy the example config and edit with your values:
   ```powershell
   cd vidur-team-call-bot
   copy appsettings.example.json appsettings.json
   notepad appsettings.json
   ```
   Set: `ServiceDnsName`, `MediaDnsName` (VM public DNS/FQDN), `CertificateThumbprint`, `AadAppId`, `AadAppSecret`.

3. **Build**
   ```powershell
   dotnet build VidurTeamCallBot.csproj -c Release
   ```

4. **Run**
   ```powershell
   .\bin\Release\net8.0\VidurTeamCallBot.exe
   ```
   Or publish a self-contained exe and run that:
   ```powershell
   dotnet publish VidurTeamCallBot.csproj -c Release -r win-x64 --self-contained true -o publish
   .\publish\VidurTeamCallBot.exe
   ```

5. **Azure Bot**  
   In Azure Portal → your Bot → Channels → Microsoft Teams → set **Calling webhook** to:
   `https://YOUR_VM_PUBLIC_DNS/api/calling/notification`

## Join a meeting from any machine

POST the Teams **long join URL** (from Calendar → meeting → “System reference” or “Copy join link” that starts with `https://teams.microsoft.com/l/meetup-join/...`):

```bash
curl -k -s -X POST "https://YOUR_VM_PUBLIC_DNS/Calls" \
  -H "Content-Type: application/json" \
  -d '{"JoinUrl":"FULL_TEAMS_MEETUP_JOIN_URL"}'
```

Success returns JSON with `callId`, `scenarioId`, `threadId`; the bot appears in the meeting and echoes audio.

## Stop the bot

- In the console: **Ctrl+C**
- Or: `taskkill /F /IM VidurTeamCallBot.exe`

## License

See project sources. Bot logic based on [Microsoft Graph Communications Samples](https://github.com/microsoftgraph/microsoft-graph-comms-samples).
