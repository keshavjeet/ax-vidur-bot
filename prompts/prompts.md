```Prompt for audio playback in node-downstream
node-downstream should be able to receive audio stream through websocket and playback the same audio stream.
```

```
create separate folder in node-downstream and implement the integration of live audio stream to the Gemini Live API and OpenAI Realtime API.

Please note that
1. There should be a switch to test the simple echo, openAI and gemini
2. with test client only local testing will be done, but the final production test will happen from teams bot which will callback to the websocket exposed by the node-downstream app. The final solution will have a team's bot talk to the end user vial gemini/open ai realtime model.


```

```
create a simple frontend page app in react js in ax-vidur-bot, voice-stream-fe.
This should show a video call view with two participants.
a) The user
b) The Vidur bot.
The voice should stream to the node-downstream app as websocket.
The response coming from the node-downstream should play in the app.

Give standard, mute, start,end button etc.
```
