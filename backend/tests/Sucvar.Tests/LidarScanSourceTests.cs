using System.Text.Json;
using Sucvar.Domain.Ai;

namespace Sucvar.Tests;

/// <summary>
/// "Proiect scanat 3D (LiDAR)": a Studio request whose source is the perspective render of an imported 3D room scan
/// compiles a 3D → photorealistic synthesis directive (exact dimensions, doors and windows), while every photo request
/// keeps the historical photo-edit instruction byte for byte.
/// </summary>
public class LidarScanSourceTests
{
    private static JsonElement Payload(object value) => JsonSerializer.SerializeToElement(value);

    private static object ScanBody(bool scan, string? goal = null, string[]? constraints = null, string style = "scandinavian") => new
    {
        mode = "interiors",
        roomType = "living",
        style,
        customPrompt = "living luminos cu canapea gri",
        preserveStructure = true,
        is3dScanSource = scan,
        doorCount = 1,
        windowCount = 2,
        optimizationGoal = goal,
        ergonomicConstraints = constraints,
        dimensions = new { length = 4.85, width = 3.9, height = 2.65, doorsCount = 1, windowsCount = 2, aiStrength = 62 },
    };

    [Fact]
    public void Scan_source_emits_the_3d_to_photorealistic_synthesis_directive()
    {
        var plan = GenerationPrompt.Create(Payload(ScanBody(scan: true)));
        Assert.True(plan.Is3dScanSource);
        Assert.True(plan.Brief!.Is3dScanSource);
        var instruction = plan.Instruction;
        Assert.StartsWith("This image is a 3D LiDAR room scan shown as an architectural perspective model", instruction);
        Assert.Contains("Convert this 3D architectural spatial layout and perspective model into a fully furnished, lifelike, photorealistic interior photograph", instruction);
        Assert.Contains("natural daylight, realistic textures and materials, and architectural lighting", instruction);
        Assert.Contains("no guide lines, grid, outlines or CGI look may remain", instruction);
        // Not an edit of a photograph: the photo anchor is gone
        Assert.DoesNotContain(ArchitecturalPromptCompiler.StructureAnchor("interiors"), instruction);
        Assert.DoesNotContain("Redesign this", instruction);
    }

    [Fact]
    public void Scan_source_preserves_the_exact_dimensions_doors_and_windows()
    {
        var instruction = GenerationPrompt.Create(Payload(ScanBody(scan: true))).Instruction;
        Assert.Contains("Exact scanned room dimensions: 4.85m × 3.90m × 2.65m (length × width × ceiling height, 2.65m ceiling)", instruction);
        Assert.Contains("wall angles, the ceiling height", instruction);
        Assert.Contains("The scan detected 1 door and 2 windows", instruction);
        Assert.Contains("real glazed window with frame, sill and daylight", instruction);
        // The closing lock names the scanned openings and forbids blocking them with furniture or appliances
        Assert.EndsWith("keep door swing paths and window openings completely unobstructed.", instruction);
        Assert.Contains("the 1 door and 2 windows detected by the 3D scan must stay visible in their exact scanned positions", instruction);
        Assert.Contains("appliances, or furniture", instruction);
    }

    [Fact]
    public void Scan_source_keeps_style_room_type_and_the_users_words()
    {
        var plan = GenerationPrompt.Create(Payload(ScanBody(scan: true)));
        Assert.Contains("photorealistic interior photograph of a living", plan.Instruction);
        Assert.Contains("Scandinavian style", plan.Instruction);
        Assert.Contains("Client requirements, highest priority", plan.Instruction);
        Assert.Contains("Living room placement rule", plan.Instruction);
    }

    [Fact]
    public void Scan_source_integrates_space_optimization_and_ergonomic_constraints()
    {
        var plan = GenerationPrompt.Create(Payload(ScanBody(scan: true, goal: "circulation", constraints: ["keep a 90 cm walkway between the sofa and the door"])));
        Assert.Contains("Space optimization goal:", plan.Instruction);
        Assert.Contains("Ergonomic rules, follow them exactly: keep a 90 cm walkway between the sofa and the door", plan.Instruction);
        Assert.StartsWith("This image is a 3D LiDAR room scan", plan.Instruction);
    }

    [Fact]
    public void Scan_source_clip_prompt_negatives_and_strength_target_the_synthesis()
    {
        var plan = GenerationPrompt.Create(Payload(ScanBody(scan: true)));
        Assert.Contains("photorealistic interior photo from 3D room scan", plan.Prompt);
        Assert.Contains("4.85m×3.90m×2.65m room", plan.Prompt);
        Assert.True(GenerationPrompt.EstimateTokens(plan.Prompt) <= AiLimits.MaxPromptTokens + 20); // reserved tail never trimmed
        Assert.StartsWith("wireframe, grid lines, clay render", plan.NegativePrompt);
        Assert.InRange(plan.PromptStrength, ArchitecturalPromptCompiler.ScanStrengthMin, ArchitecturalPromptCompiler.ScanStrengthMax);
        // The 62 % photo default is lifted into the synthesis band (flat planes must become real materials)
        Assert.Equal(ArchitecturalPromptCompiler.ScanStrengthDefault, plan.PromptStrength);
    }

    [Fact]
    public void Scan_source_always_keeps_the_architecture_even_if_the_toggle_is_off()
    {
        var body = JsonSerializer.SerializeToElement(new
        {
            mode = "interiors", roomType = "bedroom", customPrompt = "dormitor japandi", preserveStructure = false,
            is3dScanSource = true, dimensions = new { length = 4, width = 3.2, height = 2.6, doorsCount = 1, windowsCount = 1 },
        });
        var plan = GenerationPrompt.Create(body);
        Assert.True(plan.Brief!.PreserveStructure);
        // Counts fall back to the Studio dimensions when doorCount / windowCount are absent
        Assert.Equal(1, plan.Brief.DoorCount);
        Assert.Equal(1, plan.Brief.WindowCount);
        Assert.Contains("The scan detected 1 door and 1 window:", plan.Instruction);
    }

    [Fact]
    public void Photo_requests_are_unchanged_when_the_flag_is_absent_or_false()
    {
        var absent = ScanBody(scan: false);
        var withoutFlag = GenerationPrompt.Create(Payload(new
        {
            mode = "interiors", roomType = "living", style = "scandinavian", customPrompt = "living luminos cu canapea gri", preserveStructure = true,
            dimensions = new { length = 4.85, width = 3.9, height = 2.65, doorsCount = 1, windowsCount = 2, aiStrength = 62 },
        }));
        var falseFlag = GenerationPrompt.Create(Payload(absent));
        foreach (var plan in new[] { withoutFlag, falseFlag })
        {
            Assert.False(plan.Is3dScanSource);
            Assert.False(plan.Brief!.Is3dScanSource);
            Assert.StartsWith(ArchitecturalPromptCompiler.StructureAnchor("interiors") + ".", plan.Instruction);
            Assert.DoesNotContain("3D LiDAR", plan.Instruction);
            Assert.DoesNotContain("from 3D room scan", plan.Prompt);
            Assert.DoesNotContain("wireframe", plan.NegativePrompt);
            Assert.InRange(plan.PromptStrength, ArchitecturalPromptCompiler.PreserveStrengthMin, ArchitecturalPromptCompiler.PreserveStrengthMax);
        }
        Assert.Equal(withoutFlag.Instruction, falseFlag.Instruction);
        Assert.Equal(withoutFlag.Prompt, falseFlag.Prompt);
    }

    [Fact]
    public void Scan_flag_is_ignored_outside_interiors()
    {
        var plan = GenerationPrompt.Create(Payload(new { mode = "exteriors", customPrompt = "fațadă modernă", is3dScanSource = true }));
        Assert.False(plan.Is3dScanSource);
        Assert.DoesNotContain("3D LiDAR", plan.Instruction);
    }

    [Fact]
    public void Scan_flag_with_a_mask_region_compiles_a_regional_edit()
    {
        var region = SelectionRegion.FromPayload(Payload(new { selectionBounds = new { x = 0.2, y = 0.3, width = 0.3, height = 0.3 } }));
        Assert.NotNull(region);
        var plan = GenerationPrompt.Create(Payload(ScanBody(scan: true)), region);
        Assert.NotNull(plan.Region);
        Assert.DoesNotContain("Convert this 3D architectural spatial layout", plan.Instruction);
    }

    [Fact]
    public void Brief_response_echoes_the_scan_source()
    {
        var plan = GenerationPrompt.Create(Payload(ScanBody(scan: true)));
        var json = JsonSerializer.Serialize(DesignVision.ToResponse(plan.Brief!));
        Assert.Contains("\"is3dScanSource\":true", json);
        Assert.Contains("\"doorCount\":1", json);
        Assert.Contains("\"windowCount\":2", json);
    }
}
