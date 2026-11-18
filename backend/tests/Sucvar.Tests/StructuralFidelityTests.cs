using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Sucvar.Application;
using Sucvar.Domain.Ai;
using Sucvar.Domain.Studio;
using Sucvar.Infrastructure.Ai;

namespace Sucvar.Tests;

/// <summary>
/// Structural fidelity: with structure kept, doors, doorways and windows are never covered by refrigerators, tall
/// cabinets or furniture — the lock opens and closes the FLUX Kontext instruction and the img2img strength stays low.
/// </summary>
public class StructuralFidelityTests
{
    private static JsonElement Payload(object value) => JsonSerializer.SerializeToElement(value);

    private static string KitchenInstruction(bool preserve) => GenerationPrompt.Create(Payload(new
    {
        mode = "interiors", roomType = "kitchen", customPrompt = "bucătărie modernă cu fronturi albe mate", preserveStructure = preserve,
    })).Instruction;

    [Fact]
    public void Preserved_structure_opens_with_the_architectural_anchor_and_closes_with_the_lock()
    {
        var instruction = KitchenInstruction(preserve: true);
        Assert.StartsWith(ArchitecturalPromptCompiler.StructureAnchor("interiors") + ".", instruction);
        Assert.EndsWith(ArchitecturalPromptCompiler.StructureLock("interiors") + ".", instruction);
        Assert.Contains("keep every door, doorway, door frame, window, window sill, ceiling height, beam, column, and wall angle", instruction);
        Assert.Contains("Never cover, block, remove, or replace any existing door, doorway, or window with refrigerators, tall pantry cabinets, wardrobes, or furniture", instruction);
        Assert.Contains("door swing paths and window openings completely unobstructed", instruction);
    }

    [Fact]
    public void Kitchen_places_refrigerators_and_tall_cabinets_only_on_solid_walls()
    {
        var instruction = KitchenInstruction(preserve: true);
        Assert.Contains("Kitchen placement rule: put the refrigerator, the oven and every tall cabinet or pantry unit only along solid, uninterrupted wall segments or where cabinetry already stands", instruction);
        Assert.Contains("kitchen workflow clearances", instruction);
        Assert.Contains("perspective vanishing points, the floor plane boundaries and the natural light", instruction);
        // the client's own words still lead the descriptive layers
        Assert.Contains("Client requirements, highest priority", instruction);
    }

    [Theory]
    [InlineData("kitchen", "Kitchen placement rule")]
    [InlineData("bathroom", "Bathroom placement rule")]
    [InlineData("living room", "Living room placement rule")]
    [InlineData("master bedroom", "Bedroom placement rule")]
    public void Each_room_family_gets_its_own_protection(string space, string rule)
    {
        var rules = ArchitecturalPromptCompiler.RoomProtections("interiors", space);
        Assert.Contains(rules, r => r.StartsWith(rule, StringComparison.Ordinal));
        Assert.Contains(rules, r => r.Contains("camera focal length"));
    }

    [Fact]
    public void Spaces_without_a_room_rule_still_keep_the_camera_and_light_invariants()
    {
        var rules = ArchitecturalPromptCompiler.RoomProtections("interiors", "home office");
        Assert.Single(rules);
        Assert.Contains("camera focal length", rules[0]);
    }

    [Fact]
    public void Legacy_requests_are_always_locked()
    {
        var plan = GenerationPrompt.Create(Payload(new { mode = "interiors", spaceType = "kitchen", styleId = "modern" }));
        Assert.StartsWith(ArchitecturalPromptCompiler.StructureAnchor("interiors"), plan.Instruction);
        Assert.Contains("Kitchen placement rule", plan.Instruction);
        Assert.EndsWith(ArchitecturalPromptCompiler.StructureLock("interiors") + ".", plan.Instruction);
    }

    [Fact]
    public void Exteriors_get_their_own_anchor_and_lock()
    {
        var plan = GenerationPrompt.Create(Payload(new { mode = "gardens", customPrompt = "grădină cu lavandă", preserveStructure = true }));
        Assert.StartsWith(ArchitecturalPromptCompiler.StructureAnchor("gardens"), plan.Instruction);
        Assert.EndsWith(ArchitecturalPromptCompiler.StructureLock("gardens") + ".", plan.Instruction);
        Assert.DoesNotContain("refrigerators", plan.Instruction);
    }

    [Fact]
    public void An_explicit_unlock_drops_the_lock_for_a_full_renovation()
    {
        var instruction = KitchenInstruction(preserve: false);
        Assert.StartsWith("Redesign this kitchen photo", instruction);
        Assert.DoesNotContain("CRITICAL ARCHITECTURAL CONSTRAINTS", instruction);
        Assert.DoesNotContain("Kitchen placement rule", instruction);
        Assert.Contains("Perform a full architectural renovation", instruction);
    }

    [Fact]
    public void Space_optimization_keeps_the_lock_alongside_the_planning_brief()
    {
        var instruction = GenerationPrompt.Create(Payload(new
        {
            mode = "interiors", roomType = "kitchen", customPrompt = "bucătărie", preserveStructure = true,
            optimizationGoal = "storage", ergonomicConstraints = new[] { "keep 90 cm walkways" },
        })).Instruction;
        Assert.StartsWith(ArchitecturalPromptCompiler.StructureAnchor("interiors"), instruction);
        Assert.Contains("Reorganize the furniture layout", instruction);
        Assert.EndsWith(ArchitecturalPromptCompiler.StructureLock("interiors") + ".", instruction);
    }

    [Fact]
    public void Regional_edits_are_unchanged_by_the_room_lock()
    {
        var plan = GenerationPrompt.Create(Payload(new { mode = "interiors", customPrompt = "canapea bordo", preserveStructure = true }),
            new SelectionRegion(0, 0.75, 1, 0.25, 0.25));
        Assert.StartsWith("Edit only the selected masked area", plan.Instruction);
        Assert.DoesNotContain("CRITICAL ARCHITECTURAL CONSTRAINTS", plan.Instruction);
    }

    [Fact]
    public void Negative_prompt_names_blocked_openings_when_preserving()
    {
        Assert.Contains("blocked doorways", ArchitecturalPromptCompiler.NegativePrompt("interiors", true, null));
        Assert.DoesNotContain("blocked doorways", ArchitecturalPromptCompiler.NegativePrompt("interiors", false, null));
    }

    [Theory]
    [InlineData(0.9, true, 0.68)]
    [InlineData(0.4, true, 0.55)]
    [InlineData(0.6, true, 0.6)]
    [InlineData(0.85, false, 0.85)]
    public void Structure_locked_strength_stays_in_the_conservative_band(double requested, bool preserve, double expected) =>
        Assert.Equal(expected, ArchitecturalPromptCompiler.StructureLockedStrength(requested, preserve), 3);

    // ── Replicate payloads ──

    private const string Image = "data:image/jpeg;base64,/9j/AAAA";

    private static ReplicateImageProvider Provider(string? model) =>
        new(new NoHttp(), Options.Create(new AiOptions { ReplicateApiToken = "r8_test", ReplicateModel = model, ReplicateModelVersion = "abc" }),
            NullLogger<ReplicateImageProvider>.Instance);

    private static ImageGenerationRequest Request(double strength, bool preserve) =>
        new(Image, "instruction", "lowres", 40, 9, null, strength, strength * 100, "interiors", preserve);

    [Fact]
    public void Flux_kontext_keeps_the_frame_and_the_exact_instruction()
    {
        var (_, body) = Provider(AiOptions.DefaultReplicateModel).BuildCreateRequest(Request(0.62, preserve: true));
        var input = body["input"]!.AsObject();
        Assert.Equal("match_input_image", input["aspect_ratio"]!.GetValue<string>());
        Assert.False(input["prompt_upsampling"]!.GetValue<bool>());
        Assert.Equal("instruction", input["prompt"]!.GetValue<string>());
    }

    [Theory]
    [InlineData(0.85, true, 0.68)]
    [InlineData(0.85, false, 0.85)]
    public void Versioned_fallback_clamps_prompt_strength_only_when_locked(double strength, bool preserve, double expected)
    {
        var (_, body) = Provider(null).BuildCreateRequest(Request(strength, preserve));
        Assert.Equal(expected, body["input"]!["prompt_strength"]!.GetValue<double>(), 3);
    }

    private sealed class NoHttp : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => throw new InvalidOperationException("no HTTP in payload tests");
    }
}
