// ***********************************************************************
// Assembly         : EchoBot
// Author           : bcage29
// Created          : 10-27-2023
//
// Last Modified By : bcage29
// Last Modified On : 10-27-2023
// ***********************************************************************
// <copyright file="BotHost.cs" company="Microsoft">
//     Copyright ©  2023
// </copyright>
// <summary></summary>
// ***********************************************************************
using DotNetEnv.Configuration;
using EchoBot.Bot;
using EchoBot.Util;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Graph.Communications.Common.Telemetry;

namespace EchoBot
{
    /// <summary>
    /// Bot Web Application
    /// </summary>
    public class BotHost : IBotHost
    {
        private readonly ILogger<BotHost> _logger;
        private WebApplication? _app;

        /// <summary>
        /// Bot Host constructor
        /// </summary>
        /// <param name="logger"></param>
        public BotHost(ILogger<BotHost> logger)
        {
            _logger = logger;
        }

        /// <summary>
        /// Starting the Bot and Web App
        /// </summary>
        /// <returns></returns>
        public async Task StartAsync()
        {
            _logger.LogInformation("Starting the Echo Bot");
            // Set up the bot web application (content root = output dir so appsettings.Production.json is found when run as Worker)
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { ContentRootPath = AppContext.BaseDirectory });

            if (builder.Environment.IsDevelopment())
            {
                // load the .env file environment variables
                builder.Configuration.AddDotNetEnv();
            }

            // Add Environment Variables
            builder.Configuration.AddEnvironmentVariables(prefix: "AppSettings__");

            // Add services to the container.
            builder.Services.AddControllers();

            // Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
            builder.Services.AddEndpointsApiExplorer();
            builder.Services.AddSwaggerGen();

            var section = builder.Configuration.GetSection("AppSettings");
            var appSettings = section.Get<AppSettings>();
            if (appSettings == null)
            {
                throw new InvalidOperationException(
                    "AppSettings is null. Ensure appsettings.Production.json exists in the output directory and ASPNETCORE_ENVIRONMENT=Production.");
            }

            builder.Services
                .AddOptions<AppSettings>()
                .BindConfiguration(nameof(AppSettings))
                .ValidateDataAnnotations()
                .ValidateOnStart();

            builder.Services.AddSingleton<IGraphLogger, GraphLogger>(_ => new GraphLogger("EchoBotWorker", redirectToTrace: true));
            builder.Services.AddSingleton<IBotMediaLogger, BotMediaLogger>();
            builder.Logging.AddApplicationInsights();
            builder.Logging.SetMinimumLevel(LogLevel.Information);

            builder.Logging.AddEventLog(config => config.SourceName = "Echo Bot Service");

            builder.Services.AddSingleton<IBotService, BotService>();

            // Bot Settings Setup
            var botInternalHostingProtocol = "https";
            if (appSettings.UseLocalDevSettings)
            {
                // if running locally with ngrok
                // the call signalling and notification will use the same internal and external ports
                // because you cannot receive requests on the same tunnel with different ports

                // calls come in over 443 (external) and route to the internally hosted port: BotCallingInternalPort
                botInternalHostingProtocol = "http";

                builder.Services.PostConfigure<AppSettings>(options =>
                {
                    options.BotInstanceExternalPort = 443;
                    options.BotInternalPort = appSettings.BotCallingInternalPort;

                });
            }
            else
            {
                //appSettings.MediaDnsName = appSettings.ServiceDnsName;
                builder.Services.PostConfigure<AppSettings>(options =>
                {
                    options.MediaDnsName = appSettings.ServiceDnsName;
                });
            }

            // localhost
            var baseDomain = "+";

            // http for local development
            // https for running on VM
            var callListeningUris = new HashSet<string>
            {
                $"{botInternalHostingProtocol}://{baseDomain}:{appSettings.BotCallingInternalPort}/",
                $"{botInternalHostingProtocol}://{baseDomain}:{appSettings.BotInternalPort}/"
            };

            builder.WebHost.UseUrls(callListeningUris.ToArray());

            builder.WebHost.ConfigureKestrel(serverOptions =>
            {
                serverOptions.ConfigureHttpsDefaults(listenOptions =>
                {
                    listenOptions.ServerCertificate = Utilities.GetCertificateFromStore(appSettings.CertificateThumbprint);
                });
            });

            _app = builder.Build();

            using (var scope = _app.Services.CreateScope())
            {
                var bot = scope.ServiceProvider.GetRequiredService<IBotService>();
                bot.Initialize();
            }

            // Configure the HTTP request pipeline.
            if (_app.Environment.IsDevelopment())
            {
                // https://localhost:<port>/swagger
                _app.UseSwagger();
                _app.UseSwaggerUI();
            }

            _app.UseAuthorization();

            _app.MapControllers();

            var joinUrl = $"https://{appSettings.ServiceDnsName}/Calls";
            Console.WriteLine();
            Console.WriteLine("========================================");
            Console.WriteLine("  Vidur Team Call Bot is READY.");
            Console.WriteLine("  Listening on HTTPS and media port.");
            Console.WriteLine("  To join a meeting, POST to: " + joinUrl);
            Console.WriteLine("  Example: curl -k -X POST \"" + joinUrl + "\" -H \"Content-Type: application/json\" -d '{\"JoinUrl\":\"<teams-meeting-join-url>\"}'");
            Console.WriteLine("========================================");
            Console.WriteLine();

            await _app.RunAsync();
        }

        /// <summary>
        /// Stop the bot web application
        /// </summary>
        /// <returns></returns>
        public async Task StopAsync()
        {
            if (_app != null) 
            {
                using (var scope = _app.Services.CreateScope())
                {
                    var bot = scope.ServiceProvider.GetRequiredService<IBotService>();
                    // terminate all calls and dispose of the call client
                    await bot.Shutdown();
                }

                // stop the bot web application
                await _app.StopAsync();
            }
        }
    }
}
