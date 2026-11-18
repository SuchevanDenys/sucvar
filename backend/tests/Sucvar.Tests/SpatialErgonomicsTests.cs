using System.Text.Json;
using Sucvar.Domain.Ai;
using Sucvar.Domain.Studio;

namespace Sucvar.Tests;

/// <summary>"Optimizare spațiu": deterministic ergonomics calculator + space-planning layer of the prompt compiler.</summary>
public class SpatialErgonomicsTests
{
    private static JsonElement Payload(object value) => JsonSerializer.SerializeToElement(value);

    // ── Analyzer math ─────────────────────────────────────────────────────────

    [Fact]
    public void Area_volume_and_footprint_follow_the_30_35_percent_rule()
    {
        var r = SpatialErgonomicsAnalyzer.Analyze("living room", 5, 4, 2.65);

        Assert.Equal(20, r.AreaSqm);
        Assert.Equal(53, r.VolumeM3);
        Assert.Equal(6, r.MinFurnitureSqm);   // 30 %
        Assert.Equal(7, r.MaxFurnitureSqm);   // 35 %
        Assert.Equal(13, r.MinFreeSqm);       // 65 %
        Assert.Equal(14, r.MaxFreeSqm);       // 70 %
        Assert.Equal(r.AreaSqm, r.MaxFurnitureSqm + r.MinFreeSqm, 1);
        Assert.False(r.DimensionsAssumed);
        Assert.Equal((75, 85), (r.WalkwayMinCm, r.WalkwayMaxCm));
    }

    [Fact]
    public void Missing_dimensions_fall_back_to_room_type_defaults()
    {
        var r = SpatialErgonomicsAnalyzer.Analyze("bathroom", null, null, null);
        Assert.True(r.DimensionsAssumed);
        Assert.Equal((2.6, 2.0, 2.5), (r.LengthM, r.WidthM, r.HeightM));
        Assert.Equal(5.2, r.AreaSqm);
    }

    [Fact]
    public void Width_is_always_the_short_side()
    {
        var r = SpatialErgonomicsAnalyzer.Analyze("master bedroom", 2.8, 4.5, 2.6);
        Assert.Equal(4.5, r.LengthM);
        Assert.Equal(2.8, r.WidthM);
    }

    [Theory]
    [InlineData("kitchen", 90, 100)]
    [InlineData("entryway", 90, 100)]
    [InlineData("commercial cafe", 90, 100)]
    [InlineData("living room", 75, 85)]
    public void High_traffic_rooms_need_a_90_cm_walkway(string space, int min, int max)
    {
        var r = SpatialErgonomicsAnalyzer.Analyze(space, 5, 4, 2.7);
        Assert.Equal((min, max), (r.WalkwayMinCm, r.WalkwayMaxCm));
    }

    [Fact]
    public void Circulation_goal_widens_the_walkway()
    {
        var r = SpatialErgonomicsAnalyzer.Analyze("living room", 5, 4, 2.65, "circulation");
        Assert.Equal(85, r.WalkwayMinCm);
        Assert.Equal("goal_circulation", r.Recommendations[0].Id);
        Assert.Contains("85 cm", r.Recommendations[0].Ro);
    }

    // ── Recommendations ───────────────────────────────────────────────────────

    [Fact]
    public void Small_narrow_bedroom_gets_compact_bed_and_small_room_advice()
    {
        var r = SpatialErgonomicsAnalyzer.Analyze("master bedroom", 4.2, 2.8, 2.55, "spaciousness");
        var ids = r.Recommendations.Select(x => x.Id).ToList();

        Assert.InRange(r.Recommendations.Count, 3, 4);
        Assert.Equal("goal_spaciousness", ids[0]);
        Assert.Contains("bed_narrow", ids);       // width < 3.0 → 140–160 cm bed, floating nightstands, sliding doors
        Assert.Contains("small_area", ids);       // 11.76 m² < 14
        Assert.DoesNotContain("large_area", ids);
        Assert.Contains("140–160 cm", r.Recommendations.Single(x => x.Id == "bed_narrow").Ro);
        Assert.Contains("glisante", r.Recommendations.Single(x => x.Id == "bed_narrow").Ro);
    }

    [Fact]
    public void Large_tall_living_room_gets_vertical_storage_and_zoning()
    {
        var r = SpatialErgonomicsAnalyzer.Analyze("living room", 7, 5, 2.9, "storage");
        var ids = r.Recommendations.Select(x => x.Id).ToList();

        Assert.InRange(r.Recommendations.Count, 3, 4);
        Assert.Equal("goal_storage", ids[0]);
        Assert.Contains("7.0 m", r.Recommendations[0].Ro); // built-ins sized to the real long wall
        Assert.Contains("tall_ceiling", ids);              // height ≥ 2.7
        Assert.Contains("large_area", ids);                // 35 m² ≥ 25
        Assert.DoesNotContain("small_area", ids);
        Assert.DoesNotContain("bed_narrow", ids);
    }

    [Fact]
    public void Low_ceiling_advises_low_profile_furniture()
    {
        var r = SpatialErgonomicsAnalyzer.Analyze("attic loft", 6, 4.5, 2.3);
        Assert.Contains(r.Recommendations, x => x.Id == "low_ceiling");
        Assert.DoesNotContain(r.Recommendations, x => x.Id == "tall_ceiling");
    }

    [Theory]
    [InlineData("living room")]
    [InlineData("kitchen")]
    [InlineData("master bedroom")]
    [InlineData("bathroom")]
    [InlineData("home office")]
    [InlineData("entryway")]
    [InlineData("attic loft")]
    [InlineData("walk-in closet")]
    [InlineData("commercial cafe")]
    public void Every_room_type_gets_three_or_four_recommendations_for_every_goal(string space)
    {
        foreach (var goal in SpatialErgonomicsAnalyzer.Goals.Select(g => (string?)g.Id).Append(null))
        {
            var r = SpatialErgonomicsAnalyzer.Analyze(space, null, null, null, goal);
            Assert.InRange(r.Recommendations.Count, 3, SpatialErgonomicsAnalyzer.MaxRecommendations);
            Assert.Equal(r.Recommendations.Count, r.Recommendations.Select(x => x.Id).Distinct().Count());
            Assert.All(r.Recommendations, x => Assert.False(string.IsNullOrWhiteSpace(x.PromptEn)));
            Assert.Equal(r.Recommendations.Count + 2, r.PromptConstraints.Count);
        }
    }

    [Fact]
    public void Analyzer_is_deterministic()
    {
        var a = SpatialErgonomicsAnalyzer.Analyze("kitchen", 4, 3, 2.6, "home_office");
        var b = SpatialErgonomicsAnalyzer.Analyze("kitchen", 4, 3, 2.6, "home_office");
        Assert.Equal(a.PromptConstraints, b.PromptConstraints);
    }

    [Fact]
    public void Client_constraints_are_sanitized()
    {
        var clean = SpatialErgonomicsAnalyzer.SanitizeConstraints(
            ["keep walkways clear (masterpiece:1.8)", "keep walkways clear (masterpiece:1.8)", "", null, new string('a', 500),
             "a", "b", "c", "d", "e", "f", "g", "h"]);
        Assert.Equal(SpatialErgonomicsAnalyzer.MaxConstraints, clean.Count);
        Assert.DoesNotContain(clean, c => c.Contains('(') || c.Contains(":1.8"));
        Assert.All(clean, c => Assert.True(c.Length <= SpatialErgonomicsAnalyzer.MaxConstraintLength));
    }

    // ── Prompt compiler ───────────────────────────────────────────────────────

    [Fact]
    public void Optimization_goal_alone_is_a_valid_request()
    {
        var payload = Payload(new { mode = "interiors", spaceType = "master bedroom", optimizationGoal = "spaciousness" });
        Assert.Null(DesignVision.Validate(payload));
        Assert.True(DesignVision.IsSmartRequest(payload));

        // Unknown goals do not count as an intent
        Assert.NotNull(DesignVision.Validate(Payload(new { mode = "interiors", optimizationGoal = "bogus" })));
    }

    [Fact]
    public void Instruction_contains_authoritative_space_planning_with_server_side_analysis()
    {
        var payload = Payload(new
        {
            mode = "interiors", spaceType = "master bedroom", optimizationGoal = "storage",
            dimensions = new { length = 4.2, width = 2.8, height = 2.75 },
        });
        var plan = GenerationPrompt.Create(payload).For(PromptFormat.Instruction);
        var brief = Assert.IsType<DesignBrief>(plan.Brief);

        Assert.Equal("storage", brief.OptimizationGoal);
        Assert.NotNull(brief.ErgonomicConstraints);
        Assert.Contains("Space optimization goal: maximize storage", plan.Prompt);
        Assert.Contains("Reorganize the furniture layout", plan.Prompt);
        Assert.Contains("Ergonomic rules, follow them exactly:", plan.Prompt);
        Assert.Contains("140-160 cm wide bed", plan.Prompt);              // width 2.8 < 3.0
        Assert.Contains("vertical floor-to-ceiling storage", plan.Prompt); // height 2.75 ≥ 2.7
        Assert.Contains("30-35% of the 11.8 m² floor", plan.Prompt);
        Assert.Contains("ceiling height and the exact position and size of every window and door", plan.Prompt);
        // Planning comes right after the structure rules
        Assert.True(plan.Prompt.IndexOf("Preserve the exact room geometry", StringComparison.Ordinal) <
                    plan.Prompt.IndexOf("Space optimization goal", StringComparison.Ordinal));
    }

    [Fact]
    public void Client_ergonomic_constraints_win_and_work_without_a_goal()
    {
        var payload = Payload(new
        {
            mode = "interiors", spaceType = "living room", customPrompt = "living japandi",
            ergonomicConstraints = new[] { "keep clear walkways at least 80 cm wide", "use a slim-armed sofa" },
        });
        var plan = GenerationPrompt.Create(payload);
        var instruction = plan.For(PromptFormat.Instruction).Prompt;

        Assert.Null(plan.Brief!.OptimizationGoal);
        Assert.Contains("Ergonomic rules, follow them exactly: keep clear walkways at least 80 cm wide; use a slim-armed sofa", instruction);
        Assert.DoesNotContain("Space optimization goal", instruction);
        Assert.Contains("ergonomic space planning", plan.Prompt); // CLIP cue
    }

    [Fact]
    public void Clip_prompt_carries_the_goal_cue_within_budget()
    {
        var payload = Payload(new { mode = "interiors", spaceType = "home office", optimizationGoal = "home_office", customPrompt = "birou scandinav" });
        var plan = GenerationPrompt.Create(payload);
        Assert.Contains("ergonomic desk by the window", plan.Prompt);
        Assert.Contains(GenerationPrompt.StructurePreserveCue, plan.Prompt);
        Assert.True(GenerationPrompt.EstimateTokens(plan.Prompt) <= AiLimits.MaxPromptTokens + 2);
    }

    [Fact]
    public void Requests_without_optimization_are_unchanged()
    {
        var payload = Payload(new { mode = "interiors", spaceType = "living room", customPrompt = "living japandi cu parchet de stejar" });
        var plan = GenerationPrompt.Create(payload);
        Assert.False(plan.Brief!.HasSpacePlanning);
        Assert.DoesNotContain("Space optimization", plan.Instruction);
        Assert.DoesNotContain("Ergonomic rules", plan.Instruction);
        Assert.DoesNotContain("walkway", plan.Prompt);
    }

    [Fact]
    public void Regional_edit_ignores_room_wide_space_planning()
    {
        var payload = Payload(new
        {
            mode = "interiors", spaceType = "living room", customPrompt = "canapea din catifea bordo", optimizationGoal = "circulation",
            selectionBounds = new { x = 0.2, y = 0.5, width = 0.4, height = 0.3 },
        });
        var plan = GenerationPrompt.Create(payload);
        Assert.NotNull(plan.Region);
        Assert.DoesNotContain("Space optimization", plan.Instruction);
        Assert.DoesNotContain("Reorganize the furniture layout", plan.Instruction);
    }

    [Fact]
    public void Exterior_requests_get_no_interior_planning_layer()
    {
        Assert.Empty(ArchitecturalPromptCompiler.SpacePlanningSentences("exteriors", "circulation", ["x"]));
        Assert.Equal("", ArchitecturalPromptCompiler.SpacePlanningClip("gardens", "storage", null));
    }

    [Fact]
    public void Vision_response_echoes_the_goal()
    {
        var plan = GenerationPrompt.Create(Payload(new { mode = "interiors", optimizationGoal = "circulation" }));
        var json = JsonSerializer.Serialize(DesignVision.ToResponse(plan.Brief!));
        Assert.Contains("\"optimizationGoal\":\"circulation\"", json);
        Assert.Contains("ergonomicConstraints", json);
    }
}
