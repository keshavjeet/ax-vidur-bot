const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8081;

const wss = new WebSocket.Server({ port: PORT });

wss.on('listening', () => {
  console.log(`Node downstream bridge listening on ws://localhost:${PORT}`);
});

wss.on('connection', (socket) => {
  console.log('MediaAdapter connected to downstream bridge');

  // echo incoming audio for now
  socket.on('message', (data) => {
    if (Buffer.isBuffer(data)) {
      console.log(`received ${data.length} bytes from MediaAdapter`);
    }
  });

  socket.on('close', () => {
    console.log('MediaAdapter disconnected');
  });
  const generator = createGreetingGenerator();
  const interval = setInterval(() => {
    const chunk = generator.next().value;
    if (chunk) {
      socket.send(chunk);
    }
  }, 20);

  socket.on('close', () => {
    clearInterval(interval);
    console.log('Greeting stream stopped');
  });
});

function* createGreetingGenerator() {
  const sampleRate = 16000;
  const frequency = 440;
  const samplesPerChunk = 640;
  const amplitude = 10000;
  let phase = 0;
  while (true) {
    const buffer = Buffer.alloc(samplesPerChunk * 2);
    for (let i = 0; i < samplesPerChunk; i += 1) {
      const sample = Math.round(amplitude * Math.sin((2 * Math.PI * frequency * (i + phase)) / sampleRate));
      buffer.writeInt16LE(sample, i * 2);
    }
    phase += samplesPerChunk;
    yield buffer;
  }
}
