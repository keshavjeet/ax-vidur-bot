using System.Net.WebSockets;
using System.Text;
using System.Threading.Channels;

namespace EchoBot.Bot
{
    /// <summary>
    /// Per-call websocket bridge for forwarding PCM audio to a downstream service.
    /// </summary>
    internal sealed class DownstreamAudioBridge : IAsyncDisposable
    {
        private readonly string _callId;
        private readonly Uri _uri;
        private readonly ILogger _logger;
        private readonly int _connectTimeoutMs;
        private readonly bool _reconnectEnabled;
        private readonly Action<byte[]> _onAudioReceived;
        private readonly Action<string> _onControlEvent;
        private readonly Channel<byte[]> _sendQueue;
        private readonly CancellationTokenSource _cts = new();
        private readonly SemaphoreSlim _connectGate = new(1, 1);
        private readonly object _socketLock = new();
        private ClientWebSocket? _socket;
        private Task? _senderTask;
        private Task? _receiverTask;
        private bool _started;

        public DownstreamAudioBridge(
            string callId,
            string websocketUrl,
            int connectTimeoutMs,
            bool reconnectEnabled,
            ILogger logger,
            Action<byte[]> onAudioReceived,
            Action<string> onControlEvent
        )
        {
            _callId = callId;
            _uri = new Uri(websocketUrl);
            _connectTimeoutMs = connectTimeoutMs <= 0 ? 5000 : connectTimeoutMs;
            _reconnectEnabled = reconnectEnabled;
            _logger = logger;
            _onAudioReceived = onAudioReceived;
            _onControlEvent = onControlEvent;
            _sendQueue = Channel.CreateBounded<byte[]>(
                new BoundedChannelOptions(256)
                {
                    FullMode = BoundedChannelFullMode.DropOldest,
                    SingleReader = true,
                    SingleWriter = false
                });
        }

        public async Task StartAsync(CancellationToken cancellationToken = default)
        {
            if (_started)
            {
                return;
            }
            _started = true;

            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token, cancellationToken);
            await EnsureConnectedAsync(linkedCts.Token).ConfigureAwait(false);

            _senderTask = Task.Run(() => SenderLoopAsync(_cts.Token));
            _receiverTask = Task.Run(() => ReceiverSupervisorLoopAsync(_cts.Token));
        }

        public bool TryQueuePcm(byte[] pcm16Bytes)
        {
            if (pcm16Bytes.Length == 0 || _cts.IsCancellationRequested)
            {
                return false;
            }
            return _sendQueue.Writer.TryWrite(pcm16Bytes);
        }

        public async Task StopAsync()
        {
            if (_cts.IsCancellationRequested)
            {
                return;
            }

            _cts.Cancel();
            _sendQueue.Writer.TryComplete();

            try
            {
                if (_senderTask != null)
                {
                    await _senderTask.ConfigureAwait(false);
                }
                if (_receiverTask != null)
                {
                    await _receiverTask.ConfigureAwait(false);
                }
            }
            catch (OperationCanceledException)
            {
                // Shutdown path
            }

            await CloseAndDisposeSocketAsync().ConfigureAwait(false);
        }

        private async Task SenderLoopAsync(CancellationToken cancellationToken)
        {
            try
            {
                while (await _sendQueue.Reader.WaitToReadAsync(cancellationToken).ConfigureAwait(false))
                {
                    while (_sendQueue.Reader.TryRead(out var payload))
                    {
                        var connected = await EnsureConnectedAsync(cancellationToken).ConfigureAwait(false);
                        if (!connected)
                        {
                            continue;
                        }

                        var socket = GetSocket();
                        if (socket == null)
                        {
                            continue;
                        }

                        try
                        {
                            await socket.SendAsync(
                                payload,
                                WebSocketMessageType.Binary,
                                endOfMessage: true,
                                cancellationToken).ConfigureAwait(false);
                        }
                        catch (Exception ex) when (ex is WebSocketException || ex is OperationCanceledException)
                        {
                            _logger.LogWarning(ex, "Downstream send failed for call {CallId}", _callId);
                            await InvalidateSocketAsync().ConfigureAwait(false);
                        }
                    }
                }
            }
            catch (OperationCanceledException)
            {
                // Shutdown path
            }
        }

        private async Task ReceiverSupervisorLoopAsync(CancellationToken cancellationToken)
        {
            try
            {
                while (!cancellationToken.IsCancellationRequested)
                {
                    var connected = await EnsureConnectedAsync(cancellationToken).ConfigureAwait(false);
                    if (!connected)
                    {
                        if (!_reconnectEnabled)
                        {
                            return;
                        }
                        await Task.Delay(1000, cancellationToken).ConfigureAwait(false);
                        continue;
                    }

                    await ReceiveLoopAsync(cancellationToken).ConfigureAwait(false);

                    if (!_reconnectEnabled)
                    {
                        return;
                    }

                    await Task.Delay(1000, cancellationToken).ConfigureAwait(false);
                }
            }
            catch (OperationCanceledException)
            {
                // Shutdown path
            }
        }

        private async Task ReceiveLoopAsync(CancellationToken cancellationToken)
        {
            var receiveBuffer = new byte[8192];
            using var messageBuffer = new MemoryStream();
            while (!cancellationToken.IsCancellationRequested)
            {
                var socket = GetSocket();
                if (socket == null || socket.State != WebSocketState.Open)
                {
                    return;
                }

                WebSocketReceiveResult result;
                try
                {
                    result = await socket.ReceiveAsync(receiveBuffer, cancellationToken).ConfigureAwait(false);
                }
                catch (Exception ex) when (ex is WebSocketException || ex is OperationCanceledException)
                {
                    _logger.LogWarning(ex, "Downstream receive failed for call {CallId}", _callId);
                    await InvalidateSocketAsync().ConfigureAwait(false);
                    return;
                }

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    _logger.LogInformation("Downstream closed websocket for call {CallId}", _callId);
                    await InvalidateSocketAsync().ConfigureAwait(false);
                    return;
                }

                if (result.Count > 0)
                {
                    messageBuffer.Write(receiveBuffer, 0, result.Count);
                }

                if (!result.EndOfMessage)
                {
                    continue;
                }

                var payload = messageBuffer.ToArray();
                messageBuffer.SetLength(0);

                if (result.MessageType == WebSocketMessageType.Binary)
                {
                    if (payload.Length > 0)
                    {
                        _onAudioReceived(payload);
                    }
                    continue;
                }

                var text = Encoding.UTF8.GetString(payload);
                _onControlEvent(text);
            }
        }

        private async Task<bool> EnsureConnectedAsync(CancellationToken cancellationToken)
        {
            var existing = GetSocket();
            if (existing != null && existing.State == WebSocketState.Open)
            {
                return true;
            }

            await _connectGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                existing = GetSocket();
                if (existing != null && existing.State == WebSocketState.Open)
                {
                    return true;
                }

                await CloseAndDisposeSocketAsync().ConfigureAwait(false);

                var socket = new ClientWebSocket();
                using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                timeoutCts.CancelAfter(_connectTimeoutMs);
                try
                {
                    await socket.ConnectAsync(_uri, timeoutCts.Token).ConfigureAwait(false);
                    SetSocket(socket);
                    _logger.LogInformation("Connected downstream websocket for call {CallId} => {Uri}", _callId, _uri);
                    return true;
                }
                catch (Exception ex) when (ex is WebSocketException || ex is OperationCanceledException)
                {
                    socket.Dispose();
                    _logger.LogWarning(ex, "Failed connecting downstream websocket for call {CallId} => {Uri}", _callId, _uri);
                    return false;
                }
            }
            finally
            {
                _connectGate.Release();
            }
        }

        private async Task InvalidateSocketAsync()
        {
            await _connectGate.WaitAsync().ConfigureAwait(false);
            try
            {
                await CloseAndDisposeSocketAsync().ConfigureAwait(false);
            }
            finally
            {
                _connectGate.Release();
            }
        }

        private ClientWebSocket? GetSocket()
        {
            lock (_socketLock)
            {
                return _socket;
            }
        }

        private void SetSocket(ClientWebSocket socket)
        {
            lock (_socketLock)
            {
                _socket = socket;
            }
        }

        private async Task CloseAndDisposeSocketAsync()
        {
            ClientWebSocket? socket;
            lock (_socketLock)
            {
                socket = _socket;
                _socket = null;
            }

            if (socket == null)
            {
                return;
            }

            try
            {
                if (socket.State == WebSocketState.Open || socket.State == WebSocketState.CloseReceived)
                {
                    await socket.CloseAsync(
                        WebSocketCloseStatus.NormalClosure,
                        "shutdown",
                        CancellationToken.None).ConfigureAwait(false);
                }
            }
            catch (Exception)
            {
                // Ignore shutdown exceptions.
            }
            finally
            {
                socket.Dispose();
            }
        }

        public async ValueTask DisposeAsync()
        {
            await StopAsync().ConfigureAwait(false);
            _connectGate.Dispose();
            _cts.Dispose();
        }
    }
}
