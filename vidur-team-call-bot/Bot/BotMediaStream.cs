// ***********************************************************************
// Assembly         : EchoBot.Services
// Author           : JasonTheDeveloper
// Created          : 09-07-2020
//
// Last Modified By : bcage29
// Last Modified On : 10-17-2023
// ***********************************************************************
// <copyright file="BotMediaStream.cs" company="Microsoft Corporation">
//     Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.
// </copyright>
// <summary>The bot media stream.</summary>
// ***********************************************************************-
using EchoBot.Media;
using EchoBot.Util;
using Microsoft.Graph.Communications.Calls;
using Microsoft.Graph.Communications.Calls.Media;
using Microsoft.Graph.Communications.Common;
using Microsoft.Graph.Communications.Common.Telemetry;
using Microsoft.Skype.Bots.Media;
using Microsoft.Skype.Internal.Media.Services.Common;
using System.Runtime.InteropServices;
using System.Threading.Channels;

namespace EchoBot.Bot
{
    /// <summary>
    /// Class responsible for streaming audio and video.
    /// </summary>
    public class BotMediaStream : ObjectRootDisposable
    {
        private const int Pcm16KFrameBytes = 640;
        private AppSettings _settings;
        private readonly string _callId;
        private readonly AudioBridgeMode _audioBridgeMode;

        /// <summary>
        /// The participants
        /// </summary>
        internal List<IParticipant> participants;

        /// <summary>
        /// The audio socket
        /// </summary>
        private readonly IAudioSocket _audioSocket;
        /// <summary>
        /// The media stream
        /// </summary>
        private readonly ILogger _logger;
        private AudioVideoFramePlayer audioVideoFramePlayer;
        private readonly TaskCompletionSource<bool> audioSendStatusActive;
        private readonly TaskCompletionSource<bool> startVideoPlayerCompleted;
        private AudioVideoFramePlayerSettings audioVideoFramePlayerSettings;
        private List<AudioMediaBuffer> audioMediaBuffers = new List<AudioMediaBuffer>();
        private int shutdown;
        private int _audioReceivedCount;
        private readonly SpeechService? _languageService;
        private readonly DownstreamAudioBridge? _downstreamBridge;
        private readonly Channel<byte[]>? _downstreamPlaybackFrames;
        private readonly CancellationTokenSource? _downstreamPlaybackCts;
        private Task? _downstreamPlaybackTask;
        private readonly SemaphoreSlim _enqueueLock = new(1, 1);
        private readonly object _downstreamRemainderLock = new();
        private byte[] _downstreamRemainder = Array.Empty<byte>();

        /// <summary>
        /// Initializes a new instance of the <see cref="BotMediaStream" /> class.
        /// </summary>
        /// <param name="mediaSession">The media session.</param>
        /// <param name="callId">The call identity</param>
        /// <param name="graphLogger">The Graph logger.</param>
        /// <param name="logger">The logger.</param>
        /// <param name="settings">Azure settings</param>
        /// <exception cref="InvalidOperationException">A mediaSession needs to have at least an audioSocket</exception>
        public BotMediaStream(
            ILocalMediaSession mediaSession,
            string callId,
            IGraphLogger graphLogger,
            ILogger logger,
            AppSettings settings
        )
            : base(graphLogger)
        {
            ArgumentVerifier.ThrowOnNullArgument(mediaSession, nameof(mediaSession));
            ArgumentVerifier.ThrowOnNullArgument(logger, nameof(logger));
            ArgumentVerifier.ThrowOnNullArgument(settings, nameof(settings));

            _settings = settings;
            _logger = logger;
            _callId = callId;
            _audioBridgeMode = ResolveAudioBridgeMode(settings);

            this.participants = new List<IParticipant>();

            this.audioSendStatusActive = new TaskCompletionSource<bool>();
            this.startVideoPlayerCompleted = new TaskCompletionSource<bool>();

            // Subscribe to the audio media.
            this._audioSocket = mediaSession.AudioSocket;
            if (this._audioSocket == null)
            {
                throw new InvalidOperationException("A mediaSession needs to have at least an audioSocket");
            }

            _ = this.StartAudioVideoFramePlayerAsync().ForgetAndLogExceptionAsync(this.GraphLogger, "Failed to start the player");

            this._audioSocket.AudioSendStatusChanged += OnAudioSendStatusChanged;            

            this._audioSocket.AudioMediaReceived += this.OnAudioMediaReceived;

            if (_audioBridgeMode == AudioBridgeMode.Speech)
            {
                _languageService = new SpeechService(_settings, _logger);
                _languageService.SendMediaBuffer += this.OnSendMediaBuffer;
            }

            if (_audioBridgeMode == AudioBridgeMode.Downstream)
            {
                _downstreamPlaybackFrames = Channel.CreateBounded<byte[]>(
                    new BoundedChannelOptions(512)
                    {
                        FullMode = BoundedChannelFullMode.DropOldest,
                        SingleReader = true,
                        SingleWriter = false
                    });
                _downstreamPlaybackCts = new CancellationTokenSource();
                _downstreamBridge = new DownstreamAudioBridge(
                    _callId,
                    _settings.DownstreamWebSocketUrl,
                    _settings.DownstreamConnectTimeoutMs,
                    _settings.DownstreamReconnectEnabled,
                    _logger,
                    OnDownstreamAudioReceived,
                    OnDownstreamControlEvent);
                _ = StartDownstreamBridgeAsync().ForgetAndLogExceptionAsync(
                    this.GraphLogger,
                    "Failed to start downstream websocket bridge");
            }
        }

        /// <summary>
        /// Gets the participants.
        /// </summary>
        /// <returns>List&lt;IParticipant&gt;.</returns>
        public List<IParticipant> GetParticipants()
        {
            return participants;
        }

        /// <summary>
        /// Shut down.
        /// </summary>
        /// <returns><see cref="Task" />.</returns>
        public async Task ShutdownAsync()
        {
            if (Interlocked.CompareExchange(ref this.shutdown, 1, 1) == 1)
            {
                return;
            }

            await this.startVideoPlayerCompleted.Task.ConfigureAwait(false);

            // unsubscribe
            if (this._audioSocket != null)
            {
                this._audioSocket.AudioSendStatusChanged -= this.OnAudioSendStatusChanged;
                this._audioSocket.AudioMediaReceived -= this.OnAudioMediaReceived;
            }

            if (_languageService != null)
            {
                _languageService.SendMediaBuffer -= this.OnSendMediaBuffer;
            }

            if (_downstreamPlaybackCts != null)
            {
                _downstreamPlaybackCts.Cancel();
            }
            _downstreamPlaybackFrames?.Writer.TryComplete();
            if (_downstreamBridge != null)
            {
                await _downstreamBridge.StopAsync().ConfigureAwait(false);
            }
            if (_downstreamPlaybackTask != null)
            {
                await _downstreamPlaybackTask.ConfigureAwait(false);
            }

            // shutting down the players
            if (this.audioVideoFramePlayer != null)
            {
                await this.audioVideoFramePlayer.ShutdownAsync().ConfigureAwait(false);
            }

            // make sure all the audio and video buffers are disposed, it can happen that,
            // the buffers were not enqueued but the call was disposed if the caller hangs up quickly
            foreach (var audioMediaBuffer in this.audioMediaBuffers)
            {
                audioMediaBuffer.Dispose();
            }

            _logger.LogInformation($"disposed {this.audioMediaBuffers.Count} audioMediaBUffers.");

            this.audioMediaBuffers.Clear();
            _enqueueLock.Dispose();
            _downstreamPlaybackCts?.Dispose();
        }

        /// <summary>
        /// Initialize AV frame player.
        /// </summary>
        /// <returns>Task denoting creation of the player with initial frames enqueued.</returns>
        private async Task StartAudioVideoFramePlayerAsync()
        {
            try
            {
                _logger.LogInformation("Send status active for audio and video Creating the audio video player");
                this.audioVideoFramePlayerSettings =
                    new AudioVideoFramePlayerSettings(new AudioSettings(20), new VideoSettings(), 1000);
                this.audioVideoFramePlayer = new AudioVideoFramePlayer(
                    (AudioSocket)_audioSocket,
                    null,
                    this.audioVideoFramePlayerSettings);

                _logger.LogInformation("created the audio video player");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to create the audioVideoFramePlayer with exception");
            }
            finally
            {
                this.startVideoPlayerCompleted.TrySetResult(true);
            }
        }

        /// <summary>
        /// Callback for informational updates from the media plaform about audio status changes.
        /// Once the status becomes active, audio can be loopbacked.
        /// </summary>
        /// <param name="sender">The audio socket.</param>
        /// <param name="e">Event arguments.</param>
        private void OnAudioSendStatusChanged(object? sender, AudioSendStatusChangedEventArgs e)
        {
            _logger.LogTrace($"[AudioSendStatusChangedEventArgs(MediaSendStatus={e.MediaSendStatus})]");

            if (e.MediaSendStatus == MediaSendStatus.Active)
            {
                this.audioSendStatusActive.TrySetResult(true);
            }
        }

        /// <summary>
        /// Receive audio from subscribed participant.
        /// </summary>
        /// <param name="sender">The sender.</param>
        /// <param name="e">The audio media received arguments.</param>
        private async void OnAudioMediaReceived(object? sender, AudioMediaReceivedEventArgs e)
        {
            if (Interlocked.Increment(ref _audioReceivedCount) == 1)
            {
                _logger.LogInformation(
                    "First audio received - media receive path active. Mode={Mode} CallId={CallId}",
                    _audioBridgeMode,
                    _callId);
            }
            _logger.LogTrace($"Received Audio: [AudioMediaReceivedEventArgs(Data=<{e.Buffer.Data.ToString()}>, Length={e.Buffer.Length}, Timestamp={e.Buffer.Timestamp})]");

            try
            {
                if (!startVideoPlayerCompleted.Task.IsCompleted) { return; }

                if (_audioBridgeMode == AudioBridgeMode.Speech && _languageService != null)
                {
                    // send audio buffer to language service for processing
                    // the particpant talking will hear the bot repeat what they said
                    await _languageService.AppendAudioBuffer(e.Buffer);
                    return;
                }

                var length = e.Buffer.Length;
                if (length <= 0)
                {
                    return;
                }

                var buffer = new byte[length];
                Marshal.Copy(e.Buffer.Data, buffer, 0, (int)length);

                if (_audioBridgeMode == AudioBridgeMode.Downstream && _downstreamBridge != null)
                {
                    if (!_downstreamBridge.TryQueuePcm(buffer))
                    {
                        _logger.LogWarning("Dropped outbound downstream PCM frame for call {CallId}", _callId);
                    }
                    return;
                }

                // echo mode: send audio buffer back on the audio socket
                // the participant talking will hear themselves
                await EnqueuePcmForTeamsAsync(buffer).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                this.GraphLogger.Error(ex);
                _logger.LogError(ex, "OnAudioMediaReceived error");
            }
            finally
            {
                e.Buffer.Dispose();
            }
        }

        private void OnSendMediaBuffer(object? sender, Media.MediaStreamEventArgs e)
        {
            if (_audioBridgeMode != AudioBridgeMode.Speech)
            {
                return;
            }
            _ = EnqueueSpeechBuffersAsync(e.AudioMediaBuffers)
                .ForgetAndLogExceptionAsync(this.GraphLogger, "Failed to enqueue speech media buffers");
        }

        private AudioBridgeMode ResolveAudioBridgeMode(AppSettings settings)
        {
            var requestedMode = settings.AudioBridgeMode?.Trim().ToLowerInvariant();
            if (string.IsNullOrWhiteSpace(requestedMode))
            {
                requestedMode = settings.UseSpeechService ? "speech" : "echo";
            }

            if (settings.UseSpeechService && requestedMode != "speech")
            {
                throw new InvalidOperationException(
                    "UseSpeechService=true conflicts with AudioBridgeMode. Set AudioBridgeMode=speech or set UseSpeechService=false.");
            }

            if (requestedMode == "echo")
            {
                return AudioBridgeMode.Echo;
            }
            if (requestedMode == "speech")
            {
                return AudioBridgeMode.Speech;
            }
            if (requestedMode == "downstream")
            {
                if (string.IsNullOrWhiteSpace(settings.DownstreamWebSocketUrl))
                {
                    throw new InvalidOperationException(
                        "DownstreamWebSocketUrl is required when AudioBridgeMode=downstream.");
                }
                return AudioBridgeMode.Downstream;
            }
            throw new InvalidOperationException(
                $"Unsupported AudioBridgeMode '{settings.AudioBridgeMode}'. Valid values: echo, speech, downstream.");
        }

        private async Task StartDownstreamBridgeAsync()
        {
            if (_downstreamBridge == null || _downstreamPlaybackFrames == null || _downstreamPlaybackCts == null)
            {
                return;
            }

            _logger.LogInformation("Starting downstream websocket bridge for call {CallId}", _callId);
            _downstreamPlaybackTask = Task.Run(() => DownstreamPlaybackLoopAsync(_downstreamPlaybackCts.Token));
            await _downstreamBridge.StartAsync(_downstreamPlaybackCts.Token).ConfigureAwait(false);
        }

        private void OnDownstreamAudioReceived(byte[] payload)
        {
            if (_downstreamPlaybackFrames == null || payload.Length == 0)
            {
                return;
            }

            lock (_downstreamRemainderLock)
            {
                var combined = new byte[_downstreamRemainder.Length + payload.Length];
                if (_downstreamRemainder.Length > 0)
                {
                    Buffer.BlockCopy(_downstreamRemainder, 0, combined, 0, _downstreamRemainder.Length);
                }
                Buffer.BlockCopy(payload, 0, combined, _downstreamRemainder.Length, payload.Length);

                var offset = 0;
                while (combined.Length - offset >= Pcm16KFrameBytes)
                {
                    var frame = new byte[Pcm16KFrameBytes];
                    Buffer.BlockCopy(combined, offset, frame, 0, Pcm16KFrameBytes);
                    offset += Pcm16KFrameBytes;
                    if (!_downstreamPlaybackFrames.Writer.TryWrite(frame))
                    {
                        _logger.LogWarning("Dropped inbound downstream PCM frame for call {CallId}", _callId);
                    }
                }

                var remainderLength = combined.Length - offset;
                if (remainderLength > 0)
                {
                    _downstreamRemainder = new byte[remainderLength];
                    Buffer.BlockCopy(combined, offset, _downstreamRemainder, 0, remainderLength);
                }
                else
                {
                    _downstreamRemainder = Array.Empty<byte>();
                }
            }
        }

        private void OnDownstreamControlEvent(string message)
        {
            _logger.LogInformation("Downstream control event call={CallId}: {Message}", _callId, message);
        }

        private async Task DownstreamPlaybackLoopAsync(CancellationToken cancellationToken)
        {
            if (_downstreamPlaybackFrames == null)
            {
                return;
            }

            await startVideoPlayerCompleted.Task.ConfigureAwait(false);
            try
            {
                while (await _downstreamPlaybackFrames.Reader.WaitToReadAsync(cancellationToken).ConfigureAwait(false))
                {
                    while (_downstreamPlaybackFrames.Reader.TryRead(out var frame))
                    {
                        await EnqueuePcmForTeamsAsync(frame).ConfigureAwait(false);
                        await Task.Delay(20, cancellationToken).ConfigureAwait(false);
                    }
                }
            }
            catch (OperationCanceledException)
            {
                // Shutdown path.
            }
        }

        private async Task EnqueuePcmForTeamsAsync(byte[] pcmBytes)
        {
            if (pcmBytes.Length < Pcm16KFrameBytes)
            {
                return;
            }

            for (var offset = 0; offset + Pcm16KFrameBytes <= pcmBytes.Length; offset += Pcm16KFrameBytes)
            {
                var frame = new byte[Pcm16KFrameBytes];
                Buffer.BlockCopy(pcmBytes, offset, frame, 0, Pcm16KFrameBytes);
                await _enqueueLock.WaitAsync().ConfigureAwait(false);
                try
                {
                    var currentTick = DateTime.Now.Ticks;
                    this.audioMediaBuffers = Util.Utilities.CreateAudioMediaBuffers(frame, currentTick, _logger);
                    await this.audioVideoFramePlayer.EnqueueBuffersAsync(
                        this.audioMediaBuffers,
                        new List<VideoMediaBuffer>()).ConfigureAwait(false);
                }
                finally
                {
                    _enqueueLock.Release();
                }
            }
        }

        private async Task EnqueueSpeechBuffersAsync(List<AudioMediaBuffer> buffers)
        {
            await _enqueueLock.WaitAsync().ConfigureAwait(false);
            try
            {
                this.audioMediaBuffers = buffers;
                await this.audioVideoFramePlayer.EnqueueBuffersAsync(
                    this.audioMediaBuffers,
                    new List<VideoMediaBuffer>()).ConfigureAwait(false);
            }
            finally
            {
                _enqueueLock.Release();
            }
        }

        private enum AudioBridgeMode
        {
            Echo,
            Speech,
            Downstream
        }
    }
}

