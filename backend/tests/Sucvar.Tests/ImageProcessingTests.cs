using SkiaSharp;
using Sucvar.Infrastructure.Ai;

namespace Sucvar.Tests;

public class ImageProcessingTests
{
    [Fact]
    public void Transparent_png_becomes_white_jpeg_capped_at_1280px_wide()
    {
        using var bmp = new SKBitmap(new SKImageInfo(2000, 500, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        bmp.Erase(SKColors.Transparent);
        using var png = SKImage.FromBitmap(bmp).Encode(SKEncodedImageFormat.Png, 100);

        var dataUrl = SkiaImageProcessor.EncodeJpegDataUrl(png.ToArray());

        Assert.StartsWith("data:image/jpeg;base64,", dataUrl);
        var bytes = Convert.FromBase64String(dataUrl["data:image/jpeg;base64,".Length..]);
        using var codec = SKCodec.Create(new MemoryStream(bytes));
        Assert.Equal(SKEncodedImageFormat.Jpeg, codec.EncodedFormat);
        Assert.Equal(1280, codec.Info.Width);
        Assert.Equal(320, codec.Info.Height);
        using var decoded = SKBitmap.Decode(bytes);
        var px = decoded.GetPixel(10, 10);
        Assert.True(px.Red > 245 && px.Green > 245 && px.Blue > 245, $"expected white, got {px}"); // no black background
    }

    [Fact]
    public void Small_images_are_never_enlarged_and_inspect_reads_the_header()
    {
        using var bmp = new SKBitmap(300, 200);
        bmp.Erase(SKColors.Red);
        using var webp = SKImage.FromBitmap(bmp).Encode(SKEncodedImageFormat.Webp, 90);
        var processor = new SkiaImageProcessor(null!);
        var info = processor.Inspect(webp.ToArray());
        Assert.Equal(("webp", 300, 200), (info.Format, info.Width, info.Height));

        var bytes = Convert.FromBase64String(SkiaImageProcessor.EncodeJpegDataUrl(webp.ToArray())["data:image/jpeg;base64,".Length..]);
        using var codec = SKCodec.Create(new MemoryStream(bytes));
        Assert.Equal((300, 200), (codec.Info.Width, codec.Info.Height));
    }
}
