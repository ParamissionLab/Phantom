const CHANNELS: usize = 4;
const FILTER_IDENTITY: u32 = 0;
const FILTER_INVERT: u32 = 1;
const FILTER_GRAYSCALE: u32 = 2;
const FILTER_SHARPEN3X3: u32 = 3;
const FILTER_SMOOTH_ENHANCE: u32 = 4;
const FILTER_BOX_BLUR3X3: u32 = 5;
const FILTER_UNSHARP_MASK: u32 = 6;
const LUMA_R: u32 = 77;
const LUMA_G: u32 = 150;
const LUMA_B: u32 = 29;
const FIXED_SHIFT: u4 = 8;

export fn rgba_invert(input_ptr: [*]const u8, output_ptr: [*]u8, pixels: u32) void {
    invertPacked(input_ptr, output_ptr, @intCast(pixels));
}

export fn rgba_grayscale(input_ptr: [*]const u8, output_ptr: [*]u8, pixels: u32) void {
    grayscaleContiguous(input_ptr, output_ptr, @intCast(pixels));
}

export fn rgba_sharpen3x3(input_ptr: [*]const u8, output_ptr: [*]u8, width: u32, height: u32) void {
    sharpenTile(input_ptr, output_ptr, @intCast(width), @intCast(height), 0, 0, @intCast(width), @intCast(height));
}

export fn rgba_box_blur3x3(input_ptr: [*]const u8, output_ptr: [*]u8, width: u32, height: u32) void {
    boxBlurTile(input_ptr, output_ptr, @intCast(width), @intCast(height), 0, 0, @intCast(width), @intCast(height));
}

export fn rgba_unsharp_mask(input_ptr: [*]const u8, output_ptr: [*]u8, width: u32, height: u32) void {
    unsharpMaskTile(input_ptr, output_ptr, @intCast(width), @intCast(height), 0, 0, @intCast(width), @intCast(height));
}

export fn rgba_apply_alpha_mask(input_ptr: [*]const u8, mask_ptr: [*]const u8, output_ptr: [*]u8, pixels: u32) void {
    var pixel: usize = 0;
    const pixel_count: usize = @intCast(pixels);

    while (pixel < pixel_count) : (pixel += 1) {
        const index = pixel * CHANNELS;
        output_ptr[index] = input_ptr[index];
        output_ptr[index + 1] = input_ptr[index + 1];
        output_ptr[index + 2] = input_ptr[index + 2];
        const alpha: u32 = input_ptr[index + 3];
        const matte: u32 = mask_ptr[pixel];
        output_ptr[index + 3] = @intCast((alpha * matte + 127) / 255);
    }
}

export fn rgba_filter_tile(
    input_ptr: [*]const u8,
    output_ptr: [*]u8,
    input_width: u32,
    input_height: u32,
    output_offset_x: u32,
    output_offset_y: u32,
    output_width: u32,
    output_height: u32,
    filter: u32,
) void {
    const in_w: usize = @intCast(input_width);
    const in_h: usize = @intCast(input_height);
    const out_x: usize = @intCast(output_offset_x);
    const out_y: usize = @intCast(output_offset_y);
    const out_w: usize = @intCast(output_width);
    const out_h: usize = @intCast(output_height);

    switch (filter) {
        FILTER_IDENTITY => copyTile(input_ptr, output_ptr, in_w, out_x, out_y, out_w, out_h),
        FILTER_INVERT => invertTile(input_ptr, output_ptr, in_w, out_x, out_y, out_w, out_h),
        FILTER_GRAYSCALE => grayscaleTile(input_ptr, output_ptr, in_w, out_x, out_y, out_w, out_h),
        FILTER_SHARPEN3X3 => sharpenTile(input_ptr, output_ptr, in_w, in_h, out_x, out_y, out_w, out_h),
        FILTER_SMOOTH_ENHANCE => smoothEnhanceTile(input_ptr, output_ptr, in_w, in_h, out_x, out_y, out_w, out_h),
        FILTER_BOX_BLUR3X3 => boxBlurTile(input_ptr, output_ptr, in_w, in_h, out_x, out_y, out_w, out_h),
        FILTER_UNSHARP_MASK => unsharpMaskTile(input_ptr, output_ptr, in_w, in_h, out_x, out_y, out_w, out_h),
        else => {},
    }
}

export fn rgba_estimate_tile_bytes(tile_width: u32, tile_height: u32, overlap: u32) u64 {
    const expanded_w: u64 = @as(u64, tile_width) + @as(u64, overlap) * 2;
    const expanded_h: u64 = @as(u64, tile_height) + @as(u64, overlap) * 2;
    const output_bytes: u64 = @as(u64, tile_width) * @as(u64, tile_height) * CHANNELS;
    const input_bytes: u64 = expanded_w * expanded_h * CHANNELS;
    return input_bytes + output_bytes;
}

fn copyTile(input_ptr: [*]const u8, output_ptr: [*]u8, input_width: usize, offset_x: usize, offset_y: usize, width: usize, height: usize) void {
    var y: usize = 0;
    while (y < height) : (y += 1) {
        const source_start = pixelIndex(offset_x, offset_y + y, input_width);
        const dest_start = y * width * CHANNELS;
        @memcpy(output_ptr[dest_start .. dest_start + width * CHANNELS], input_ptr[source_start .. source_start + width * CHANNELS]);
    }
}

fn invertPacked(input_ptr: [*]const u8, output_ptr: [*]u8, pixels: usize) void {
    var index: usize = 0;

    while (index + 8 <= pixels) : (index += 8) {
        invertPixel(input_ptr + index * CHANNELS, output_ptr + index * CHANNELS);
        invertPixel(input_ptr + (index + 1) * CHANNELS, output_ptr + (index + 1) * CHANNELS);
        invertPixel(input_ptr + (index + 2) * CHANNELS, output_ptr + (index + 2) * CHANNELS);
        invertPixel(input_ptr + (index + 3) * CHANNELS, output_ptr + (index + 3) * CHANNELS);
        invertPixel(input_ptr + (index + 4) * CHANNELS, output_ptr + (index + 4) * CHANNELS);
        invertPixel(input_ptr + (index + 5) * CHANNELS, output_ptr + (index + 5) * CHANNELS);
        invertPixel(input_ptr + (index + 6) * CHANNELS, output_ptr + (index + 6) * CHANNELS);
        invertPixel(input_ptr + (index + 7) * CHANNELS, output_ptr + (index + 7) * CHANNELS);
    }

    while (index < pixels) : (index += 1) {
        invertPixel(input_ptr + index * CHANNELS, output_ptr + index * CHANNELS);
    }
}

inline fn invertPixel(source: [*]const u8, dest: [*]u8) void {
    dest[0] = 255 - source[0];
    dest[1] = 255 - source[1];
    dest[2] = 255 - source[2];
    dest[3] = source[3];
}

fn invertTile(input_ptr: [*]const u8, output_ptr: [*]u8, input_width: usize, offset_x: usize, offset_y: usize, width: usize, height: usize) void {
    var y: usize = 0;
    while (y < height) : (y += 1) {
        const source = input_ptr + pixelIndex(offset_x, offset_y + y, input_width);
        const dest = output_ptr + y * width * CHANNELS;
        invertPacked(source, dest, width);
    }
}

fn grayscaleContiguous(input_ptr: [*]const u8, output_ptr: [*]u8, pixels: usize) void {
    var pixel: usize = 0;
    while (pixel + 4 <= pixels) : (pixel += 4) {
        grayscalePixel(input_ptr + pixel * CHANNELS, output_ptr + pixel * CHANNELS);
        grayscalePixel(input_ptr + (pixel + 1) * CHANNELS, output_ptr + (pixel + 1) * CHANNELS);
        grayscalePixel(input_ptr + (pixel + 2) * CHANNELS, output_ptr + (pixel + 2) * CHANNELS);
        grayscalePixel(input_ptr + (pixel + 3) * CHANNELS, output_ptr + (pixel + 3) * CHANNELS);
    }
    while (pixel < pixels) : (pixel += 1) {
        grayscalePixel(input_ptr + pixel * CHANNELS, output_ptr + pixel * CHANNELS);
    }
}

fn grayscaleTile(input_ptr: [*]const u8, output_ptr: [*]u8, input_width: usize, offset_x: usize, offset_y: usize, width: usize, height: usize) void {
    var y: usize = 0;
    while (y < height) : (y += 1) {
        var x: usize = 0;
        const source_row = input_ptr + pixelIndex(offset_x, offset_y + y, input_width);
        const dest_row = output_ptr + y * width * CHANNELS;

        while (x < width) : (x += 1) {
            grayscalePixel(source_row + x * CHANNELS, dest_row + x * CHANNELS);
        }
    }
}

inline fn grayscalePixel(source: [*]const u8, dest: [*]u8) void {
    const red: u32 = source[0];
    const green: u32 = source[1];
    const blue: u32 = source[2];
    const luma: u8 = @intCast((red * LUMA_R + green * LUMA_G + blue * LUMA_B) >> FIXED_SHIFT);
    dest[0] = luma;
    dest[1] = luma;
    dest[2] = luma;
    dest[3] = source[3];
}

fn sharpenTile(input_ptr: [*]const u8, output_ptr: [*]u8, input_width: usize, input_height: usize, offset_x: usize, offset_y: usize, width: usize, height: usize) void {
    var y: usize = 0;
    while (y < height) : (y += 1) {
        var x: usize = 0;
        while (x < width) : (x += 1) {
            const source_x = offset_x + x;
            const source_y = offset_y + y;
            const center = pixelIndex(source_x, source_y, input_width);
            const left = pixelIndex(if (source_x == 0) 0 else source_x - 1, source_y, input_width);
            const right = pixelIndex(if (source_x + 1 >= input_width) input_width - 1 else source_x + 1, source_y, input_width);
            const top = pixelIndex(source_x, if (source_y == 0) 0 else source_y - 1, input_width);
            const bottom = pixelIndex(source_x, if (source_y + 1 >= input_height) input_height - 1 else source_y + 1, input_width);
            const dest = (y * width + x) * CHANNELS;

            output_ptr[dest] = sharpenChannel(input_ptr, center, left, right, top, bottom, 0);
            output_ptr[dest + 1] = sharpenChannel(input_ptr, center, left, right, top, bottom, 1);
            output_ptr[dest + 2] = sharpenChannel(input_ptr, center, left, right, top, bottom, 2);
            output_ptr[dest + 3] = input_ptr[center + 3];
        }
    }
}

inline fn sharpenChannel(input_ptr: [*]const u8, center: usize, left: usize, right: usize, top: usize, bottom: usize, channel: usize) u8 {
    const current: i32 = input_ptr[center + channel];
    const l: i32 = input_ptr[left + channel];
    const r: i32 = input_ptr[right + channel];
    const t: i32 = input_ptr[top + channel];
    const b: i32 = input_ptr[bottom + channel];
    return clampU8(current * 5 - l - r - t - b);
}

fn smoothEnhanceTile(input_ptr: [*]const u8, output_ptr: [*]u8, input_width: usize, input_height: usize, offset_x: usize, offset_y: usize, width: usize, height: usize) void {
    detailEnhanceTile(input_ptr, output_ptr, input_width, input_height, offset_x, offset_y, width, height, 3, 8);
}

fn unsharpMaskTile(input_ptr: [*]const u8, output_ptr: [*]u8, input_width: usize, input_height: usize, offset_x: usize, offset_y: usize, width: usize, height: usize) void {
    detailEnhanceTile(input_ptr, output_ptr, input_width, input_height, offset_x, offset_y, width, height, 5, 8);
}

fn detailEnhanceTile(input_ptr: [*]const u8, output_ptr: [*]u8, input_width: usize, input_height: usize, offset_x: usize, offset_y: usize, width: usize, height: usize, detail_num: i32, detail_den: i32) void {
    var y: usize = 0;
    while (y < height) : (y += 1) {
        var x: usize = 0;
        while (x < width) : (x += 1) {
            const source_x = offset_x + x;
            const source_y = offset_y + y;
            const center = pixelIndex(source_x, source_y, input_width);
            const dest = (y * width + x) * CHANNELS;
            const neighbors = sample3x3Indexes(input_width, input_height, source_x, source_y);
            var channel: usize = 0;

            while (channel < 3) : (channel += 1) {
                const current: i32 = input_ptr[center + channel];
                const blur: i32 = gaussianBlurChannel(input_ptr, neighbors, channel);
                const detail = current - blur;
                output_ptr[dest + channel] = clampU8(current + @divTrunc(detail * detail_num, detail_den));
            }

            output_ptr[dest + 3] = input_ptr[center + 3];
        }
    }
}

fn boxBlurTile(input_ptr: [*]const u8, output_ptr: [*]u8, input_width: usize, input_height: usize, offset_x: usize, offset_y: usize, width: usize, height: usize) void {
    var y: usize = 0;
    while (y < height) : (y += 1) {
        var x: usize = 0;
        while (x < width) : (x += 1) {
            const source_x = offset_x + x;
            const source_y = offset_y + y;
            const center = pixelIndex(source_x, source_y, input_width);
            const dest = (y * width + x) * CHANNELS;
            const neighbors = sample3x3Indexes(input_width, input_height, source_x, source_y);
            var channel: usize = 0;

            while (channel < 3) : (channel += 1) {
                output_ptr[dest + channel] = boxBlurChannel(input_ptr, neighbors, channel);
            }

            output_ptr[dest + 3] = input_ptr[center + 3];
        }
    }
}

const Sample3x3 = struct {
    center: usize,
    top: usize,
    bottom: usize,
    left: usize,
    right: usize,
    top_left: usize,
    top_right: usize,
    bottom_left: usize,
    bottom_right: usize,
};

inline fn sample3x3Indexes(input_width: usize, input_height: usize, x: usize, y: usize) Sample3x3 {
    const left_x = if (x == 0) 0 else x - 1;
    const right_x = if (x + 1 >= input_width) input_width - 1 else x + 1;
    const top_y = if (y == 0) 0 else y - 1;
    const bottom_y = if (y + 1 >= input_height) input_height - 1 else y + 1;
    return .{
        .center = pixelIndex(x, y, input_width),
        .top = pixelIndex(x, top_y, input_width),
        .bottom = pixelIndex(x, bottom_y, input_width),
        .left = pixelIndex(left_x, y, input_width),
        .right = pixelIndex(right_x, y, input_width),
        .top_left = pixelIndex(left_x, top_y, input_width),
        .top_right = pixelIndex(right_x, top_y, input_width),
        .bottom_left = pixelIndex(left_x, bottom_y, input_width),
        .bottom_right = pixelIndex(right_x, bottom_y, input_width),
    };
}

inline fn gaussianBlurChannel(input_ptr: [*]const u8, indexes: Sample3x3, channel: usize) i32 {
    const center: i32 = input_ptr[indexes.center + channel];
    const top: i32 = input_ptr[indexes.top + channel];
    const bottom: i32 = input_ptr[indexes.bottom + channel];
    const left: i32 = input_ptr[indexes.left + channel];
    const right: i32 = input_ptr[indexes.right + channel];
    const corners: i32 = @as(i32, input_ptr[indexes.top_left + channel]) +
        @as(i32, input_ptr[indexes.top_right + channel]) +
        @as(i32, input_ptr[indexes.bottom_left + channel]) +
        @as(i32, input_ptr[indexes.bottom_right + channel]);
    return @divTrunc(corners + (top + bottom + left + right) * 2 + center * 4, 16);
}

inline fn boxBlurChannel(input_ptr: [*]const u8, indexes: Sample3x3, channel: usize) u8 {
    const total: u32 = @as(u32, input_ptr[indexes.top_left + channel]) +
        @as(u32, input_ptr[indexes.top + channel]) +
        @as(u32, input_ptr[indexes.top_right + channel]) +
        @as(u32, input_ptr[indexes.left + channel]) +
        @as(u32, input_ptr[indexes.center + channel]) +
        @as(u32, input_ptr[indexes.right + channel]) +
        @as(u32, input_ptr[indexes.bottom_left + channel]) +
        @as(u32, input_ptr[indexes.bottom + channel]) +
        @as(u32, input_ptr[indexes.bottom_right + channel]);
    return @intCast((total + 4) / 9);
}

fn pixelIndex(x: usize, y: usize, width: usize) usize {
    return (y * width + x) * CHANNELS;
}

fn clampU8(value: i32) u8 {
    if (value <= 0) return 0;
    if (value >= 255) return 255;
    return @intCast(value);
}

const testing = @import("std").testing;

test "whole-image kernels preserve alpha and match fixed-point output" {
    const input = [_]u8{ 10, 20, 30, 77, 200, 100, 50, 128 };
    var inverted: [input.len]u8 align(4) = undefined;
    var grayscale: [input.len]u8 = undefined;

    rgba_invert(&input, &inverted, 2);
    rgba_grayscale(&input, &grayscale, 2);

    try testing.expectEqualSlices(u8, &.{ 245, 235, 225, 77, 55, 155, 205, 128 }, &inverted);
    try testing.expectEqualSlices(u8, &.{ 18, 18, 18, 77, 124, 124, 124, 128 }, &grayscale);
}

test "tile filter extracts and sharpens the requested core" {
    const pixel = [_]u8{ 10, 10, 10, 255 };
    var input: [9 * CHANNELS]u8 = undefined;
    for (0..9) |index| {
        @memcpy(input[index * CHANNELS ..][0..CHANNELS], &pixel);
    }
    input[4 * CHANNELS] = 100;
    input[4 * CHANNELS + 1] = 100;
    input[4 * CHANNELS + 2] = 100;
    var output: [CHANNELS]u8 = undefined;

    rgba_filter_tile(&input, &output, 3, 3, 1, 1, 1, 1, FILTER_SHARPEN3X3);

    try testing.expectEqualSlices(u8, &.{ 255, 255, 255, 255 }, &output);
}

test "enhancement kernels accumulate bright neighbors without u8 overflow" {
    const pixel = [_]u8{ 255, 255, 255, 255 };
    var input: [9 * CHANNELS]u8 = undefined;
    for (0..9) |index| {
        @memcpy(input[index * CHANNELS ..][0..CHANNELS], &pixel);
    }
    var blurred: [CHANNELS]u8 = undefined;
    var enhanced: [CHANNELS]u8 = undefined;

    rgba_filter_tile(&input, &blurred, 3, 3, 1, 1, 1, 1, FILTER_BOX_BLUR3X3);
    rgba_filter_tile(&input, &enhanced, 3, 3, 1, 1, 1, 1, FILTER_SMOOTH_ENHANCE);

    try testing.expectEqualSlices(u8, &pixel, &blurred);
    try testing.expectEqualSlices(u8, &pixel, &enhanced);
}

test "tile scratch estimate includes expanded input and core output" {
    try testing.expectEqual(@as(u64, 33_808), rgba_estimate_tile_bytes(64, 64, 1));
}
