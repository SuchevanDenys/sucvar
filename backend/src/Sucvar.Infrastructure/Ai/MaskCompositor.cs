using System.Runtime.InteropServices;
using SkiaSharp;

namespace Sucvar.Infrastructure.Ai;

/// <summary>
/// Pixel-exact safeguard for "Edit selected area": whatever the model returns, the final image is
/// <c>original + (generated − original) · α</c> where α is a feathered copy of the user's binary mask that is
/// <b>exactly 0</b> wherever the mask is black. The feather (erode, then Gaussian blur, then a hard clamp to the
/// mask) lives entirely <i>inside</i> the selection, so the seam is soft but no pixel outside it can change.
/// </summary>
/// <remarks>All bitmaps are <see cref="SKColorType.Rgba8888"/>, tightly packed (<c>RowBytes == Width · 4</c>).</remarks>
public static class MaskCompositor
{
    public const int MinFeather = 6, MaxFeather = 10;

    /// <summary>Feather width in pixels: 6–10 px, growing with the image (≈0.8 % of the short side).</summary>
    public static int FeatherRadius(int width, int height) =>
        Math.Clamp((int)Math.Round(Math.Min(width, height) * 0.008), MinFeather, MaxFeather);

    /// <summary>
    /// Binary mask (255 = edit, 0 = keep) from a mask rendered over black: a pixel is selected when its luminance is
    /// at least 50 % — a transparent or half-transparent stroke edge counts as black.
    /// </summary>
    public static byte[] Binarize(SKBitmap bitmap)
    {
        var px = Pixels(bitmap);
        var mask = new byte[bitmap.Width * bitmap.Height];
        for (int i = 0, p = 0; i < mask.Length; i++, p += 4)
        {
            var luminance = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2];
            mask[i] = luminance >= 128 ? (byte)255 : (byte)0;
        }
        return mask;
    }

    /// <summary>
    /// Feathered blend weights in <c>[0, 1]</c>: the mask eroded by the radius, blurred with a Gaussian
    /// (σ = radius / 2, kernel truncated at the radius), then multiplied by the binary mask. The ramp therefore
    /// ends at ≈0 on the selection border and α is exactly 0 for every unselected pixel.
    /// </summary>
    public static float[] FeatherAlpha(byte[] mask, int width, int height, int radius)
    {
        var alpha = new float[mask.Length];
        if (radius <= 0)
        {
            for (var i = 0; i < mask.Length; i++) alpha[i] = mask[i] == 0 ? 0f : 1f;
            return alpha;
        }
        // Thin strokes: shrink the feather until erosion keeps at least 15 % of the selection (never erase an edit)
        var selected = mask.Count(v => v != 0);
        var eroded = Erode(mask, width, height, radius);
        while (radius > 1 && eroded.Count(v => v != 0) < selected * 0.15)
        {
            radius /= 2;
            eroded = Erode(mask, width, height, radius);
        }
        var blurred = GaussianBlur(eroded, width, height, radius / 2.0, radius);
        for (var i = 0; i < mask.Length; i++) alpha[i] = mask[i] == 0 ? 0f : Math.Clamp(blurred[i], 0f, 1f);
        return alpha;
    }

    /// <summary>
    /// <c>source + (generated − source) · α</c>, per channel. Pixels with α = 0 are copied byte for byte from
    /// <paramref name="source"/>. Both bitmaps must have the same size; the result is opaque.
    /// </summary>
    public static SKBitmap Composite(SKBitmap source, SKBitmap generated, float[] alpha)
    {
        if (source.Width != generated.Width || source.Height != generated.Height || alpha.Length != source.Width * source.Height)
            throw new ArgumentException("Source, generated image and mask must have the same size.");
        var src = Pixels(source);
        var gen = Pixels(generated);
        var output = new byte[src.Length];
        for (int i = 0, p = 0; i < alpha.Length; i++, p += 4)
        {
            var a = alpha[i];
            if (a <= 0f)
            {
                output[p] = src[p]; output[p + 1] = src[p + 1]; output[p + 2] = src[p + 2];
            }
            else
            {
                for (var c = 0; c < 3; c++)
                    output[p + c] = (byte)Math.Clamp((int)Math.Round(src[p + c] + (gen[p + c] - src[p + c]) * a), 0, 255);
            }
            output[p + 3] = 255;
        }
        return FromPixels(output, source.Width, source.Height);
    }

    /// <summary>Selection bounds (normalised <c>0..1</c>) and coverage measured from a binary mask; null when empty.</summary>
    public static Sucvar.Domain.Ai.SelectionRegion? Measure(byte[] mask, int width, int height)
    {
        int minX = width, minY = height, maxX = -1, maxY = -1;
        long selected = 0;
        for (var y = 0; y < height; y++)
        for (var x = 0; x < width; x++)
        {
            if (mask[y * width + x] == 0) continue;
            selected++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        if (selected == 0) return null;
        static double R(double v) => Sucvar.Domain.Ai.SelectionRegion.Round(v);
        return new Sucvar.Domain.Ai.SelectionRegion(
            R((double)minX / width), R((double)minY / height),
            R((double)(maxX - minX + 1) / width), R((double)(maxY - minY + 1) / height),
            R((double)selected / mask.Length));
    }

    /// <summary>Opaque black/white RGBA bitmap of a binary mask (what inpainting models expect).</summary>
    public static SKBitmap ToBitmap(byte[] mask, int width, int height)
    {
        var px = new byte[mask.Length * 4];
        for (int i = 0, p = 0; i < mask.Length; i++, p += 4)
        {
            px[p] = px[p + 1] = px[p + 2] = mask[i];
            px[p + 3] = 255;
        }
        return FromPixels(px, width, height);
    }

    // ── Morphology & blur (edge-clamped, separable) ─────────────────────────────

    /// <summary>Square erosion; the image border counts as "inside" so a selection touching the edge is not shrunk there.</summary>
    private static byte[] Erode(byte[] mask, int width, int height, int r)
    {
        var tmp = new byte[mask.Length];
        var result = new byte[mask.Length];
        for (var y = 0; y < height; y++)
        for (var x = 0; x < width; x++)
        {
            byte min = 255;
            for (int k = Math.Max(0, x - r), end = Math.Min(width - 1, x + r); k <= end && min > 0; k++) min = Math.Min(min, mask[y * width + k]);
            tmp[y * width + x] = min;
        }
        for (var y = 0; y < height; y++)
        for (var x = 0; x < width; x++)
        {
            byte min = 255;
            for (int k = Math.Max(0, y - r), end = Math.Min(height - 1, y + r); k <= end && min > 0; k++) min = Math.Min(min, tmp[k * width + x]);
            result[y * width + x] = min;
        }
        return result;
    }

    private static float[] GaussianBlur(byte[] mask, int width, int height, double sigma, int radius)
    {
        var kernel = new float[2 * radius + 1];
        double sum = 0;
        for (var i = -radius; i <= radius; i++) sum += kernel[i + radius] = (float)Math.Exp(-(i * i) / (2 * sigma * sigma));
        for (var i = 0; i < kernel.Length; i++) kernel[i] = (float)(kernel[i] / sum);

        var tmp = new float[mask.Length];
        for (var y = 0; y < height; y++)
        for (var x = 0; x < width; x++)
        {
            float acc = 0;
            for (var k = -radius; k <= radius; k++) acc += kernel[k + radius] * mask[y * width + Math.Clamp(x + k, 0, width - 1)];
            tmp[y * width + x] = acc / 255f;
        }
        var result = new float[mask.Length];
        for (var y = 0; y < height; y++)
        for (var x = 0; x < width; x++)
        {
            float acc = 0;
            for (var k = -radius; k <= radius; k++) acc += kernel[k + radius] * tmp[Math.Clamp(y + k, 0, height - 1) * width + x];
            result[y * width + x] = acc;
        }
        return result;
    }

    // ── Pixel access ─────────────────────────────────────────────────────────────

    /// <summary>Tightly packed RGBA bytes of a bitmap (converted to <see cref="SKColorType.Rgba8888"/> if needed).</summary>
    public static byte[] Pixels(SKBitmap bitmap)
    {
        if (bitmap.ColorType == SKColorType.Rgba8888 && bitmap.RowBytes == bitmap.Width * 4) return bitmap.Bytes;
        using var converted = new SKBitmap(new SKImageInfo(bitmap.Width, bitmap.Height, SKColorType.Rgba8888, SKAlphaType.Premul));
        using (var canvas = new SKCanvas(converted))
        {
            canvas.Clear(SKColors.Black);
            // 1:1 copy at the origin: nearest sampling is pixel-identical to the former DrawBitmap(bitmap, 0, 0)
            using var image = SKImage.FromBitmap(bitmap);
            canvas.DrawImage(image, 0, 0, new SKSamplingOptions(SKFilterMode.Nearest));
        }
        return converted.Bytes;
    }

    public static SKBitmap FromPixels(byte[] rgba, int width, int height)
    {
        var bitmap = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Premul));
        if (bitmap.RowBytes != width * 4) throw new InvalidOperationException("Unexpected row stride.");
        Marshal.Copy(rgba, 0, bitmap.GetPixels(), rgba.Length);
        return bitmap;
    }

    /// <summary>
    /// Decodes an encoded image upright (EXIF orientation applied) into a <paramref name="width"/> × <paramref name="height"/>
    /// RGBA bitmap over <paramref name="background"/>: stretched (<paramref name="cover"/> = false, masks) or scaled to
    /// cover and centre-cropped (generated images whose size / aspect differs slightly from the source).
    /// </summary>
    public static SKBitmap RenderUpright(byte[] encoded, int width, int height, bool cover, SKColor background, SKSamplingOptions sampling)
    {
        using var codec = SKCodec.Create(new MemoryStream(encoded)) ?? throw new InvalidDataException("unreadable image");
        using var decoded = SKBitmap.Decode(codec) ?? throw new InvalidDataException("decode failed");
        var origin = codec.EncodedOrigin;
        var (srcW, srcH) = OrientedSize(origin, decoded.Width, decoded.Height);

        var info = new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Premul);
        var bitmap = new SKBitmap(info);
        using var canvas = new SKCanvas(bitmap);
        canvas.Clear(background);
        float sx = (float)width / srcW, sy = (float)height / srcH;
        if (cover)
        {
            var s = Math.Max(sx, sy);
            canvas.Translate((width - srcW * s) / 2f, (height - srcH * s) / 2f);
            sx = sy = s;
        }
        canvas.Scale(sx, sy);
        SkiaImageProcessor.ApplyOrigin(canvas, origin, decoded.Width, decoded.Height);
        using var image = SKImage.FromBitmap(decoded);
        canvas.DrawImage(image, 0, 0, sampling);
        canvas.Flush();
        return bitmap;
    }

    public static (int Width, int Height) OrientedSize(SKEncodedOrigin origin, int width, int height) =>
        origin is SKEncodedOrigin.LeftTop or SKEncodedOrigin.RightTop or SKEncodedOrigin.RightBottom or SKEncodedOrigin.LeftBottom
            ? (height, width)
            : (width, height);
}
