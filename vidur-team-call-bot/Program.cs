using EchoBot;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Configuration;
using Microsoft.Extensions.Logging.EventLog;

IHost host = Host.CreateDefaultBuilder(args)
    .UseWindowsService(options =>
    {
        options.ServiceName = "Echo Bot Service";
    })
    .ConfigureServices(services =>
    {
        LoggerProviderOptions.RegisterProviderOptions<
            EventLogSettings, EventLogLoggerProvider>(services);

        services.AddSingleton<IBotHost, BotHost>();

        services.AddHostedService<EchoBotWorker>();
    })
    .Build();

// Allow Ctrl+C to stop the host when run as a console app
Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    host.Services.GetRequiredService<IHostApplicationLifetime>().StopApplication();
};

Console.WriteLine("Vidur Team Call Bot starting...");
await host.RunAsync();
Console.WriteLine("Vidur Team Call Bot stopped.");
