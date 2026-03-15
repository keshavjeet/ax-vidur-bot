# Vidur Team Call Bot

Teams meeting bot (based on Microsoft Graph Communications EchoBot). Joins meetings and echoes audio.

**First-time setup:** Copy `appsettings.example.json` to `appsettings.json` and set your VM DNS, certificate thumbprint, and Azure Bot (AadAppId, AadAppSecret). Do not commit `appsettings.json` (it contains secrets).

## Run the bot (on the VM)

From this folder:

```powershell
dotnet run --project VidurTeamCallBot.csproj -c Release
```

Or run the built executable:

```powershell
.\bin\Release\net8.0\VidurTeamCallBot.exe
```

The bot listens on **HTTPS 443** and **8445** (media). Ensure the certificate is installed and port 8445 is bound. Azure Bot **calling webhook** must be: `https://vidur-bot-dns.eastus.cloudapp.azure.com/api/calling/notification`.

## Join meeting from any machine (curl)

Replace `YOUR_TEAMS_MEETING_JOIN_URL` with the full Teams join link (e.g. from Calendar → Join).

```powershell
curl.exe -k -s -X POST "https://vidur-bot-dns.eastus.cloudapp.azure.com/Calls" -H "Content-Type: application/json" -d "{\"JoinUrl\":\"YOUR_TEAMS_MEETING_JOIN_URL\"}"
```

Using a JSON file:

1. Create `join-body.json` in this folder with: `{"JoinUrl":"YOUR_FULL_TEAMS_JOIN_URL"}` (use the long meetup-join URL from the meeting’s “System reference”).
2. Run: `curl.exe -k -s -X POST "https://YOUR_VM_DNS/Calls" -H "Content-Type: application/json" -d "@join-body.json"`

Success response includes `callId`, `scenarioId`, `threadId`. The bot joins the meeting; you should see it in the roster and hear echo when you speak.
