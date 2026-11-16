using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using Anthropic;
using Anthropic.Models.Messages;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Sucvar.Application;

namespace Sucvar.Infrastructure.Ai;

/// <summary>
/// Optional LLM "Prompt Architect" (section <c>PromptEnhancer</c>; env <c>PromptEnhancer__ApiKey</c> etc.).
/// Empty key ⇒ disabled, and the deterministic Architectural Prompt Compiler is used as-is.
/// </summary>
public sealed class PromptEnhancerOptions
{
    /// <summary>anthropic | openai | openrouter (empty + key = anthropic).</summary>
    public string? Provider { get; set; }
    public string? ApiKey { get; set; }
    /// <summary>Model id. Defaults: anthropic → claude-opus-5-5 (low effort); openai/openrouter must be set explicitly.</summary>
    public string? Model { get; set; }
    /// <summary>OpenAI-compatible base URL override (OpenRouter default: https://openrouter.ai/api/v1).</summary>
    public string? BaseUrl { get; set; }
    /// <summary>Hard budget for the whole call; on expiry the render proceeds with the deterministic prompt.</summary>
    public int TimeoutMs { get; set; } = 10_000;
}

public static class PromptEnhancerPrompts
{
    public const string System =
        """
        You are a senior architectural visualization director writing prompts for a Stable Diffusion
        interior-redesign model (CLIP text encoder, ~75 tokens, English only).
        Rewrite the brief into ONE line of comma-separated English render terms, at most 40 words.
        Rules:
        - The LOCKED SPECS are the client's explicit choices: they are already placed first; never contradict
          them and never describe those same elements with other materials or colours.
        - Describe the remaining surfaces, furniture, decor, light and atmosphere coherently with the style,
          scaled to the stated room size (small rooms: slim, apartment-scale pieces).
        - Use precise material vocabulary (species, finish, texture, colour temperature in Kelvin).
        - No sentences, no quotes, no numbering, no weights like (term:1.2), no camera or photo terms
          (they are appended separately), no negative phrasing.
        Output only the line.
        """;

    public static string User(PromptEnhancementRequest r)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"Mode: {r.Mode}; room: {r.SpaceType}; style: {r.StyleId ?? "inferred"}");
        if (r.AreaSqm is { } a) sb.AppendLine($"Room size: {a:0.#} m²{(r.CeilingHeight is { } h ? $", ceiling {h:0.00} m" : "")}");
        if (r.Palette is not null) sb.AppendLine($"Palette: {r.Palette}");
        if (r.Lighting is not null) sb.AppendLine($"Lighting: {r.Lighting}");
        sb.AppendLine(r.PreserveStructure ? "Structure: keep walls, windows, doors and camera exactly" : "Structure: full spatial redesign allowed");
        sb.AppendLine($"Client words (may be Romanian): {r.CustomPrompt}");
        sb.AppendLine($"LOCKED SPECS: {(r.LockedSpecs.Count > 0 ? string.Join("; ", r.LockedSpecs) : "none")}");
        sb.AppendLine($"Current compiled prompt: {r.DeterministicPrompt}");
        return sb.ToString();
    }
}

public sealed class LlmPromptEnhancer(IHttpClientFactory http, IOptions<PromptEnhancerOptions> options, ILogger<LlmPromptEnhancer> logger) : IPromptEnhancer
{
    public const string HttpClientName = "prompt-enhancer";
    private PromptEnhancerOptions O => options.Value;
    private string Key => AiOptions.Clean(O.ApiKey);
    private string Provider => AiOptions.Clean(O.Provider).ToLowerInvariant() is { Length: > 0 } p ? p : "anthropic";

    public string Id => IsConfigured ? Provider : "none";
    public bool IsConfigured => Key.Length > 0 && Provider is "anthropic" or "openai" or "openrouter" &&
                                (Provider == "anthropic" || AiOptions.Clean(O.Model).Length > 0);

    public async Task<string?> EnhanceAsync(PromptEnhancementRequest request, CancellationToken ct = default)
    {
        if (!IsConfigured) return null;
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(Math.Clamp(O.TimeoutMs, 1_000, 30_000));
        try
        {
            var text = Provider == "anthropic" ? await AnthropicAsync(request, cts.Token) : await OpenAiCompatibleAsync(request, cts.Token);
            return string.IsNullOrWhiteSpace(text) ? null : text.Trim();
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning("[SUCVAR] Prompt enhancer timed out; using the deterministic prompt");
            return null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Never fail a paid render because of the optional step
            logger.LogWarning(ex, "[SUCVAR] Prompt enhancer failed; using the deterministic prompt");
            return null;
        }
    }

    private async Task<string?> AnthropicAsync(PromptEnhancementRequest request, CancellationToken ct)
    {
        AnthropicClient client = new() { ApiKey = Key };
        var model = AiOptions.Clean(O.Model) is { Length: > 0 } m ? m : "claude-opus-5-5";
        var response = await client.Messages.Create(new MessageCreateParams
        {
            Model = model,
            MaxTokens = 2048,
            System = PromptEnhancerPrompts.System,
            // Short rewrite: low effort keeps latency to a few seconds inside the render budget
            OutputConfig = new OutputConfig { Effort = Effort.Low },
            Messages = [new UserMessageParam { Content = PromptEnhancerPrompts.User(request) }],
        }, ct);
        // A refusal or truncated answer is simply not used: the deterministic compiler already produced a prompt
        if (response.StopReason != "end_turn") return null;
        return string.Concat(response.Content.Select(b => b.Value).OfType<TextBlock>().Select(t => t.Text));
    }

    private async Task<string?> OpenAiCompatibleAsync(PromptEnhancementRequest request, CancellationToken ct)
    {
        var baseUrl = AiOptions.Clean(O.BaseUrl) is { Length: > 0 } b ? b.TrimEnd('/')
            : Provider == "openrouter" ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1";
        var client = http.CreateClient(HttpClientName);
        using var message = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/chat/completions")
        {
            Content = JsonContent.Create(new JsonObject
            {
                ["model"] = AiOptions.Clean(O.Model),
                ["max_tokens"] = 300,
                ["messages"] = new JsonArray(
                    new JsonObject { ["role"] = "system", ["content"] = PromptEnhancerPrompts.System },
                    new JsonObject { ["role"] = "user", ["content"] = PromptEnhancerPrompts.User(request) }),
            }),
        };
        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Key);
        using var response = await client.SendAsync(message, ct);
        var body = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode) throw new HttpRequestException($"Prompt enhancer {(int)response.StatusCode}");
        var choice = JsonNode.Parse(body)?["choices"]?[0];
        if (choice?["finish_reason"]?.GetValue<string>() is { } finish && finish != "stop") return null;
        return choice?["message"]?["content"]?.GetValue<string>();
    }
}
